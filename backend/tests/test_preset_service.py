import json
from pathlib import Path

import pytest

from app.core.has_image_categories import OCR_FALLBACK_ONLY_VISUAL_SLUGS, SLUG_TO_CLASS_ID
from app.core.config import settings
from app.core.persistence import load_json
from app.models.schemas import PresetCreate, PresetImportRequest, PresetUpdate
from app.services import preset_service


def _use_temp_preset_store(monkeypatch, tmp_path: Path) -> Path:
    store_path = tmp_path / "presets.json"
    monkeypatch.setattr(settings, "PRESET_STORE_PATH", str(store_path))
    return store_path


def test_builtin_industry_presets_are_listed_as_readonly(monkeypatch, tmp_path):
    store_path = _use_temp_preset_store(monkeypatch, tmp_path)

    response = preset_service.list_presets()

    ids = {preset.id for preset in response.presets}
    assert ids == {
        "industry_contract_legal_disclosure",
        "industry_medical_record_release",
        "industry_finance_audit_sharing",
    }
    assert all(preset.readonly for preset in response.presets if preset.id.startswith("industry_"))
    assert response.total == len(response.presets)
    assert not store_path.exists()


def test_presets_openapi_documents_readonly_builtin_examples(test_client):
    schema = test_client.app.openapi()
    operation = schema["paths"]["/api/v1/presets"]["get"]
    assert operation["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PresetsListResponse"
    }

    components = schema["components"]["schemas"]
    preset_props = components["PresetOut"]["properties"]
    list_props = components["PresetsListResponse"]["properties"]

    assert preset_props["kind"]["enum"] == ["text", "vision", "full"]
    assert preset_props["kind"]["examples"] == ["full"]
    assert preset_props["readonly"]["examples"] == [True]
    assert "True for built-in industry presets" in preset_props["readonly"]["description"]
    assert "update, delete, and import override operations are rejected" in preset_props["readonly"]["description"]
    assert "Built-in read-only presets" in list_props["presets"]["description"]

    preset_example = components["PresetOut"]["examples"][0]
    assert preset_example["id"] == "industry_contract_legal_disclosure"
    assert preset_example["readonly"] is True
    assert preset_example["kind"] == "full"
    list_example = components["PresetsListResponse"]["examples"][0]
    assert list_example["presets"][0]["readonly"] is True


def test_user_presets_are_merged_after_builtin_presets(monkeypatch, tmp_path):
    _use_temp_preset_store(monkeypatch, tmp_path)

    created = preset_service.create(
        PresetCreate(
            name="Custom user preset",
            kind="text",
            selectedEntityTypeIds=["PERSON"],
            ocrHasTypes=[],
            hasImageTypes=[],
            replacementMode="structured",
        )
    )
    response = preset_service.list_presets()

    assert response.presets[-1].id == created.id
    assert response.presets[-1].readonly is False
    assert response.presets[-1].selectedEntityTypeIds == ["PERSON"]


def test_builtin_presets_cannot_be_updated_deleted_or_import_overridden(monkeypatch, tmp_path):
    store_path = _use_temp_preset_store(monkeypatch, tmp_path)
    builtin_id = "industry_contract_legal_disclosure"

    assert preset_service.update(builtin_id, PresetUpdate(name="edited")) is None
    assert preset_service.delete(builtin_id) is False

    imported_count = preset_service.import_presets(
        PresetImportRequest(
            merge=False,
            presets=[
                {
                    "id": builtin_id,
                    "name": "User override should be ignored",
                    "kind": "text",
                    "selectedEntityTypeIds": ["PERSON"],
                    "ocrHasTypes": [],
                    "hasImageTypes": [],
                    "replacementMode": "mask",
                },
                {
                    "id": "user_legal_sample",
                    "name": "User legal sample",
                    "kind": "text",
                    "selectedEntityTypeIds": ["PERSON"],
                    "ocrHasTypes": [],
                    "hasImageTypes": [],
                    "replacementMode": "structured",
                },
            ],
        )
    )

    assert imported_count == 1
    saved = load_json(str(store_path))
    assert len(saved) == 1
    assert saved[0]["id"] == "user_legal_sample"
    assert saved[0]["name"] == "User legal sample"
    assert saved[0]["kind"] == "text"
    assert saved[0]["selectedEntityTypeIds"] == ["PERSON"]
    assert saved[0]["ocrHasTypes"] == []
    assert saved[0]["hasImageTypes"] == []
    assert saved[0]["replacementMode"] == "structured"
    assert saved[0]["created_at"]
    assert saved[0]["updated_at"]

    exported = preset_service.export_all()
    exported_by_id = {preset["id"]: preset for preset in exported["presets"]}
    assert exported_by_id[builtin_id]["name"] == "Industry - Legal case materials"
    assert exported_by_id[builtin_id]["readonly"] is True
    assert exported_by_id["user_legal_sample"]["readonly"] is False


def test_import_presets_merge_count_matches_newly_persisted_rows(monkeypatch, tmp_path):
    store_path = _use_temp_preset_store(monkeypatch, tmp_path)
    store_path.write_text(
        json.dumps(
            [
                {
                    "id": "existing-user",
                    "name": "Existing user",
                    "kind": "text",
                    "selectedEntityTypeIds": ["PERSON"],
                    "ocrHasTypes": [],
                    "hasImageTypes": [],
                    "replacementMode": "structured",
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "updated_at": "2026-01-01T00:00:00+00:00",
                }
            ]
        ),
        encoding="utf-8",
    )

    imported_count = preset_service.import_presets(
        PresetImportRequest(
            merge=True,
            presets=[
                {
                    "id": "existing-user",
                    "name": "Duplicate should be skipped",
                    "kind": "text",
                    "selectedEntityTypeIds": ["EMAIL"],
                    "ocrHasTypes": [],
                    "hasImageTypes": [],
                    "replacementMode": "mask",
                },
                {
                    "id": "new-user",
                    "name": "New user",
                    "kind": "vision",
                    "selectedEntityTypeIds": [],
                    "ocrHasTypes": [],
                    "hasImageTypes": ["face"],
                    "replacementMode": "structured",
                },
            ],
        )
    )

    saved = load_json(str(store_path))
    saved_by_id = {preset["id"]: preset for preset in saved}
    assert imported_count == 1
    assert len(saved) == 2
    assert saved_by_id["existing-user"]["name"] == "Existing user"
    assert saved_by_id["new-user"]["name"] == "New user"


def test_builtin_industry_preset_references_are_valid():
    repo_backend = Path(__file__).resolve().parents[1]
    industry_path = repo_backend / "config" / "industry_presets.json"
    entity_path = repo_backend / "config" / "preset_entity_types.json"
    pipeline_path = repo_backend / "config" / "preset_pipeline_types.json"

    presets = json.loads(industry_path.read_text(encoding="utf-8"))
    entities = json.loads(entity_path.read_text(encoding="utf-8"))
    entity_ids = set(entities)
    enabled_entity_ids = {id_ for id_, item in entities.items() if item.get("enabled") is not False}
    pipelines = json.loads(pipeline_path.read_text(encoding="utf-8"))
    ocr_ids = {item["id"] for item in pipelines["ocr_has"]}
    image_ids = {item["id"] for item in pipelines["has_image"]}
    assert image_ids == set(SLUG_TO_CLASS_ID)
    enabled_ocr_ids = {item["id"] for item in pipelines["ocr_has"] if item.get("enabled") is not False}
    enabled_image_ids = {
        item["id"] for item in pipelines["has_image"] if item.get("enabled") is not False
    }

    seen_ids: set[str] = set()
    for preset in presets:
        assert preset["id"] not in seen_ids
        seen_ids.add(preset["id"])
        assert preset["kind"] in {"text", "vision", "full"}
        assert set(preset["selectedEntityTypeIds"]) <= entity_ids
        assert set(preset["ocrHasTypes"]) <= ocr_ids
        assert set(preset["hasImageTypes"]) <= image_ids
        assert set(preset["selectedEntityTypeIds"]) <= enabled_entity_ids
        assert set(preset["ocrHasTypes"]) <= enabled_ocr_ids
        assert set(preset["hasImageTypes"]) <= enabled_image_ids
        assert not (set(preset["hasImageTypes"]) & OCR_FALLBACK_ONLY_VISUAL_SLUGS)

    assert seen_ids == {
        "industry_contract_legal_disclosure",
        "industry_medical_record_release",
        "industry_finance_audit_sharing",
    }
    presets_by_id = {preset["id"]: preset for preset in presets}
    assert presets_by_id["industry_finance_audit_sharing"]["vlmTypes"] == ["signature"]
    assert presets_by_id["industry_contract_legal_disclosure"]["vlmTypes"] == ["signature"]
    assert presets_by_id["industry_medical_record_release"]["vlmTypes"] == ["signature"]
    assert "HEALTH_INFO" in presets_by_id["industry_medical_record_release"]["selectedEntityTypeIds"]
    assert "CRIMINAL_RECORD" in presets_by_id["industry_contract_legal_disclosure"]["selectedEntityTypeIds"]
    assert "BANK_ACCOUNT" in presets_by_id["industry_finance_audit_sharing"]["selectedEntityTypeIds"]
    assert {
        "LEGAL_PLAINTIFF",
        "LEGAL_DEFENDANT",
        "LEGAL_THIRD_PARTY",
        "LEGAL_COURT",
        "LEGAL_CASE_ID",
    } <= set(presets_by_id["industry_contract_legal_disclosure"]["selectedEntityTypeIds"])
    assert {
        "COMPANY_NAME",
        "INSTITUTION_NAME",
        "CREDIT_CODE",
        "TAX_ID",
        "FIN_CUSTOMER_ID",
        "FIN_ACCOUNT_NAME",
        "FIN_TRANSACTION_ID",
        "FIN_MERCHANT_ID",
        "CASE_NUMBER",
    } <= set(presets_by_id["industry_finance_audit_sharing"]["selectedEntityTypeIds"])
    assert {
        "INSTITUTION_NAME",
        "GOVERNMENT_AGENCY",
        "WORK_UNIT",
        "DEPARTMENT_NAME",
        "MED_PATIENT",
        "MED_CLINICIAN",
        "MED_INSTITUTION",
        "MED_RECORD_ID",
        "MED_DIAGNOSIS",
    } <= set(presets_by_id["industry_medical_record_release"]["selectedEntityTypeIds"])
    assert "CASE_NUMBER" in presets_by_id["industry_contract_legal_disclosure"]["selectedEntityTypeIds"]


def test_builtin_preset_loader_rejects_invalid_contract_references(monkeypatch, tmp_path):
    invalid_path = tmp_path / "industry_presets.json"
    invalid_path.write_text(
        json.dumps(
            [
                {
                    "id": "industry_invalid",
                    "name": "Industry - Invalid",
                    "kind": "full",
                    "selectedEntityTypeIds": ["PERSON", "MISSING_ENTITY"],
                    "ocrHasTypes": ["PERSON", "MISSING_OCR"],
                    "hasImageTypes": ["face", "signature"],
                    "replacementMode": "structured",
                    "created_at": "2026-05-05T00:00:00+00:00",
                    "updated_at": "2026-05-05T00:00:00+00:00",
                }
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(preset_service, "_BUILTIN_PRESETS_PATH", str(invalid_path))

    with pytest.raises(ValueError) as exc:
        preset_service._load_builtin_presets()

    message = str(exc.value)
    assert "MISSING_ENTITY" in message
    assert "MISSING_OCR" in message
    assert "signature" in message


def test_presets_api_exposes_builtin_readonly_and_forbids_mutation(test_client):
    builtin_id = "industry_contract_legal_disclosure"

    response = test_client.get("/api/v1/presets")
    assert response.status_code == 200
    presets = response.json()["presets"]
    builtin = next(p for p in presets if p["id"] == builtin_id)
    assert builtin["readonly"] is True

    update_response = test_client.put(f"/api/v1/presets/{builtin_id}", json={"name": "edited"})
    assert update_response.status_code == 403

    delete_response = test_client.delete(f"/api/v1/presets/{builtin_id}")
    assert delete_response.status_code == 403


def test_presets_api_rejects_malformed_import_payload(test_client):
    response = test_client.post(
        "/api/v1/presets/import",
        json={"merge": False, "presets": [{"id": "broken"}]},
    )

    assert response.status_code == 422

    list_response = test_client.get("/api/v1/presets")
    assert list_response.status_code == 200


def test_list_presets_skips_legacy_malformed_store_rows(monkeypatch, tmp_path):
    store_path = _use_temp_preset_store(monkeypatch, tmp_path)
    store_path.write_text(
        json.dumps(
            [
                {"id": "bad-missing-name"},
                {
                    "id": "bad-kind",
                    "name": "Bad kind",
                    "kind": "unknown",
                    "selectedEntityTypeIds": [],
                    "ocrHasTypes": [],
                    "hasImageTypes": [],
                    "replacementMode": "structured",
                },
                {
                    "id": "good-user",
                    "name": "Good user",
                    "kind": "text",
                    "selectedEntityTypeIds": ["PERSON"],
                    "ocrHasTypes": [],
                    "hasImageTypes": [],
                    "replacementMode": "mask",
                },
            ]
        ),
        encoding="utf-8",
    )

    response = preset_service.list_presets()
    by_id = {preset.id: preset for preset in response.presets}

    assert "bad-missing-name" not in by_id
    assert "bad-kind" not in by_id
    assert by_id["good-user"].name == "Good user"


def test_presets_api_survives_null_legacy_store_payload(test_client):
    store_path = Path(settings.PRESET_STORE_PATH)
    store_path.parent.mkdir(parents=True, exist_ok=True)
    store_path.write_text(json.dumps({"presets": None}), encoding="utf-8")

    response = test_client.get("/api/v1/presets")

    assert response.status_code == 200
    assert response.json()["total"] >= 1
