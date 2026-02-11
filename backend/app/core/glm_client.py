"""
GLM API 客户端封装
支持两种模式：
1. MCP 模式（推荐）：通过本地 MCP 服务处理图像和画框，坐标精确
2. 直连模式（回退）：直接调用 API，本地做坐标转换

坐标系使用 0-1000 归一化，支持本地 llama.cpp 和云端 API（智谱 GLM、OpenAI 兼容接口）
"""
import json
import base64
import re
import time
from io import BytesIO
from typing import List, Dict, Any, Optional
from PIL import Image, ImageDraw, ImageFont

from app.core.config import settings
from app.models.schemas import BoundingBox


# 坐标归一化基准（与 smartcity 保持一致）
COORD_MODE = 1000

# MCP 服务地址
MCP_BASE_URL = "http://127.0.0.1:8090"


def get_active_model_config():
    """获取当前激活的模型配置"""
    try:
        from app.api.model_config import load_configs
        configs = load_configs()
        if configs.active_id:
            for cfg in configs.configs:
                if cfg.id == configs.active_id and cfg.enabled:
                    return cfg
        # 返回第一个启用的配置
        for cfg in configs.configs:
            if cfg.enabled:
                return cfg
    except Exception as e:
        print(f"[GLM] Failed to load model config: {e}")
    return None


import time as _time
import threading as _threading

# MCP 可用性状态（后台线程刷新，推理路径零开销）
_mcp_available: bool = False
_mcp_check_started: bool = False
_mcp_lock = _threading.Lock()


def _check_mcp_once() -> bool:
    """单次检查 MCP 是否可用"""
    try:
        import httpx
        with httpx.Client(timeout=2.0) as client:
            resp = client.get(f"{MCP_BASE_URL}/health")
            return resp.status_code == 200
    except Exception:
        return False


def _mcp_health_loop():
    """后台线程：每 15 秒检查一次 MCP 状态"""
    global _mcp_available
    while True:
        _mcp_available = _check_mcp_once()
        _time.sleep(15)


def ensure_mcp_checker_started():
    """确保后台健康检查线程已启动（只启动一次）"""
    global _mcp_check_started, _mcp_available
    with _mcp_lock:
        if _mcp_check_started:
            return
        _mcp_check_started = True
    # 先同步检查一次
    _mcp_available = _check_mcp_once()
    if _mcp_available:
        print("[MCP] Initial health check: OK")
    else:
        print("[MCP] Initial health check: offline (will retry in background)")
    # 启动后台线程
    t = _threading.Thread(target=_mcp_health_loop, daemon=True)
    t.start()


def is_mcp_available() -> bool:
    """检查 MCP 是否可用（零开销，直接读内存变量）"""
    ensure_mcp_checker_started()
    return _mcp_available


class GLMClient:
    """GLM 大模型客户端 - 支持本地和云端"""
    
    def __init__(self):
        # 默认使用本地配置（会在调用时动态获取激活配置）
        self.base_url = settings.GLM_LOCAL_BASE_URL.rstrip('/')
        self.model = settings.GLM_LOCAL_MODEL
    
    def _get_enabled_vision_types(self) -> List[Dict[str, Any]]:
        """获取启用的 GLM Vision Pipeline 类型配置"""
        try:
            from app.api.vision_pipeline import get_pipeline_types_for_mode
            return get_pipeline_types_for_mode("glm_vision")
        except:
            return []
    
    def _build_prompt(self) -> str:
        """
        构建检测 prompt（参考 smartcity 格式）
        支持自定义敏感信息类型
        """
        vision_types = self._get_enabled_vision_types()
        
        # 构建检测规则列表
        rules = []
        for i, vt in enumerate(vision_types, 1):
            name = vt.name
            desc = vt.description or ""
            examples = getattr(vt, 'examples', '') or ""
            
            rule = f"{i}. 检测所有【{name}】"
            if desc:
                rule += f"：{desc}"
            if examples:
                rule += f"，如：{examples}"
            rules.append(rule)
        
        if not rules:
            rules = [
                "1. 检测所有【人名/昵称】：如曹总、乐姐、小王、张三",
                "2. 检测所有【实验室/机构名】：如腾讯玄武实验室、XX研究所",
                "3. 检测所有【电话号码】：11位手机号",
                "4. 检测所有【身份证号】：18位数字",
            ]
        
        rules_text = "\n".join(rules)
        
        # 简化 prompt，让模型用原生 grounding 能力返回坐标
        prompt = f"""请分析这张图片并定位所有敏感信息区域。

检测规则清单：
{rules_text}

请找出所有匹配的区域，用 box_2d 标注每个区域的位置。返回 JSON 格式：
{{"objects": [{{"type": "类型", "text": "内容", "box_2d": [x1, y1, x2, y2]}}]}}

泛化识别要求：
1) 不要只依赖显式关键词，也要识别符合语义或格式的敏感信息
2) 识别非文字敏感区域：签名、印章、指纹、证件照、二维码等
3) 同类信息多处出现时全部输出，不要遗漏
4) 边框要精确贴合目标内容
5) 仔细扫描图片每一个角落，宁多勿漏

只返回 JSON，不要 Markdown 代码块。"""
        
        return prompt
    
    def _build_custom_prompt(self, custom_types: List[str]) -> str:
        """根据自定义类型构建 prompt（用于 GLM Vision Pipeline）"""
        rules = []
        for i, type_hint in enumerate(custom_types, 1):
            rules.append(f"{i}. 检测所有【{type_hint}】")
        
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
    
    def _normalize_entity_type(self, type_str: str) -> str:
        """
        标准化实体类型
        GLM Vision 专注视觉类敏感信息，是对 OCR+HaS 的补充
        """
        type_mapping = {
            # === GLM Vision 核心视觉类型 ===
            # 签名/手写
            "SIGNATURE": "SIGNATURE", "签名": "SIGNATURE", "手写": "SIGNATURE",
            "签名/手写": "SIGNATURE", "手写签名": "SIGNATURE", "签字": "SIGNATURE",
            "手写文字": "SIGNATURE", "手写批注": "HANDWRITING",
            # 印章
            "SEAL": "SEAL", "公章": "SEAL", "印章": "SEAL", "公章/印章": "SEAL",
            "私章": "SEAL", "合同章": "SEAL", "财务章": "SEAL", "法院印章": "SEAL",
            # 指纹/手印
            "FINGERPRINT": "FINGERPRINT", "指纹": "FINGERPRINT", "手印": "FINGERPRINT",
            "指纹/手印": "FINGERPRINT", "捺印": "FINGERPRINT",
            # 照片/头像
            "PHOTO": "PHOTO", "证件照": "PHOTO", "照片": "PHOTO", "头像": "PHOTO",
            "人物照片": "PHOTO", "微信头像": "PHOTO",
            # 二维码/条形码
            "QR_CODE": "QR_CODE", "二维码": "QR_CODE", "条形码": "QR_CODE",
            "二维码/条形码": "QR_CODE", "小程序码": "QR_CODE",
            # 手写批注
            "HANDWRITING": "HANDWRITING", "批注": "HANDWRITING",
            # 水印
            "WATERMARK": "WATERMARK", "水印": "WATERMARK",
            # Logo/标志
            "LOGO": "LOGO", "标志": "LOGO", "认证标志": "LOGO", "徽章": "LOGO",
            "CMA": "LOGO", "CNAS": "LOGO", "ILAC": "LOGO", "ESI": "LOGO",
            
            # === 文字类（GLM Vision 也可能识别到，映射到标准ID） ===
            "PERSON": "PERSON", "PER": "PERSON", "人名": "PERSON", "姓名": "PERSON",
            "ORG": "ORG", "ORGANIZATION": "ORG", "机构": "ORG", "公司": "ORG",
            "ID_CARD": "ID_CARD", "IDCARD": "ID_CARD", "身份证": "ID_CARD", "身份证号": "ID_CARD",
            "BANK_CARD": "BANK_CARD", "BANKCARD": "BANK_CARD", "银行卡": "BANK_CARD",
            "PHONE": "PHONE", "TEL": "PHONE", "电话": "PHONE", "手机": "PHONE",
            "ADDRESS": "ADDRESS", "ADDR": "ADDRESS", "地址": "ADDRESS",
            "DATE": "DATE", "日期": "DATE",
            "MONEY": "AMOUNT", "金额": "AMOUNT", "AMOUNT": "AMOUNT",
        }
        return type_mapping.get(type_str.upper().strip(), type_mapping.get(type_str, type_str))
    
    async def vision_detect_via_mcp(
        self,
        image_data: bytes,
        custom_types: List[str] = None,
    ) -> List[BoundingBox]:
        """
        通过 MCP 服务进行视觉检测（推荐方式）
        MCP 服务负责：图像预处理 -> 调用智谱 API -> 坐标转换
        返回精确的 0-1 归一化坐标
        """
        import httpx
        
        model_config = get_active_model_config()
        if not model_config or model_config.provider != "zhipu" or not model_config.api_key:
            print("[VLM-MCP] No zhipu config, falling back to direct mode")
            return await self.vision_detect_direct(image_data, custom_types)
        
        # 压缩大图片再发给 MCP（MCP 内部还会再压缩一次给 API，但先压缩减少 HTTP 传输）
        image_base64 = self._compress_for_api(image_data)
        
        # 构建检测类型
        detect_types = []
        if custom_types:
            for ct in custom_types:
                # 解析 "名称(描述)" 格式
                match = re.match(r'^(.+?)(?:\((.+)\))?$', ct)
                if match:
                    name = match.group(1).strip()
                    desc = match.group(2).strip() if match.group(2) else ""
                    detect_types.append({"name": name, "description": desc})
                else:
                    detect_types.append({"name": ct, "description": ""})
        else:
            # 从 pipeline 配置获取
            vision_types = self._get_enabled_vision_types()
            for vt in vision_types:
                detect_types.append({
                    "name": vt.name,
                    "description": vt.description or "",
                })
        
        request_body = {
            "image_base64": image_base64,
            "detect_types": detect_types,
            "provider": "zhipu",
            "api_key": model_config.api_key,
            "model_name": model_config.model_name,
            "temperature": model_config.temperature,
            "top_p": model_config.top_p,
            "max_tokens": model_config.max_tokens,
            "enable_thinking": model_config.enable_thinking,
        }
        
        try:
            print(f"[VLM-MCP] Calling MCP detect service at {MCP_BASE_URL}...")
            request_start = time.perf_counter()
            
            async with httpx.AsyncClient(timeout=300.0) as client:
                resp = await client.post(
                    f"{MCP_BASE_URL}/mcp/detect",
                    json=request_body,
                )
                resp.raise_for_status()
                data = resp.json()
            
            elapsed = time.perf_counter() - request_start
            print(f"[VLM-MCP] MCP detect done in {elapsed:.2f}s")
            
            # 转换为 BoundingBox
            bounding_boxes = []
            for box_data in data.get("boxes", []):
                bounding_boxes.append(BoundingBox(
                    id=box_data["id"],
                    x=box_data["x"],
                    y=box_data["y"],
                    width=box_data["width"],
                    height=box_data["height"],
                    type=self._normalize_entity_type(box_data.get("type", "CUSTOM")),
                    text=box_data.get("text", ""),
                ))
            
            print(f"[VLM-MCP] Got {len(bounding_boxes)} boxes from MCP")
            return bounding_boxes
            
        except Exception as e:
            print(f"[VLM-MCP] MCP call failed: {e}, falling back to direct mode")
            return await self.vision_detect_direct(image_data, custom_types)

    async def vision_detect(
        self, 
        image_data: bytes,
        custom_types: List[str] = None,
    ) -> List[BoundingBox]:
        """
        使用 GLM 视觉模型检测敏感区域
        返回 BoundingBox 列表（坐标为 0-1 归一化）
        
        优先使用 MCP 服务（智谱 API + 精确坐标转换），
        MCP 不可用时回退到直连模式。
        """
        # 检查是否应该使用 MCP
        model_config = get_active_model_config()
        use_mcp = (
            model_config 
            and model_config.provider == "zhipu" 
            and model_config.api_key
            and is_mcp_available()
        )
        
        if use_mcp:
            print("[VLM] Using MCP mode (zhipu API + precise coord conversion)")
            return await self.vision_detect_via_mcp(image_data, custom_types)
        else:
            if model_config and model_config.provider == "zhipu" and not is_mcp_available():
                print("[VLM] MCP service not available, using direct mode")
            return await self.vision_detect_direct(image_data, custom_types)

    @staticmethod
    def _compress_for_api(image_data: bytes, max_side: int = 2048) -> str:
        """压缩大图片后转 base64，加速 API 传输。坐标是归一化的，缩放不影响精度。"""
        from PIL import ImageOps as _ImageOps
        img = Image.open(BytesIO(image_data))
        img = _ImageOps.exif_transpose(img)
        if img.mode != "RGB":
            img = img.convert("RGB")
        w, h = img.size
        if max(w, h) > max_side:
            scale = max_side / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
            print(f"[VLM] Compressed {w}x{h} -> {img.size[0]}x{img.size[1]} for API")
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=85)
        return base64.b64encode(buf.getvalue()).decode("utf-8")

    async def vision_detect_direct(
        self, 
        image_data: bytes,
        custom_types: List[str] = None,
    ) -> List[BoundingBox]:
        """
        直连模式：直接调用 API 并本地做坐标转换（回退方案）
        """
        # 获取原始图像尺寸
        try:
            with Image.open(BytesIO(image_data)) as _img:
                img_w, img_h = _img.size
                try:
                    exif = _img.getexif()
                    exif_orientation = exif.get(274) if exif else None
                except Exception:
                    exif_orientation = None
        except Exception:
            img_w, img_h = COORD_MODE, COORD_MODE
            exif_orientation = None
        
        # 压缩大图片以加速 API 传输
        image_base64 = self._compress_for_api(image_data)
        
        # 使用自定义类型或默认类型
        if custom_types:
            prompt = self._build_custom_prompt(custom_types)
        else:
            prompt = self._build_prompt()
        
        messages = [
            {
                "role": "system",
                "content": "你是一个专业的文档分析助手。请始终使用中文回复。"
            },
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}},
                    {"type": "text", "text": prompt},
                ],
            },
        ]
        
        try:
            import httpx
            
            # 获取当前激活的模型配置
            model_config = get_active_model_config()
            
            request_start = time.perf_counter()
            response_text = ""
            
            if model_config and model_config.provider == "zhipu":
                # 智谱 AI 云端 API
                print(f"[VLM] Using ZhipuAI cloud API, model={model_config.model_name}")
                try:
                    from zhipuai import ZhipuAI
                    client = ZhipuAI(api_key=model_config.api_key)
                    
                    # 构建智谱格式的消息
                    zhipu_messages = [
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "image_url",
                                    "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}
                                },
                                {
                                    "type": "text",
                                    "text": prompt
                                }
                            ]
                        }
                    ]
                    
                    # 调用智谱 API
                    kwargs = {
                        "model": model_config.model_name,
                        "messages": zhipu_messages,
                        "temperature": model_config.temperature,
                        "top_p": model_config.top_p,
                        "max_tokens": model_config.max_tokens,
                    }
                    
                    # 启用思考模式（如果配置了）
                    if model_config.enable_thinking:
                        kwargs["thinking"] = {"type": "enabled"}
                    
                    response = client.chat.completions.create(**kwargs)
                    response_text = response.choices[0].message.content
                    
                except ImportError:
                    print("[VLM] zhipuai package not installed, falling back to local")
                    model_config = None
                except Exception as e:
                    print(f"[VLM] ZhipuAI API error: {e}, falling back to local")
                    model_config = None
            
            elif model_config and model_config.provider in ["openai", "custom"]:
                # OpenAI 兼容接口
                base_url = model_config.base_url.rstrip('/') if model_config.base_url else "https://api.openai.com"
                print(f"[VLM] Using OpenAI-compatible API at {base_url}, model={model_config.model_name}")
                
                headers = {"Content-Type": "application/json"}
                if model_config.api_key:
                    headers["Authorization"] = f"Bearer {model_config.api_key}"
                
                async with httpx.AsyncClient(timeout=300.0) as client:
                    resp = await client.post(
                        f"{base_url}/v1/chat/completions",
                        headers=headers,
                        json={
                            "model": model_config.model_name,
                            "messages": messages,
                            "temperature": model_config.temperature,
                            "top_p": model_config.top_p,
                            "max_tokens": model_config.max_tokens,
                        },
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    response_text = data["choices"][0]["message"]["content"]
            
            # 本地模式（默认或回退）
            if not response_text:
                if model_config and model_config.provider == "local":
                    base_url = model_config.base_url.rstrip('/') if model_config.base_url else self.base_url
                    model_name = model_config.model_name or self.model
                    temperature = model_config.temperature
                    top_p = model_config.top_p
                    max_tokens = model_config.max_tokens
                else:
                    base_url = self.base_url
                    model_name = self.model
                    temperature = settings.GLM_TEMPERATURE
                    top_p = settings.GLM_TOP_P
                    max_tokens = settings.GLM_MAX_TOKENS
                
                print(f"[VLM] Using local llama-server at {base_url}")
                
                async with httpx.AsyncClient(timeout=300.0) as client:  # 5分钟超时，VLM 首次推理较慢
                    resp = await client.post(
                        f"{base_url}/v1/chat/completions",
                        json={
                            "model": model_name,
                            "messages": messages,
                            "temperature": temperature,
                            "top_p": top_p,
                            "top_k": settings.GLM_TOP_K,
                            "repeat_penalty": settings.GLM_REPEAT_PENALTY,
                            "max_tokens": max_tokens,
                        },
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    response_text = data["choices"][0]["message"]["content"]
            
            print(f"[PERF] GLM request finished in {time.perf_counter() - request_start:.2f}s")
            print(f"[VLM] Response length: {len(response_text)}, first 500 chars: {response_text[:500]}...")
            
            # 提取 JSON - 更健壮的解析
            parse_start = time.perf_counter()
            result = {"objects": []}
            parse_method = "none"
            
            # 方法1: 尝试直接解析整个响应
            try:
                parsed = json.loads(response_text)
                if isinstance(parsed, list):
                    result = {"objects": parsed}
                elif isinstance(parsed, dict):
                    result = parsed
                parse_method = "direct"
                print(f"[VLM] JSON parsed directly, {len(result.get('objects', []))} objects")
            except json.JSONDecodeError:
                # 方法2: 正则提取
                json_match = re.search(r'(\{.*\}|\[.*\])', response_text, re.DOTALL)
                if json_match:
                    try:
                        parsed = json.loads(json_match.group())
                        if isinstance(parsed, list):
                            result = {"objects": parsed}
                        else:
                            result = parsed
                        parse_method = "regex"
                        print(f"[VLM] JSON parsed via regex, {len(result.get('objects', []))} objects")
                    except json.JSONDecodeError as e:
                        print(f"[VLM] JSON parse error: {e}")
                        # 方法3: 尝试修复不完整的 JSON
                        try:
                            # 找到最后一个完整的对象
                            text = json_match.group()
                            # 尝试找到 objects 数组
                            objects_match = re.search(r'"objects"\s*:\s*\[', text)
                            if objects_match:
                                # 提取数组内容，找完整的对象
                                array_start = objects_match.end()
                                objects = []
                                # 使用简单的正则匹配完整对象
                                obj_pattern = r'\{[^{}]*"type"\s*:\s*"[^"]*"[^{}]*"box_2d"\s*:\s*\[[^\]]+\][^{}]*\}'
                                for m in re.finditer(obj_pattern, text):
                                    try:
                                        obj = json.loads(m.group())
                                        objects.append(obj)
                                    except:
                                        pass
                                if objects:
                                    result = {"objects": objects}
                                    parse_method = "recover"
                                    print(f"[VLM] Recovered {len(objects)} objects from incomplete JSON")
                        except Exception as fix_err:
                            print(f"[VLM] JSON fix failed: {fix_err}")
                else:
                    print("[VLM] No JSON found in response")
            
            print(f"[PERF] GLM parse finished in {time.perf_counter() - parse_start:.2f}s")
            
            # =====================================================================
            # 智谱云端 API 专用坐标处理
            # 经实测验证：智谱 GLM-4.6V API 返回 [xmin, ymin, xmax, ymax]
            # 范围 0-1000（归一化到图片宽高）
            # 直接除以 1000 即可得到 0-1 归一化坐标
            # =====================================================================
            is_zhipu = model_config and model_config.provider == "zhipu"
            
            if is_zhipu:
                print(f"[VLM] Using ZHIPU coord mode: [xmin,ymin,xmax,ymax] / 1000")
                bounding_boxes = []
                for i, obj in enumerate(result.get("objects", [])):
                    box = obj.get("box_2d") or obj.get("box", [])
                    if len(box) != 4:
                        continue
                    raw = [float(v) for v in box]
                    print(f"[VLM] #{i} raw box_2d={raw}, type={obj.get('type','?')}, text={obj.get('text','')[:20]}")
                    
                    # 智谱格式: [xmin, ymin, xmax, ymax] / 1000
                    xmin, ymin, xmax, ymax = raw
                    
                    # 确保 min < max
                    if xmin > xmax:
                        xmin, xmax = xmax, xmin
                    if ymin > ymax:
                        ymin, ymax = ymax, ymin
                    
                    # 归一化到 0-1
                    x1 = xmin / 1000.0
                    y1 = ymin / 1000.0
                    x2 = xmax / 1000.0
                    y2 = ymax / 1000.0
                    
                    # 裁剪到 [0, 1]
                    x1 = max(0.0, min(1.0, x1))
                    y1 = max(0.0, min(1.0, y1))
                    x2 = max(0.0, min(1.0, x2))
                    y2 = max(0.0, min(1.0, y2))
                    
                    w = x2 - x1
                    h = y2 - y1
                    
                    # 过滤异常框
                    if w < 0.005 or h < 0.005 or (w > 0.95 and h > 0.95):
                        print(f"[VLM] #{i} skipped: abnormal size (w={w:.3f}, h={h:.3f})")
                        continue
                    
                    print(f"[VLM] #{i} -> norm=({x1:.4f},{y1:.4f},{w:.4f},{h:.4f})")
                    
                    bounding_boxes.append(BoundingBox(
                        id=f"glm_{i}",
                        x=x1,
                        y=y1,
                        width=w,
                        height=h,
                        type=self._normalize_entity_type(obj.get("type", "CUSTOM")),
                        text=obj.get("text"),
                    ))
                
                print(f"[VLM] Detected {len(bounding_boxes)} regions (zhipu mode)")
                return bounding_boxes
            
            # =====================================================================
            # 本地模型 / OpenAI 兼容接口的坐标处理
            # 自适应检测坐标模式（0-1 / 0-1000 / 像素 / letterbox）
            # =====================================================================
            raw_boxes = []
            for obj in result.get("objects", []):
                box = obj.get("box_2d") or obj.get("box", [])
                if len(box) == 4:
                    try:
                        raw_boxes.append([float(v) for v in box])
                    except Exception:
                        continue
            
            def _normalize_box(
                raw_box: list[float],
                mode: str,
                coord_base: float = COORD_MODE,
            ) -> Optional[tuple[float, float, float, float]]:
                xmin, ymin, xmax, ymax = raw_box
                if xmin > xmax:
                    xmin, xmax = xmax, xmin
                if ymin > ymax:
                    ymin, ymax = ymax, ymin
                
                if mode == "pixel":
                    div_x = max(img_w, 1)
                    div_y = max(img_h, 1)
                    x1 = xmin / div_x
                    y1 = ymin / div_y
                    x2 = xmax / div_x
                    y2 = ymax / div_y
                elif mode == "normalized":
                    x1, y1, x2, y2 = xmin, ymin, xmax, ymax
                elif mode == "coord_square":
                    div_x = coord_base
                    div_y = coord_base
                    x1 = xmin / div_x
                    y1 = ymin / div_y
                    x2 = xmax / div_x
                    y2 = ymax / div_y
                elif mode == "coord_square_letterbox":
                    # 模型按正方形 coord_base 输入，保持比例后补边
                    if img_w <= 0 or img_h <= 0:
                        return None
                    scale = min(coord_base / img_w, coord_base / img_h)
                    if scale <= 0:
                        return None
                    pad_x = (coord_base - img_w * scale) / 2
                    pad_y = (coord_base - img_h * scale) / 2
                    x1 = (xmin - pad_x) / (img_w * scale)
                    y1 = (ymin - pad_y) / (img_h * scale)
                    x2 = (xmax - pad_x) / (img_w * scale)
                    y2 = (ymax - pad_y) / (img_h * scale)
                else:
                    return None
                
                return x1, y1, x2, y2
            
            def score_mode(mode: str, coord_base: float = COORD_MODE) -> int:
                score = 0
                for raw in raw_boxes:
                    norm = _normalize_box(raw, mode, coord_base)
                    if not norm:
                        continue
                    x1, y1, x2, y2 = norm
                    w = x2 - x1
                    h = y2 - y1
                    if x1 < -0.02 or y1 < -0.02 or x2 <= x1 or y2 <= y1:
                        continue
                    if x2 > 1.02 or y2 > 1.02:
                        continue
                    if w < 0.003 or h < 0.003 or w > 0.98 or h > 0.98:
                        continue
                    score += 1
                return score
            
            # 候选模式（包含 letterbox 反推）
            candidates: list[tuple[str, float]] = [
                ("pixel", 0.0),
                ("normalized", 0.0),
            ]
            square_bases = [float(COORD_MODE)]
            if COORD_MODE != 1024:
                square_bases.append(1024.0)
            for base in square_bases:
                candidates.append(("coord_square", base))
                candidates.append(("coord_square_letterbox", base))
            
            scored = []
            for mode, base in candidates:
                s = score_mode(mode, base if base else COORD_MODE)
                scored.append((s, mode, base))
            
            # 选择最可能的坐标模式
            scored.sort(key=lambda x: (x[0], 0 if x[1].startswith("coord_square") else 1), reverse=True)
            best_score, mode, base = scored[0] if scored else (0, "coord_square", float(COORD_MODE))
            coord_base = base if base else float(COORD_MODE)
            
            max_raw = max((max(b) for b in raw_boxes), default=0)
            if mode == "normalized":
                print("[VLM] Using coord mode: 0-1 normalized")
            elif mode == "pixel":
                print(f"[VLM] Using coord mode: pixel ({img_w}x{img_h}), max_raw={max_raw:.1f}")
            elif mode == "coord_square_letterbox":
                print(f"[VLM] Using coord mode: 0-{coord_base} letterbox, max_raw={max_raw:.1f}")
            else:
                print(f"[VLM] Using coord mode: 0-{coord_base}, max_raw={max_raw:.1f}")
            
            bounding_boxes = []
            for i, obj in enumerate(result.get("objects", [])):
                box = obj.get("box_2d") or obj.get("box", [])
                if len(box) == 4:
                    raw = [float(v) for v in box]
                    print(f"[VLM] #{i} raw box_2d={raw}, type={obj.get('type','?')}, text={obj.get('text','')[:20]}")
                    
                    # 本地模型返回 [xmin, ymin, xmax, ymax]
                    xmin, ymin, xmax, ymax = raw
                    
                    # 确保 min < max
                    if xmin > xmax:
                        xmin, xmax = xmax, xmin
                    if ymin > ymax:
                        ymin, ymax = ymax, ymin
                    
                    # 归一化到 0-1
                    norm = _normalize_box(raw, mode, coord_base)
                    if not norm:
                        continue
                    x1, y1, x2, y2 = norm
                    w = x2 - x1
                    h = y2 - y1
                    
                    # 过滤异常框
                    if w < 0.005 or h < 0.005 or w > 0.95 or h > 0.95:
                        print(f"[VLM] #{i} skipped: abnormal size (w={w:.3f}, h={h:.3f})")
                        continue
                    
                    # 裁剪到 [0, 1]，避免轻微越界
                    x1 = max(0.0, min(1.0, x1))
                    y1 = max(0.0, min(1.0, y1))
                    w = min(1.0 - x1, max(0.0, w))
                    h = min(1.0 - y1, max(0.0, h))
                    
                    bounding_boxes.append(BoundingBox(
                        id=f"glm_{i}",
                        x=x1,
                        y=y1,
                        width=w,
                        height=h,
                        type=self._normalize_entity_type(obj.get("type", "CUSTOM")),
                        text=obj.get("text"),
                    ))
            
            print(f"[VLM] Detected {len(bounding_boxes)} regions")
            return bounding_boxes
            
        except Exception as e:
            print(f"[ERR] Vision detect failed: {e}")
            import traceback
            traceback.print_exc()
            return []
    
    @staticmethod
    def draw_boxes_on_image(image_bytes: bytes, detections: List[BoundingBox]) -> bytes:
        """
        在图片上绘制检测框
        detections 中的坐标为 0-1 归一化坐标
        """
        try:
            # 直接打开图片，不做 EXIF 处理（与 smartcity 保持一致）
            image = Image.open(BytesIO(image_bytes)).convert("RGB")
            width, height = image.size
            draw = ImageDraw.Draw(image)
            
            # 加载中文字体
            font = None
            font_paths = [
                "C:/Windows/Fonts/msyh.ttc",
                "C:/Windows/Fonts/simhei.ttf",
                "C:/Windows/Fonts/simsun.ttc",
                "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
                "/System/Library/Fonts/PingFang.ttc",
            ]
            for fp in font_paths:
                try:
                    font = ImageFont.truetype(fp, 18)
                    break
                except:
                    continue
            if font is None:
                font = ImageFont.load_default()
            
            # 类型颜色映射
            type_colors = {
                "PERSON": "#F59E0B",
                "ORG": "#3B82F6", 
                "ID_CARD": "#EF4444",
                "PHONE": "#10B981",
                "ADDRESS": "#8B5CF6",
                "BANK_CARD": "#EC4899",
                "NICKNAME": "#A855F7",
                "LAB_NAME": "#0EA5E9",
                "DATE": "#14B8A6",
                "MONEY": "#F97316",
            }
            
            for det in detections:
                # 0-1 坐标转像素（与 smartcity 的 draw_boxes 逻辑一致）
                xmin = int(det.x * width)
                ymin = int(det.y * height)
                xmax = int((det.x + det.width) * width)
                ymax = int((det.y + det.height) * height)
                
                color = type_colors.get(det.type, "#007AFF")
                
                # 绘制框
                draw.rectangle([xmin, ymin, xmax, ymax], outline=color, width=2)
                
                # 标签
                label = det.text or det.type
                if len(label) > 15:
                    label = label[:15] + "..."
                
                try:
                    bbox = draw.textbbox((0, 0), label, font=font)
                    text_w, text_h = bbox[2] - bbox[0], bbox[3] - bbox[1]
                except:
                    text_w, text_h = len(label) * 10, 16
                
                # 标签背景
                label_y = max(0, ymin - text_h - 6)
                draw.rectangle([xmin, label_y, xmin + text_w + 8, label_y + text_h + 4], fill=color)
                draw.text((xmin + 4, label_y + 2), label, fill="#FFFFFF", font=font)
            
            buffer = BytesIO()
            image.save(buffer, format="JPEG", quality=90)
            return buffer.getvalue()
            
        except Exception as e:
            print(f"[ERR] Draw boxes failed: {e}")
            return image_bytes


# 全局客户端实例
glm_client = GLMClient()
