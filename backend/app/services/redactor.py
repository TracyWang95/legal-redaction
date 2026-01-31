"""
脱敏执行服务
处理文本和图片的脱敏逻辑
"""
import os
import uuid
import re
from typing import Optional
from docx import Document
import fitz

from app.core.config import settings
from app.models.schemas import (
    Entity, 
    BoundingBox, 
    RedactionConfig, 
    ReplacementMode,
    EntityType,
    FileType,
)
from app.services.vision_service import VisionService


class RedactionContext:
    """
    脱敏上下文
    维护实体映射关系，确保同一实体在文档中的一致性
    """
    
    def __init__(self, mode: ReplacementMode):
        self.mode = mode
        self.entity_map: dict[str, str] = {}
        self._coref_map: dict[str, str] = {}
        self.type_counters: dict[str, int] = {}
        self.custom_replacements: dict[str, str] = {}
        self.structured_tag_map: dict[str, str] = {}
    
    def set_custom_replacements(self, replacements: dict[str, str]):
        """设置自定义替换映射"""
        self.custom_replacements = replacements

    def set_structured_mapping(self, mapping: dict[str, list[str]]):
        """设置结构化标签映射（tag -> 原文列表）"""
        for tag, values in mapping.items():
            for value in values:
                if value and value not in self.structured_tag_map:
                    self.structured_tag_map[value] = tag
    
    def get_replacement(self, entity: Entity) -> str:
        """
        获取实体的替换文本
        确保同一实体在整个文档中使用相同的替换
        """
        # 使用 coref_id 作为主键以保持指代一致
        entity_key = entity.coref_id or entity.text
        if entity_key in self._coref_map:
            return self._coref_map[entity_key]
        
        # 根据模式生成替换文本
        if self.mode == ReplacementMode.CUSTOM:
            # 自定义模式：使用预设的替换
            replacement = self.custom_replacements.get(
                entity.text,
                entity.replacement or self._generate_smart_replacement(entity)
            )
        elif self.mode == ReplacementMode.MASK:
            # 掩码模式
            replacement = self._generate_mask_replacement(entity)
        elif self.mode == ReplacementMode.STRUCTURED:
            # 结构化语义标签
            replacement = self._generate_structured_replacement(entity)
        else:
            # 智能模式
            replacement = self._generate_smart_replacement(entity)
        
        self._coref_map[entity_key] = replacement
        if entity.text not in self.entity_map:
            self.entity_map[entity.text] = replacement
        return replacement
    
    def _generate_smart_replacement(self, entity: Entity) -> str:
        """生成智能替换文本"""
        entity_type = entity.type
        type_key = entity_type.value if isinstance(entity_type, EntityType) else str(entity_type)
        
        # 获取计数器
        if type_key not in self.type_counters:
            self.type_counters[type_key] = 0
        self.type_counters[type_key] += 1
        count = self.type_counters[type_key]
        
        # 根据类型生成替换文本
        type_labels = {
            "PERSON": "当事人",
            "ORG": "公司",
            "ID_CARD": "证件号",
            "PHONE": "电话",
            "ADDRESS": "地址",
            "BANK_CARD": "账号",
            "CASE_NUMBER": "案号",
            "DATE": "日期",
            "MONEY": "金额",
            "AMOUNT": "金额",
            "EMAIL": "邮箱",
            "LICENSE_PLATE": "车牌",
            "CONTRACT_NO": "合同编号",
            "CUSTOM": "敏感信息",
        }
        
        label = type_labels.get(type_key, "敏感信息")
        
        # 使用中文数字编号
        chinese_nums = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]
        if count <= 10:
            num_str = chinese_nums[count]
        else:
            num_str = str(count)
        
        return f"[{label}{num_str}]"
    
    def _generate_mask_replacement(self, entity: Entity) -> str:
        """生成掩码替换文本"""
        text = entity.text
        length = len(text)
        type_key = entity.type.value if isinstance(entity.type, EntityType) else str(entity.type)
        
        if type_key == "PERSON":
            # 人名：保留姓，其他用 *
            if length >= 2:
                return text[0] + "*" * (length - 1)
            return "*"
        
        elif type_key == "PHONE":
            # 电话：保留前3后4
            if length >= 11:
                return text[:3] + "****" + text[-4:]
            return "*" * length
        
        elif type_key == "ID_CARD":
            # 身份证：保留前6后4
            if length >= 18:
                return text[:6] + "********" + text[-4:]
            return "*" * length
        
        elif type_key == "BANK_CARD":
            # 银行卡：保留后4
            if length >= 16:
                return "*" * (length - 4) + text[-4:]
            return "*" * length
        
        else:
            # 其他：全部用 *
            return "*" * length

    def _generate_structured_replacement(self, entity: Entity) -> str:
        """生成结构化语义标签"""
        type_key = entity.type.value if isinstance(entity.type, EntityType) else str(entity.type)

        if entity.coref_id and entity.coref_id.startswith("<") and entity.coref_id.endswith(">"):
            return entity.coref_id

        if entity.text in self.structured_tag_map:
            return self.structured_tag_map[entity.text]

        template = self._get_tag_template(type_key)
        if template:
            if type_key not in self.type_counters:
                self.type_counters[type_key] = 0
            self.type_counters[type_key] += 1
            index = self.type_counters[type_key]
            return template.replace("{index}", f"{index:03d}")

        structured_map = {
            "PERSON": ("人物", "个人.姓名"),
            "ORG": ("组织", "企业.完整名称"),
            "ADDRESS": ("地点", "办公地址.完整地址"),
            "PHONE": ("电话", "固定电话.号码"),
            "ID_CARD": ("编号", "身份证.号码"),
            "BANK_CARD": ("编号", "银行卡.号码"),
            "CASE_NUMBER": ("编号", "案件编号.号码"),
            "DATE": ("日期/时间", "具体日期.年月日"),
            "MONEY": ("金额", "合同金额.数值"),
            "AMOUNT": ("金额", "合同金额.数值"),
            "EMAIL": ("邮箱", "个人邮箱.地址"),
            "LICENSE_PLATE": ("编号", "车牌.号码"),
            "CONTRACT_NO": ("编号", "合同编号.代码"),
        }

        if type_key not in self.type_counters:
            self.type_counters[type_key] = 0
        self.type_counters[type_key] += 1
        index = self.type_counters[type_key]

        type_name = structured_map.get(type_key)
        if type_name:
            category, path = type_name
            return f"<{category}[{index:03d}].{path}>"

        # 自定义或未知类型兜底
        label = type_key
        return f"<{label}[{index:03d}].完整名称>"

    def _get_tag_template(self, type_key: str) -> Optional[str]:
        try:
            from app.api.entity_types import entity_types_db
            cfg = entity_types_db.get(type_key)
            if cfg and getattr(cfg, "tag_template", None):
                return cfg.tag_template
        except Exception:
            return None
        return None


class Redactor:
    """脱敏执行器"""
    
    def __init__(self):
        self.vision_service = VisionService()
    
    async def redact(
        self,
        file_info: dict,
        entities: list[Entity],
        bounding_boxes: list[BoundingBox],
        config: RedactionConfig,
    ) -> dict:
        """
        执行脱敏操作
        
        Args:
            file_info: 文件信息
            entities: 要脱敏的实体列表
            bounding_boxes: 要脱敏的图片区域列表
            config: 脱敏配置
            
        Returns:
            脱敏结果
        """
        file_type = file_info["file_type"]
        file_path = file_info["file_path"]
        
        # 创建脱敏上下文
        context = RedactionContext(config.replacement_mode)
        context.set_custom_replacements(config.custom_replacements)
        
        # 生成输出文件路径
        output_file_id = str(uuid.uuid4())
        original_ext = os.path.splitext(file_path)[1]
        output_ext = original_ext
        if file_type == FileType.DOC:
            output_ext = ".docx"
        output_path = os.path.join(settings.OUTPUT_DIR, f"{output_file_id}{output_ext}")
        
        # 只处理选中的实体
        selected_entities = [e for e in entities if e.selected]
        selected_boxes = [b for b in bounding_boxes if b.selected]

        # 结构化模式：优先使用 HaS Hide 映射提升一致性
        if config.replacement_mode == ReplacementMode.STRUCTURED and file_info.get("content"):
            try:
                from app.services.has_service import has_service
                from app.api.entity_types import entity_types_db

                if has_service.is_available():
                    type_ids = {e.type for e in selected_entities}
                    entity_types = [entity_types_db[tid] for tid in type_ids if tid in entity_types_db]
                    if entity_types:
                        masked_text, mapping = await has_service.hide_text(
                            file_info["content"],
                            entity_types,
                        )
                        context.set_structured_mapping(mapping)
                        # 用于前端对比展示
                        file_info["redacted_text"] = masked_text
            except Exception as e:
                print(f"结构化脱敏映射构建失败: {e}")
        
        redacted_count = 0
        
        if file_type == FileType.DOC:
            # 先将 .doc 转换为 .docx 再处理
            converted_path = await self._convert_doc_to_docx(file_path)
            if not converted_path or not os.path.exists(converted_path):
                raise ValueError("DOC 转换失败，无法脱敏")
            redacted_count = await self._redact_docx(
                converted_path, output_path, selected_entities, context
            )
            # 清理转换后的临时文件
            if converted_path != file_path:
                try:
                    os.remove(converted_path)
                except:
                    pass
        elif file_type == FileType.DOCX:
            # Word 文档脱敏
            redacted_count = await self._redact_docx(
                file_path, output_path, selected_entities, context
            )
        elif file_type == FileType.PDF:
            # PDF 文档脱敏（文本型）
            redacted_count = await self._redact_pdf_text(
                file_path, output_path, selected_entities, context
            )
        elif file_type in [FileType.PDF_SCANNED, FileType.IMAGE]:
            # 图片/扫描件脱敏
            await self.vision_service.apply_redaction(
                file_path, file_type, selected_boxes, output_path
            )
            redacted_count = len(selected_boxes)
        
        return {
            "output_file_id": output_file_id,
            "output_path": output_path,
            "redacted_count": redacted_count,
            "entity_map": context.entity_map,
        }

    async def _convert_doc_to_docx(self, file_path: str) -> Optional[str]:
        """将 .doc 转换为 .docx（复用 FileParser 逻辑）"""
        try:
            from app.services.file_parser import FileParser
            parser = FileParser()
            return await parser._convert_doc_to_docx(file_path)
        except Exception as e:
            print(f"DOC 转换失败: {e}")
            return None
    
    async def _redact_docx(
        self,
        input_path: str,
        output_path: str,
        entities: list[Entity],
        context: RedactionContext,
    ) -> int:
        """Word 文档脱敏"""
        doc = Document(input_path)
        redacted_count = 0
        
        # 构建替换映射
        replacements = {}
        for entity in entities:
            if entity.text not in replacements:
                replacements[entity.text] = context.get_replacement(entity)
        
        for para in self._iter_all_paragraphs(doc):
            redacted_count += self._replace_in_paragraph(para, replacements)
        
        doc.save(output_path)
        return redacted_count

    def _iter_all_paragraphs(self, doc: Document):
        """遍历正文/表格/页眉页脚中的所有段落"""
        for para in doc.paragraphs:
            yield para
        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    for para in cell.paragraphs:
                        yield para
        for section in doc.sections:
            for para in section.header.paragraphs:
                yield para
            for para in section.footer.paragraphs:
                yield para
            for table in section.header.tables:
                for row in table.rows:
                    for cell in row.cells:
                        for para in cell.paragraphs:
                            yield para
            for table in section.footer.tables:
                for row in table.rows:
                    for cell in row.cells:
                        for para in cell.paragraphs:
                            yield para

    def _replace_in_paragraph(self, para, replacements: dict[str, str]) -> int:
        """在段落内进行 run 级替换，尽量保留原始格式"""
        if not replacements:
            return 0
        runs = list(para.runs)
        if not runs:
            return 0

        full_text = "".join(run.text for run in runs)
        if not full_text:
            return 0

        # 记录每个字符所属的 run 索引
        style_ids: list[int] = []
        for idx, run in enumerate(runs):
            style_ids.extend([idx] * len(run.text))

        if not style_ids:
            return 0

        # 找到所有替换
        matches: list[tuple[int, int, str]] = []
        for old_text, new_text in replacements.items():
            if not old_text:
                continue
            start = 0
            while True:
                pos = full_text.find(old_text, start)
                if pos < 0:
                    break
                matches.append((pos, pos + len(old_text), new_text))
                start = pos + len(old_text)

        if not matches:
            return 0

        matches.sort(key=lambda x: x[0])
        new_text_parts: list[str] = []
        new_style_ids: list[int] = []
        last_end = 0
        replaced_count = 0

        for start, end, replacement in matches:
            if start < last_end:
                continue
            if start > last_end:
                new_text_parts.append(full_text[last_end:start])
                new_style_ids.extend(style_ids[last_end:start])
            style_id = style_ids[start] if start < len(style_ids) else style_ids[-1]
            new_text_parts.append(replacement)
            new_style_ids.extend([style_id] * len(replacement))
            last_end = end
            replaced_count += 1

        if last_end < len(full_text):
            new_text_parts.append(full_text[last_end:])
            new_style_ids.extend(style_ids[last_end:])

        rebuilt = "".join(new_text_parts)
        if rebuilt == full_text:
            return 0

        # 清理原 runs
        for run in runs:
            run._element.getparent().remove(run._element)

        # 重建 runs，保留格式
        pos = 0
        while pos < len(rebuilt):
            current_style = new_style_ids[pos]
            next_pos = pos + 1
            while next_pos < len(rebuilt) and new_style_ids[next_pos] == current_style:
                next_pos += 1
            segment = rebuilt[pos:next_pos]
            if segment:
                new_run = para.add_run(segment)
                self._copy_run_format(runs[current_style], new_run)
            pos = next_pos

        return replaced_count

    def _copy_run_format(self, source_run, target_run):
        """复制 run 的格式样式"""
        target_run.style = source_run.style
        target_run.bold = source_run.bold
        target_run.italic = source_run.italic
        target_run.underline = source_run.underline
        target_run.font.name = source_run.font.name
        target_run.font.size = source_run.font.size
        target_run.font.color.rgb = source_run.font.color.rgb
        target_run.font.highlight_color = source_run.font.highlight_color
    
    async def _redact_pdf_text(
        self,
        input_path: str,
        output_path: str,
        entities: list[Entity],
        context: RedactionContext,
    ) -> int:
        """PDF 文档脱敏（文本型）"""
        doc = fitz.open(input_path)
        redacted_count = 0
        
        # 构建替换映射
        replacements = {}
        for entity in entities:
            if entity.text not in replacements:
                replacements[entity.text] = context.get_replacement(entity)
        
        # 对每一页进行处理
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            
            for old_text, new_text in replacements.items():
                # 查找文本位置
                text_instances = page.search_for(old_text)
                
                for inst in text_instances:
                    # 添加遮罩（白色背景 + 新文本）
                    # 首先用白色矩形覆盖原文本
                    shape = page.new_shape()
                    shape.draw_rect(inst)
                    shape.finish(color=(1, 1, 1), fill=(1, 1, 1))
                    shape.commit()
                    
                    # 然后插入新文本
                    # 计算文本位置（矩形左上角）
                    text_point = fitz.Point(inst.x0, inst.y1 - 2)
                    page.insert_text(
                        text_point,
                        new_text,
                        fontsize=10,
                        color=(0, 0, 0),
                    )
                    
                    redacted_count += 1
        
        doc.save(output_path)
        doc.close()
        
        return redacted_count
    
    async def get_comparison(self, file_info: dict) -> dict:
        """
        获取脱敏前后对比数据
        """
        file_type = file_info["file_type"]
        original_path = file_info["file_path"]
        redacted_path = file_info.get("output_path")
        redacted_text = file_info.get("redacted_text")
        
        if not redacted_path or not os.path.exists(redacted_path):
            raise ValueError("脱敏文件不存在")
        
        original_content = ""
        redacted_content = ""
        
        if redacted_text:
            # 使用结构化脱敏文本（更符合展示）
            redacted_content = redacted_text
            if file_type == FileType.DOCX:
                original_content = self._extract_docx_text(original_path)
            elif file_type == FileType.PDF:
                original_content = self._extract_pdf_text(original_path)
            else:
                original_content = "[图片文件，请查看预览]"
        elif file_type == FileType.DOCX:
            # Word 文档
            original_content = self._extract_docx_text(original_path)
            redacted_content = self._extract_docx_text(redacted_path)
        elif file_type == FileType.PDF:
            # PDF 文档
            original_content = self._extract_pdf_text(original_path)
            redacted_content = self._extract_pdf_text(redacted_path)
        else:
            # 图片类：返回提示信息
            original_content = "[图片文件，请查看预览]"
            redacted_content = "[已脱敏图片，请查看预览]"
        
        # 计算变更
        changes = self._compute_changes(
            original_content,
            redacted_content,
            file_info.get("entity_map", {}),
        )
        
        return {
            "original": original_content,
            "redacted": redacted_content,
            "changes": changes,
        }
    
    def _extract_docx_text(self, file_path: str) -> str:
        """提取 Word 文档文本"""
        doc = Document(file_path)
        paragraphs = [para.text for para in doc.paragraphs if para.text.strip()]
        return "\n".join(paragraphs)
    
    def _extract_pdf_text(self, file_path: str) -> str:
        """提取 PDF 文档文本"""
        doc = fitz.open(file_path)
        text = ""
        for page in doc:
            text += page.get_text() + "\n"
        doc.close()
        return text
    
    def _compute_changes(
        self,
        original: str,
        redacted: str,
        entity_map: dict[str, str],
    ) -> list[dict]:
        """计算变更列表"""
        changes = []
        
        for original_text, replacement in entity_map.items():
            # 计算出现次数
            count = original.count(original_text)
            if count > 0:
                changes.append({
                    "original": original_text,
                    "replacement": replacement,
                    "count": count,
                })
        
        return changes
