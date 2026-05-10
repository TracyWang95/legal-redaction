from app.services.entity_type_service import (
    get_default_generic_types,
    is_default_generic_entity_type_id,
)


def test_default_generic_schema_excludes_industry_specific_types():
    assert is_default_generic_entity_type_id("PERSON") is True
    assert is_default_generic_entity_type_id("ORG") is False
    assert is_default_generic_entity_type_id("COMPANY_NAME") is True
    assert is_default_generic_entity_type_id("INSTITUTION_NAME") is True
    assert is_default_generic_entity_type_id("GOVERNMENT_AGENCY") is True
    assert is_default_generic_entity_type_id("DEPARTMENT_NAME") is True
    assert is_default_generic_entity_type_id("PROJECT_NAME") is True
    assert is_default_generic_entity_type_id("WORK_UNIT") is False
    assert is_default_generic_entity_type_id("LEGAL_PLAINTIFF") is False
    assert is_default_generic_entity_type_id("FIN_TRANSACTION_ID") is False
    assert is_default_generic_entity_type_id("MED_RECORD_ID") is False


def test_get_default_generic_types_keeps_industry_presets_available_but_not_default():
    type_ids = {item.id for item in get_default_generic_types()}

    assert {"PERSON", "ID_CARD", "PHONE", "EMAIL"}.issubset(type_ids)
    assert {
        "COMPANY_NAME",
        "INSTITUTION_NAME",
        "GOVERNMENT_AGENCY",
        "DEPARTMENT_NAME",
        "PROJECT_NAME",
    }.issubset(type_ids)
    assert "ORG" not in type_ids
    assert "WORK_UNIT" not in type_ids
    assert "LEGAL_PLAINTIFF" not in type_ids
    assert "FIN_TRANSACTION_ID" not in type_ids
    assert "MED_RECORD_ID" not in type_ids
