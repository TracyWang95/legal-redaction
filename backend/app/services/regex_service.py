"""
正则表达式识别服务
用于识别有固定模式的敏感信息，准确率接近100%
"""

import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.models.type_mapping import canonical_type_id


@dataclass
class RegexPattern:
    """正则模式配置"""
    pattern: str
    group: int = 0
    priority: int = 1  # 优先级，数字越大越优先
    validator: Callable[[str], bool] | None = None  # 可选的校验函数


# 预定义的正则模式
_ORG_PREFIX_BLACKLIST = (
    "\u539f\u544a",
    "\u88ab\u544a",
    "\u7b2c\u4e09\u4eba",
    "\u7533\u8bf7\u4eba",
    "\u88ab\u7533\u8bf7\u4eba",
    "\u4e0a\u8bc9\u4eba",
    "\u88ab\u4e0a\u8bc9\u4eba",
    "\u672c\u9662",
    "\u4e0a\u8bc9\u4e8e",
)
_ORG_CONNECTOR_BLACKLIST = (
    "\u88ab\u9001\u5f80",
    "\u9001\u5f80",
    "\u4f4f\u9662\u6cbb\u7597",
    "\u9a7e\u9a76\u767b\u8bb0\u5728",
)
_ORG_TITLE_BLACKLIST = {
    "\u6c11\u4e8b\u5224\u51b3\u4e66",
    "\u6c11\u4e8b\u88c1\u5b9a\u4e66",
    "\u6c11\u4e8b\u8c03\u89e3\u4e66",
    "\u5224\u51b3\u4e66",
    "\u88c1\u5b9a\u4e66",
    "\u8c03\u89e3\u4e66",
}
_ORG_SUFFIX_RE = re.compile(
    r"(?:"
    r"\u4eba\u6c11\u6cd5\u9662|\u6cd5\u9662|\u4eba\u6c11\u68c0\u5bdf\u9662|\u68c0\u5bdf\u9662|"
    r"\u4ef2\u88c1\u59d4\u5458\u4f1a|\u516c\u8bc1\u5904|\u53f8\u6cd5\u5c40|\u516c\u5b89\u5c40|"
    r"\u5f8b\u5e08\u4e8b\u52a1\u6240|\u4e8b\u52a1\u6240|\u6709\u9650\u8d23\u4efb\u516c\u53f8|"
    r"\u80a1\u4efd\u6709\u9650\u516c\u53f8|\u6709\u9650\u516c\u53f8|\u5206\u516c\u53f8|"
    r"\u516c\u53f8|\u96c6\u56e2|\u4fdd\u9669|\u94f6\u884c|\u652f\u884c|\u59d4\u5458\u4f1a|\u533b\u9662|\u5b66\u6821|\u4e2d\u5fc3"
    r")$"
)


def _is_probable_org_name(text: str) -> bool:
    compact = re.sub(r"\s+", "", text).strip(" ,，.。;；:：()（）[]【】")
    if compact in _ORG_TITLE_BLACKLIST:
        return False
    if not (4 <= len(compact) <= 45):
        return False
    if any(connector in compact for connector in _ORG_CONNECTOR_BLACKLIST):
        return False
    if any(compact.startswith(prefix) for prefix in _ORG_PREFIX_BLACKLIST):
        return False
    return bool(_ORG_SUFFIX_RE.search(compact))


BUILTIN_PATTERNS: dict[str, list[RegexPattern]] = {
    # 身份证号 - 15位或18位
    "ID_CARD": [
        RegexPattern(
            pattern=r"(?<![A-Za-z0-9])[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![A-Za-z0-9])",
            priority=20,
        ),
        RegexPattern(
            pattern=r"(?<![A-Za-z0-9])[1-9]\d{5}\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}(?![A-Za-z0-9])",
            priority=19,
        ),
    ],

    # 手机号 - 中国大陆
    "PERSON": [
        RegexPattern(
            pattern=(
                r"(?:\u539f\u544a|\u88ab\u544a|\u7b2c\u4e09\u4eba|\u4e0a\u8bc9\u4eba|"
                r"\u88ab\u4e0a\u8bc9\u4eba|\u7533\u8bf7\u4eba|\u88ab\u7533\u8bf7\u4eba)[\uff1a:]"
                r"([\u4e00-\u9fff]{2,4})(?=[\uff0c,](?:\u7537|\u5973|\u6c49\u65cf))"
            ),
            priority=8,
            group=1,
        ),
        RegexPattern(
            pattern=(
                r"(?:\u6cd5\u5b9a\u4ee3\u8868\u4eba|\u59d4\u6258\u8bc9\u8bbc\u4ee3\u7406\u4eba|"
                r"\u5ba1\u5224\u5458|\u4e66\u8bb0\u5458|\u8d1f\u8d23\u4eba|\u7ecf\u529e\u4eba|\u8054\u7cfb\u4eba)[\uff1a:]"
                r"([\u4e00-\u9fff]{2,4})(?=$|[\s\uff0c,;\uff1b])"
            ),
            priority=8,
            group=1,
        ),
    ],

    "PHONE": [
        RegexPattern(
            pattern=r"(?<![A-Za-z0-9])1[3-9]\d{9}(?![A-Za-z0-9])",
            priority=10,
        ),
        # 带区号的座机
        RegexPattern(
            pattern=r"(?<![A-Za-z0-9])(?:0\d{2,3}[-\s]?)?\d{7,8}(?![A-Za-z0-9])",
            priority=5,
        ),
    ],

    # 银行卡号 - 16-19位数字
    "BANK_CARD": [
        RegexPattern(
            pattern=r"(?<![A-Za-z0-9])(?:62|4|5)\d{14,17}(?![A-Za-z0-9])",
            priority=10,
        ),
    ],

    # 银行账号 - require an account label to avoid broad digit false positives
    "BANK_ACCOUNT": [
        RegexPattern(
            pattern=r"(?:账号|帐号|账户号|银行账号|对公账号|收款账号)[：:\s]*(?:\d[\d\s-]{8,30}\d)",
            priority=10,
        ),
    ],

    # 邮箱
    "EMAIL": [
        RegexPattern(
            pattern=r"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![A-Za-z0-9.-])",
            priority=10,
        ),
    ],

    # 案件编号 - 常见格式
    "CASE_NUMBER": [
        # (2024)京01民初123号
        RegexPattern(
            pattern=r"[\(（]\d{4}[\)）][京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领A-Z]{1,4}\d{0,4}[民刑行执破知赔财商][初终复再抗申裁监督撤]?\d+号",
            priority=10,
        ),
        # 兼容更多格式
        RegexPattern(
            pattern=r"[\(（]\d{4}[\)）][A-Za-z\u4e00-\u9fff]+\d*[A-Za-z\u4e00-\u9fff]*\d+号",
            priority=8,
        ),
    ],

    # 日期 - 多种格式
    "ORG": [
        RegexPattern(
            pattern=(
                r"(?:\u88ab\u9001\u5f80|\u9001\u5f80|\u81f3|\u5230)"
                r"([\u4e00-\u9fffA-Za-z0-9\uff08\uff09()·\-.]{2,40}"
                r"(?:\u4eba\u6c11\u6cd5\u9662|\u6cd5\u9662|\u4eba\u6c11\u68c0\u5bdf\u9662|\u68c0\u5bdf\u9662|"
                r"\u4ef2\u88c1\u59d4\u5458\u4f1a|\u516c\u8bc1\u5904|\u53f8\u6cd5\u5c40|\u516c\u5b89\u5c40|"
                r"\u5f8b\u5e08\u4e8b\u52a1\u6240|\u4e8b\u52a1\u6240|\u6709\u9650\u8d23\u4efb\u516c\u53f8|"
                r"\u80a1\u4efd\u6709\u9650\u516c\u53f8|\u6709\u9650\u516c\u53f8|\u5206\u516c\u53f8|"
                r"\u516c\u53f8|\u96c6\u56e2|\u4fdd\u9669|\u94f6\u884c|\u652f\u884c|\u59d4\u5458\u4f1a|\u533b\u9662|\u5b66\u6821|\u4e2d\u5fc3))"
                r"(?=$|[\s,，.。;；:：)）]|\u4f4f\u9662|\u6cbb\u7597|\u5f8b\u5e08|\u5458\u5de5)"
            ),
            priority=10,
            group=1,
            validator=_is_probable_org_name,
        ),
        RegexPattern(
            pattern=(
                r"(?<![\u4e00-\u9fffA-Za-z0-9])"
                r"[\u4e00-\u9fffA-Za-z0-9\uff08\uff09()·\-.]{2,40}"
                r"(?:\u516c\u53f8|\u96c6\u56e2|\u4fdd\u9669|\u94f6\u884c|\u652f\u884c)"
                r"(?=\u5728|\u7cfb|\u5e94|\u4e8e|\u5904|\u540d\u4e0b|\u5458\u5de5)"
            ),
            priority=10,
            validator=_is_probable_org_name,
        ),
        RegexPattern(
            pattern=(
                r"(?<![\u4e00-\u9fffA-Za-z0-9])"
                r"[\u4e00-\u9fffA-Za-z0-9\uff08\uff09()·\-.]{2,40}"
                r"(?:\u4eba\u6c11\u6cd5\u9662|\u6cd5\u9662|\u4eba\u6c11\u68c0\u5bdf\u9662|\u68c0\u5bdf\u9662|"
                r"\u4ef2\u88c1\u59d4\u5458\u4f1a|\u516c\u8bc1\u5904|\u53f8\u6cd5\u5c40|\u516c\u5b89\u5c40|"
                r"\u5f8b\u5e08\u4e8b\u52a1\u6240|\u4e8b\u52a1\u6240|\u6709\u9650\u8d23\u4efb\u516c\u53f8|"
                r"\u80a1\u4efd\u6709\u9650\u516c\u53f8|\u6709\u9650\u516c\u53f8|\u5206\u516c\u53f8|"
                r"\u516c\u53f8|\u96c6\u56e2|\u4fdd\u9669|\u94f6\u884c|\u652f\u884c|\u59d4\u5458\u4f1a|\u533b\u9662|\u5b66\u6821|\u4e2d\u5fc3)"
                r"(?=$|[\s,，.。;；:：)）]|\u5f8b\u5e08|\u5458\u5de5|\u4f4f\u9662)"
            ),
            priority=9,
            validator=_is_probable_org_name,
        ),
        RegexPattern(
            pattern=(
                r"(?<=[\u4e8e\u81f3\u5230\u5411])"
                r"[\u4e00-\u9fffA-Za-z0-9\uff08\uff09()·\-.]{2,40}"
                r"(?:\u4eba\u6c11\u6cd5\u9662|\u6cd5\u9662|\u4eba\u6c11\u68c0\u5bdf\u9662|\u68c0\u5bdf\u9662|"
                r"\u4ef2\u88c1\u59d4\u5458\u4f1a|\u516c\u8bc1\u5904|\u53f8\u6cd5\u5c40|\u516c\u5b89\u5c40)"
                r"(?=$|[\s,，.。;；:：)）])"
            ),
            priority=8,
            validator=_is_probable_org_name,
        ),
    ],

    "DATE": [
        RegexPattern(
            pattern=(
                r"[一二三四五六七八九〇零]{4}\s*年\s*"
                r"(?:十[一二]?|[一二三四五六七八九])\s*月\s*"
                r"(?:三十[一]?|二十[一二三四五六七八九]?|十[一二三四五六七八九]?|[一二三四五六七八九])\s*日"
            ),
            priority=13,
        ),
        RegexPattern(
            pattern=r"(?:签订日期|签署日期|开具日期|填写日期|日期|时间|Date)[：:\s]*(?:19|20)\d{2}\s*(?:年|[-/.])\s*(?:0?[1-9]|1[0-2])\s*(?:月|[-/.])\s*(?:0?[1-9]|[12]\d|3[01])\s*(?:日|号)?\s*(?:T|\s+)?(?:上午|下午|晚上|凌晨|中午)?\s*(?:[01]?\d|2[0-3])(?:[:：](?:[0-5]\d)(?:[:：][0-5]\d)?|\s*(?:点|时)(?:\s*[0-5]?\d\s*分)?(?:\s*[0-5]?\d\s*秒)?)",
            priority=15,
        ),
        # 2024-01-01 14:30 / 2024年1月1日下午3点15分; DATE covers
        # date, datetime and clock-time semantics as one public type.
        RegexPattern(
            pattern=r"(?<!\d)(?:19|20)\d{2}\s*(?:年|[-/.])\s*(?:0?[1-9]|1[0-2])\s*(?:月|[-/.])\s*(?:0?[1-9]|[12]\d|3[01])\s*(?:日|号)?\s*(?:T|\s+)?(?:上午|下午|晚上|凌晨|中午)?\s*(?:[01]?\d|2[0-3])(?:[:：](?:[0-5]\d)(?:[:：][0-5]\d)?|\s*(?:点|时)(?:\s*[0-5]?\d\s*分)?(?:\s*[0-5]?\d\s*秒)?)",
            priority=14,
        ),
        RegexPattern(
            pattern=r"(?<!\d)(?:19|20)\d{2}\s*(?:年|[-/.])\s*(?:0?[1-9]|1[0-2])\s*(?:月|[-/.])\s*(?:0?[1-9]|[12]\d|3[01])\s*(?:日|号)?(?!\d)",
            priority=12,
        ),
        RegexPattern(
            pattern=r"(?:签订日期|签署日期|开具日期|填写日期|日期|时间|Date)[：:\s]*(?:19|20)\d{2}\s*(?:年|[-/.])\s*(?:0?[1-9]|1[0-2])\s*(?:月|[-/.])\s*(?:0?[1-9]|[12]\d|3[01])\s*(?:日|号)?",
            priority=11,
        ),
        RegexPattern(
            pattern=r"(?:签订日期|签署日期|开具日期|填写日期|日期|时间)[：:\s]*(?:0?[1-9]|1[0-2])月(?:0?[1-9]|[12]\d|3[01])(?:日|号)",
            priority=8,
        ),
        # 2024年1月1日
        RegexPattern(
            pattern=r"\d{4}年\d{1,2}月\d{1,2}日",
            priority=10,
        ),
        # 2024-01-01 或 2024/01/01
        RegexPattern(
            pattern=r"\d{4}[-/]\d{1,2}[-/]\d{1,2}",
            priority=9,
        ),
        RegexPattern(
            pattern=r"(?<!\d)(?:[01]?\d|2[0-3])[:：](?:[0-5]\d)(?:[:：][0-5]\d)?(?!\d)",
            priority=7,
        ),
        RegexPattern(
            pattern=r"(?:上午|下午|晚上|凌晨|中午)?\s*(?:[01]?\d|2[0-3])\s*(?:点|时)(?:\s*[0-5]?\d\s*分)?(?:\s*[0-5]?\d\s*秒)?",
            priority=7,
        ),
    ],

    # 金额
    "AMOUNT": [
        # 带货币前缀的金额：人民币 1,200.00 / RMB 1200 / ¥1200 元
        RegexPattern(
            pattern=r"(?<![A-Za-z0-9])(?:人民币|￥|¥|RMB)\s*\d[\d,，]*(?:[.，,]\d{1,2})?\s*(?:亿元|万元|元)?(?![A-Za-z0-9])",
            priority=10,
        ),
        # 无货币前缀时必须带金额单位，避免把年份、编号、统一社会信用代码误判为金额
        RegexPattern(
            pattern=r"(?<![A-Za-z0-9])\d[\d,，]*(?:[.，,]\d{1,2})?\s*(?:亿元|万元|元)(?![A-Za-z0-9])",
            priority=9,
        ),
        RegexPattern(
            pattern=r"[零一二三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟]+元(?:整)?",
            priority=8,
        ),
    ],

    # 车牌号
    "LICENSE_PLATE": [
        RegexPattern(
            pattern=r"[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领][A-Z][·.\-\s]?[A-Z0-9]{5,6}",
            priority=10,
        ),
    ],

    # IP地址
    "IP_ADDRESS": [
        RegexPattern(
            pattern=r"(?<![A-Za-z0-9])(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?![A-Za-z0-9])",
            priority=10,
        ),
    ],

    # 网址
    "URL": [
        RegexPattern(
            pattern=r"https?://[^\s<>\"{}|\\^`\[\]]+",
            priority=10,
        ),
    ],
}


class RegexService:
    """正则识别服务"""

    def __init__(self):
        self.patterns = BUILTIN_PATTERNS.copy()
        # 预编译正则
        self._compiled: dict[str, list[tuple]] = {}
        self._compile_patterns()

    def _compile_patterns(self):
        """预编译正则表达式"""
        for entity_type, patterns in self.patterns.items():
            self._compiled[entity_type] = [
                (re.compile(p.pattern, re.IGNORECASE), p.priority, p.validator, p.group)
                for p in patterns
            ]

    def add_pattern(self, entity_type: str, pattern: str, priority: int = 5):
        """添加自定义正则模式"""
        entity_type = canonical_type_id(entity_type)
        if entity_type not in self.patterns:
            self.patterns[entity_type] = []

        self.patterns[entity_type].append(RegexPattern(pattern=pattern, priority=priority))

        # 重新编译
        self._compiled[entity_type] = [
            (re.compile(p.pattern, re.IGNORECASE), p.priority, p.validator, p.group)
            for p in self.patterns[entity_type]
        ]

    def extract(
        self,
        text: str,
        entity_types: list[str] | None = None
    ) -> list[dict[str, Any]]:
        """
        从文本中提取匹配正则的实体

        Args:
            text: 待识别文本
            entity_types: 要识别的实体类型列表，None表示全部

        Returns:
            识别到的实体列表
        """
        entities = []
        seen_positions = set()  # 去重用

        types_to_check = self._resolve_requested_types(entity_types)

        for entity_type in types_to_check:
            if entity_type not in self._compiled:
                continue

            for compiled_pattern, priority, validator, group in self._compiled[entity_type]:
                for match in compiled_pattern.finditer(text):
                    start, end = match.start(group), match.end(group)
                    matched_text = match.group(group)

                    # 跳过已识别的位置
                    pos_key = (start, end)
                    if pos_key in seen_positions:
                        continue

                    # 可选的校验
                    if validator and not validator(matched_text):
                        continue

                    seen_positions.add(pos_key)
                    entities.append({
                        "id": f"regex_{entity_type}_{start}_{end}",
                        "text": matched_text,
                        "type": entity_type,
                        "start": start,
                        "end": end,
                        "confidence": 0.99,  # 正则匹配置信度很高
                        "source": "regex",
                        "priority": priority,
                    })

        # 按位置排序
        entities.sort(key=lambda x: (x["start"], -x["priority"]))

        # 处理重叠的匹配，保留优先级高的
        final_entities = []
        last_end = -1

        for entity in entities:
            if entity["start"] >= last_end:
                final_entities.append(entity)
                last_end = entity["end"]

        return final_entities

    def get_supported_types(self) -> list[str]:
        """获取支持正则识别的类型"""
        return list(self.patterns.keys())

    def _resolve_requested_types(self, entity_types: list[str] | None) -> list[str]:
        if entity_types is None:
            return list(self._compiled.keys())
        resolved: list[str] = []
        seen: set[str] = set()
        for entity_type in entity_types:
            canonical = canonical_type_id(entity_type)
            if canonical in seen:
                continue
            seen.add(canonical)
            resolved.append(canonical)
        return resolved


# 单例
regex_service = RegexService()
