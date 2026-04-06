"""
数据安全 API 路由
存储信息查询与一键清理。
"""
from __future__ import annotations

import logging
import os

from fastapi import APIRouter

from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/safety", tags=["数据安全"])


@router.get("/storage-info")
async def storage_info():
    """返回数据存储路径信息，便于用户了解文件存放位置。"""
    upload_size = sum(
        os.path.getsize(os.path.join(settings.UPLOAD_DIR, f))
        for f in os.listdir(settings.UPLOAD_DIR)
        if os.path.isfile(os.path.join(settings.UPLOAD_DIR, f))
    ) if os.path.isdir(settings.UPLOAD_DIR) else 0
    output_size = sum(
        os.path.getsize(os.path.join(settings.OUTPUT_DIR, f))
        for f in os.listdir(settings.OUTPUT_DIR)
        if os.path.isfile(os.path.join(settings.OUTPUT_DIR, f))
    ) if os.path.isdir(settings.OUTPUT_DIR) else 0
    return {
        "upload_dir": os.path.realpath(settings.UPLOAD_DIR),
        "output_dir": os.path.realpath(settings.OUTPUT_DIR),
        "db_path": os.path.realpath(settings.JOB_DB_PATH),
        "upload_size_bytes": upload_size,
        "output_size_bytes": output_size,
        "total_size_bytes": upload_size + output_size,
    }


@router.post("/cleanup")
async def cleanup_all_data():
    """一键清理所有上传文件、匿名化产物和任务记录。"""
    from app.services.file_management_service import get_file_store, get_file_store_lock
    from app.services.job_store import get_job_store

    file_store = get_file_store()
    _file_store_lock = get_file_store_lock()
    # 先统计用户文件数（file_store 记录数，不是磁盘文件数）
    async with _file_store_lock:
        files_count = len(file_store)
        file_store.clear()
    # 清磁盘
    for d in (settings.UPLOAD_DIR, settings.OUTPUT_DIR):
        if os.path.isdir(d):
            for f in os.listdir(d):
                fp = os.path.join(d, f)
                if os.path.isfile(fp):
                    try:
                        os.remove(fp)
                    except OSError:
                        pass
    # 清任务
    store = get_job_store()
    jobs_list, _ = store.list_jobs(page=1, page_size=10000)
    jobs_count = len(jobs_list)
    for j in jobs_list:
        try:
            store.delete_job(j["id"])
        except Exception:
            pass
    logger.info("Cleanup: %d files, %d jobs", files_count, jobs_count)
    return {
        "files_removed": files_count,
        "jobs_removed": jobs_count,
    }
