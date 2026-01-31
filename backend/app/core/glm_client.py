"""
GLM API 客户端封装
参考 D:\smartcity 的实现，坐标系使用 0-1000 归一化
"""
import json
import base64
import re
from io import BytesIO
from typing import List, Dict, Any
from PIL import Image, ImageDraw, ImageFont

from app.core.config import settings
from app.models.schemas import BoundingBox


# 坐标归一化基准（与 smartcity 保持一致）
COORD_MODE = 1000


class GLMClient:
    """GLM 大模型客户端 - 仅本地视觉识别"""
    
    def __init__(self):
        self.base_url = settings.GLM_LOCAL_BASE_URL.rstrip('/')
        self.model = settings.GLM_LOCAL_MODEL
    
    def _get_enabled_vision_types(self) -> List[Dict[str, Any]]:
        """获取启用的视觉类型配置"""
        try:
            from app.api.vision_types import get_enabled_vision_types
            return get_enabled_vision_types()
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
        
        # 参考 smartcity 的 prompt 格式
        prompt = f"""请分析这张图片并定位所有敏感信息区域。

检测规则清单：
{rules_text}

请输出一个 JSON 对象，包含 "objects" 键。
每个检测到的敏感区域必须包含:
1. "type": 敏感信息类型（如"人名"、"昵称"、"实验室名称"等）
2. "text": 识别到的具体文字内容（非文字区域可为空或描述）
3. "box_2d": [xmin, ymin, xmax, ymax] 格式的整数列表

坐标基于归一化坐标系（图像宽高均为 {COORD_MODE} 单位，左上角为 [0, 0]，右下角为 [{COORD_MODE}, {COORD_MODE}]）。

泛化识别要求：
1) 不要只依赖显式关键词（如“账号/开户行/身份证/电话”等），也要识别未标注但符合语义或格式的敏感信息。
2) 识别结构化信息：人名/组织机构/地址/联系方式/证件号/银行卡号/账号/日期/金额等。
3) 识别非文字敏感区域：签名、手写、印章、公章、指纹、证件照、二维码、条形码、小广告等。
4) 同类信息可能多处出现，需全部输出。
5) 边框要尽量贴合目标内容本身，避免把整段、整页或大块空白一起框进去。

重要：请仔细扫描图片中的每一行文字，宁可多检测也不要漏掉。
只返回 JSON 格式，不要使用 Markdown 代码块或其他文字。"""
        
        return prompt
    
    def _build_custom_prompt(self, custom_types: List[str]) -> str:
        """根据自定义类型构建 prompt（用于 GLM Vision Pipeline）"""
        rules = []
        for i, type_hint in enumerate(custom_types, 1):
            rules.append(f"{i}. 检测所有【{type_hint}】")
        
        rules_text = "\n".join(rules)
        
        prompt = f"""请分析这张图片并定位所有敏感信息区域。

检测规则清单：
{rules_text}

请输出一个 JSON 对象，包含 "objects" 键。
每个检测到的敏感区域必须包含:
1. "type": 敏感信息类型
2. "text": 识别到的具体文字内容（如有）
3. "box_2d": [xmin, ymin, xmax, ymax] 格式的整数列表

坐标基于归一化坐标系（图像宽高均为 {COORD_MODE} 单位，左上角为 [0, 0]，右下角为 [{COORD_MODE}, {COORD_MODE}]）。

泛化识别要求：
1) 即使图片中没有明确关键词，也要依据语义或格式识别敏感信息。
2) 同类信息可能多处出现，需全部输出。
3) 边框要尽量贴合目标内容本身，避免把整段、整页或大块空白一起框进去。

重要：请仔细扫描图片，识别所有符合规则的区域。对于签名、公章等非文字区域，text 字段可以为空或填写描述。
只返回 JSON 格式，不要使用 Markdown 代码块或其他文字。"""
        
        return prompt
    
    def _normalize_entity_type(self, type_str: str) -> str:
        """标准化实体类型"""
        type_mapping = {
            # 人物相关
            "PERSON": "PERSON", "PER": "PERSON", "人名": "PERSON", "姓名": "PERSON",
            "NICKNAME": "NICKNAME", "昵称": "NICKNAME", "人物昵称": "NICKNAME",
            # 组织相关
            "ORG": "ORG", "ORGANIZATION": "ORG", "机构": "ORG", "公司": "ORG",
            "LAB_NAME": "LAB_NAME", "实验室": "LAB_NAME", "实验室名称": "LAB_NAME",
            # 证件相关
            "ID_CARD": "ID_CARD", "IDCARD": "ID_CARD", "身份证": "ID_CARD", "身份证号": "ID_CARD",
            "BANK_CARD": "BANK_CARD", "BANKCARD": "BANK_CARD", "银行卡": "BANK_CARD",
            "PHONE": "PHONE", "TEL": "PHONE", "电话": "PHONE", "手机": "PHONE",
            "ADDRESS": "ADDRESS", "ADDR": "ADDRESS", "地址": "ADDRESS",
            "DATE": "DATE", "日期": "DATE",
            "MONEY": "MONEY", "金额": "MONEY",
            # GLM Vision Pipeline 特有类型
            "SIGNATURE": "SIGNATURE", "签名": "SIGNATURE", "手写": "SIGNATURE", "签名/手写": "SIGNATURE",
            "SEAL": "SEAL", "公章": "SEAL", "印章": "SEAL", "公章/印章": "SEAL",
            "FINGERPRINT": "FINGERPRINT", "指纹": "FINGERPRINT", "手印": "FINGERPRINT", "指纹/手印": "FINGERPRINT",
            "PHOTO": "PHOTO", "证件照": "PHOTO", "照片": "PHOTO",
            "QR_CODE": "QR_CODE", "二维码": "QR_CODE",
        }
        return type_mapping.get(type_str.upper().strip(), type_mapping.get(type_str, type_str))
    
    async def vision_detect(
        self, 
        image_data: bytes,
        custom_types: List[str] = None,
    ) -> List[BoundingBox]:
        """
        使用 GLM 视觉模型检测敏感区域
        返回 BoundingBox 列表（坐标为 0-1 归一化）
        
        Args:
            image_data: 图像字节数据
            custom_types: 自定义类型列表，如 ["签名(手写签名区域)", "公章(印章区域)"]
        """
        image_base64 = base64.b64encode(image_data).decode("utf-8")
        
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
            # 本地模式：使用 OpenAI 兼容 API (llama-server)
            import httpx
            print(f"[VLM] Using local llama-server at {self.base_url}")
            
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(
                    f"{self.base_url}/v1/chat/completions",
                    json={
                        "model": self.model,
                        "messages": messages,
                        "temperature": settings.GLM_TEMPERATURE,
                        "top_p": settings.GLM_TOP_P,
                        "top_k": settings.GLM_TOP_K,
                        "repeat_penalty": settings.GLM_REPEAT_PENALTY,
                        "max_tokens": settings.GLM_MAX_TOKENS,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                response_text = data["choices"][0]["message"]["content"]
            
            print(f"[VLM] Response length: {len(response_text)}, first 500 chars: {response_text[:500]}...")
            print(f"[VLM] Response length: {len(response_text)}, first 500 chars: {response_text[:500]}...")
            
            # 提取 JSON - 更健壮的解析
            result = {"objects": []}
            
            # 方法1: 尝试直接解析整个响应
            try:
                parsed = json.loads(response_text)
                if isinstance(parsed, list):
                    result = {"objects": parsed}
                elif isinstance(parsed, dict):
                    result = parsed
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
                                    print(f"[VLM] Recovered {len(objects)} objects from incomplete JSON")
                        except Exception as fix_err:
                            print(f"[VLM] JSON fix failed: {fix_err}")
                else:
                    print("[VLM] No JSON found in response")
            
            # 转换为 BoundingBox（0-1 归一化坐标）
            bounding_boxes = []
            for i, obj in enumerate(result.get("objects", [])):
                box = obj.get("box_2d", [])
                if len(box) == 4:
                    # GLM 返回 0-1000 坐标，转换为 0-1
                    xmin, ymin, xmax, ymax = box
                    bounding_boxes.append(BoundingBox(
                        id=f"glm_{i}",
                        x=float(xmin) / COORD_MODE,
                        y=float(ymin) / COORD_MODE,
                        width=(float(xmax) - float(xmin)) / COORD_MODE,
                        height=(float(ymax) - float(ymin)) / COORD_MODE,
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
        在图片上绘制检测框（参考 smartcity 实现）
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
