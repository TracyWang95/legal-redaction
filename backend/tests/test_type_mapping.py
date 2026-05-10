# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

from app.models.type_mapping import TYPE_ID_TO_CN, canonical_type_id, canonical_type_ids, cn_to_id


def test_organization_schema_keeps_granular_public_types():
    assert canonical_type_id("COMPANY_NAME") == "COMPANY_NAME"
    assert canonical_type_id("INSTITUTION_NAME") == "INSTITUTION_NAME"
    assert canonical_type_id("WORK_UNIT") == "WORK_UNIT"
    assert canonical_type_id("TAX_ID") == "TAX_ID"
    assert cn_to_id("\u516c\u53f8\u540d\u79f0") == "COMPANY_NAME"
    assert cn_to_id("\u4f01\u4e1a\u540d\u79f0") == "COMPANY_NAME"
    assert cn_to_id("\u673a\u6784\u540d\u79f0") == "INSTITUTION_NAME"
    assert cn_to_id("\u5de5\u4f5c\u5355\u4f4d") == "WORK_UNIT"


def test_date_time_aliases_canonicalize_to_date():
    assert canonical_type_id("TIME") == "TIME"
    assert canonical_type_id(" date-time ") == "DATE"
    assert canonical_type_id("date/and/time") == "DATE"
    assert canonical_type_id("TIMESTAMP") == "DATE"
    assert canonical_type_id("time_stamp") == "DATE"
    assert cn_to_id("\u65e5\u671f\u65f6\u95f4") == "DATE"
    assert cn_to_id("\u65f6\u95f4") == "TIME"


def test_company_code_stays_separate_from_organization():
    assert canonical_type_id("CREDIT_CODE") == "CREDIT_CODE"
    assert cn_to_id("\u7edf\u4e00\u793e\u4f1a\u4fe1\u7528\u4ee3\u7801") == "CREDIT_CODE"
    assert cn_to_id("\u7a0e\u53f7") == "TAX_ID"


def test_username_password_aliases_canonicalize_to_username_password():
    assert canonical_type_id("PASSWORD") == "AUTH_SECRET"
    assert canonical_type_id("account-password") == "AUTH_SECRET"
    assert canonical_type_id("user/name") == "USERNAME_PASSWORD"
    assert cn_to_id("\u7528\u6237\u540d_\u5bc6\u7801") == "USERNAME_PASSWORD"
    assert cn_to_id("\u8d26\u53f7\u5bc6\u7801") == "USERNAME_PASSWORD"
    assert cn_to_id("\u5bc6\u7801") == "AUTH_SECRET"


def test_url_website_aliases_canonicalize_to_url_website():
    assert canonical_type_id("URL") == "URL_WEBSITE"
    assert canonical_type_id("website") == "URL_WEBSITE"
    assert canonical_type_id("link") == "URL_WEBSITE"
    assert cn_to_id("\u7f51\u5740_\u94fe\u63a5") == "URL_WEBSITE"
    assert cn_to_id("\u7f51\u5740\u94fe\u63a5") == "URL_WEBSITE"
    assert cn_to_id("\u7f51\u5740") == "URL_WEBSITE"


def test_vin_aliases_canonicalize_to_vin():
    assert canonical_type_id("vin-number") == "VIN"
    assert canonical_type_id("vehicle/vin") == "VIN"
    assert canonical_type_id("vehicle-identification-number") == "VIN"
    assert cn_to_id("\u8f66\u67b6\u53f7_VIN") == "VIN"
    assert cn_to_id("\u8f66\u67b6\u53f7/VIN") == "VIN"
    assert cn_to_id("\u8f66\u8f86\u8bc6\u522b\u4ee3\u53f7") == "VIN"


def test_canonical_type_ids_are_stable_and_deduped():
    assert canonical_type_ids(["COMPANY_NAME", "ORG", "DATE_TIME", "TIMESTAMP", "CREDIT_CODE"]) == [
        "COMPANY_NAME",
        "ORG",
        "DATE",
        "CREDIT_CODE",
    ]


def test_reverse_chinese_mapping_does_not_expose_alias_keys():
    assert "DATE_TIME" not in TYPE_ID_TO_CN
    assert TYPE_ID_TO_CN["ORG"] == "\u7ec4\u7ec7\u673a\u6784"
    assert TYPE_ID_TO_CN["COMPANY_NAME"] == "\u516c\u53f8\u540d\u79f0"
    assert TYPE_ID_TO_CN["WORK_UNIT"] == "\u5de5\u4f5c\u5355\u4f4d"
    assert TYPE_ID_TO_CN["DATE"] == "\u65e5\u671f"
    assert TYPE_ID_TO_CN["TIME"] == "\u65f6\u95f4"
