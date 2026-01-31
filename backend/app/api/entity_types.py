"""
实体类型管理API
所有类型都是可配置的，系统预置常用类型供用户使用
"""

from fastapi import APIRouter, HTTPException, status, Query
from typing import List, Dict, Optional
from pydantic import BaseModel, Field
import uuid


router = APIRouter()


class EntityTypeConfig(BaseModel):
    """实体类型配置"""
    id: str = Field(..., description="唯一ID")
    name: str = Field(..., description="显示名称")
    description: Optional[str] = Field(None, description="语义描述，用于指导LLM识别")
    examples: List[str] = Field(default_factory=list, description="示例文本")
    color: str = Field(default="#6B7280", description="前端显示颜色")
    regex_pattern: Optional[str] = Field(None, description="正则表达式（优先使用）")
    use_llm: bool = Field(default=True, description="是否使用LLM识别（无正则时必须为True）")
    enabled: bool = Field(default=True, description="是否启用")
    order: int = Field(default=100, description="排序权重")
    tag_template: Optional[str] = Field(None, description="结构化标签模板，如 <组织[{index}].企业.完整名称>")


class EntityTypesResponse(BaseModel):
    """实体类型列表响应"""
    custom_types: List[EntityTypeConfig]
    total: int


class CreateEntityTypeRequest(BaseModel):
    """创建实体类型请求"""
    name: str
    description: Optional[str] = None
    examples: List[str] = []
    color: str = "#6B7280"
    regex_pattern: Optional[str] = None
    use_llm: bool = True
    tag_template: Optional[str] = None


class UpdateEntityTypeRequest(BaseModel):
    """更新实体类型请求"""
    name: Optional[str] = None
    description: Optional[str] = None
    examples: Optional[List[str]] = None
    color: Optional[str] = None
    regex_pattern: Optional[str] = None
    use_llm: Optional[bool] = None
    enabled: Optional[bool] = None
    order: Optional[int] = None
    tag_template: Optional[str] = None


# 预置的法律领域敏感信息类型（全部可配置）
PRESET_ENTITY_TYPES: Dict[str, EntityTypeConfig] = {
    # 有正则的类型 - 优先正则识别
    "ID_CARD": EntityTypeConfig(
        id="ID_CARD",
        name="身份证号",
        description="中国大陆居民身份证号码，18位或15位数字",
        examples=["110101199003071234", "11010119900307123X"],
        color="#EF4444",
        regex_pattern=r'[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]',
        use_llm=False,
        tag_template="<编号[{index}].身份证.号码>",
        order=10,
    ),
    "PHONE": EntityTypeConfig(
        id="PHONE",
        name="电话号码",
        description="手机号码或座机号码",
        examples=["13812345678", "021-12345678", "010-87654321"],
        color="#F97316",
        regex_pattern=r'1[3-9]\d{9}|(?:0\d{2,3}[-\s]?)?\d{7,8}',
        use_llm=False,
        tag_template="<电话[{index}].固定电话.号码>",
        order=11,
    ),
    "BANK_CARD": EntityTypeConfig(
        id="BANK_CARD",
        name="银行卡号",
        description="银行借记卡或信用卡卡号，16-19位数字",
        examples=["6222021234567890123", "4367421234567890"],
        color="#EC4899",
        regex_pattern=r'(?:62|4|5)\d{14,17}',
        use_llm=False,
        tag_template="<编号[{index}].银行卡.号码>",
        order=12,
    ),
    "CASE_NUMBER": EntityTypeConfig(
        id="CASE_NUMBER",
        name="案件编号",
        description="法院案件编号，如(2024)京01民初123号",
        examples=["(2024)京01民初123号", "(2023)沪0115民初9876号"],
        color="#8B5CF6",
        regex_pattern=r'[\(（]\d{4}[\)）][京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领A-Za-z]{1,4}\d{0,4}[民刑行执破知赔财商][初终复再抗申裁监督撤]?\d+号',
        use_llm=False,
        tag_template="<编号[{index}].案件编号.号码>",
        order=13,
    ),
    "EMAIL": EntityTypeConfig(
        id="EMAIL",
        name="邮箱地址",
        description="电子邮件地址",
        examples=["user@example.com", "info@company.cn"],
        color="#06B6D4",
        regex_pattern=r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}',
        use_llm=False,
        tag_template="<邮箱[{index}].个人邮箱.地址>",
        order=14,
    ),
    "LICENSE_PLATE": EntityTypeConfig(
        id="LICENSE_PLATE",
        name="车牌号",
        description="机动车号牌",
        examples=["京A12345", "沪B67890"],
        color="#14B8A6",
        regex_pattern=r'[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领][A-Z][A-Z0-9]{5,6}',
        use_llm=False,
        tag_template="<编号[{index}].车牌.号码>",
        order=15,
    ),
    "DATE": EntityTypeConfig(
        id="DATE",
        name="日期",
        description="具体日期信息",
        examples=["2024年1月15日", "2024-01-15"],
        color="#84CC16",
        regex_pattern=r'\d{4}年\d{1,2}月\d{1,2}日|\d{4}[-/]\d{1,2}[-/]\d{1,2}',
        use_llm=False,
        tag_template="<日期/时间[{index}].具体日期.年月日>",
        order=20,
        enabled=True,
    ),
    
    # 需要LLM识别的类型 - 无固定格式
    "PERSON": EntityTypeConfig(
        id="PERSON",
        name="人名",
        description="自然人姓名，包括中文名、英文名、笔名、艺名等",
        examples=["张三", "李明华", "王小二", "John Smith"],
        color="#3B82F6",
        use_llm=True,
        tag_template="<人物[{index}].个人.姓名>",
        order=1,
    ),
    "ORG": EntityTypeConfig(
        id="ORG",
        name="机构名称",
        description="公司、组织、政府机构、法院等单位名称",
        examples=["北京某某科技有限公司", "某某市中级人民法院", "某某银行"],
        color="#10B981",
        use_llm=True,
        tag_template="<组织[{index}].企业.完整名称>",
        order=2,
    ),
    "ADDRESS": EntityTypeConfig(
        id="ADDRESS",
        name="地址",
        description="详细地址，包括省市区街道门牌号",
        examples=["北京市朝阳区某某路123号", "上海市浦东新区某某街道某某小区1栋101室"],
        color="#6366F1",
        use_llm=True,
        tag_template="<地点[{index}].办公地址.完整地址>",
        order=3,
    ),
    "LEGAL_PARTY": EntityTypeConfig(
        id="LEGAL_PARTY",
        name="案件当事人",
        description="法律文书中的原告、被告、申请人、被申请人、上诉人、被上诉人等当事人称谓及姓名",
        examples=["原告张三", "被告某公司", "申请人李四", "被上诉人王五"],
        color="#F59E0B",
        use_llm=True,
        tag_template="<人物[{index}].当事人.姓名>",
        order=4,
    ),
    "LAWYER": EntityTypeConfig(
        id="LAWYER",
        name="律师/代理人",
        description="委托代理人、辩护人、律师姓名及其所属律所",
        examples=["北京某某律师事务所律师张三", "委托代理人李四"],
        color="#A855F7",
        use_llm=True,
        tag_template="<人物[{index}].律师.姓名>",
        order=5,
    ),
    "JUDGE": EntityTypeConfig(
        id="JUDGE",
        name="法官/书记员",
        description="审判长、审判员、书记员、人民陪审员姓名",
        examples=["审判长：张某某", "书记员：李某"],
        color="#0EA5E9",
        use_llm=True,
        tag_template="<人物[{index}].司法人员.姓名>",
        order=6,
    ),
    "AMOUNT": EntityTypeConfig(
        id="AMOUNT",
        name="金额",
        description="涉及的具体金额数目",
        examples=["人民币10万元", "500,000元", "叁拾万元整"],
        color="#F43F5E",
        use_llm=True,
        tag_template="<金额[{index}].合同金额.数值>",
        order=7,
    ),
    "CONTRACT_NO": EntityTypeConfig(
        id="CONTRACT_NO",
        name="合同编号",
        description="合同、协议的编号",
        examples=["合同编号：HT-2024-001", "协议编号：XY20240115"],
        color="#64748B",
        use_llm=True,
        tag_template="<编号[{index}].合同编号.代码>",
        order=8,
    ),
    "WITNESS": EntityTypeConfig(
        id="WITNESS",
        name="证人",
        description="证人姓名",
        examples=["证人张某", "证人李某某"],
        color="#78716C",
        use_llm=True,
        order=9,
    ),
}

# 内存存储（生产环境应改为数据库）
entity_types_db: Dict[str, EntityTypeConfig] = PRESET_ENTITY_TYPES.copy()


@router.get("/custom-types", response_model=EntityTypesResponse)
async def get_entity_types(enabled_only: bool = Query(False, description="是否只返回启用的类型")):
    """
    获取所有实体类型配置
    """
    types = list(entity_types_db.values())
    
    if enabled_only:
        types = [t for t in types if t.enabled]
    
    # 按order排序
    types.sort(key=lambda x: x.order)
    
    return EntityTypesResponse(
        custom_types=types,
        total=len(types)
    )


@router.get("/custom-types/{type_id}", response_model=EntityTypeConfig)
async def get_entity_type(type_id: str):
    """获取单个实体类型配置"""
    if type_id not in entity_types_db:
        raise HTTPException(status_code=404, detail="实体类型不存在")
    return entity_types_db[type_id]


@router.post("/custom-types", response_model=EntityTypeConfig)
async def create_entity_type(request: CreateEntityTypeRequest):
    """创建新的实体类型"""
    # 生成ID
    type_id = f"custom_{uuid.uuid4().hex[:8]}"
    
    new_type = EntityTypeConfig(
        id=type_id,
        name=request.name,
        description=request.description,
        examples=request.examples,
        color=request.color,
        regex_pattern=request.regex_pattern,
        use_llm=request.use_llm,
        tag_template=request.tag_template,
        enabled=True,
        order=200,  # 自定义类型排在后面
    )
    
    entity_types_db[type_id] = new_type
    return new_type


@router.put("/custom-types/{type_id}", response_model=EntityTypeConfig)
async def update_entity_type(type_id: str, request: UpdateEntityTypeRequest):
    """更新实体类型配置"""
    if type_id not in entity_types_db:
        raise HTTPException(status_code=404, detail="实体类型不存在")
    
    existing = entity_types_db[type_id]
    update_data = request.dict(exclude_unset=True)
    
    for key, value in update_data.items():
        setattr(existing, key, value)
    
    entity_types_db[type_id] = existing
    return existing


@router.delete("/custom-types/{type_id}")
async def delete_entity_type(type_id: str):
    """删除实体类型（预置类型只能禁用，不能删除）"""
    if type_id not in entity_types_db:
        raise HTTPException(status_code=404, detail="实体类型不存在")
    
    # 预置类型不允许删除
    if type_id in PRESET_ENTITY_TYPES:
        raise HTTPException(status_code=400, detail="预置类型不能删除，只能禁用")
    
    del entity_types_db[type_id]
    return {"message": "删除成功"}


@router.post("/custom-types/{type_id}/toggle")
async def toggle_entity_type(type_id: str):
    """切换实体类型的启用状态"""
    if type_id not in entity_types_db:
        raise HTTPException(status_code=404, detail="实体类型不存在")
    
    entity_types_db[type_id].enabled = not entity_types_db[type_id].enabled
    return {"enabled": entity_types_db[type_id].enabled}


@router.post("/custom-types/reset")
async def reset_entity_types():
    """重置为预置配置"""
    global entity_types_db
    entity_types_db = PRESET_ENTITY_TYPES.copy()
    return {"message": "已重置为默认配置"}


def get_enabled_types() -> List[EntityTypeConfig]:
    """获取所有启用的实体类型"""
    return [t for t in entity_types_db.values() if t.enabled]


def get_regex_types() -> List[EntityTypeConfig]:
    """获取使用正则识别的类型"""
    return [t for t in entity_types_db.values() if t.enabled and t.regex_pattern]


def get_llm_types() -> List[EntityTypeConfig]:
    """获取使用LLM识别的类型"""
    return [t for t in entity_types_db.values() if t.enabled and t.use_llm]
