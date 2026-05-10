# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

from app.services.regex_service import regex_service


def test_chinese_context_detects_common_sensitive_values():
    text = (
        "张三的身份证号是110101199003071234，电话是13800138000，"
        "邮箱是zhangsan@example.com。银行卡号为6222020202020202020，"
        "案件编号为（2024）京0101民初123号。"
    )

    entities = regex_service.extract(
        text,
        entity_types=["ID_CARD", "PHONE", "EMAIL", "BANK_CARD", "CASE_NUMBER"],
    )

    by_type = {entity["type"]: entity["text"] for entity in entities}

    assert by_type == {
        "ID_CARD": "110101199003071234",
        "PHONE": "13800138000",
        "EMAIL": "zhangsan@example.com",
        "BANK_CARD": "6222020202020202020",
        "CASE_NUMBER": "（2024）京0101民初123号",
    }


def test_date_time_aliases_extract_as_single_date_type():
    text = "会议时间：2024-01-15 14:30，提醒时间：08:00。"

    entities = regex_service.extract(text, entity_types=["DATE", "TIME", "DATETIME"])

    assert [(entity["type"], entity["text"]) for entity in entities] == [
        ("DATE", "时间：2024-01-15 14:30"),
        ("DATE", "08:00"),
    ]
    assert "TIME" not in regex_service.get_supported_types()


def test_legal_org_regex_detects_court_without_document_title():
    text = (
        "\uff082025\uff09\u7ca40305\u6c11\u521d12345\u53f7\n"
        "\u5e7f\u4e1c\u7701\u6df1\u5733\u5e02\u5357\u5c71\u533a\u4eba\u6c11\u6cd5\u9662\n"
        "\u6c11\u4e8b\u5224\u51b3\u4e66\n"
        "\u4e0a\u8bc9\u4e8e\u5e7f\u4e1c\u7701\u6df1\u5733\u5e02\u4e2d\u7ea7\u4eba\u6c11\u6cd5\u9662\u3002"
    )

    entities = regex_service.extract(text, entity_types=["ORG"])

    assert [entity["text"] for entity in entities] == [
        "\u5e7f\u4e1c\u7701\u6df1\u5733\u5e02\u5357\u5c71\u533a\u4eba\u6c11\u6cd5\u9662",
        "\u5e7f\u4e1c\u7701\u6df1\u5733\u5e02\u4e2d\u7ea7\u4eba\u6c11\u6cd5\u9662",
    ]
    assert all(entity["text"] != "\u6c11\u4e8b\u5224\u51b3\u4e66" for entity in entities)


def test_legal_person_regex_supplements_role_names_only():
    text = (
        "\u539f\u544a\uff1a\u8d75\u96ea\u6885\uff0c\u5973\uff0c\u6c49\u65cf\u3002\n"
        "\u88ab\u544a\uff1a\u6df1\u5733\u5e02\u745e\u4e30\u6052\u6cf0\u8d38\u6613\u6709\u9650\u516c\u53f8\uff0c\u4f4f\u6240\u5730...\n"
        "\u88ab\u544a\uff1a\u5f20\u5efa\u519b\uff0c\u7537\uff0c\u6c49\u65cf\u3002\n"
        "\u59d4\u6258\u8bc9\u8bbc\u4ee3\u7406\u4eba\uff1a\u5218\u4f1f\uff0c\u5e7f\u4e1c\u5353\u5efa\u5f8b\u5e08\u4e8b\u52a1\u6240\u5f8b\u5e08\u3002\n"
        "\u6cd5\u5b9a\u4ee3\u8868\u4eba\uff1a\u9648\u56fd\u5f3a\uff0c\u603b\u7ecf\u7406\u3002\n"
        "\u5ba1\u5224\u5458\uff1a\u5468\u660e\n"
        "\u4e66\u8bb0\u5458\uff1a\u674e\u6653\u60a6\n"
    )

    entities = regex_service.extract(text, entity_types=["PERSON"])

    assert [entity["text"] for entity in entities] == [
        "\u8d75\u96ea\u6885",
        "\u5f20\u5efa\u519b",
        "\u5218\u4f1f",
        "\u9648\u56fd\u5f3a",
        "\u5468\u660e",
        "\u674e\u6653\u60a6",
    ]


def test_legal_document_tail_values_are_recalled_without_greedy_org():
    text = (
        "\u8d75\u96ea\u6885\u88ab\u9001\u5f80\u6df1\u5733\u5e02\u5357\u5c71\u533a\u4eba\u6c11\u533b\u9662\u4f4f\u9662\u6cbb\u759715\u5929\u3002"
        "\u745e\u4e30\u6052\u6cf0\u516c\u53f8\u5728\u4e8b\u53d1\u540e\u4ec5\u5411\u539f\u544a\u57ab\u4ed8\u3002"
        "\u8f66\u724c\u53f7\uff1a\u7ca4B\u00b7A8899\u3002"
        "\u4e8c\u3007\u4e8c\u4e94\u5e74\u4e94\u6708\u4e8c\u5341\u65e5"
    )

    entities = regex_service.extract(text, entity_types=["ORG", "LICENSE_PLATE", "DATE"])

    assert [(entity["type"], entity["text"]) for entity in entities] == [
        ("ORG", "\u6df1\u5733\u5e02\u5357\u5c71\u533a\u4eba\u6c11\u533b\u9662"),
        ("ORG", "\u745e\u4e30\u6052\u6cf0\u516c\u53f8"),
        ("LICENSE_PLATE", "\u7ca4B\u00b7A8899"),
        ("DATE", "\u4e8c\u3007\u4e8c\u4e94\u5e74\u4e94\u6708\u4e8c\u5341\u65e5"),
    ]
