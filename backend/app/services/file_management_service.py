"""
文件管理业务逻辑服务层 — 从 api/files.py 提取。

管理 file_store (SQLite) 实例、文件校验辅助、元数据组装、
JSON→SQLite 迁移、文件上传处理、批量下载 ZIP 等。
"""
from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import re
import shutil
import uuid
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Optional

import aiofiles

from app.core.config import settings
from app.core.persistence import load_json, to_jsonable
from app.models.schemas import (
    BatchDownloadRequest,
    FileListItem,
    FileType,
    FileUploadResponse,
    JobEmbedSummary,
    JobItemMini,
)
from app.services.file_store_db import FileStoreDB
from app.services.wizard_furthest import coerce_wizard_furthest_step, infer_batch_step1_configured

logger = logging.getLogger(__name__)

_BATCH_GROUP_ID_RE = re.compile(r"^[a-zA-Z0-9_.-]{1,80}$")
_BACKEND_ROOT = os.path.realpath(os.path.join(os.path.dirname(__file__), "..", ".."))
_PROJECT_ROOT = os.path.realpath(os.path.join(_BACKEND_ROOT, ".."))

# ---- Magic bytes for file validation ----
MAGIC_BYTES = {
    b'%PDF': {'.pdf'},
    b'PK\x03\x04': {'.docx', '.doc'},
    b'\xff\xd8\xff': {'.jpg', '.jpeg'},
    b'\x89PNG': {'.png'},
    b'GIF8': {'.gif'},
    b'BM': {'.bmp'},
    b'RIFF': {'.webp'},
    b'\xd0\xcf\x11\xe0': {'.doc', '.rtf'},
    b'II\x2a\x00': {'.tif', '.tiff'},
    b'MM\x00\x2a': {'.tif', '.tiff'},
    b'{\\rtf': {'.rtf'},
}

_TEXT_EXTENSIONS = frozenset({'.txt', '.md', '.rtf', '.html', '.htm'})

# ---------------------------------------------------------------------------
# Primary file store: SQLite-backed (FileStoreDB)
# ---------------------------------------------------------------------------
_file_store_db_path = os.path.join(settings.DATA_DIR, "file_store.sqlite3")
file_store: FileStoreDB = FileStoreDB(_file_store_db_path)

# Async lock — still needed for atomic read-modify-write sequences
_file_store_lock = asyncio.Lock()


# ---------------------------------------------------------------------------
# Helpers: sanitize / normalize
# ---------------------------------------------------------------------------

def sanitize_job_id(raw: Optional[str]) -> Optional[str]:
    """任务中心 Job UUID，合法则绑定 job_items。"""
    if not raw or not str(raw).strip():
        return None
    s = str(raw).strip()
    try:
        uuid.UUID(s)
    except (ValueError, TypeError):
        return None
    return s


def sanitize_upload_source(raw: Optional[str]) -> Optional[str]:
    if not raw or not str(raw).strip():
        return None
    s = str(raw).strip().lower()
    if s in ("playground", "batch"):
        return s
    return None


def effective_upload_source(info: dict) -> str:
    """兼容旧数据：无字段时按 batch_group_id / job_id 推断。"""
    u = info.get("upload_source")
    if u in ("playground", "batch"):
        return u
    if info.get("job_id") or info.get("batch_group_id"):
        return "batch"
    return "playground"


def sanitize_batch_group_id(raw: Optional[str]) -> Optional[str]:
    """批量向导会话 ID：UUID 或短标识，非法则忽略（视为单文件）。"""
    if not raw or not str(raw).strip():
        return None
    s = str(raw).strip()
    if len(s) > 80:
        s = s[:80]
    if not _BATCH_GROUP_ID_RE.match(s):
        return None
    return s


# ---------------------------------------------------------------------------
# File type / validation helpers
# ---------------------------------------------------------------------------

def normalize_file_type(value: Any) -> Any:
    """Normalize file_type string to FileType enum (used during JSON→SQLite migration)."""
    try:
        return FileType(value) if isinstance(value, str) else value
    except (ValueError, KeyError):
        return value


def get_file_type(filename: str) -> FileType:
    """根据文件扩展名判断文件类型"""
    ext = os.path.splitext(filename)[1].lower()
    if ext == ".doc":
        return FileType.DOC
    elif ext == ".docx":
        return FileType.DOCX
    elif ext in (".txt", ".md", ".rtf", ".html", ".htm"):
        return FileType.TXT
    elif ext == ".pdf":
        return FileType.PDF
    elif ext in (".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp", ".tif", ".tiff"):
        return FileType.IMAGE
    else:
        return None  # caller should raise HTTPException


def validate_magic_bytes(file_path: str, ext: str) -> bool:
    """Validate file magic bytes match extension. Reject unknown binary signatures."""
    try:
        with open(file_path, 'rb') as f:
            header = f.read(8)
        for magic, exts in MAGIC_BYTES.items():
            if header.startswith(magic):
                return ext in exts
        # 未知签名：仅允许纯文本类扩展名通过（文本文件无固定魔术字节）
        if ext in _TEXT_EXTENSIONS:
            return True
        # 非文本扩展名且无匹配签名 → 拒绝（防止伪造文件）
        return False
    except OSError:
        return False


def safe_path_in_dir(file_path: str, allowed_dir: str) -> bool:
    real_file = os.path.realpath(file_path)
    real_dir = os.path.realpath(allowed_dir)
    return real_file == real_dir or real_file.startswith(real_dir + os.sep)


# ---------------------------------------------------------------------------
# Entity / recognition counting helpers
# ---------------------------------------------------------------------------

def bounding_box_total(info: dict) -> int:
    """图像/视觉链：bounding_boxes 为 {page: [BoundingBox, ...]} 或列表。"""
    raw = info.get("bounding_boxes")
    if not raw:
        return 0
    if isinstance(raw, list):
        return len(raw)
    if isinstance(raw, dict):
        n = 0
        for v in raw.values():
            if isinstance(v, list):
                n += len(v)
        return n
    return 0


def recognition_count_from_stored_fields(info: dict) -> int:
    """仅从 file_store 已有字段推断条数（不含 redacted_count）。"""
    ents = info.get("entities")
    n_text = len(ents) if isinstance(ents, list) else 0
    n_boxes = bounding_box_total(info)
    n = n_text + n_boxes
    if n > 0:
        return n
    em = info.get("entity_map")
    if isinstance(em, dict) and len(em) > 0:
        return len(em)
    return 0


def entity_count(info: dict) -> int:
    """
    处理历史「识别项」数量：
    - 已生成脱敏文件时优先使用 redacted_count（执行接口落库）；
    - 否则根据 entities / bounding_boxes / entity_map 推断。
    """
    if bool(info.get("output_path")) and isinstance(info.get("redacted_count"), int):
        return int(info["redacted_count"])
    return recognition_count_from_stored_fields(info)


# ---------------------------------------------------------------------------
# Path normalization helpers
# ---------------------------------------------------------------------------

def _candidate_storage_dirs(preferred_dir: str) -> list[str]:
    """Allow migrating legacy records from either repo root or backend-local storage."""
    out: list[str] = []
    for raw in (
        preferred_dir,
        os.path.join(_BACKEND_ROOT, os.path.basename(preferred_dir)),
        os.path.join(_PROJECT_ROOT, os.path.basename(preferred_dir)),
    ):
        real = os.path.realpath(raw)
        if real not in out:
            out.append(real)
    return out


def _normalize_store_path(raw: object, preferred_dir: str) -> Optional[str]:
    if not isinstance(raw, str) or not raw.strip():
        return None
    path = raw.strip()
    if os.path.isabs(path) and os.path.exists(path):
        return os.path.realpath(path)

    basename = os.path.basename(path)
    if basename:
        for directory in _candidate_storage_dirs(preferred_dir):
            candidate = os.path.realpath(os.path.join(directory, basename))
            if os.path.exists(candidate):
                return candidate

    if os.path.isabs(path):
        return os.path.realpath(path)
    return os.path.realpath(os.path.join(preferred_dir, basename or path))


def repair_file_store_paths() -> int:
    """Normalize legacy relative paths so jobs/history survive restarts from any working directory."""
    repaired = 0
    for file_id, info in file_store.items():
        if not isinstance(info, dict):
            continue
        next_info = dict(info)
        changed = False

        normalized_file_path = _normalize_store_path(info.get("file_path"), settings.UPLOAD_DIR)
        if normalized_file_path and normalized_file_path != info.get("file_path"):
            next_info["file_path"] = normalized_file_path
            changed = True

        normalized_output_path = _normalize_store_path(info.get("output_path"), settings.OUTPUT_DIR)
        if normalized_output_path and normalized_output_path != info.get("output_path"):
            next_info["output_path"] = normalized_output_path
            changed = True

        if changed:
            file_store.set(file_id, next_info)
            repaired += 1

    return repaired


# ---------------------------------------------------------------------------
# JSON → SQLite migration
# ---------------------------------------------------------------------------

def migrate_json_to_sqlite() -> None:
    """Merge any JSON file_store entries into SQLite (idempotent)."""
    json_path = settings.FILE_STORE_PATH
    if not os.path.exists(json_path):
        return
    raw = load_json(json_path, default={}) or {}
    if not isinstance(raw, dict) or not raw:
        return
    count = 0
    for file_id, info in raw.items():
        if not isinstance(info, dict):
            continue
        file_path = info.get("file_path")
        if file_path:
            resolved = os.path.realpath(file_path)
            if not os.path.exists(resolved):
                logger.debug("Migration skip: file not found at %s (resolved: %s)", file_path, resolved)
                continue
            info["file_path"] = resolved
        info["file_type"] = normalize_file_type(info.get("file_type"))
        # Backfill redacted_count for old records
        if info.get("output_path") and not isinstance(info.get("redacted_count"), int):
            n = recognition_count_from_stored_fields(info)
            if n > 0:
                info["redacted_count"] = n
        file_store.set(file_id, info)
        count += 1
    if count:
        logger.info("Migrated %d files from JSON to SQLite file_store", count)
    # Backup old JSON file
    backup = json_path + ".migrated"
    try:
        os.rename(json_path, backup)
        logger.info("Old JSON file_store backed up to %s", backup)
    except OSError:
        pass


# Run migration and path repair at module import time (same as before)
migrate_json_to_sqlite()
_repaired_paths = repair_file_store_paths()
if _repaired_paths:
    logger.info("Normalized %d file_store path records", _repaired_paths)


# ---------------------------------------------------------------------------
# File list building
# ---------------------------------------------------------------------------

def build_file_list_items(
    filtered_entries: list[tuple[str, dict]],
    item_status_map: dict[str, dict],
) -> list[FileListItem]:
    """Build FileListItem list from filtered entries, grouped by batch."""
    batch_counts: dict[str, int] = defaultdict(int)
    for _fid, info in filtered_entries:
        bg = info.get("batch_group_id")
        if isinstance(bg, str) and bg.strip():
            batch_counts[bg.strip()] += 1

    raw_items: list[FileListItem] = []
    for fid, info in filtered_entries:
        ft = info.get("file_type")
        if ft is not None and not isinstance(ft, FileType):
            try:
                ft = FileType(ft) if isinstance(ft, str) else ft
            except (ValueError, KeyError):
                ft = FileType.DOCX
        bg_raw = info.get("batch_group_id")
        bg_key: Optional[str] = None
        if isinstance(bg_raw, str) and bg_raw.strip():
            bg_key = bg_raw.strip()
        cnt = batch_counts.get(bg_key) if bg_key else None
        eff = effective_upload_source(info)
        jid = info.get("job_id")
        job_key = jid.strip() if isinstance(jid, str) and jid.strip() else None
        raw_items.append(
            FileListItem(
                file_id=fid,
                original_filename=info.get("original_filename", ""),
                file_size=int(info.get("file_size", 0)),
                file_type=ft if isinstance(ft, FileType) else FileType.DOCX,
                created_at=info.get("created_at"),
                has_output=bool(info.get("output_path")),
                entity_count=entity_count(info),
                upload_source=eff,
                job_id=job_key,
                batch_group_id=bg_key,
                batch_group_count=cnt,
                item_status=(item_status_map.get(fid) or {}).get("status"),
                item_id=(item_status_map.get(fid) or {}).get("item_id"),
            )
        )
    return raw_items


def group_and_sort_items(raw_items: list[FileListItem]) -> list[FileListItem]:
    """Group items by batch, sort groups by newest timestamp descending."""
    groups: dict[str, list[FileListItem]] = defaultdict(list)
    for it in raw_items:
        gk = it.batch_group_id if it.batch_group_id else f"single:{it.file_id}"
        groups[gk].append(it)

    for gk in groups:
        groups[gk].sort(key=lambda x: x.created_at or "")

    def _group_max_ts(k: str) -> str:
        xs = groups[k]
        return max((x.created_at or "" for x in xs), default="")

    ordered_keys = sorted(groups.keys(), key=_group_max_ts, reverse=True)
    items: list[FileListItem] = []
    for k in ordered_keys:
        items.extend(groups[k])
    return items


def build_job_embed_map(page_items: list[FileListItem], store: Any) -> dict[str, JobEmbedSummary]:
    """Build job embed summaries for page items that have job_id."""
    jids = {it.job_id for it in page_items if it.job_id}
    embed_map: dict[str, JobEmbedSummary] = {}
    for jid in jids:
        row = store.get_job(jid)
        if not row:
            continue
        jt = row.get("job_type")
        if jt not in ("text_batch", "image_batch", "smart_batch"):
            continue
        raw_items = store.list_items(jid)
        mini = [JobItemMini(id=str(x["id"]), status=str(x["status"])) for x in raw_items]
        first_awaiting_embed: str | None = None
        for x in raw_items:
            if str(x.get("status")) == "awaiting_review":
                first_awaiting_embed = str(x["id"])
                break
        progress = {
            "total_items": len(raw_items),
            "pending": sum(1 for x in raw_items if str(x.get("status")) == "pending"),
            "queued": sum(1 for x in raw_items if str(x.get("status")) == "queued"),
            "parsing": sum(1 for x in raw_items if str(x.get("status")) == "parsing"),
            "ner": sum(1 for x in raw_items if str(x.get("status")) == "ner"),
            "vision": sum(1 for x in raw_items if str(x.get("status")) == "vision"),
            "awaiting_review": sum(1 for x in raw_items if str(x.get("status")) == "awaiting_review"),
            "review_approved": sum(1 for x in raw_items if str(x.get("status")) == "review_approved"),
            "redacting": sum(1 for x in raw_items if str(x.get("status")) == "redacting"),
            "completed": sum(1 for x in raw_items if str(x.get("status")) == "completed"),
            "failed": sum(1 for x in raw_items if str(x.get("status")) == "failed"),
            "cancelled": sum(1 for x in raw_items if str(x.get("status")) == "cancelled"),
        }
        try:
            cfg_row = json.loads(row.get("config_json") or "{}")
        except json.JSONDecodeError:
            cfg_row = {}
        wf_embed = coerce_wizard_furthest_step(cfg_row.get("wizard_furthest_step"))
        step1_ok = infer_batch_step1_configured(cfg_row, jt)
        embed_map[jid] = JobEmbedSummary(
            status=str(row["status"]),
            job_type=jt,
            items=mini,
            progress=progress,
            wizard_furthest_step=wf_embed,
            first_awaiting_review_item_id=first_awaiting_embed,
            batch_step1_configured=step1_ok,
        )
    return embed_map


# ---------------------------------------------------------------------------
# File upload processing
# ---------------------------------------------------------------------------

async def process_upload(
    file_path: str,
    file_ext: str,
    filename: str,
    file_size: int,
    batch_group_id: Optional[str],
    job_id: Optional[str],
    upload_source: Optional[str],
) -> FileUploadResponse:
    """
    Core upload processing after the file has been saved to disk.
    Validates magic bytes, runs virus scan, registers in file_store.
    Returns FileUploadResponse. Raises ValueError/RuntimeError on failure.
    """
    # 验证文件 magic bytes 与扩展名匹配
    if not validate_magic_bytes(file_path, file_ext):
        os.remove(file_path)
        raise ValueError(f"文件内容与扩展名 {file_ext} 不匹配，可能是伪造文件")

    # 病毒扫描
    from app.core.virus_scan import scan_file as _virus_scan
    scan_result = _virus_scan(file_path)
    if not scan_result.clean:
        os.remove(file_path)
        raise ValueError(f"文件包含恶意内容: {scan_result.virus_name}")
    if scan_result.error:
        logger.warning("Virus scan degraded for %s: %s", file_path, scan_result.error)

    ft = get_file_type(filename)
    if ft is None:
        ext = os.path.splitext(filename)[1].lower()
        os.remove(file_path)
        raise ValueError(f"不支持的文件类型: {ext}")

    # Prometheus: 记录上传
    from app.core.metrics import FILE_UPLOAD_TOTAL
    FILE_UPLOAD_TOTAL.labels(file_type=ft.value if hasattr(ft, 'value') else str(ft)).inc()

    file_id = os.path.splitext(os.path.basename(file_path))[0]
    created_at = datetime.now(timezone.utc)
    jid = sanitize_job_id(job_id)
    bg = sanitize_batch_group_id(batch_group_id)
    if jid:
        bg = jid

    us = sanitize_upload_source(upload_source)
    if jid:
        eff_source = "batch"
    elif bg:
        eff_source = "batch"
    else:
        if us == "batch":
            raise ValueError("upload_source=batch 时必须提供 batch_group_id 或 job_id")
        eff_source = us or "playground"

    # Sanitize original filename
    safe_original = os.path.basename(filename or "unnamed") if filename else "unnamed"
    safe_original = re.sub(r'[\x00-\x1f\x7f]', '', safe_original)
    if not safe_original or safe_original.startswith('.'):
        safe_original = f"upload{file_ext}"

    rec: dict = {
        "id": file_id,
        "original_filename": safe_original,
        "stored_filename": os.path.basename(file_path),
        "file_path": file_path,
        "file_type": ft,
        "file_size": file_size,
        "created_at": created_at.isoformat(),
        "upload_source": eff_source,
    }
    if bg:
        rec["batch_group_id"] = bg
    if jid:
        rec["job_id"] = jid

    async with _file_store_lock:
        file_store.set(file_id, rec)

    return FileUploadResponse(
        file_id=file_id,
        filename=filename,
        file_type=ft,
        file_size=file_size,
        created_at=created_at,
    ), jid


def register_file_with_job(job_id: str, file_id: str) -> None:
    """Register uploaded file with a batch job (add as job item)."""
    from app.services.job_store import JobStatus
    store = _get_job_store()
    row = store.get_job(job_id)
    if not row or row["status"] != JobStatus.DRAFT.value:
        raise ValueError("任务不存在或已不是草稿，无法追加文件")
    n = len(store.list_items(job_id))
    store.add_item(job_id, file_id, sort_order=n)
    store.touch_job_updated(job_id)


async def rollback_upload(file_id: str, file_path: str) -> None:
    """Rollback a file upload by removing from store and disk."""
    async with _file_store_lock:
        file_store.pop(file_id, None)
    if os.path.exists(file_path):
        os.remove(file_path)


def _get_job_store():
    """Deferred import to avoid circular dependency."""
    from app.api.jobs import get_job_store
    return get_job_store()


# ---------------------------------------------------------------------------
# Batch download ZIP
# ---------------------------------------------------------------------------

def build_batch_zip(request: BatchDownloadRequest) -> tuple[bytes, str]:
    """
    Build a ZIP file containing requested files.
    Returns (zip_bytes, filename). Raises ValueError on errors.
    """
    seen: set[str] = set()
    unique_ids: list[str] = []
    for fid in request.file_ids:
        if fid not in seen:
            seen.add(fid)
            unique_ids.append(fid)

    missing: list[str] = []
    pairs: list[tuple[str, str]] = []
    used_names: dict[str, int] = {}

    for fid in unique_ids:
        if fid not in file_store:
            missing.append(fid)
            continue
        info = file_store[fid]
        if request.redacted:
            path = info.get("output_path")
            if not path or not os.path.isfile(path):
                missing.append(fid)
                continue
            base = f"redacted_{os.path.basename(info.get('original_filename', 'file'))}"
        else:
            path = info.get("file_path")
            if not path or not os.path.isfile(path):
                missing.append(fid)
                continue
            base = os.path.basename(info.get("original_filename", "file"))

        safe = os.path.basename(base) or "file"
        n = used_names.get(safe, 0)
        used_names[safe] = n + 1
        arcname = safe if n == 0 else f"{n}_{safe}"
        pairs.append((path, arcname))

    if missing:
        raise ValueError(missing)  # caller turns into HTTPException with {"missing": ...}
    if not pairs:
        raise ValueError("没有可下载的文件（不存在或未脱敏）")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path, arcname in pairs:
            zf.write(path, arcname)
    buf.seek(0)
    zip_filename = "redacted_batch.zip" if request.redacted else "original_batch.zip"
    return buf.getvalue(), zip_filename


# ---------------------------------------------------------------------------
# File info / download / delete helpers
# ---------------------------------------------------------------------------

async def get_file_info(file_id: str) -> Optional[dict[str, Any]]:
    """Get file info dict under lock, or None."""
    async with _file_store_lock:
        info = file_store.get(file_id)
        if not info:
            return None
        return dict(info)


async def get_file_snapshot(file_id: str) -> Optional[dict[str, Any]]:
    """Get a snapshot (copy) of file info under lock."""
    async with _file_store_lock:
        info = file_store.get(file_id)
        if not info:
            return None
        return dict(info)


async def delete_file(file_id: str) -> Optional[dict[str, Any]]:
    """
    Delete file from store and disk. Returns the snapshot of deleted info,
    or None if file not found.
    """
    async with _file_store_lock:
        file_info = file_store.get(file_id)
        if not file_info:
            return None
        snapshot = dict(file_info)
        del file_store[file_id]

    # 删除原始文件
    fp = snapshot.get("file_path", "")
    if fp and os.path.exists(fp) and safe_path_in_dir(fp, settings.UPLOAD_DIR):
        os.remove(fp)

    # 删除脱敏后的文件
    op = snapshot.get("output_path", "")
    if op and os.path.exists(op) and safe_path_in_dir(op, settings.OUTPUT_DIR):
        os.remove(op)

    return snapshot


# ---------------------------------------------------------------------------
# Parse / NER helpers
# ---------------------------------------------------------------------------

async def parse_file(file_id: str) -> dict[str, Any]:
    """
    Parse an uploaded file. Returns ParseResult-compatible dict.
    Raises ValueError if file not found.
    """
    from app.services.file_parser import FileParser

    async with _file_store_lock:
        file_info = file_store.get(file_id)
        if not file_info:
            raise ValueError(f"file_id={file_id} NOT in file_store (keys={len(file_store)}, path={file_store._path})")
        snapshot = dict(file_info)

    file_path = snapshot["file_path"]
    file_type = snapshot["file_type"]

    parser = FileParser()
    result = await parser.parse(file_path, file_type)

    async with _file_store_lock:
        if file_id in file_store:
            file_store.update_fields(file_id, {
                "content": result.content,
                "pages": result.pages,
                "page_count": result.page_count,
                "is_scanned": result.is_scanned,
            })

    result.file_id = file_id
    return result


async def run_hybrid_ner(file_id: str, entity_type_ids: Optional[list[str]] = None) -> dict[str, Any]:
    """
    Run hybrid NER on parsed file. Returns NERResult-compatible values.
    Raises ValueError if file not found or not yet parsed.
    """
    from app.services.hybrid_ner_service import perform_hybrid_ner, HybridNERService

    async with _file_store_lock:
        file_info = file_store.get(file_id)
        if not file_info:
            raise ValueError("文件不存在")
        snapshot = dict(file_info)

    if "content" not in snapshot:
        raise ValueError("请先解析文件内容")

    if snapshot.get("is_scanned", False):
        return {"entities": [], "entity_count": 0, "entity_summary": {}, "warnings": []}

    content = snapshot["content"]

    from app.api.entity_types import get_enabled_types, entity_types_db

    if entity_type_ids:
        entity_types = [entity_types_db[tid] for tid in entity_type_ids if tid in entity_types_db]
    else:
        entity_types = get_enabled_types()

    warnings: list[str] = []
    if len(content) > HybridNERService.MAX_TEXT_LENGTH:
        warnings.append(
            f"文本过长（{len(content)} 字符），已截断至 {HybridNERService.MAX_TEXT_LENGTH} 字符，"
            "超出部分未进行识别。"
        )

    try:
        entities = await perform_hybrid_ner(content, entity_types)
        logger.info("混合识别完成，共 %d 个实体", len(entities))
    except Exception as e:
        logger.exception("混合识别失败: %s", e)
        entities = []

    entity_summary = {}
    for ent in entities:
        etype = ent.type
        entity_summary[etype] = entity_summary.get(etype, 0) + 1

    async with _file_store_lock:
        if file_id in file_store:
            file_store.update_fields(file_id, {"entities": entities})

    return {
        "entities": entities,
        "entity_count": len(entities),
        "entity_summary": entity_summary,
        "warnings": warnings,
    }


async def run_default_ner(file_id: str) -> dict[str, Any]:
    """Run NER with default entity types."""
    from app.services.hybrid_ner_service import perform_hybrid_ner

    async with _file_store_lock:
        file_info = file_store.get(file_id)
        if not file_info:
            raise ValueError("文件不存在")
        snapshot = dict(file_info)

    if "content" not in snapshot:
        raise ValueError("请先解析文件内容")

    if snapshot.get("is_scanned", False):
        return {"entities": [], "entity_count": 0, "entity_summary": {}}

    from app.api.entity_types import get_enabled_types
    entity_types = get_enabled_types()
    entities = await perform_hybrid_ner(snapshot["content"], entity_types)

    entity_summary = {}
    for ent in entities:
        etype = ent.type
        entity_summary[etype] = entity_summary.get(etype, 0) + 1

    async with _file_store_lock:
        if file_id in file_store:
            file_store.update_fields(file_id, {"entities": entities})

    return {
        "entities": entities,
        "entity_count": len(entities),
        "entity_summary": entity_summary,
    }
