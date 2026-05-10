import json
from pathlib import Path

from app.core.has_image_categories import (
    CLASS_ID_TO_SLUG,
    DEFAULT_EXCLUDED_HAS_IMAGE_SLUGS,
    DEFAULT_HAS_IMAGE_SLUGS,
    HAS_IMAGE_CATEGORIES,
    HAS_IMAGE_MODEL_CLASS_COUNT,
    HAS_IMAGE_MODEL_SLUGS,
    OCR_FALLBACK_ONLY_VISUAL_SLUGS,
    SLUG_TO_CLASS_ID,
    filter_has_image_model_slugs,
    has_only_ocr_fallback_visual_slugs,
    is_has_image_model_slug,
    slug_list_to_class_indices,
)


FORBIDDEN_VISUAL_SLUGS = {
    "signature",
    "handwritten",
    "hand_written",
    "handwriting",
    "handwritten_signature",
}
MOJIBAKE_MARKERS = (
    "\ufffd",
    "锛",
    "鈥",
    "Ã",
    "Â",
    "â",
)


def test_has_image_categories_are_exactly_the_model_21_class_contract() -> None:
    slugs = [category.id for category in HAS_IMAGE_CATEGORIES]
    class_ids = [category.class_id for category in HAS_IMAGE_CATEGORIES]

    assert HAS_IMAGE_MODEL_CLASS_COUNT == 21
    assert len(HAS_IMAGE_CATEGORIES) == HAS_IMAGE_MODEL_CLASS_COUNT
    assert slugs == [
        "face",
        "fingerprint",
        "palmprint",
        "id_card",
        "hk_macau_permit",
        "passport",
        "employee_badge",
        "license_plate",
        "bank_card",
        "physical_key",
        "receipt",
        "shipping_label",
        "official_seal",
        "whiteboard",
        "sticky_note",
        "mobile_screen",
        "monitor_screen",
        "medical_wristband",
        "qr_code",
        "barcode",
        "paper",
    ]
    assert class_ids == list(range(21))
    assert len(slugs) == len(set(slugs))
    assert set(slugs).isdisjoint(FORBIDDEN_VISUAL_SLUGS)
    assert HAS_IMAGE_MODEL_SLUGS == set(slugs)

    assert SLUG_TO_CLASS_ID == {
        category.id: category.class_id for category in HAS_IMAGE_CATEGORIES
    }
    assert CLASS_ID_TO_SLUG == {
        category.class_id: category.id for category in HAS_IMAGE_CATEGORIES
    }


def test_has_image_category_chinese_display_text_is_complete_and_readable() -> None:
    assert len(HAS_IMAGE_CATEGORIES) == 21

    for category in HAS_IMAGE_CATEGORIES:
        for field_name, value in {
            "name_zh": category.name_zh,
            "description_zh": category.description_zh,
        }.items():
            assert value.strip(), f"{category.id}.{field_name} must not be empty"
            assert not any(
                marker in value for marker in MOJIBAKE_MARKERS
            ), f"{category.id}.{field_name} looks mojibaked: {value!r}"
            assert all(
                ord(char) >= 32 or char in "\t\n\r" for char in value
            ), f"{category.id}.{field_name} contains control characters"


def test_has_image_key_class_ids_do_not_drift() -> None:
    assert SLUG_TO_CLASS_ID["face"] == 0
    assert SLUG_TO_CLASS_ID["official_seal"] == 12
    assert SLUG_TO_CLASS_ID["qr_code"] == 18

    assert CLASS_ID_TO_SLUG[0] == "face"
    assert CLASS_ID_TO_SLUG[12] == "official_seal"
    assert CLASS_ID_TO_SLUG[18] == "qr_code"


def test_slug_list_to_class_indices_preserves_api_contract() -> None:
    assert slug_list_to_class_indices(None) is None
    assert slug_list_to_class_indices([]) == []
    assert slug_list_to_class_indices(["face", "official_seal", "qr_code"]) == [0, 12, 18]
    assert slug_list_to_class_indices(["unknown", "qr_code", "signature"]) == [18]
    assert slug_list_to_class_indices(["signature", "handwritten"]) == []
    assert slug_list_to_class_indices(["qr_code", "qr_code"]) == [18, 18]
    assert slug_list_to_class_indices(["FACE", "official-seal"]) == [0, 12]


def test_filter_has_image_model_slugs_rejects_ocr_fallback_only_visual_ids() -> None:
    assert OCR_FALLBACK_ONLY_VISUAL_SLUGS == {
        "signature",
        "handwritten",
        "hand_written",
        "handwriting",
        "handwritten_signature",
    }
    assert filter_has_image_model_slugs(None) is None
    assert filter_has_image_model_slugs(["signature", "handwritten", "face"]) == ["face"]
    assert filter_has_image_model_slugs(["SIGNATURE", "hand-written", "official_seal"]) == [
        "official_seal"
    ]
    assert is_has_image_model_slug("official-seal") is True
    assert is_has_image_model_slug("SIGNATURE") is False
    assert is_has_image_model_slug("hand-written") is False
    assert has_only_ocr_fallback_visual_slugs(["signature", "hand-written"]) is True
    assert has_only_ocr_fallback_visual_slugs(["signature", "face"]) is False


def test_default_has_image_selection_is_active_subset_not_model_contract() -> None:
    model_slugs = [category.id for category in HAS_IMAGE_CATEGORIES]
    disabled_by_default = set(model_slugs) - set(DEFAULT_HAS_IMAGE_SLUGS)

    assert len(model_slugs) == 21
    assert DEFAULT_EXCLUDED_HAS_IMAGE_SLUGS == {"paper"}
    assert disabled_by_default == {"paper"}
    assert len(DEFAULT_HAS_IMAGE_SLUGS) == 20
    assert "paper" in model_slugs
    assert "paper" not in DEFAULT_HAS_IMAGE_SLUGS
    assert set(DEFAULT_HAS_IMAGE_SLUGS).issubset(set(model_slugs))
    assert set(DEFAULT_HAS_IMAGE_SLUGS).isdisjoint(FORBIDDEN_VISUAL_SLUGS)


def test_preset_has_image_types_match_has_image_model_contract() -> None:
    repo_backend = Path(__file__).resolve().parents[1]
    pipeline_path = repo_backend / "config" / "preset_pipeline_types.json"
    pipelines = json.loads(pipeline_path.read_text(encoding="utf-8"))

    has_image_types = pipelines["has_image"]
    has_image_ids = [item["id"] for item in has_image_types]

    assert len(has_image_ids) == 21
    assert len(has_image_ids) == len(set(has_image_ids))
    assert set(has_image_ids) == set(SLUG_TO_CLASS_ID)
    assert set(has_image_ids).isdisjoint(FORBIDDEN_VISUAL_SLUGS)

    enabled_ids = {item["id"] for item in has_image_types if item.get("enabled")}
    disabled_ids = {item["id"] for item in has_image_types if item.get("enabled") is False}
    assert enabled_ids == set(DEFAULT_HAS_IMAGE_SLUGS)
    assert disabled_ids == {"paper"}
    assert "paper" not in enabled_ids
