"""
视觉识别服务
支持两种 Pipeline 模式:
1. OCR + HaS: 本地模型，适合文字多的场景
2. GLM Vision: 视觉大模型，适合公章、签字等场景
"""
import asyncio
import time
import base64
import io
import uuid
from typing import Optional
from PIL import Image, ImageDraw, ImageOps

from app.models.schemas import BoundingBox, FileType
from app.core.config import settings
from app.services.file_parser import FileParser
from app.services.hybrid_vision_service import get_hybrid_vision_service


class VisionService:
    """视觉识别服务"""
    
    def __init__(self):
        self.file_parser = FileParser()
        self.hybrid_service = get_hybrid_vision_service()
        self._glm_client = None
    
    def _get_glm_client(self):
        """延迟初始化 GLM 客户端"""
        if self._glm_client is None:
            from app.core.glm_client import GLMClient
            self._glm_client = GLMClient()
        return self._glm_client
    
    async def detect_sensitive_regions(
        self,
        file_path: str,
        file_type: FileType,
        page: int = 1,
        draw_result: bool = True,
        pipeline_mode: str = "ocr_has",
        pipeline_types: list = None,
    ) -> tuple[list[BoundingBox], Optional[str]]:
        """
        检测图片/文档中的敏感区域
        
        Args:
            file_path: 文件路径
            file_type: 文件类型
            page: 页码 (对于 PDF)
            draw_result: 是否在图片上绘制检测框
            pipeline_mode: Pipeline 模式 (ocr_has 或 glm_vision)
            pipeline_types: 该模式下启用的类型配置列表
            
        Returns:
            (敏感区域边界框列表, 带框图片base64)
        """
        # 获取图片数据
        if file_type == FileType.IMAGE:
            image_data = await self.file_parser.read_image(file_path)
        elif file_type in [FileType.PDF, FileType.PDF_SCANNED]:
            image_data = await self.file_parser.get_pdf_page_image(file_path, page)
        else:
            raise ValueError(f"Unsupported file type for vision: {file_type}")
        
        print(f"[PIPE] Using pipeline: {pipeline_mode}")
        
        # 根据 pipeline 模式选择处理方式
        if pipeline_mode == "glm_vision":
            # GLM Vision Pipeline
            bounding_boxes, result_image_base64 = await self._detect_with_glm(
                image_data, page, pipeline_types
            )
        else:
            # OCR + HaS Pipeline (默认)
            bounding_boxes, result_image_base64 = await self._detect_with_ocr_has(
                image_data, page, pipeline_types
            )
        
        print(f"[OK] Vision detect done ({pipeline_mode}): {len(bounding_boxes)} regions")
        return bounding_boxes, result_image_base64
    
    async def detect_with_dual_pipeline(
        self,
        file_path: str,
        file_type: FileType,
        page: int = 1,
        ocr_has_types: list = None,
        glm_vision_types: list = None,
    ) -> tuple[list[BoundingBox], Optional[str]]:
        """
        双 Pipeline 检测：同时运行 OCR+HaS 和 GLM Vision，合并结果
        
        Args:
            file_path: 文件路径
            file_type: 文件类型
            page: 页码
            ocr_has_types: OCR+HaS Pipeline 启用的类型（None 表示不运行）
            glm_vision_types: GLM Vision Pipeline 启用的类型（None 表示不运行）
        """
        # 获取图片数据
        if file_type == FileType.IMAGE:
            image_data = await self.file_parser.read_image(file_path)
        elif file_type in [FileType.PDF, FileType.PDF_SCANNED]:
            image_data = await self.file_parser.get_pdf_page_image(file_path, page)
        else:
            raise ValueError(f"Unsupported file type for vision: {file_type}")
        
        all_boxes: list[BoundingBox] = []
        
        total_start = time.perf_counter()
        
        async def timed(label: str, coro):
            start = time.perf_counter()
            try:
                return await coro
            finally:
                elapsed = time.perf_counter() - start
                print(f"[PERF] {label} finished in {elapsed:.2f}s")
        
        # 1. 并行运行 OCR + HaS 与 GLM Vision
        ocr_task = None
        glm_task = None

        if ocr_has_types:
            print(f"[PIPE] Running OCR+HaS with {len(ocr_has_types)} types...")
            ocr_task = asyncio.create_task(
                timed("ocr_has", self._detect_with_ocr_has(image_data, page, ocr_has_types))
            )
        else:
            print("[PIPE] OCR+HaS skipped (no types enabled)")
        
        if glm_vision_types:
            print(f"[PIPE] Running GLM Vision with {len(glm_vision_types)} types...")
            glm_task = asyncio.create_task(
                timed("glm_vision", self._detect_with_glm(image_data, page, glm_vision_types))
            )
        else:
            print("[PIPE] GLM Vision skipped (no types enabled)")

        results = []
        tasks = []
        labels = []
        if ocr_task:
            tasks.append(ocr_task)
            labels.append("ocr_has")
        if glm_task:
            tasks.append(glm_task)
            labels.append("glm_vision")

        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)

        for label, result in zip(labels, results):
            if isinstance(result, Exception):
                print(f"[PIPE] {label} failed: {result}")
                continue
            boxes, _ = result
            all_boxes.extend(boxes)
            print(f"[PIPE] {label} found {len(boxes)} regions")
        
        # 2.5 去重：如果 OCR 和 GLM 检测到重叠区域，优先保留 OCR 结果
        pre_dedup = len(all_boxes)
        all_boxes = self._deduplicate_boxes(all_boxes)
        
        # 3. 在图片上绘制所有检测框
        img = Image.open(io.BytesIO(image_data))
        img = ImageOps.exif_transpose(img)
        result_image_base64 = self._draw_boxes_on_image(img, all_boxes)
        
        total_elapsed = time.perf_counter() - total_start
        print(f"[OK] Dual pipeline total: {len(all_boxes)} regions, {total_elapsed:.2f}s")
        return all_boxes, result_image_base64
    
    def _calculate_iou(self, box1: BoundingBox, box2: BoundingBox) -> float:
        """计算两个边界框的 IoU（交并比）"""
        # 计算交集
        x1 = max(box1.x, box2.x)
        y1 = max(box1.y, box2.y)
        x2 = min(box1.x + box1.width, box2.x + box2.width)
        y2 = min(box1.y + box1.height, box2.y + box2.height)
        
        if x2 <= x1 or y2 <= y1:
            return 0.0
        
        intersection = (x2 - x1) * (y2 - y1)
        area1 = box1.width * box1.height
        area2 = box2.width * box2.height
        union = area1 + area2 - intersection
        
        if union <= 0:
            return 0.0
        
        return intersection / union
    
    def _deduplicate_boxes(
        self, 
        boxes: list[BoundingBox], 
        iou_threshold: float = 0.3
    ) -> list[BoundingBox]:
        """
        去除重叠的边界框，优先保留 OCR 结果
        
        Args:
            boxes: 所有边界框
            iou_threshold: IoU 阈值，超过此值认为重叠
        
        Returns:
            去重后的边界框列表
        """
        if len(boxes) <= 1:
            return boxes
        
        # 按来源分组：OCR 优先
        ocr_boxes = [b for b in boxes if b.source == "ocr_has"]
        glm_boxes = [b for b in boxes if b.source == "glm_vision"]
        other_boxes = [b for b in boxes if b.source not in ("ocr_has", "glm_vision")]
        
        # OCR 结果全部保留
        result = list(ocr_boxes)
        
        # GLM 结果：只保留与 OCR 不重叠的
        for glm_box in glm_boxes:
            is_duplicate = False
            for ocr_box in ocr_boxes:
                iou = self._calculate_iou(glm_box, ocr_box)
                if iou > iou_threshold:
                    print(f"[DEDUP] GLM '{glm_box.type}' overlaps with OCR '{ocr_box.type}' (IoU={iou:.2f}), skipping GLM")
                    is_duplicate = True
                    break
            if not is_duplicate:
                result.append(glm_box)
        
        # 其他来源也检查重叠
        for other_box in other_boxes:
            is_duplicate = False
            for existing_box in result:
                iou = self._calculate_iou(other_box, existing_box)
                if iou > iou_threshold:
                    is_duplicate = True
                    break
            if not is_duplicate:
                result.append(other_box)
        
        removed_count = len(boxes) - len(result)
        if removed_count > 0:
            print(f"[DEDUP] Removed {removed_count} duplicate boxes")
        
        return result
    
    async def _detect_with_ocr_has(
        self,
        image_data: bytes,
        page: int,
        pipeline_types: list = None,
    ) -> tuple[list[BoundingBox], Optional[str]]:
        """OCR + HaS Pipeline"""
        # 使用混合服务检测
        regions, result_image_base64 = await self.hybrid_service.detect_and_draw(
            image_data, 
            vision_types=pipeline_types,
        )
        
        # 获取图片尺寸用于坐标转换
        img = Image.open(io.BytesIO(image_data))
        img = ImageOps.exif_transpose(img)
        width, height = img.size
        
        # 将 SensitiveRegion 转换为 BoundingBox
        bounding_boxes = []
        for i, region in enumerate(regions):
            bbox = BoundingBox(
                id=f"ocr_{i}_{uuid.uuid4().hex[:8]}",
                x=region.left / width,
                y=region.top / height,
                width=region.width / width,
                height=region.height / height,
                type=region.entity_type,
                text=region.text,
                page=page,
                source="ocr_has",  # 标注来源
            )
            bounding_boxes.append(bbox)
        
        return bounding_boxes, result_image_base64
    
    async def _detect_with_glm(
        self,
        image_data: bytes,
        page: int,
        pipeline_types: list = None,
    ) -> tuple[list[BoundingBox], Optional[str]]:
        """GLM Vision Pipeline - 优先使用 MCP 服务"""
        glm_client = self._get_glm_client()
        
        # 构建类型提示和反向映射
        type_hints = []
        hint_to_id = {}  # 从 hint 映射回 type_id
        if pipeline_types:
            for t in pipeline_types:
                hint = t.name
                if hasattr(t, 'description') and t.description:
                    hint += f"({t.description})"
                type_hints.append(hint)
                # 建立多种映射方式
                hint_to_id[hint] = t.id
                hint_to_id[t.name] = t.id
                if hasattr(t, 'description') and t.description:
                    hint_to_id[t.description] = t.id
        
        # 调用 GLM 视觉检测（内部会自动选择 MCP 或直连模式）
        glm_boxes = await glm_client.vision_detect(
            image_data, 
            custom_types=type_hints if type_hints else None,
        )
        
        # 获取图片尺寸
        img = Image.open(io.BytesIO(image_data))
        img = ImageOps.exif_transpose(img)
        width, height = img.size
        
        # 辅助函数：将 GLM 返回的类型映射回 type_id
        def map_type_to_id(glm_type: str) -> str:
            # 直接匹配
            if glm_type in hint_to_id:
                return hint_to_id[glm_type]
            # 模糊匹配：检查 hint 是否包含在 glm_type 中
            for hint, type_id in hint_to_id.items():
                if hint in glm_type or glm_type in hint:
                    return type_id
            # 关键词匹配
            type_lower = glm_type.lower()
            if any(kw in type_lower for kw in ['公章', '印章', '章', 'seal', 'stamp']):
                return 'SEAL'
            if any(kw in type_lower for kw in ['签名', '签字', 'signature']):
                return 'SIGNATURE'
            if any(kw in type_lower for kw in ['指纹', 'fingerprint']):
                return 'FINGERPRINT'
            if any(kw in type_lower for kw in ['照片', '头像', 'photo']):
                return 'PHOTO'
            if any(kw in type_lower for kw in ['二维码', 'qr']):
                return 'QR_CODE'
            # 默认返回第一个 pipeline_type 的 id，或原始类型
            if pipeline_types:
                return pipeline_types[0].id
            return glm_type
        
        # 转换 GLM 返回的坐标（已经是 0-1 归一化）
        bounding_boxes = []
        for i, box in enumerate(glm_boxes):
            mapped_type = map_type_to_id(box.type)
            bbox = BoundingBox(
                id=f"glm_{i}_{uuid.uuid4().hex[:8]}",
                x=box.x,
                y=box.y,
                width=box.width,
                height=box.height,
                type=mapped_type,
                text=box.text or "",
                page=page,
                source="glm_vision",  # 标注来源
            )
            bounding_boxes.append(bbox)
            print(f"[VLM] Mapped type: '{box.type}' -> '{mapped_type}'")
        
        # 尝试通过 MCP 画框（更精确），回退到本地画框
        result_image_base64 = await self._draw_boxes_via_mcp_or_local(
            image_data, img, bounding_boxes
        )
        
        return bounding_boxes, result_image_base64
    
    async def _draw_boxes_via_mcp_or_local(
        self,
        image_data: bytes,
        image: Image.Image,
        bounding_boxes: list[BoundingBox],
    ) -> str:
        """优先通过 MCP 画框，回退到本地（使用缓存的 MCP 状态）"""
        from app.core.glm_client import MCP_BASE_URL, is_mcp_available
        
        if is_mcp_available():  # 使用缓存，不会重复 HTTP 调用
            try:
                import httpx
                image_b64 = base64.b64encode(image_data).decode("utf-8")
                
                mcp_boxes = []
                for bbox in bounding_boxes:
                    mcp_boxes.append({
                        "id": bbox.id,
                        "x": bbox.x,
                        "y": bbox.y,
                        "width": bbox.width,
                        "height": bbox.height,
                        "type": bbox.type,
                        "text": bbox.text or "",
                        "confidence": 1.0,
                    })
                
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.post(
                        f"{MCP_BASE_URL}/mcp/draw",
                        json={
                            "image_base64": image_b64,
                            "boxes": mcp_boxes,
                        },
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    print(f"[MCP-DRAW] Drew {len(mcp_boxes)} boxes via MCP")
                    return data["result_image"]
            except Exception as e:
                print(f"[MCP-DRAW] Failed: {e}, falling back to local draw")
        
        # 回退到本地画框
        return self._draw_boxes_on_image(image, bounding_boxes)
    
    def _draw_boxes_on_image(
        self,
        image: Image.Image,
        bounding_boxes: list[BoundingBox],
    ) -> str:
        """在图片上绘制检测框并返回 base64"""
        import os
        
        draw_image = image.copy()
        draw = ImageDraw.Draw(draw_image)
        width, height = draw_image.size
        
        # 加载字体
        font = None
        font_paths = [
            "C:/Windows/Fonts/msyh.ttc",
            "C:/Windows/Fonts/simsun.ttc",
        ]
        try:
            from PIL import ImageFont
            for fp in font_paths:
                if os.path.exists(fp):
                    font = ImageFont.truetype(fp, 16)
                    break
        except:
            pass
        
        # 类型颜色映射
        type_colors = {
            "SIGNATURE": "#3B82F6",
            "SEAL": "#EF4444",
            "FINGERPRINT": "#F97316",
            "PHOTO": "#8B5CF6",
            "QR_CODE": "#10B981",
            "PERSON": "#3B82F6",
            "ID_CARD": "#EF4444",
            "BANK_CARD": "#EC4899",
        }
        
        for bbox in bounding_boxes:
            # 0-1 坐标转像素
            x1 = int(bbox.x * width)
            y1 = int(bbox.y * height)
            x2 = int((bbox.x + bbox.width) * width)
            y2 = int((bbox.y + bbox.height) * height)
            
            color = type_colors.get(bbox.type, "#6B7280")
            
            # 画框
            draw.rectangle([x1, y1, x2, y2], outline=color, width=2)
            
            # 画标签
            label = f"[{bbox.type}] {bbox.text[:10]}..." if len(bbox.text) > 10 else f"[{bbox.type}] {bbox.text}"
            if font:
                draw.text((x1, y1 - 20), label, fill=color, font=font)
            else:
                draw.text((x1, y1 - 12), label, fill=color)
        
        # 转 base64
        buffer = io.BytesIO()
        draw_image.save(buffer, format="PNG")
        return base64.b64encode(buffer.getvalue()).decode("utf-8")
    
    async def apply_redaction(
        self,
        file_path: str,
        file_type: FileType,
        bounding_boxes: list[BoundingBox],
        output_path: str,
    ) -> str:
        """
        应用脱敏（黑色覆盖）到图片
        
        Args:
            file_path: 原始文件路径
            file_type: 文件类型
            bounding_boxes: 要覆盖的区域列表
            output_path: 输出文件路径
            
        Returns:
            输出文件路径
        """
        if file_type == FileType.IMAGE:
            return await self._redact_image(file_path, bounding_boxes, output_path)
        elif file_type in [FileType.PDF, FileType.PDF_SCANNED]:
            return await self._redact_pdf(file_path, bounding_boxes, output_path)
        else:
            raise ValueError(f"不支持的文件类型进行脱敏: {file_type}")
    
    async def _redact_image(
        self,
        file_path: str,
        bounding_boxes: list[BoundingBox],
        output_path: str,
    ) -> str:
        """对图片应用黑色覆盖（不做 EXIF 处理，与 smartcity 一致）"""
        # 打开图片（不做 EXIF 处理）
        image = Image.open(file_path).convert("RGB")
        width, height = image.size
        
        draw = ImageDraw.Draw(image)
        
        for bbox in bounding_boxes:
            if not bbox.selected:
                continue
            
            # 0-1 坐标转像素
            x1 = int(bbox.x * width)
            y1 = int(bbox.y * height)
            x2 = int((bbox.x + bbox.width) * width)
            y2 = int((bbox.y + bbox.height) * height)
            
            draw.rectangle([x1, y1, x2, y2], fill="black")
        
        image.save(output_path)
        return output_path
    
    async def _redact_pdf(
        self,
        file_path: str,
        bounding_boxes: list[BoundingBox],
        output_path: str,
    ) -> str:
        """对 PDF 应用黑色覆盖"""
        import fitz
        
        # 打开 PDF
        doc = fitz.open(file_path)
        
        # 按页分组边界框
        boxes_by_page: dict[int, list[BoundingBox]] = {}
        for bbox in bounding_boxes:
            if not bbox.selected:
                continue
            page = bbox.page
            if page not in boxes_by_page:
                boxes_by_page[page] = []
            boxes_by_page[page].append(bbox)
        
        # 对每页应用覆盖
        for page_num, page_boxes in boxes_by_page.items():
            if page_num < 1 or page_num > len(doc):
                continue
            
            page = doc.load_page(page_num - 1)  # 0-based index
            page_rect = page.rect
            width = page_rect.width
            height = page_rect.height
            
            for bbox in page_boxes:
                # 将相对坐标转换为绝对坐标
                x1 = bbox.x * width
                y1 = bbox.y * height
                x2 = (bbox.x + bbox.width) * width
                y2 = (bbox.y + bbox.height) * height
                
                # 创建矩形
                rect = fitz.Rect(x1, y1, x2, y2)
                
                # 添加黑色矩形注释
                shape = page.new_shape()
                shape.draw_rect(rect)
                shape.finish(color=(0, 0, 0), fill=(0, 0, 0))
                shape.commit()
        
        # 保存 PDF
        doc.save(output_path)
        doc.close()
        
        return output_path
    
    async def preview_redaction(
        self,
        file_path: str,
        file_type: FileType,
        bounding_boxes: list[BoundingBox],
        page: int = 1,
    ) -> bytes:
        """
        生成脱敏预览图片（不保存到文件，不做 EXIF 处理）
        """
        # 获取原始图片
        if file_type == FileType.IMAGE:
            image_data = await self.file_parser.read_image(file_path)
        else:
            image_data = await self.file_parser.get_pdf_page_image(file_path, page)
        
        # 不做 EXIF 处理（与 smartcity 一致）
        image = Image.open(io.BytesIO(image_data)).convert("RGB")
        width, height = image.size
        draw = ImageDraw.Draw(image)
        
        # 只处理当前页的边界框
        page_boxes = [b for b in bounding_boxes if b.page == page and b.selected]
        
        for bbox in page_boxes:
            x1 = int(bbox.x * width)
            y1 = int(bbox.y * height)
            x2 = int((bbox.x + bbox.width) * width)
            y2 = int((bbox.y + bbox.height) * height)
            
            draw.rectangle([x1, y1, x2, y2], fill="black")
        
        output = io.BytesIO()
        image.save(output, format="PNG")
        output.seek(0)
        
        return output.getvalue()
