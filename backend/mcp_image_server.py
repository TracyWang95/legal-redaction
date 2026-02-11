"""
本地图像处理 MCP 服务器
职责：
1. 图像预处理（EXIF 校正、尺寸获取）
2. 调用智谱 GLM-4.6V API 做视觉检测
3. 精确坐标转换（模型坐标 -> 像素坐标）
4. 在原图上精确画框
5. 通过 SSE 提供 MCP 协议接口

端口：8090
"""
import asyncio
import base64
import io
import json
import os
import re
import time
import uuid
from typing import List, Dict, Any, Optional, Tuple

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from PIL import Image, ImageDraw, ImageFont, ImageOps

# ─────────────────────────────────────────────
# 数据模型
# ─────────────────────────────────────────────

class DetectedObject(BaseModel):
    """检测到的目标"""
    type: str
    text: str = ""
    box_2d: List[int]  # [ymin, xmin, ymax, xmax] GLM 原始格式
    confidence: float = 1.0


class DetectionResult(BaseModel):
    """检测结果"""
    objects: List[DetectedObject] = []
    image_width: int = 0
    image_height: int = 0
    coord_system: str = "glm_1000"  # glm_1000 / pixel


class BBoxNormalized(BaseModel):
    """归一化坐标的边界框 (0-1)"""
    id: str
    x: float
    y: float
    width: float
    height: float
    type: str
    text: str = ""
    confidence: float = 1.0


class DrawRequest(BaseModel):
    """画框请求"""
    image_base64: str
    boxes: List[BBoxNormalized]


class DetectRequest(BaseModel):
    """检测请求"""
    image_base64: str
    detect_types: List[Dict[str, Any]] = []
    provider: str = "zhipu"  # zhipu / local
    api_key: Optional[str] = None
    model_name: str = "glm-4.6v"
    temperature: float = 0.8
    top_p: float = 0.8
    max_tokens: int = 8192
    enable_thinking: bool = False


class DetectAndDrawRequest(BaseModel):
    """检测+画框一体化请求"""
    image_base64: str
    detect_types: List[Dict[str, Any]] = []
    provider: str = "zhipu"
    api_key: Optional[str] = None
    model_name: str = "glm-4.6v"
    temperature: float = 0.8
    top_p: float = 0.8
    max_tokens: int = 8192
    enable_thinking: bool = False


# ─────────────────────────────────────────────
# 图像处理核心
# ─────────────────────────────────────────────

class ImageProcessor:
    """图像处理器"""

    # 发给 VLM API 的图片最大边长（太大会导致 API 传输慢）
    MAX_API_SIDE = 2048

    @staticmethod
    def load_image(image_base64: str) -> Tuple[Image.Image, bytes]:
        """加载图像，处理 EXIF 方向"""
        image_bytes = base64.b64decode(image_base64)
        img = Image.open(io.BytesIO(image_bytes))
        img = ImageOps.exif_transpose(img)
        if img.mode != "RGB":
            img = img.convert("RGB")
        # 重新编码（EXIF 校正后）
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=95)
        corrected_bytes = buf.getvalue()
        return img, corrected_bytes

    @staticmethod
    def prepare_for_api(img: Image.Image) -> bytes:
        """
        为 VLM API 准备图片：压缩大图以加速传输。
        坐标是 0-1000 归一化的，缩放不影响坐标精度。
        """
        w, h = img.size
        max_side = ImageProcessor.MAX_API_SIDE
        if max(w, h) > max_side:
            scale = max_side / max(w, h)
            new_w = int(w * scale)
            new_h = int(h * scale)
            img = img.resize((new_w, new_h), Image.LANCZOS)
            print(f"[MCP] Resized {w}x{h} -> {new_w}x{new_h} for API")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        return buf.getvalue()

    @staticmethod
    def get_font(size: int = 16) -> ImageFont.FreeTypeFont:
        """获取中文字体"""
        font_paths = [
            "C:/Windows/Fonts/msyh.ttc",
            "C:/Windows/Fonts/simhei.ttf",
            "C:/Windows/Fonts/simsun.ttc",
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
            "/System/Library/Fonts/PingFang.ttc",
        ]
        for fp in font_paths:
            try:
                return ImageFont.truetype(fp, size)
            except Exception:
                continue
        return ImageFont.load_default()

    @staticmethod
    def glm_box_to_normalized(
        box_2d: List[int],
        img_width: int,
        img_height: int,
        coord_base: int = 1000,
    ) -> Tuple[float, float, float, float]:
        """
        将 GLM 模型返回的坐标转换为 0-1 归一化坐标。
        
        经实测验证：
        智谱云端 API (glm-4.6v) 返回 [xmin, ymin, xmax, ymax]，范围 0-1000
        直接除以 1000 归一化。
        
        Returns:
            (x, y, width, height) 归一化到 0-1
        """
        if len(box_2d) != 4:
            return (0, 0, 0, 0)
        
        v0, v1, v2, v3 = [float(v) for v in box_2d]
        
        # 智谱云端格式: [xmin, ymin, xmax, ymax] / 1000
        xmin, ymin, xmax, ymax = v0, v1, v2, v3
        
        # 归一化到 0-1
        x1 = xmin / coord_base
        y1 = ymin / coord_base
        x2 = xmax / coord_base
        y2 = ymax / coord_base
        
        # 确保 min < max
        if x1 > x2:
            x1, x2 = x2, x1
        if y1 > y2:
            y1, y2 = y2, y1
        
        # 裁剪到 [0, 1]
        x1 = max(0.0, min(1.0, x1))
        y1 = max(0.0, min(1.0, y1))
        x2 = max(0.0, min(1.0, x2))
        y2 = max(0.0, min(1.0, y2))
        
        w = x2 - x1
        h = y2 - y1
        
        return (x1, y1, w, h)

    @staticmethod
    def auto_detect_coord_format(
        raw_boxes: List[List[int]],
        img_width: int,
        img_height: int,
    ) -> str:
        """
        自动检测坐标格式。
        
        智谱云端: [ymin, xmin, ymax, xmax] 范围 0-999
        本地 llama.cpp: [xmin, ymin, xmax, ymax] 范围 0-1000
        
        通过分析坐标值的分布来判断。
        """
        if not raw_boxes:
            return "zhipu"  # 默认
        
        # 检查最大值范围
        max_val = max(max(box) for box in raw_boxes if len(box) == 4)
        
        if max_val <= 1.0:
            return "normalized"  # 已经是 0-1
        elif max_val <= 1000:
            return "zhipu"  # 0-1000 范围
        else:
            return "pixel"  # 像素坐标
    
    @staticmethod
    def draw_boxes(
        image: Image.Image,
        boxes: List[BBoxNormalized],
        type_colors: Optional[Dict[str, str]] = None,
    ) -> Image.Image:
        """
        在图像上精确绘制检测框。
        
        Args:
            image: PIL 图像
            boxes: 归一化坐标的边界框列表
            type_colors: 类型颜色映射
        
        Returns:
            绘制了框的图像
        """
        draw_image = image.copy()
        draw = ImageDraw.Draw(draw_image)
        width, height = draw_image.size
        
        font = ImageProcessor.get_font(16)
        small_font = ImageProcessor.get_font(12)
        
        # 默认颜色
        default_colors = {
            "PERSON": "#3B82F6", "SIGNATURE": "#3B82F6",
            "SEAL": "#DC143C", "FINGERPRINT": "#F97316",
            "PHOTO": "#8B5CF6", "QR_CODE": "#10B981",
            "LOGO": "#6366F1", "HANDWRITING": "#06B6D4",
            "ID_CARD": "#EF4444", "PHONE": "#F97316",
            "BANK_CARD": "#EC4899", "ADDRESS": "#6366F1",
            "ORG": "#10B981", "COMPANY": "#14B8A6",
            "DATE": "#22D3EE", "AMOUNT": "#F43F5E",
            "WATERMARK": "#A3A3A3",
        }
        if type_colors:
            default_colors.update(type_colors)
        
        for bbox in boxes:
            # 归一化坐标 -> 像素坐标
            x1 = int(bbox.x * width)
            y1 = int(bbox.y * height)
            x2 = int((bbox.x + bbox.width) * width)
            y2 = int((bbox.y + bbox.height) * height)
            
            # 确保在图像范围内
            x1 = max(0, min(x1, width - 1))
            y1 = max(0, min(y1, height - 1))
            x2 = max(x1 + 1, min(x2, width))
            y2 = max(y1 + 1, min(y2, height))
            
            color = default_colors.get(bbox.type, "#007AFF")
            
            # 画框（3px 宽度，更清晰）
            draw.rectangle([x1, y1, x2, y2], outline=color, width=3)
            
            # 标签文字
            label = f"[{bbox.type}]"
            if bbox.text:
                display_text = bbox.text[:15] + ("..." if len(bbox.text) > 15 else "")
                label += f" {display_text}"
            
            # 计算标签尺寸
            try:
                text_bbox = draw.textbbox((0, 0), label, font=font)
                text_w = text_bbox[2] - text_bbox[0]
                text_h = text_bbox[3] - text_bbox[1]
            except Exception:
                text_w = len(label) * 10
                text_h = 16
            
            # 标签位置（框上方）
            label_y = max(0, y1 - text_h - 6)
            label_x = x1
            
            # 标签背景
            draw.rectangle(
                [label_x, label_y, label_x + text_w + 8, label_y + text_h + 4],
                fill=color,
            )
            draw.text((label_x + 4, label_y + 2), label, fill="#FFFFFF", font=font)
        
        return draw_image

    @staticmethod
    def image_to_base64(image: Image.Image, format: str = "PNG") -> str:
        """图像转 base64"""
        buf = io.BytesIO()
        image.save(buf, format=format, quality=95)
        return base64.b64encode(buf.getvalue()).decode("utf-8")


# ─────────────────────────────────────────────
# 智谱 GLM-4.6V API 调用
# ─────────────────────────────────────────────

class ZhipuVisionClient:
    """智谱 GLM-4.6V 视觉检测客户端"""
    
    @staticmethod
    def build_detect_prompt(detect_types: List[Dict[str, Any]]) -> str:
        """构建检测 prompt"""
        rules = []
        for i, dt in enumerate(detect_types, 1):
            name = dt.get("name", "")
            desc = dt.get("description", "")
            rule = f"{i}. 检测所有【{name}】"
            if desc:
                rule += f"：{desc}"
            rules.append(rule)
        
        if not rules:
            rules = [
                "1. 检测所有【签名/手写签名】",
                "2. 检测所有【印章/公章】",
                "3. 检测所有【指纹/手印】",
                "4. 检测所有【人物照片/头像】",
                "5. 检测所有【二维码/条形码】",
                "6. 检测所有【Logo/认证标志】",
            ]
        
        rules_text = "\n".join(rules)
        
        prompt = f"""请分析这张图片，精确定位所有敏感信息区域。

检测规则：
{rules_text}

请找出所有匹配的区域，用 box_2d 标注每个区域的位置。返回 JSON 格式：
{{"objects": [{{"type": "类型", "text": "内容", "box_2d": [x1, y1, x2, y2]}}]}}

要求：
1) 仔细扫描图片每一处，宁多勿漏
2) 边框要精确贴合目标区域
3) 同类信息多处出现时全部输出
4) 只返回 JSON，不要 Markdown 代码块"""
        
        return prompt
    
    @staticmethod
    async def detect(
        image_base64: str,
        detect_types: List[Dict[str, Any]],
        api_key: str,
        model_name: str = "glm-4.6v",
        temperature: float = 0.8,
        top_p: float = 0.8,
        max_tokens: int = 8192,
        enable_thinking: bool = False,
    ) -> List[Dict[str, Any]]:
        """
        调用智谱 GLM-4.6V API 进行视觉检测
        
        Returns:
            原始检测结果列表 [{type, text, box_2d}, ...]
        """
        prompt = ZhipuVisionClient.build_detect_prompt(detect_types)
        
        try:
            from zhipuai import ZhipuAI
            client = ZhipuAI(api_key=api_key)
            
            messages = [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}
                        },
                        {
                            "type": "text",
                            "text": prompt,
                        }
                    ]
                }
            ]
            
            kwargs = {
                "model": model_name,
                "messages": messages,
                "temperature": temperature,
                "top_p": top_p,
                "max_tokens": max_tokens,
            }
            
            if enable_thinking:
                kwargs["thinking"] = {"type": "enabled"}
            
            print(f"[MCP-VLM] Calling ZhipuAI {model_name}...")
            start = time.perf_counter()
            
            response = await asyncio.to_thread(
                lambda: client.chat.completions.create(**kwargs)
            )
            
            response_text = response.choices[0].message.content
            elapsed = time.perf_counter() - start
            print(f"[MCP-VLM] Response in {elapsed:.2f}s, length={len(response_text)}")
            print(f"[MCP-VLM] Raw response: {response_text[:500]}...")
            
            # 解析 JSON
            objects = ZhipuVisionClient._parse_response(response_text)
            print(f"[MCP-VLM] Parsed {len(objects)} objects")
            return objects
            
        except Exception as e:
            print(f"[MCP-VLM] Error: {e}")
            import traceback
            traceback.print_exc()
            return []
    
    @staticmethod
    def _parse_response(response_text: str) -> List[Dict[str, Any]]:
        """解析 GLM 返回的 JSON"""
        # 清理 markdown 代码块
        text = response_text.strip()
        if text.startswith("```"):
            # 去掉 ```json 和 ```
            text = re.sub(r'^```(?:json)?\s*', '', text)
            text = re.sub(r'\s*```$', '', text)
        
        # 方法1: 直接解析
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return parsed
            if isinstance(parsed, dict):
                return parsed.get("objects", [])
        except json.JSONDecodeError:
            pass
        
        # 方法2: 正则提取
        json_match = re.search(r'(\{.*\}|\[.*\])', text, re.DOTALL)
        if json_match:
            try:
                parsed = json.loads(json_match.group())
                if isinstance(parsed, list):
                    return parsed
                if isinstance(parsed, dict):
                    return parsed.get("objects", [])
            except json.JSONDecodeError:
                pass
        
        # 方法3: 逐个对象提取
        objects = []
        obj_pattern = r'\{[^{}]*"type"\s*:\s*"[^"]*"[^{}]*"box_2d"\s*:\s*\[[^\]]+\][^{}]*\}'
        for m in re.finditer(obj_pattern, text):
            try:
                obj = json.loads(m.group())
                objects.append(obj)
            except Exception:
                pass
        
        return objects


# ─────────────────────────────────────────────
# 类型映射
# ─────────────────────────────────────────────

TYPE_MAPPING = {
    # 签名
    "签名": "SIGNATURE", "手写签名": "SIGNATURE", "签字": "SIGNATURE",
    "手写": "SIGNATURE", "签名/手写签名": "SIGNATURE",
    # 印章
    "印章": "SEAL", "公章": "SEAL", "印章/公章": "SEAL",
    "合同章": "SEAL", "财务章": "SEAL", "法院印章": "SEAL",
    # 指纹
    "指纹": "FINGERPRINT", "手印": "FINGERPRINT", "指纹/手印": "FINGERPRINT",
    # 照片
    "照片": "PHOTO", "头像": "PHOTO", "证件照": "PHOTO",
    "人物照片": "PHOTO", "人物照片/头像": "PHOTO",
    # 二维码
    "二维码": "QR_CODE", "条形码": "QR_CODE", "二维码/条形码": "QR_CODE",
    # Logo
    "Logo": "LOGO", "logo": "LOGO", "LOGO": "LOGO",
    "认证标志": "LOGO", "Logo/认证标志": "LOGO", "标志": "LOGO",
    "CMA": "LOGO", "CNAS": "LOGO", "ILAC": "LOGO",
    # 手写
    "手写文字": "HANDWRITING", "手写批注": "HANDWRITING", "批注": "HANDWRITING",
    # 水印
    "水印": "WATERMARK",
    # 文字类
    "人名": "PERSON", "姓名": "PERSON",
    "身份证号": "ID_CARD", "身份证": "ID_CARD",
    "电话号码": "PHONE", "电话": "PHONE", "手机号": "PHONE",
    "银行卡号": "BANK_CARD", "银行卡": "BANK_CARD",
    "地址": "ADDRESS", "详细地址": "ADDRESS",
    "公司": "COMPANY", "企业": "COMPANY", "公司名称": "COMPANY",
    "机构": "ORG", "组织": "ORG",
    "日期": "DATE", "金额": "AMOUNT",
}


def normalize_type(raw_type: str) -> str:
    """标准化类型名称"""
    # 直接匹配
    if raw_type in TYPE_MAPPING:
        return TYPE_MAPPING[raw_type]
    # 大写匹配
    if raw_type.upper() in TYPE_MAPPING:
        return TYPE_MAPPING[raw_type.upper()]
    # 模糊匹配
    raw_lower = raw_type.lower()
    for key, val in TYPE_MAPPING.items():
        if key in raw_type or raw_type in key:
            return val
    # 关键词匹配
    if any(kw in raw_lower for kw in ['章', 'seal', 'stamp']):
        return 'SEAL'
    if any(kw in raw_lower for kw in ['签名', '签字', 'signature']):
        return 'SIGNATURE'
    if any(kw in raw_lower for kw in ['指纹', 'fingerprint']):
        return 'FINGERPRINT'
    if any(kw in raw_lower for kw in ['照片', '头像', 'photo']):
        return 'PHOTO'
    if any(kw in raw_lower for kw in ['二维码', 'qr']):
        return 'QR_CODE'
    if any(kw in raw_lower for kw in ['logo', '标志', '徽章']):
        return 'LOGO'
    return raw_type.upper()


# ─────────────────────────────────────────────
# FastAPI 应用
# ─────────────────────────────────────────────

app = FastAPI(title="Image Process MCP Server", version="1.0.0")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "image-process-mcp", "version": "1.0.0"}


@app.post("/mcp/detect")
async def mcp_detect(req: DetectRequest):
    """
    MCP 工具：视觉检测
    调用 GLM-4.6V API 检测图像中的敏感区域，返回归一化坐标
    """
    start = time.perf_counter()
    
    # 1. 加载并预处理图像
    img, corrected_bytes = ImageProcessor.load_image(req.image_base64)
    img_w, img_h = img.size
    
    # 压缩大图以加速 API 传输（坐标是归一化的，缩放不影响精度）
    api_bytes = ImageProcessor.prepare_for_api(img)
    api_b64 = base64.b64encode(api_bytes).decode("utf-8")
    
    orig_kb = len(corrected_bytes) / 1024
    api_kb = len(api_bytes) / 1024
    print(f"[MCP] Image loaded: {img_w}x{img_h}, orig={orig_kb:.0f}KB, api={api_kb:.0f}KB")
    
    # 2. 调用 GLM-4.6V API
    if req.provider == "zhipu" and req.api_key:
        raw_objects = await ZhipuVisionClient.detect(
            image_base64=api_b64,
            detect_types=req.detect_types,
            api_key=req.api_key,
            model_name=req.model_name,
            temperature=req.temperature,
            top_p=req.top_p,
            max_tokens=req.max_tokens,
            enable_thinking=req.enable_thinking,
        )
    else:
        return JSONResponse(
            status_code=400,
            content={"error": "需要提供 zhipu provider 和 api_key"},
        )
    
    # 3. 坐标转换
    boxes: List[BBoxNormalized] = []
    for i, obj in enumerate(raw_objects):
        raw_box = obj.get("box_2d", [])
        if len(raw_box) != 4:
            print(f"[MCP] #{i} skipped: invalid box_2d={raw_box}")
            continue
        
        raw_type = obj.get("type", "UNKNOWN")
        text = obj.get("text", "")
        
        # 智谱 API 返回 [ymin, xmin, ymax, xmax]，范围 0-999
        x, y, w, h = ImageProcessor.glm_box_to_normalized(
            raw_box, img_w, img_h, coord_base=1000,
        )
        
        # 过滤异常框
        if w < 0.005 or h < 0.005:
            print(f"[MCP] #{i} skipped: too small (w={w:.4f}, h={h:.4f})")
            continue
        if w > 0.95 and h > 0.95:
            print(f"[MCP] #{i} skipped: too large (w={w:.4f}, h={h:.4f})")
            continue
        
        normalized_type = normalize_type(raw_type)
        
        boxes.append(BBoxNormalized(
            id=f"mcp_{i}_{uuid.uuid4().hex[:6]}",
            x=x, y=y, width=w, height=h,
            type=normalized_type,
            text=text,
            confidence=obj.get("confidence", 1.0),
        ))
        
        print(f"[MCP] #{i} raw=[{raw_box}] -> norm=({x:.4f},{y:.4f},{w:.4f},{h:.4f}) type={raw_type}->{normalized_type} text={text[:20]}")
    
    elapsed = time.perf_counter() - start
    print(f"[MCP] Detect done: {len(boxes)} boxes in {elapsed:.2f}s")
    
    return {
        "boxes": [b.model_dump() for b in boxes],
        "image_width": img_w,
        "image_height": img_h,
        "elapsed": elapsed,
    }


@app.post("/mcp/draw")
async def mcp_draw(req: DrawRequest):
    """
    MCP 工具：精确画框
    在图像上绘制检测框，返回标注后的图像
    """
    start = time.perf_counter()
    
    # 加载图像
    img, _ = ImageProcessor.load_image(req.image_base64)
    
    # 画框
    result_img = ImageProcessor.draw_boxes(img, req.boxes)
    
    # 转 base64
    result_b64 = ImageProcessor.image_to_base64(result_img)
    
    elapsed = time.perf_counter() - start
    print(f"[MCP] Draw done: {len(req.boxes)} boxes in {elapsed:.2f}s")
    
    return {
        "result_image": result_b64,
        "box_count": len(req.boxes),
        "elapsed": elapsed,
    }


@app.post("/mcp/detect_and_draw")
async def mcp_detect_and_draw(req: DetectAndDrawRequest):
    """
    MCP 工具：检测+画框一体化
    调用 GLM-4.6V API 检测 -> 坐标转换 -> 精确画框
    返回归一化坐标和标注后的图像
    """
    start = time.perf_counter()
    
    # 1. 检测
    detect_req = DetectRequest(
        image_base64=req.image_base64,
        detect_types=req.detect_types,
        provider=req.provider,
        api_key=req.api_key,
        model_name=req.model_name,
        temperature=req.temperature,
        top_p=req.top_p,
        max_tokens=req.max_tokens,
        enable_thinking=req.enable_thinking,
    )
    detect_result = await mcp_detect(detect_req)
    
    if isinstance(detect_result, JSONResponse):
        return detect_result
    
    boxes = [BBoxNormalized(**b) for b in detect_result["boxes"]]
    
    # 2. 画框
    img, _ = ImageProcessor.load_image(req.image_base64)
    result_img = ImageProcessor.draw_boxes(img, boxes)
    result_b64 = ImageProcessor.image_to_base64(result_img)
    
    elapsed = time.perf_counter() - start
    print(f"[MCP] Detect+Draw done: {len(boxes)} boxes in {elapsed:.2f}s")
    
    return {
        "boxes": detect_result["boxes"],
        "result_image": result_b64,
        "image_width": detect_result["image_width"],
        "image_height": detect_result["image_height"],
        "elapsed": elapsed,
    }


# ─────────────────────────────────────────────
# 启动
# ─────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    print("=" * 60)
    print("  Image Process MCP Server")
    print("  Port: 8090")
    print("=" * 60)
    uvicorn.run(app, host="0.0.0.0", port=8090)
