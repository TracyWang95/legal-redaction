from app.core.has_image_categories import SLUG_TO_CLASS_ID
from app.services.pipeline_service import (
    HAS_IMAGE_PAPER_DEFAULT_DISABLED_MIGRATION,
    PIPELINE_MIGRATIONS_KEY,
    PipelineConfig,
    PipelineMode,
    PipelineTypeConfig,
    add_pipeline_type,
    merge_pipeline_disk_snapshot,
    update_pipeline_type,
)
from app.services import pipeline_service
from app.services.vlm_vision_service import VlmVisionService, _few_shot_messages
from PIL import Image


def test_merge_pipeline_disk_snapshot_recovers_empty_builtin_types() -> None:
    pipelines = merge_pipeline_disk_snapshot(
        {
            "ocr_has": {
                "mode": "ocr_has",
                "name": "OCR + HaS",
                "description": "corrupted runtime snapshot",
                "enabled": True,
                "types": [],
            },
            "has_image": {
                "mode": "has_image",
                "name": "HaS Image",
                "description": "corrupted runtime snapshot",
                "enabled": True,
                "types": [],
            },
        }
    )

    assert len(pipelines["ocr_has"].types) > 0
    assert len(pipelines["has_image"].types) > 0
    ids = {item.id for item in pipelines["has_image"].types}
    assert ids == set(SLUG_TO_CLASS_ID)
    assert "signature" not in ids


def test_merge_pipeline_disk_snapshot_removes_deprecated_ocr_visual_types() -> None:
    pipelines = merge_pipeline_disk_snapshot(
        {
            "ocr_has": {
                "mode": "ocr_has",
                "name": "OCR + HaS",
                "description": "old runtime snapshot",
                "enabled": True,
                "types": [
                    {
                        "id": "PERSON",
                        "name": "姓名",
                        "enabled": True,
                    },
                    {
                        "id": "SEAL",
                        "name": "印章",
                        "enabled": True,
                    },
                ],
            }
        }
    )

    assert any(item.id == "PERSON" for item in pipelines["ocr_has"].types)
    assert all(item.id != "SEAL" for item in pipelines["ocr_has"].types)


def test_merge_pipeline_disk_snapshot_keeps_has_image_to_model_categories() -> None:
    pipelines = merge_pipeline_disk_snapshot(
        {
            "has_image": {
                "mode": "has_image",
                "name": "HaS Image",
                "description": "old runtime snapshot",
                "enabled": True,
                "types": [
                    {
                        "id": "official_seal",
                        "name": "seal",
                        "enabled": True,
                    },
                    {
                        "id": "paper",
                        "name": "paper",
                        "enabled": False,
                    },
                ],
            }
        }
    )

    ids = [item.id for item in pipelines["has_image"].types]
    assert "official_seal" in ids
    assert "paper" in ids
    assert "signature" not in ids


def test_merge_pipeline_disk_snapshot_migrates_paper_back_to_default_disabled() -> None:
    pipelines = merge_pipeline_disk_snapshot(
        {
            "has_image": {
                "mode": "has_image",
                "name": "HaS Image",
                "description": "old runtime snapshot with stale paper default",
                "enabled": True,
                "types": [
                    {
                        "id": "face",
                        "name": "face",
                        "enabled": False,
                    },
                    {
                        "id": "paper",
                        "name": "paper",
                        "enabled": True,
                    },
                    {
                        "id": "custom_sensitive_region",
                        "name": "custom",
                        "enabled": True,
                    },
                ],
            }
        }
    )

    by_id = {item.id: item for item in pipelines["has_image"].types}
    assert set(SLUG_TO_CLASS_ID).issubset(by_id)
    assert by_id["paper"].enabled is False
    assert by_id["face"].enabled is False
    assert "custom_sensitive_region" not in by_id


def test_merge_pipeline_disk_snapshot_preserves_user_enabled_paper_after_migration() -> None:
    pipelines = merge_pipeline_disk_snapshot(
        {
            PIPELINE_MIGRATIONS_KEY: {
                HAS_IMAGE_PAPER_DEFAULT_DISABLED_MIGRATION: True,
            },
            "has_image": {
                "mode": "has_image",
                "name": "HaS Image",
                "description": "runtime snapshot after paper default migration",
                "enabled": True,
                "types": [
                    {
                        "id": "face",
                        "name": "face",
                        "enabled": False,
                    },
                    {
                        "id": "paper",
                        "name": "paper",
                        "enabled": True,
                    },
                    {
                        "id": "custom_sensitive_region",
                        "name": "custom",
                        "enabled": True,
                    },
                ],
            },
        }
    )

    by_id = {item.id: item for item in pipelines["has_image"].types}
    assert by_id["paper"].enabled is True
    assert by_id["face"].enabled is False
    assert "custom_sensitive_region" not in by_id


def test_vlm_pipeline_type_preserves_checklist_and_samples() -> None:
    config = PipelineTypeConfig(
        id="custom_signature",
        name="Signature",
        enabled=True,
        checklist=[
            {
                "rule": "Detect handwritten signature ink",
                "positive_prompt": "curved ink strokes",
                "negative_prompt": "printed name",
            }
        ],
        few_shot_enabled=True,
        few_shot_samples=[
            {
                "type": "positive",
                "image": "data:image/png;base64,abc",
                "label": "signed page",
                "filename": "signature.png",
            }
        ],
    )

    assert config.checklist[0].rule == "Detect handwritten signature ink"
    assert config.checklist[0].positive_prompt == "curved ink strokes"
    assert config.few_shot_samples[0].filename == "signature.png"


def test_vlm_prompt_uses_checklist_row_prompts() -> None:
    config = PipelineTypeConfig(
        id="custom_signature",
        name="Signature",
        enabled=True,
        checklist=[
            {
                "rule": "Detect handwritten signature ink",
                "positive_prompt": "curved ink strokes",
                "negative_prompt": "printed name",
            }
        ],
    )

    prompt = VlmVisionService().build_prompt([config])

    assert "Check: Detect handwritten signature ink" in prompt
    assert "Positive: curved ink strokes" in prompt
    assert "Negative: printed name" in prompt


def test_vlm_detection_views_use_full_image_only() -> None:
    image = Image.new("RGB", (1279, 1541), "white")

    views = VlmVisionService()._detection_views(image)

    assert len(views) == 1
    assert views[0].name == "full"
    assert views[0].crop_x == 0
    assert views[0].crop_y == 0
    assert views[0].crop_width == 1279
    assert views[0].crop_height == 1541


def test_vlm_few_shot_samples_become_messages() -> None:
    config = PipelineTypeConfig(
        id="custom_signature",
        name="Signature",
        enabled=True,
        few_shot_enabled=True,
        few_shot_samples=[
            {
                "type": "negative",
                "image": "data:image/png;base64,abc",
                "label": "empty signing line",
            }
        ],
    )

    messages = _few_shot_messages([config])

    assert len(messages) == 2
    assert messages[0]["content"][0]["image_url"]["url"] == "data:image/png;base64,abc"
    assert "negative sample" in messages[0]["content"][1]["text"]


def test_has_image_pipeline_rejects_runtime_free_categories(monkeypatch) -> None:
    monkeypatch.setattr(pipeline_service, "_persist_pipelines", lambda: None)
    monkeypatch.setattr(
        pipeline_service,
        "pipelines_db",
        {
            "has_image": PipelineConfig(
                mode=PipelineMode.HAS_IMAGE,
                name="HaS Image",
                description="fixed model classes",
                enabled=True,
                types=[
                    PipelineTypeConfig(
                        id="face",
                        name="Face",
                        enabled=True,
                    )
                ],
            )
        },
    )

    created, create_error = add_pipeline_type(
        "has_image",
        PipelineTypeConfig(
            id="custom_sensitive_region",
            name="Custom region",
            enabled=True,
        ),
    )
    updated, update_error = update_pipeline_type(
        "has_image",
        "face",
        PipelineTypeConfig(
            id="signature",
            name="Signature",
            enabled=True,
        ),
    )

    assert created is None
    assert updated is None
    assert "fixed to the 21 model classes" in create_error
    assert "fixed to the 21 model classes" in update_error
    assert [item.id for item in pipeline_service.pipelines_db["has_image"].types] == ["face"]


def test_has_image_pipeline_canonicalizes_fixed_category_ids(monkeypatch) -> None:
    monkeypatch.setattr(pipeline_service, "_persist_pipelines", lambda: None)
    monkeypatch.setattr(
        pipeline_service,
        "pipelines_db",
        {
            "has_image": PipelineConfig(
                mode=PipelineMode.HAS_IMAGE,
                name="HaS Image",
                description="fixed model classes",
                enabled=True,
                types=[
                    PipelineTypeConfig(
                        id="face",
                        name="Face",
                        enabled=True,
                    )
                ],
            )
        },
    )

    created, create_error = add_pipeline_type(
        "has_image",
        PipelineTypeConfig(
            id="license-plate",
            name="License plate",
            enabled=True,
        ),
    )
    updated, update_error = update_pipeline_type(
        "has_image",
        "face",
        PipelineTypeConfig(
            id="Official-Seal",
            name="Official seal",
            enabled=True,
        ),
    )

    assert create_error == ""
    assert update_error == ""
    assert created is not None
    assert updated is not None
    assert [item.id for item in pipeline_service.pipelines_db["has_image"].types] == [
        "official_seal",
        "license_plate",
    ]
