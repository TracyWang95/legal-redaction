"""
OCR 服务
用于从图片中提取文字及其位置（优先 PaddleOCR-VL）
"""
from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from typing import List, Optional

from PIL import Image, ImageOps


@dataclass
class OCRItem:
    text: str
    x: float  # 归一化坐标 0-1
    y: float
    width: float
    height: float
    confidence: float
    label: str = "text"  # PaddleOCR-VL 的 label: text, title, seal, table 等


class OCRService:
    def __init__(self) -> None:
        self._ocr = None
        self._vl = None
        self._ready = False
        self._init_ocr()
        self._max_side = 1600

    def _init_ocr(self) -> None:
        # 优先使用 PaddleOCR-VL
        try:
            from paddleocr import PaddleOCRVL  # type: ignore
            self._vl = PaddleOCRVL()
            self._ready = True
            return
        except Exception as e:
            print(f"OCR-VL 初始化失败: {e}")
            self._vl = None

        try:
            from paddleocr import PaddleOCR  # type: ignore
            self._ocr = PaddleOCR(use_angle_cls=True, lang="ch")
            self._ready = True
        except Exception as e:
            # 未安装 OCR 依赖时直接降级
            print(f"OCR 初始化失败: {e}")
            self._ocr = None
            self._ready = False

    def is_available(self) -> bool:
        return self._ready and (self._vl is not None or self._ocr is not None)

    def _extract_from_vl(self, image: Image.Image) -> List[OCRItem]:
        if not self._vl:
            return []

        width, height = image.size

        try:
            import numpy as np
            # PaddleOCR-VL 只接受 numpy 数组或文件路径，不接受 PIL.Image
            img_arr = np.array(image)
            outputs = self._vl.predict(img_arr)
        except Exception as e:
            print(f"[OCR-VL] 预测失败: {e}")
            return []

        if not outputs:
            return []

        items: List[OCRItem] = []
        raw_boxes = []
        
        for res in outputs:
            data = None
            # 获取 parsing_res_list
            parsing_list = None
            if hasattr(res, "parsing_res_list"):
                parsing_list = res.parsing_res_list
            elif hasattr(res, "__getitem__"):
                try:
                    parsing_list = res["parsing_res_list"]
                except:
                    pass
            
            # 解析 PaddleOCR-VL 1.5 的 parsing_res_list
            if parsing_list:
                for blk in parsing_list:
                    try:
                        # PaddleOCRVLBlock: label, content, bbox
                        label = getattr(blk, "label", "") or ""
                        content = getattr(blk, "content", "") or ""
                        box = getattr(blk, "bbox", None)
                    except:
                        continue
                    
                    # seal/印章区域保留 label，后续单独处理
                    if label == "seal":
                        content = "[公章]"  # 用特殊文本标记
                    
                    if not box or len(box) != 4:
                        continue
                    
                    # 公章可以没有 content，但必须有 bbox
                    if not content and label != "seal":
                        continue
                    
                    raw_boxes.append({
                        "text": str(content) if content else "[公章]",
                        "box": [float(x) for x in box],  # 转为浮点数列表
                        "confidence": 0.9,
                        "label": label,  # 保留原始 label
                    })
                continue  # 已解析完，跳过旧格式
            
            # 兼容旧版本输出格式
            if hasattr(res, "to_dict"):
                try:
                    data = res.to_dict()
                except Exception:
                    data = None
            if data is None:
                data = res
            blocks = []
            if isinstance(data, dict):
                for key in ["text_blocks", "blocks", "texts", "text", "ocr"]:
                    if key in data and isinstance(data[key], list):
                        blocks = data[key]
                        break
            if not blocks and isinstance(data, list):
                blocks = data

            for blk in blocks:
                if not isinstance(blk, dict):
                    continue
                text = blk.get("text") or blk.get("label") or ""
                if not text:
                    continue
                box = blk.get("box") or blk.get("bbox") or blk.get("box_2d")
                if not box:
                    poly = blk.get("polygon") or blk.get("points")
                    if poly and isinstance(poly, list) and len(poly) >= 4:
                        xs = [p[0] for p in poly]
                        ys = [p[1] for p in poly]
                        box = [min(xs), min(ys), max(xs), max(ys)]
                if not box or len(box) != 4:
                    continue

                raw_boxes.append(
                    {
                        "text": str(text),
                        "box": box,
                        "confidence": float(blk.get("score") or blk.get("confidence") or 0),
                    }
                )

        if not raw_boxes:
            return []

        # 判断坐标系类型：归一化(0-1) 还是像素坐标
        max_x = max(b["box"][2] for b in raw_boxes if len(b["box"]) == 4)
        max_y = max(b["box"][3] for b in raw_boxes if len(b["box"]) == 4)

        # 坐标空间大小
        if max(max_x, max_y) <= 1.5:
            # 归一化坐标 (0-1)
            space_w, space_h = 1.0, 1.0
        else:
            # 像素坐标，使用图像实际宽高作为空间大小
            space_w, space_h = float(width), float(height)

        def map_point(x: float, y: float) -> tuple[float, float]:
            # 统一按空间缩放到当前输入图像尺寸
            return x / space_w * width, y / space_h * height

        for rb in raw_boxes:
            box = rb["box"]
            if len(box) != 4:
                continue
            xmin, ymin, xmax, ymax = box
            xmin, ymin = map_point(xmin, ymin)
            xmax, ymax = map_point(xmax, ymax)

            # 纠正坐标方向
            if xmin > xmax:
                xmin, xmax = xmax, xmin
            if ymin > ymax:
                ymin, ymax = ymax, ymin

            # 裁剪到图像范围
            xmin = max(0.0, min(xmin, width))
            xmax = max(0.0, min(xmax, width))
            ymin = max(0.0, min(ymin, height))
            ymax = max(0.0, min(ymax, height))

            w = max(1.0, xmax - xmin)
            h = max(1.0, ymax - ymin)
            items.append(
                OCRItem(
                    text=rb["text"],
                    x=float(xmin / width),
                    y=float(ymin / height),
                    width=float(w / width),
                    height=float(h / height),
                    confidence=rb["confidence"],
                    label=rb.get("label", "text"),  # 保留 label
                )
            )

        return items

    def _prepare_ocr_image(self, image_bytes: bytes) -> tuple[Image.Image, Image.Image, float, float]:
        """准备 OCR 输入图片，并返回缩放比例"""
        original = ImageOps.exif_transpose(Image.open(BytesIO(image_bytes)).convert("RGB"))
        orig_w, orig_h = original.size

        # 控制 OCR 输入尺寸，避免超大图影响识别
        max_side = max(orig_w, orig_h)
        if max_side > self._max_side:
            scale = self._max_side / max_side
            ocr_w = int(orig_w * scale)
            ocr_h = int(orig_h * scale)
            ocr_image = original.resize((ocr_w, ocr_h), Image.Resampling.LANCZOS)
        else:
            ocr_image = original
            ocr_w, ocr_h = orig_w, orig_h

        scale_x = ocr_w / orig_w if orig_w else 1.0
        scale_y = ocr_h / orig_h if orig_h else 1.0

        return original, ocr_image, scale_x, scale_y

    def extract_text_boxes(self, image_bytes: bytes) -> List[OCRItem]:
        if not self.is_available():
            return []

        original, ocr_image, scale_x, scale_y = self._prepare_ocr_image(image_bytes)
        ocr_w, ocr_h = ocr_image.size

        # PaddleOCR-VL 优先
        vl_items = self._extract_from_vl(ocr_image)
        if vl_items:
            # 将 OCR 输入归一化坐标映射回原图
            mapped: List[OCRItem] = []
            for item in vl_items:
                mapped.append(
                    OCRItem(
                        text=item.text,
                        x=item.x * scale_x,
                        y=item.y * scale_y,
                        width=item.width * scale_x,
                        height=item.height * scale_y,
                        confidence=item.confidence,
                    )
                )
            return mapped

        try:
            import numpy as np  # type: ignore
        except Exception:
            return []

        img_arr = np.array(ocr_image)

        # PaddleOCR 返回结构：[[[points], (text, conf)], ...]
        result = self._ocr.ocr(img_arr, cls=True)
        if not result or not result[0]:
            return []

        items: List[OCRItem] = []
        for line in result[0]:
            if not line or len(line) < 2:
                continue
            points = line[0]
            text, conf = line[1][0], line[1][1]
            if not text:
                continue

            xs = [p[0] for p in points]
            ys = [p[1] for p in points]
            xmin, xmax = min(xs), max(xs)
            ymin, ymax = min(ys), max(ys)
            w = max(1.0, xmax - xmin)
            h = max(1.0, ymax - ymin)

            # 先转为原图坐标，再归一化到原图
            xmin = xmin / scale_x
            xmax = xmax / scale_x
            ymin = ymin / scale_y
            ymax = ymax / scale_y

            orig_w, orig_h = original.size
            w = max(1.0, xmax - xmin)
            h = max(1.0, ymax - ymin)

            items.append(
                OCRItem(
                    text=text,
                    x=float(xmin / orig_w),
                    y=float(ymin / orig_h),
                    width=float(w / orig_w),
                    height=float(h / orig_h),
                    confidence=float(conf or 0),
                )
            )

        return items


ocr_service = OCRService()
