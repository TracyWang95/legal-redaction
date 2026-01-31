"""
Hybrid Vision Service - 图像脱敏核心服务
参考 document_redaction_vlm 项目架构
采用 PaddleOCR-VL（文字检测）+ HaS 本地模型（敏感信息识别）混合模式
完全离线运行，不依赖云端 API
"""
from __future__ import annotations

# 重要：必须先导入 torch，否则 PaddleOCR 导入时会报 DLL 错误
try:
    import torch
except ImportError:
    pass

import base64
import io
import os
import re
import inspect
from difflib import SequenceMatcher
from dataclasses import dataclass, field
from typing import List, Optional, Tuple, Dict, Any

from PIL import Image, ImageDraw, ImageFont, ImageOps
from app.core.config import settings

# 敏感信息检测结果
@dataclass
class SensitiveRegion:
    """敏感区域"""
    text: str
    entity_type: str
    left: int      # 像素坐标
    top: int
    width: int
    height: int
    confidence: float = 1.0
    source: str = "unknown"  # "ocr", "vlm", "merged"
    color: Tuple[int, int, int] = (255, 0, 0)


@dataclass
class OCRTextBlock:
    """OCR 识别的文本块"""
    text: str
    polygon: List[List[float]]  # 四边形顶点 [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
    confidence: float = 1.0
    
    @property
    def bbox(self) -> Tuple[int, int, int, int]:
        """获取边界框 (left, top, right, bottom)"""
        xs = [p[0] for p in self.polygon]
        ys = [p[1] for p in self.polygon]
        return (int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys)))
    
    @property
    def left(self) -> int:
        return self.bbox[0]
    
    @property
    def top(self) -> int:
        return self.bbox[1]
    
    @property
    def width(self) -> int:
        return self.bbox[2] - self.bbox[0]
    
    @property
    def height(self) -> int:
        return self.bbox[3] - self.bbox[1]


class HybridVisionService:
    """
    混合视觉脱敏服务（完全离线）
    1. PaddleOCR-VL：文字检测+识别（获取精确位置）
    2. HaS 本地模型：敏感信息类型识别（理解语义）
    3. 融合两者结果
    """
    
    def __init__(self):
        self._paddle_ocr = None
        self._ocr_service = None
        self._has_client = None
        self._has_service = None
        self._paddle_ready = False
        self._has_ready = False
        self._init_services()
    
    def _init_services(self):
        """初始化 OCR 和 HaS 服务"""
        # 初始化 OCRService（PaddleOCR-VL）
        try:
            from app.services.ocr_service import ocr_service
            if ocr_service.is_available():
                self._ocr_service = ocr_service
                print("[OK] OCRService init success (PaddleOCR-VL)")
            else:
                self._ocr_service = None
        except Exception as e:
            print(f"[WARN] OCRService init failed: {e}")
            self._ocr_service = None

        # 初始化 PaddleOCR
        try:
            # 设置 PaddleOCR 环境变量（需在 import 前设置）
            if settings.PADDLE_MODEL_DIR and settings.PADDLE_MODEL_DIR.strip():
                os.environ.setdefault("PADDLEOCR_MODEL_DIR", settings.PADDLE_MODEL_DIR.strip())
            if settings.PADDLE_FONT_PATH and settings.PADDLE_FONT_PATH.strip() and os.path.exists(settings.PADDLE_FONT_PATH):
                os.environ.setdefault("PADDLE_PDX_LOCAL_FONT_FILE_PATH", settings.PADDLE_FONT_PATH.strip())
            else:
                # 尽量使用系统字体，避免下载默认字体导致异常
                font_candidates = [
                    "C:/Windows/Fonts/msyh.ttc",
                    "C:/Windows/Fonts/simhei.ttf",
                    "C:/Windows/Fonts/simsun.ttc",
                    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
                    "/System/Library/Fonts/PingFang.ttc",
                ]
                for font_path in font_candidates:
                    if os.path.exists(font_path):
                        os.environ.setdefault("PADDLE_PDX_LOCAL_FONT_FILE_PATH", font_path)
                        break

            from paddleocr import PaddleOCR
            # 新版 PaddleOCR 3.x 参数
            init_kwargs = {
                "lang": "ch",
                "use_doc_orientation_classify": False,
                "use_doc_unwarping": False,
                "use_textline_orientation": False,
            }
            self._paddle_ocr = PaddleOCR(**init_kwargs)
            self._paddle_ready = True
            print("[OK] PaddleOCR init success")
        except Exception as e:
            print(f"[WARN] PaddleOCR init failed: {e}")
            self._paddle_ready = False
        
        # 初始化 HaS Client（本地模型）
        try:
            from app.services.has_client import HaSClient
            self._has_client = HaSClient(base_url=settings.HAS_BASE_URL)
            if self._has_client.is_available():
                self._has_ready = True
                self._has_service = True
                print("[OK] HaS Client init success (local model)")
            else:
                print("[WARN] HaS service not available (is llama.cpp server running?)")
                self._has_ready = False
        except Exception as e:
            print(f"[WARN] HaS Client init failed: {e}")
            self._has_client = None
            self._has_ready = False
    
    def _prepare_image(self, image_bytes: bytes) -> Tuple[Image.Image, int, int]:
        """准备图像，处理 EXIF 方向"""
        image = Image.open(io.BytesIO(image_bytes))
        # 处理 EXIF 方向
        image = ImageOps.exif_transpose(image)
        if image.mode != "RGB":
            image = image.convert("RGB")
        return image, image.width, image.height
    
    def _run_paddle_ocr(self, image: Image.Image) -> Tuple[List[OCRTextBlock], List[SensitiveRegion]]:
        """
        运行 OCR 获取文字位置（优先 PaddleOCR-VL）
        返回：(文本块列表, 视觉敏感区域如公章)
        
        新版 PaddleOCR 3.x 使用 predict() API
        """
        # 优先使用 OCRService（PaddleOCR-VL）
        if self._ocr_service and self._ocr_service.is_available():
            blocks, visual_regions = self._run_ocr_service(image)
            if blocks or visual_regions:
                print(f"[OCR] PaddleOCR-VL found {len(blocks)} text blocks, {len(visual_regions)} visual regions")
                return blocks, visual_regions

        if not self._paddle_ready or not self._paddle_ocr:
            return [], []
        
        try:
            import numpy as np
            import tempfile
            
            # 新版 PaddleOCR 需要文件路径或 URL
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
                temp_path = f.name
                image.save(f, format='PNG')
            
            # 使用新版 predict API
            result = self._paddle_ocr.predict(input=temp_path)
            
            # 清理临时文件
            try:
                os.remove(temp_path)
            except:
                pass
            
            blocks: List[OCRTextBlock] = []
            
            if result and len(result) > 0:
                res = result[0]  # 第一个结果
                
                # 新版返回格式：{'rec_texts': [...], 'rec_polys': [...], 'rec_scores': [...]}
                rec_texts = res.get('rec_texts', [])
                rec_polys = res.get('rec_polys', [])
                rec_scores = res.get('rec_scores', [])
                
                for i, text in enumerate(rec_texts):
                    if not text or not text.strip():
                        continue
                    
                    # 获取坐标（四边形顶点）
                    if i < len(rec_polys):
                        poly = rec_polys[i]
                        # poly 是 numpy array，shape=(4, 2)
                        polygon = [[int(p[0]), int(p[1])] for p in poly]
                    else:
                        continue
                    
                    # 获取置信度
                    conf = rec_scores[i] if i < len(rec_scores) else 1.0
                    
                    blocks.append(OCRTextBlock(
                        text=str(text),
                        polygon=polygon,
                        confidence=float(conf),
                    ))
            
            print(f"[OCR] PaddleOCR found {len(blocks)} text blocks")
            # 打印前几个识别结果
            for b in blocks[:5]:
                print(f"  - {b.text[:30]}... @ {b.bbox}")
            
            # PaddleOCR 基础版不识别公章，返回空的 visual_regions
            return blocks, []
            
        except Exception as e:
            print(f"[ERR] PaddleOCR exec failed: {e}")
            import traceback
            traceback.print_exc()
            return [], []

    def _run_ocr_service(self, image: Image.Image) -> Tuple[List[OCRTextBlock], List[SensitiveRegion]]:
        """
        使用 OCRService (PaddleOCR-VL) 提取文本块和视觉元素
        
        Returns:
            (文本块列表, 视觉敏感区域列表如公章)
        """
        if not self._ocr_service or not self._ocr_service.is_available():
            return [], []

        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        image_bytes = buffer.getvalue()

        items = self._ocr_service.extract_text_boxes(image_bytes)
        if not items:
            return [], []

        width, height = image.size
        blocks: List[OCRTextBlock] = []
        visual_regions: List[SensitiveRegion] = []
        
        for item in items:
            left = int(item.x * width)
            top = int(item.y * height)
            w = int(item.width * width)
            h = int(item.height * height)
            right = max(left + max(w, 1), left + 1)
            bottom = max(top + max(h, 1), top + 1)

            # 裁剪到图像范围
            left = max(0, min(left, width - 1))
            top = max(0, min(top, height - 1))
            right = max(left + 1, min(right, width))
            bottom = max(top + 1, min(bottom, height))
            
            # 公章/印章区域直接作为敏感区域
            label = getattr(item, 'label', 'text') or 'text'
            if label == "seal" or item.text.strip() == "[公章]":
                visual_regions.append(SensitiveRegion(
                    text="[公章]",
                    entity_type="SEAL",
                    left=left,
                    top=top,
                    width=right - left,
                    height=bottom - top,
                    confidence=item.confidence,
                    source="paddleocr_vl",
                    color=(255, 0, 0),  # 红色
                ))
                print(f"[VL] Found SEAL @ ({left}, {top}, {right-left}, {bottom-top})")
                continue  # 公章不需要走 HaS 文字分析

            polygon = [
                [left, top],
                [right, top],
                [right, bottom],
                [left, bottom],
            ]
            blocks.append(OCRTextBlock(
                text=item.text,
                polygon=polygon,
                confidence=float(item.confidence),
            ))

        return blocks, visual_regions
    
    async def _run_has_text_analysis(
        self,
        ocr_blocks: List[OCRTextBlock],
        vision_types: Optional[list] = None,
    ) -> List[Dict[str, str]]:
        """
        用 HaS 本地模型分析 OCR 提取的文字，识别敏感信息
        完全离线，不依赖云端 API
        
        Args:
            ocr_blocks: OCR 识别的文本块
            vision_types: 用户启用的视觉类型配置列表
        
        Returns:
            [{type: "PERSON", text: "张三"}, ...]
        """
        if not ocr_blocks:
            return []
        
        # 动态检查 HaS 是否可用（服务可能后启动）
        if not self._has_client:
            try:
                from app.services.has_client import HaSClient
                self._has_client = HaSClient(base_url=settings.HAS_BASE_URL)
            except Exception as e:
                print(f"[ERR] HaS Client init failed: {e}")
                return []
        
        if not self._has_client.is_available():
            print("[WARN] HaS service not available, skipping NER")
            return []
        
        try:
            # 把所有 OCR 文字拼接起来
            all_texts = [block.text for block in ocr_blocks if block.text.strip()]
            text_content = "\n".join(all_texts)
            
            if not text_content.strip():
                return []
            
            print(f"[HaS] Analyzing {len(all_texts)} text blocks...")
            
            # 类型 ID -> 中文名 映射（HaS NER 使用中文类型名）
            # HaS 擅长语义理解，适合识别：人名、公司、组织、地址等需要上下文的实体
            id_to_chinese = {
                # 人员相关 - HaS 强项
                "PERSON": "人名",
                
                # 组织机构 - HaS 强项（能识别简称和全称）
                "ORG": "组织机构",
                "COMPANY": "公司名称",  # 包括简称如"腾讯"和全称如"深圳市腾讯计算机系统有限公司"
                
                # 银行账户相关 - HaS 强项
                "ACCOUNT_NAME": "账户名",
                "BANK_NAME": "开户行",
                "ACCOUNT_NUMBER": "账号",
                
                # 地址 - HaS 强项（能理解语义）
                "ADDRESS": "地址",
                
                # 日期 - HaS 强项
                "DATE": "日期",
                
                # 联系方式 - 正则为主，HaS 补充
                "PHONE": "电话号码",
                "EMAIL": "电子邮箱",
                
                # 证件号码 - 正则为主，HaS 补充
                "ID_CARD": "身份证号",
                "BANK_CARD": "银行卡号",
            }
            
            # 根据用户配置生成中文类型列表
            if vision_types:
                chinese_types = []
                for vt in vision_types:
                    # 跳过视觉类型（公章等），HaS 不处理
                    if vt.id in ["SEAL", "SIGNATURE", "FINGERPRINT"]:
                        continue
                    # 优先用标准 ID 映射
                    if vt.id in id_to_chinese:
                        chinese_types.append(id_to_chinese[vt.id])
                    else:
                        # 自定义类型用名称
                        chinese_types.append(vt.name)
                # 去重
                chinese_types = list(dict.fromkeys(chinese_types))
                print(f"[HaS] Using types for NER: {chinese_types}")
            else:
                # 默认类型 - 确保覆盖所有需要语义理解的类型
                chinese_types = ["人名", "公司名称", "组织机构", "地址", "电话号码", "身份证号", "银行卡号", "账号", "账户名", "开户行"]
                print(f"[HaS] Using default types: {chinese_types}")
            
            ner_result = self._has_client.ner(text_content, chinese_types)
            
            # HaS ner() 返回格式：{类型: [实体列表]}，如 {"人名": ["张三"], "组织": ["腾讯"]}
            if not ner_result or not isinstance(ner_result, dict):
                print("[HaS] No entities found by NER")
                return []
            
            print(f"[HaS] NER result: {ner_result}")
            
            # 中文 -> 类型 ID 映射（用于返回）
            # 注意：HaS 可能返回不同的中文表述，需要多种映射
            chinese_to_id = {
                # 人名
                "人名": "PERSON",
                "姓名": "PERSON",
                "名字": "PERSON",
                
                # 公司
                "公司名称": "COMPANY",
                "公司": "COMPANY",
                "公司名": "COMPANY",
                "企业": "COMPANY",
                "企业名称": "COMPANY",
                
                # 组织
                "组织机构": "ORG",
                "组织": "ORG",
                "机构": "ORG",
                "单位": "ORG",
                
                # 账户名
                "账户名": "ACCOUNT_NAME",
                "账户名称": "ACCOUNT_NAME",
                "户名": "ACCOUNT_NAME",
                
                # 开户行
                "开户行": "BANK_NAME",
                "开户银行": "BANK_NAME",
                "银行名称": "BANK_NAME",
                "银行": "BANK_NAME",
                
                # 账号
                "账号": "ACCOUNT_NUMBER",
                "账户号": "ACCOUNT_NUMBER",
                "账户号码": "ACCOUNT_NUMBER",
                
                # 地址
                "地址": "ADDRESS",
                "住址": "ADDRESS",
                "居住地": "ADDRESS",
                
                # 日期
                "日期": "DATE",
                "时间": "DATE",
                "日期时间": "DATE",
                
                # 电话
                "电话号码": "PHONE",
                "电话": "PHONE",
                "手机号": "PHONE",
                "联系方式": "PHONE",
                
                # 邮箱
                "电子邮箱": "EMAIL",
                "邮箱": "EMAIL",
                
                # 身份证
                "身份证号": "ID_CARD",
                "身份证": "ID_CARD",
                "身份证号码": "ID_CARD",
                
                # 银行卡
                "银行卡号": "BANK_CARD",
                "银行卡": "BANK_CARD",
                "卡号": "BANK_CARD",
            }
            
            # 如果有用户自定义类型，也加入映射
            if vision_types:
                for vt in vision_types:
                    if vt.id not in id_to_chinese:
                        chinese_to_id[vt.name] = vt.id
            
            # 转换为统一格式，过滤太短的实体
            entities = []
            min_len_by_type = {
                "PERSON": 2,   # 人名至少 2 字
                "ORG": 2,      # 组织至少 2 字
                "COMPANY": 2,  # 公司至少 2 字（简称如"腾讯"）
                "ADDRESS": 4,  # 地址至少 4 字
            }
            
            for entity_type, entity_list in ner_result.items():
                if not entity_list:
                    continue
                
                # 中文类型转换为 ID
                normalized_type = chinese_to_id.get(entity_type, entity_type.upper())
                min_len = min_len_by_type.get(normalized_type, 2)
                
                for entity_text in entity_list:
                    text = entity_text.strip() if entity_text else ""
                    # 过滤太短的实体
                    if len(text) < min_len:
                        print(f"[HaS] Skipped too short: '{text}' ({normalized_type})")
                        continue
                    
                    entities.append({
                        "type": normalized_type,
                        "text": text,
                    })
                    print(f"[HaS] Found entity: {text} ({normalized_type})")
            
            print(f"[HaS] Total {len(entities)} sensitive entities found")
            return entities
            
        except Exception as e:
            print(f"[ERR] HaS text analysis failed: {e}")
            import traceback
            traceback.print_exc()
            return []
    
    def _match_entities_to_ocr(
        self,
        ocr_blocks: List[OCRTextBlock],
        entities: List[Dict[str, str]],
    ) -> List[SensitiveRegion]:
        """
        将 HaS 识别的敏感实体匹配到 OCR 文本块
        用文字匹配获取精确坐标，支持子词级别定位
        """
        regions: List[SensitiveRegion] = []
        
        for entity in entities:
            entity_text = entity.get("text", "").strip()
            entity_type = entity.get("type", "UNKNOWN")
            
            if not entity_text:
                continue
            
            # 标准化类型名
            type_mapping = {
                "人名": "PERSON", "姓名": "PERSON", "昵称": "NICKNAME",
                "实验室名称": "LAB_NAME", "实验室": "LAB_NAME", "机构": "ORG",
                "电话": "PHONE", "手机号": "PHONE", "电话号码": "PHONE",
                "身份证": "ID_CARD", "身份证号": "ID_CARD",
                "银行卡": "BANK_CARD", "银行卡号": "BANK_CARD",
                "地址": "ADDRESS", "公司": "ORG", "公司名称": "ORG",
            }
            normalized_type = type_mapping.get(entity_type, entity_type.upper())
            
            # 在 OCR 块中查找匹配
            for block in ocr_blocks:
                block_text = block.text
                
                # 精确包含匹配
                if entity_text in block_text:
                    # 计算子词在行内的精确位置
                    start_pos = block_text.find(entity_text)
                    text_len = len(block_text)
                    entity_len = len(entity_text)
                    
                    if text_len > 0:
                        # 根据字符位置比例计算像素位置
                        # 假设等宽字体（实际中文基本等宽，英文略窄）
                        start_ratio = start_pos / text_len
                        width_ratio = entity_len / text_len
                        
                        sub_left = int(block.left + start_ratio * block.width)
                        sub_width = max(int(width_ratio * block.width), 20)  # 最小宽度 20px
                        
                        # 如果敏感词占整个块的大部分(>80%)，直接用块坐标
                        if width_ratio > 0.8:
                            sub_left = block.left
                            sub_width = block.width
                        
                        regions.append(SensitiveRegion(
                            text=entity_text,
                            entity_type=normalized_type,
                            left=sub_left,
                            top=block.top,
                            width=sub_width,
                            height=block.height,
                            confidence=1.0,
                            source="text_match",
                        ))
                        print(f"  [MATCH] '{entity_text}' in '{block_text[:20]}...' @ ({sub_left}, {block.top}, {sub_width}, {block.height})")
                    break
                    
                # 模糊匹配（处理 OCR 可能的小错误）
                elif SequenceMatcher(None, entity_text, block_text).ratio() > 0.85:
                    regions.append(SensitiveRegion(
                        text=entity_text,
                        entity_type=normalized_type,
                        left=block.left,
                        top=block.top,
                        width=block.width,
                        height=block.height,
                        confidence=0.9,
                        source="fuzzy_match",
                    ))
                    print(f"  [MATCH] '{entity_text}' ~ '{block_text[:20]}...' (fuzzy)")
                    break
        
        print(f"[MATCH] Matched {len(regions)} entities to OCR blocks")
        return regions
    
    def _match_ocr_to_vlm(
        self,
        ocr_blocks: List[OCRTextBlock],
        vlm_regions: List[SensitiveRegion],
        iou_threshold: float = 0.3,
    ) -> List[SensitiveRegion]:
        """
        将 VLM 检测结果与 OCR 文本块匹配
        如果 VLM 区域与 OCR 块重叠，使用 OCR 的精确坐标
        """
        def calc_iou(box1: Tuple[int, int, int, int], box2: Tuple[int, int, int, int]) -> float:
            """计算两个边界框的 IoU"""
            x1 = max(box1[0], box2[0])
            y1 = max(box1[1], box2[1])
            x2 = min(box1[0] + box1[2], box2[0] + box2[2])
            y2 = min(box1[1] + box1[3], box2[1] + box2[3])
            
            if x2 <= x1 or y2 <= y1:
                return 0.0
            
            inter_area = (x2 - x1) * (y2 - y1)
            box1_area = box1[2] * box1[3]
            box2_area = box2[2] * box2[3]
            union_area = box1_area + box2_area - inter_area
            
            return inter_area / union_area if union_area > 0 else 0.0
        
        def normalize_text(text: str) -> str:
            if not text:
                return ""
            text = re.sub(r"\s+", "", text)
            text = re.sub(r"[^\w\u4e00-\u9fff]", "", text)
            return text

        refined_regions: List[SensitiveRegion] = []
        
        for vlm_region in vlm_regions:
            vlm_box = (vlm_region.left, vlm_region.top, vlm_region.width, vlm_region.height)
            
            best_match: Optional[OCRTextBlock] = None
            best_iou = 0.0
            
            for ocr_block in ocr_blocks:
                ocr_box = (ocr_block.left, ocr_block.top, ocr_block.width, ocr_block.height)
                iou = calc_iou(vlm_box, ocr_box)
                
                if iou > best_iou and iou >= iou_threshold:
                    best_iou = iou
                    best_match = ocr_block
            
            if not best_match:
                # IoU 失败时，使用文本匹配兜底
                norm_vlm = normalize_text(vlm_region.text)
                if norm_vlm:
                    for ocr_block in ocr_blocks:
                        norm_ocr = normalize_text(ocr_block.text)
                        if norm_ocr and (norm_vlm in norm_ocr or norm_ocr in norm_vlm):
                            best_match = ocr_block
                            break
                        # 模糊匹配兜底
                        if norm_ocr:
                            ratio = SequenceMatcher(None, norm_vlm, norm_ocr).ratio()
                            if ratio >= 0.6:
                                best_match = ocr_block
                                break

            if best_match:
                # 使用 OCR 的精确坐标
                refined_regions.append(SensitiveRegion(
                    text=best_match.text,
                    entity_type=vlm_region.entity_type,
                    left=best_match.left,
                    top=best_match.top,
                    width=best_match.width,
                    height=best_match.height,
                    confidence=max(vlm_region.confidence, best_match.confidence),
                    source="merged",
                    color=vlm_region.color,
                ))
            else:
                # 没有匹配的 OCR 块，保留 VLM 结果
                refined_regions.append(vlm_region)
        
        return refined_regions
    
    def _apply_regex_rules(
        self,
        ocr_blocks: List[OCRTextBlock],
        entity_types: List[str],
    ) -> List[SensitiveRegion]:
        """
        对 OCR 结果应用正则规则检测
        覆盖各类敏感信息：证件号、联系方式、账号、网络标识等
        """
        # 敏感信息正则模式（正则为主力的类型）
        patterns = {
            # ===== 联系方式 =====
            "PHONE": r"1[3-9]\d{9}",  # 手机号
            "EMAIL": r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}",
            
            # ===== 证件号码 =====
            "ID_CARD": r"[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]",  # 18位身份证
            "BANK_CARD": r"[3-6]\d{15,18}",  # 银行卡号（3/4/5/6开头）
            
            # ===== 组织机构 =====
            "COMPANY": r"[\u4e00-\u9fa5]{2,20}(?:有限公司|股份有限公司|集团|公司)",  # 公司名（全称或简称）
            
            # ===== 开户行 =====
            "BANK_NAME": r"[\u4e00-\u9fa5]{2,10}(?:银行)[\u4e00-\u9fa5]{0,10}(?:分行|支行|营业部)?",  # 如：中国工商银行北京分行
            
            # ===== 账号 =====
            # 正则只作为辅助，主要依赖 HaS 模型语义识别
            "ACCOUNT_NUMBER": r"(?:账号|帐号|账户号)[：:\s]*(\d{10,25})",  # 账号：6222020200012345678
            
            # ===== 日期 =====
            "DATE": r"(?:\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?)|(?:\d{4}年\d{1,2}月\d{1,2}日)",  # 2024-01-01 或 2024年1月1日
        }
        
        regions: List[SensitiveRegion] = []
        
        for block in ocr_blocks:
            block_text = block.text
            text_len = len(block_text)
            
            for entity_type, pattern in patterns.items():
                if entity_type not in entity_types:
                    continue
                
                matches = re.finditer(pattern, block_text)
                for match in matches:
                    matched_text = match.group()
                    
                    # 计算子词在行内的精确位置
                    start_pos = match.start()
                    matched_len = len(matched_text)
                    
                    if text_len > 0:
                        start_ratio = start_pos / text_len
                        width_ratio = matched_len / text_len
                        
                        sub_left = int(block.left + start_ratio * block.width)
                        sub_width = max(int(width_ratio * block.width), 20)
                        
                        # 如果匹配内容占整个块的大部分(>80%)，用块坐标
                        if width_ratio > 0.8:
                            sub_left = block.left
                            sub_width = block.width
                    else:
                        sub_left = block.left
                        sub_width = block.width
                    
                    regions.append(SensitiveRegion(
                        text=matched_text,
                        entity_type=entity_type,
                        left=sub_left,
                        top=block.top,
                        width=sub_width,
                        height=block.height,
                        confidence=1.0,
                        source="regex",
                    ))
        
        return regions
    
    def _draw_regions_on_image(
        self,
        image: Image.Image,
        regions: List[SensitiveRegion],
    ) -> Image.Image:
        """在图像上绘制敏感区域框"""
        draw_image = image.copy()
        draw = ImageDraw.Draw(draw_image)
        
        # 尝试加载中文字体
        font = None
        font_paths = [
            "C:/Windows/Fonts/msyh.ttc",
            "C:/Windows/Fonts/simsun.ttc",
            "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
        ]
        for fp in font_paths:
            if os.path.exists(fp):
                try:
                    font = ImageFont.truetype(fp, 14)
                    break
                except:
                    pass
        if not font:
            font = ImageFont.load_default()
        
        # 类型颜色映射（hex 转 RGB）
        type_colors = {
            # 人员相关
            "PERSON": (59, 130, 246),      # 蓝色
            
            # 组织机构
            "ORG": (16, 185, 129),         # 绿色
            "COMPANY": (20, 184, 166),     # 青绿色
            
            # 联系方式
            "PHONE": (249, 115, 22),       # 橙色
            "EMAIL": (234, 179, 8),        # 黄色
            
            # 证件号码
            "ID_CARD": (239, 68, 68),      # 红色
            "BANK_CARD": (236, 72, 153),   # 粉红色
            
            # 银行账户相关
            "ACCOUNT_NAME": (168, 85, 247),# 紫色
            "BANK_NAME": (124, 58, 237),   # 深紫色
            "ACCOUNT_NUMBER": (139, 92, 246), # 紫罗兰色
            
            # 地址
            "ADDRESS": (99, 102, 241),     # 靛蓝色
            
            # 日期
            "DATE": (161, 98, 7),          # 深金色
            
            # 视觉类
            "SEAL": (220, 20, 60),         # 深红色（公章）
        }
        
        for region in regions:
            color = type_colors.get(region.entity_type, (255, 0, 0))
            
            # 绘制边框
            x1, y1 = region.left, region.top
            x2, y2 = region.left + region.width, region.top + region.height
            draw.rectangle([x1, y1, x2, y2], outline=color, width=2)
            
            # 绘制标签
            label = f"{region.entity_type}"
            if region.text:
                label += f": {region.text[:15]}"
            
            # 标签背景
            bbox = draw.textbbox((x1, y1 - 18), label, font=font)
            draw.rectangle([bbox[0] - 2, bbox[1] - 2, bbox[2] + 2, bbox[3] + 2], fill=color)
            draw.text((x1, y1 - 18), label, fill=(255, 255, 255), font=font)
        
        return draw_image
    
    async def detect_and_draw(
        self,
        image_bytes: bytes,
        vision_types: Optional[list] = None,
    ) -> Tuple[List[SensitiveRegion], str]:
        """
        检测敏感信息并在图像上绘制
        
        新流程（参考 document_redaction_vlm）：
        1. PaddleOCR 提取所有文字和精确坐标
        2. HaS 分析文字内容，识别敏感实体（不依赖坐标）
        3. 用文字匹配把敏感实体映射回 OCR 坐标
        4. 正则规则补充检测
        
        Args:
            image_bytes: 图像字节
            vision_types: 用户启用的视觉类型配置列表 (VisionTypeConfig 对象)
            
        Returns:
            (敏感区域列表, base64编码的带框图像)
        """
        # 准备图像
        image, width, height = self._prepare_image(image_bytes)
        print(f"[IMG] Image size: {width}x{height}")
        
        # 把用户配置转换为类型 ID 列表（用于正则规则和过滤）
        if vision_types:
            entity_type_ids = [t.id for t in vision_types]
            print(f"[CFG] User enabled types: {[t.name for t in vision_types]}")
        else:
            # 默认检测所有类型
            entity_type_ids = ["PERSON", "ORG", "COMPANY", "PHONE", "EMAIL",
                              "ID_CARD", "BANK_CARD", "ACCOUNT_NAME", "BANK_NAME",
                              "ACCOUNT_NUMBER", "ADDRESS", "DATE", "SEAL"]
        
        # 1. 运行 PaddleOCR-VL 提取文字和视觉元素（如公章）
        ocr_blocks, visual_regions = self._run_paddle_ocr(image)
        
        all_regions: List[SensitiveRegion] = []
        
        # 1.5 添加视觉敏感区域（公章等），根据用户配置过滤
        for vr in visual_regions:
            if vr.entity_type in entity_type_ids:
                all_regions.append(vr)
                print(f"[VL] Added {vr.entity_type}: {vr.text}")
            else:
                print(f"[VL] Skipped {vr.entity_type} (not in enabled types)")
        
        if ocr_blocks:
            # 打印 OCR 识别到的所有文字（调试用）
            print(f"[OCR] All texts: {[b.text for b in ocr_blocks]}")
            
            # 2. 用 HaS 本地模型分析 OCR 文字，识别敏感实体（完全离线！）
            entities = await self._run_has_text_analysis(ocr_blocks, vision_types)
            
            # 3. 用文字匹配把敏感实体映射回 OCR 的精确坐标
            if entities:
                matched_regions = self._match_entities_to_ocr(ocr_blocks, entities)
                all_regions.extend(matched_regions)
            
            # 4. 对 OCR 结果应用正则规则（补充检测）
            regex_regions = self._apply_regex_rules(ocr_blocks, entity_type_ids)
            all_regions = self._merge_regions(all_regions, regex_regions)
        else:
            print("[WARN] PaddleOCR returned no text blocks")
        
        print(f"[OK] Final detected {len(all_regions)} sensitive regions")
        
        # 5. 在图像上绘制
        result_image = self._draw_regions_on_image(image, all_regions)
        
        # 6. 转换为 base64
        buffer = io.BytesIO()
        result_image.save(buffer, format="PNG")
        result_base64 = base64.b64encode(buffer.getvalue()).decode("utf-8")
        
        return all_regions, result_base64
    
    def _merge_regions(
        self,
        regions1: List[SensitiveRegion],
        regions2: List[SensitiveRegion],
        iou_threshold: float = 0.5,
    ) -> List[SensitiveRegion]:
        """合并两个区域列表，去除重复"""
        def calc_iou(r1: SensitiveRegion, r2: SensitiveRegion) -> float:
            x1 = max(r1.left, r2.left)
            y1 = max(r1.top, r2.top)
            x2 = min(r1.left + r1.width, r2.left + r2.width)
            y2 = min(r1.top + r1.height, r2.top + r2.height)
            
            if x2 <= x1 or y2 <= y1:
                return 0.0
            
            inter = (x2 - x1) * (y2 - y1)
            area1 = r1.width * r1.height
            area2 = r2.width * r2.height
            union = area1 + area2 - inter
            
            return inter / union if union > 0 else 0.0
        
        merged = list(regions1)
        
        for r2 in regions2:
            is_duplicate = False
            for r1 in merged:
                if calc_iou(r1, r2) >= iou_threshold:
                    is_duplicate = True
                    break
            if not is_duplicate:
                merged.append(r2)
        
        return merged
    
    async def apply_redaction(
        self,
        image_bytes: bytes,
        regions: List[SensitiveRegion],
        redaction_color: Tuple[int, int, int] = (0, 0, 0),
    ) -> bytes:
        """
        应用脱敏（用纯色块覆盖敏感区域）
        """
        image, _, _ = self._prepare_image(image_bytes)
        draw = ImageDraw.Draw(image)
        
        for region in regions:
            x1, y1 = region.left, region.top
            x2, y2 = region.left + region.width, region.top + region.height
            draw.rectangle([x1, y1, x2, y2], fill=redaction_color)
        
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()


# 单例
_hybrid_service: Optional[HybridVisionService] = None

def get_hybrid_vision_service() -> HybridVisionService:
    global _hybrid_service
    if _hybrid_service is None:
        _hybrid_service = HybridVisionService()
    return _hybrid_service
