"""
PaddleOCR-VL 独立微服务
端口: 8082
与 HaS(8080)、GLM-4V(8081) 架构一致，独立进程运行

API:
  GET  /health          - 健康检查
  POST /ocr             - OCR识别（接收图片base64，返回文本块列表）
"""

import os
import sys
import base64
import time
import json
import numpy as np
from io import BytesIO
from dataclasses import dataclass, asdict
from typing import List, Optional

from PIL import Image, ImageOps, ImageDraw

# FastAPI
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="PaddleOCR-VL Service", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ============================================================
# OCR 引擎
# ============================================================

_vl = None
_ocr = None
_ready = False
_model_name = "PaddleOCR-VL-1.5"
MAX_SIDE = 1600


def init_ocr():
    global _vl, _ocr, _ready, _model_name
    # 优先 PaddleOCR-VL
    try:
        from paddleocr import PaddleOCRVL
        _vl = PaddleOCRVL()
        _ready = True
        _model_name = "PaddleOCR-VL-1.5"
        print(f"[OCR] {_model_name} loaded", flush=True)
        warmup()
        return
    except Exception as e:
        print(f"[OCR] PaddleOCR-VL init failed: {e}", flush=True)
        _vl = None

    # 降级 PaddleOCR
    try:
        from paddleocr import PaddleOCR
        _ocr = PaddleOCR(use_angle_cls=True, lang="ch")
        _ready = True
        _model_name = "PaddleOCR-2.x"
        print(f"[OCR] {_model_name} loaded (fallback)", flush=True)
    except Exception as e:
        print(f"[OCR] All OCR init failed: {e}", flush=True)
        _ready = False


def warmup():
    """预热模型"""
    if not _vl:
        return
    import tempfile
    try:
        print("[OCR] Warming up...", flush=True)
        img = Image.new('RGB', (300, 200), color='white')
        draw = ImageDraw.Draw(img)
        draw.text((50, 80), "Warmup Test", fill='black')
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
            temp_path = f.name
            img.save(f, format='PNG')
        _vl.predict(temp_path, max_new_tokens=256)
        os.remove(temp_path)
        print("[OCR] Warmup complete!", flush=True)
    except Exception as e:
        print(f"[OCR] Warmup failed: {e}", flush=True)


# ============================================================
# 数据模型
# ============================================================

class OCRRequest(BaseModel):
    image: str = Field(..., description="Base64编码的图片数据")
    max_new_tokens: int = Field(default=512, description="最大生成token数")


class OCRBox(BaseModel):
    text: str
    x: float       # 归一化坐标 0-1
    y: float
    width: float
    height: float
    confidence: float = 0.9
    label: str = "text"  # text, title, seal, table 等


class OCRResponse(BaseModel):
    boxes: List[OCRBox]
    model: str
    elapsed: float


# ============================================================
# OCR 核心逻辑
# ============================================================

def extract_vl(image: Image.Image, max_new_tokens: int = 512) -> List[OCRBox]:
    """使用 PaddleOCR-VL 提取"""
    if not _vl:
        return []

    width, height = image.size
    img_arr = np.array(image)

    try:
        outputs = _vl.predict(img_arr, max_new_tokens=max_new_tokens)
    except Exception as e:
        print(f"[OCR] predict failed: {e}")
        return []

    if not outputs:
        return []

    raw_boxes = []
    for res in outputs:
        parsing_list = None
        if hasattr(res, "parsing_res_list"):
            parsing_list = res.parsing_res_list
        elif hasattr(res, "__getitem__"):
            try:
                parsing_list = res["parsing_res_list"]
            except:
                pass

        if parsing_list:
            for blk in parsing_list:
                try:
                    label = getattr(blk, "label", "") or ""
                    content = getattr(blk, "content", "") or ""
                    box = getattr(blk, "bbox", None)
                except:
                    continue
                if label == "seal":
                    content = "[公章]"
                if not box or len(box) != 4:
                    continue
                if not content and label != "seal":
                    continue
                raw_boxes.append({
                    "text": str(content) if content else "[公章]",
                    "box": [float(x) for x in box],
                    "confidence": 0.9,
                    "label": label,
                })

    if not raw_boxes:
        return []

    # 坐标归一化
    max_x = max(b["box"][2] for b in raw_boxes)
    max_y = max(b["box"][3] for b in raw_boxes)
    if max(max_x, max_y) <= 1.5:
        space_w, space_h = 1.0, 1.0
    else:
        space_w, space_h = float(width), float(height)

    items = []
    for rb in raw_boxes:
        box = rb["box"]
        xmin, ymin, xmax, ymax = box
        xmin = xmin / space_w * width
        ymin = ymin / space_h * height
        xmax = xmax / space_w * width
        ymax = ymax / space_h * height
        if xmin > xmax: xmin, xmax = xmax, xmin
        if ymin > ymax: ymin, ymax = ymax, ymin
        xmin = max(0, min(xmin, width))
        xmax = max(0, min(xmax, width))
        ymin = max(0, min(ymin, height))
        ymax = max(0, min(ymax, height))
        w = max(1.0, xmax - xmin)
        h = max(1.0, ymax - ymin)
        items.append(OCRBox(
            text=rb["text"],
            x=xmin / width,
            y=ymin / height,
            width=w / width,
            height=h / height,
            confidence=rb["confidence"],
            label=rb.get("label", "text"),
        ))
    return items


def prepare_image(image_bytes: bytes) -> tuple:
    """准备OCR输入图片"""
    original = ImageOps.exif_transpose(Image.open(BytesIO(image_bytes)).convert("RGB"))
    orig_w, orig_h = original.size
    max_side = max(orig_w, orig_h)
    if max_side > MAX_SIDE:
        scale = MAX_SIDE / max_side
        ocr_w, ocr_h = int(orig_w * scale), int(orig_h * scale)
        ocr_image = original.resize((ocr_w, ocr_h), Image.Resampling.LANCZOS)
    else:
        ocr_image = original
        ocr_w, ocr_h = orig_w, orig_h
    scale_x = ocr_w / orig_w if orig_w else 1.0
    scale_y = ocr_h / orig_h if orig_h else 1.0
    return original, ocr_image, scale_x, scale_y


# ============================================================
# API 端点
# ============================================================

@app.get("/health")
async def health():
    return {
        "status": "online" if _ready else "offline",
        "model": _model_name,
        "ready": _ready,
    }


@app.post("/ocr", response_model=OCRResponse)
async def ocr_extract(request: OCRRequest):
    import asyncio
    
    if not _ready:
        raise HTTPException(status_code=503, detail="OCR service not ready")

    start = time.perf_counter()

    # 解码图片
    try:
        image_bytes = base64.b64decode(request.image)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image")

    original, ocr_image, scale_x, scale_y = prepare_image(image_bytes)

    # OCR识别 - 放到线程池中执行，避免阻塞事件循环
    loop = asyncio.get_event_loop()
    items = await loop.run_in_executor(
        None, 
        lambda: extract_vl(ocr_image, max_new_tokens=request.max_new_tokens)
    )

    # 坐标映射回原图
    mapped = []
    for item in items:
        mapped.append(OCRBox(
            text=item.text,
            x=item.x * scale_x,
            y=item.y * scale_y,
            width=item.width * scale_x,
            height=item.height * scale_y,
            confidence=item.confidence,
            label=item.label,
        ))

    elapsed = time.perf_counter() - start
    print(f"[OCR] {len(mapped)} boxes in {elapsed:.2f}s")

    return OCRResponse(boxes=mapped, model=_model_name, elapsed=elapsed)


# ============================================================
# 启动
# ============================================================

@app.on_event("startup")
async def startup():
    init_ocr()


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("OCR_PORT", "8082"))
    uvicorn.run("ocr_server:app", host="0.0.0.0", port=port, workers=1)
