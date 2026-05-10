from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient


def _create_job(client: TestClient) -> str:
    resp = client.post("/api/v1/jobs", json={"job_type": "text_batch", "title": "export"})
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def _upload_to_job(client: TestClient, job_id: str, filename: str, content: bytes = b"text") -> str:
    resp = client.post(
        "/api/v1/files/upload",
        data={"job_id": job_id, "upload_source": "batch"},
        files={"file": (filename, io.BytesIO(content), "text/plain")},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["file_id"]


def test_job_export_report_openapi_declares_delivery_and_visual_contract(test_client: TestClient):
    schema = test_client.app.openapi()
    operation = schema["paths"]["/api/v1/jobs/{job_id}/export-report"]["get"]
    assert operation["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/JobExportReportResponse"
    }

    components = schema["components"]["schemas"]
    summary_props = components["JobExportReportSummary"]["properties"]
    file_props = components["JobExportReportFile"]["properties"]
    visual_props = components["JobExportReportVisualReview"]["properties"]
    evidence_props = components["JobExportReportVisualEvidence"]["properties"]

    for field in (
        "delivery_status",
        "action_required_files",
        "action_required",
        "blocking_files",
        "blocking",
        "ready_for_delivery",
        "visual_review_hint",
        "visual_review_issue_count",
        "visual_review_by_issue",
        "visual_evidence",
    ):
        assert field in summary_props

    assert summary_props["delivery_status"]["enum"] == [
        "ready_for_delivery",
        "action_required",
        "no_selection",
    ]
    assert "Canonical selected-set delivery status" in summary_props["delivery_status"]["description"]
    assert "Visual-review hints are advisory" in summary_props["delivery_status"]["description"]
    assert summary_props["delivery_status"]["examples"] == ["action_required"]
    assert "visual-review issues" in summary_props["visual_review_hint"]["description"]
    assert "does not make delivery_status action_required" in summary_props["visual_review_hint"]["description"]
    assert summary_props["visual_review_hint"]["examples"] == [True]

    for field in (
        "delivery_status",
        "ready_for_delivery",
        "action_required",
        "blocking",
        "blocking_reasons",
        "redacted_export_skip_reason",
        "visual_review_hint",
        "visual_evidence",
        "visual_review",
    ):
        assert field in file_props

    assert file_props["delivery_status"]["enum"] == [
        "ready_for_delivery",
        "action_required",
        "not_selected",
    ]
    assert "Canonical per-file delivery status" in file_props["delivery_status"]["description"]
    assert "Visual-review hints are advisory" in file_props["delivery_status"]["description"]
    assert file_props["delivery_status"]["examples"] == ["ready_for_delivery"]
    assert "Backward-compatible boolean alias" in file_props["ready_for_delivery"]["description"]
    assert "Advisory only" in file_props["visual_review_hint"]["description"]
    assert "not included in delivery_status calculations" in file_props["visual_review_hint"]["description"]
    assert file_props["visual_review_hint"]["examples"] == [True]

    for field in ("blocking", "review_hint", "issue_count", "issue_pages", "by_issue"):
        assert field in visual_props

    for field in (
        "total_boxes",
        "selected_boxes",
        "has_image_model",
        "local_fallback",
        "ocr_has",
        "table_structure",
        "fallback_detector",
        "source_counts",
        "evidence_source_counts",
        "source_detail_counts",
        "warnings_by_key",
    ):
        assert field in evidence_props

    assert "Counters are informational" in summary_props["visual_evidence"]["description"]
    assert "do not affect delivery_status" in file_props["visual_evidence"]["description"]
    assert "source_detail" in evidence_props["source_detail_counts"]["description"]
    assert "warning key" in evidence_props["warnings_by_key"]["description"]

    assert visual_props["blocking"]["examples"] == [False]
    assert "does not affect delivery_status" in visual_props["blocking"]["description"]
    assert "advisory" in visual_props["review_hint"]["description"].lower()
    assert "not a delivery blocker" in visual_props["review_hint"]["description"]
    assert "does not change delivery_status" in visual_props["review_hint"]["description"]

    response_example = components["JobExportReportResponse"]["examples"][0]
    assert response_example["summary"]["delivery_status"] == "action_required"
    assert response_example["summary"]["visual_review_hint"] is True
    assert response_example["summary"]["visual_evidence"]["has_image_model"] == 1
    assert response_example["files"][0]["delivery_status"] == "ready_for_delivery"
    assert response_example["files"][0]["visual_review_hint"] is True
    assert response_example["files"][0]["visual_evidence"]["source_counts"] == {"has_image": 1}
    assert response_example["files"][0]["visual_review"]["blocking"] is False


def test_job_export_report_uses_backend_store_and_matches_redacted_zip_skips(
    test_client: TestClient,
    tmp_data_dir: str,
):
    from app.services.file_management_service import get_file_store
    from app.services.job_store import JobItemStatus, get_job_store

    job_id = _create_job(test_client)
    ready_file_id = _upload_to_job(test_client, job_id, "ready.txt", b"ready")
    pending_file_id = _upload_to_job(test_client, job_id, "pending.txt", b"pending")

    detail = test_client.get(f"/api/v1/jobs/{job_id}").json()
    item_by_file = {item["file_id"]: item for item in detail["items"]}
    ready_item_id = item_by_file[ready_file_id]["id"]
    store = get_job_store()
    store.update_item_status(ready_item_id, JobItemStatus.PROCESSING)
    store.update_item_status(ready_item_id, JobItemStatus.AWAITING_REVIEW)
    store.update_item_status(ready_item_id, JobItemStatus.COMPLETED)

    output_path = Path(tmp_data_dir) / "outputs" / "redacted-ready.txt"
    output_path.write_bytes(b"redacted")
    get_file_store().update_fields(
        ready_file_id,
        {
            "output_path": str(output_path),
            "entities": [{"text": "Alice"}, {"text": "Acme"}],
            "bounding_boxes": {
                5: [
                    {
                        "id": "right-seam-seal",
                        "x": 0.945,
                        "y": 0.45,
                        "width": 0.04,
                        "height": 0.13,
                        "type": "official_seal",
                        "source": "has_image",
                        "selected": True,
                    },
                    {
                        "id": "deselected-edge-seal",
                        "x": 0.01,
                        "y": 0.3,
                        "width": 0.05,
                        "height": 0.12,
                        "type": "official_seal",
                        "source": "has_image",
                        "selected": False,
                    },
                ],
            },
            "page_count": 2,
        },
    )

    resp = test_client.get(
        f"/api/v1/jobs/{job_id}/export-report",
        params=[("file_ids", ready_file_id), ("file_ids", pending_file_id)],
    )

    assert resp.status_code == 200
    report = resp.json()
    assert report["job"]["id"] == job_id
    assert report["summary"]["total_files"] == 2
    assert report["summary"]["selected_files"] == 2
    assert report["summary"]["redacted_selected_files"] == 1
    assert report["summary"]["unredacted_selected_files"] == 1
    assert report["summary"]["detected_entities"] == 4
    assert report["summary"]["action_required_files"] == 1
    assert report["summary"]["delivery_status"] == "action_required"
    assert report["summary"]["action_required"] is True
    assert report["summary"]["blocking_files"] == 1
    assert report["summary"]["blocking"] is True
    assert report["summary"]["ready_for_delivery"] is False
    assert report["summary"]["visual_review_hint"] is True
    assert report["summary"]["visual_review_issue_files"] == 1
    assert report["summary"]["visual_review_issue_count"] == 2
    assert report["summary"]["visual_review_issue_pages_count"] == 1
    assert report["summary"]["visual_review_issue_labels"] == ["edge_seal", "seam_seal"]
    assert report["summary"]["visual_review_by_issue"] == {
        "edge_seal": 1,
        "seam_seal": 1,
    }
    assert report["summary"]["visual_evidence"] == {
        "total_boxes": 2,
        "selected_boxes": 1,
        "has_image_model": 1,
        "local_fallback": 0,
        "ocr_has": 0,
        "table_structure": 0,
        "fallback_detector": 0,
        "source_counts": {"has_image": 1},
        "evidence_source_counts": {},
        "source_detail_counts": {},
        "warnings_by_key": {},
    }
    assert report["redacted_zip"]["included_count"] == 1
    assert report["redacted_zip"]["skipped"] == [
        {"file_id": pending_file_id, "reason": "missing_redacted_output"}
    ]

    files_by_id = {file["file_id"]: file for file in report["files"]}
    assert files_by_id[ready_file_id]["delivery_status"] == "ready_for_delivery"
    assert files_by_id[ready_file_id]["ready_for_delivery"] is True
    assert files_by_id[ready_file_id]["action_required"] is False
    assert files_by_id[ready_file_id]["blocking"] is False
    assert files_by_id[ready_file_id]["blocking_reasons"] == []
    assert files_by_id[ready_file_id]["visual_review_hint"] is True
    assert files_by_id[ready_file_id]["page_count"] == 2
    assert files_by_id[ready_file_id]["visual_review"] == {
        "blocking": False,
        "review_hint": True,
        "issue_count": 2,
        "issue_pages": ["5"],
        "issue_pages_count": 1,
        "issue_labels": ["edge_seal", "seam_seal"],
        "by_issue": {"edge_seal": 1, "seam_seal": 1},
    }
    assert files_by_id[ready_file_id]["visual_evidence"] == {
        "total_boxes": 2,
        "selected_boxes": 1,
        "has_image_model": 1,
        "local_fallback": 0,
        "ocr_has": 0,
        "table_structure": 0,
        "fallback_detector": 0,
        "source_counts": {"has_image": 1},
        "evidence_source_counts": {},
        "source_detail_counts": {},
        "warnings_by_key": {},
    }
    assert files_by_id[pending_file_id]["delivery_status"] == "action_required"
    assert files_by_id[pending_file_id]["ready_for_delivery"] is False
    assert files_by_id[pending_file_id]["action_required"] is True
    assert files_by_id[pending_file_id]["blocking"] is True
    assert files_by_id[pending_file_id]["blocking_reasons"] == [
        "missing_redacted_output",
        "review_not_confirmed",
    ]
    assert files_by_id[pending_file_id]["visual_review_hint"] is False
    assert files_by_id[pending_file_id]["visual_evidence"]["selected_boxes"] == 0
    assert files_by_id[pending_file_id]["redacted_export_skip_reason"] == "missing_redacted_output"


def test_redacted_batch_zip_manifest_reports_job_item_not_delivery_ready(
    test_client: TestClient,
    tmp_data_dir: str,
):
    from app.services.file_management_service import get_file_store
    from app.services.job_store import JobItemStatus, get_job_store

    job_id = _create_job(test_client)
    ready_file_id = _upload_to_job(test_client, job_id, "ready.txt", b"ready")
    pending_file_id = _upload_to_job(test_client, job_id, "pending.txt", b"pending")

    detail = test_client.get(f"/api/v1/jobs/{job_id}").json()
    ready_item_id = next(item["id"] for item in detail["items"] if item["file_id"] == ready_file_id)
    store = get_job_store()
    store.update_item_status(ready_item_id, JobItemStatus.PROCESSING)
    store.update_item_status(ready_item_id, JobItemStatus.AWAITING_REVIEW)
    store.update_item_status(ready_item_id, JobItemStatus.COMPLETED)

    ready_output_path = Path(tmp_data_dir) / "outputs" / "redacted-ready.txt"
    pending_output_path = Path(tmp_data_dir) / "outputs" / "redacted-pending.txt"
    ready_output_path.write_bytes(b"redacted-ready")
    pending_output_path.write_bytes(b"redacted-pending")
    get_file_store().update_fields(ready_file_id, {"output_path": str(ready_output_path)})
    get_file_store().update_fields(pending_file_id, {"output_path": str(pending_output_path)})

    resp = test_client.post(
        "/api/v1/files/batch/download",
        json={"file_ids": [ready_file_id, pending_file_id], "redacted": True},
    )

    assert resp.status_code == 200, resp.text
    assert resp.headers["X-Batch-Zip-Included-Count"] == "1"
    assert resp.headers["X-Batch-Zip-Skipped-Count"] == "1"
    assert json.loads(resp.headers["X-Batch-Zip-Skipped"]) == [
        {"file_id": pending_file_id, "reason": "job_item_not_delivery_ready"}
    ]
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        manifest = json.loads(zf.read("manifest.json"))
    assert manifest["included_count"] == 1
    assert manifest["skipped"] == [
        {"file_id": pending_file_id, "reason": "job_item_not_delivery_ready"}
    ]


def test_job_export_report_visual_review_prefers_specific_risk_over_generic_warning(
    test_client: TestClient,
    tmp_data_dir: str,
):
    from app.services.file_management_service import get_file_store
    from app.services.job_store import JobItemStatus, get_job_store

    job_id = _create_job(test_client)
    file_id = _upload_to_job(test_client, job_id, "visual-risk.txt", b"visual risk")

    detail = test_client.get(f"/api/v1/jobs/{job_id}").json()
    item_id = detail["items"][0]["id"]
    store = get_job_store()
    store.update_item_status(item_id, JobItemStatus.PROCESSING)
    store.update_item_status(item_id, JobItemStatus.AWAITING_REVIEW)
    store.update_item_status(item_id, JobItemStatus.COMPLETED)

    output_path = Path(tmp_data_dir) / "outputs" / "redacted-visual-risk.txt"
    output_path.write_bytes(b"redacted")
    get_file_store().update_fields(
        file_id,
        {
            "output_path": str(output_path),
            "bounding_boxes": {
                1: [
                    {
                        "id": "fallback-seam-seal",
                        "x": 0.945,
                        "y": 0.45,
                        "width": 0.04,
                        "height": 0.13,
                        "type": "official_seal",
                        "source": "has_image",
                        "source_detail": "seal_detector",
                        "evidence_source": "local_fallback",
                        "warnings": ["near-page-edge"],
                        "selected": True,
                    },
                ],
                2: [
                    {
                        "id": "generic-warning-only",
                        "x": 0.2,
                        "y": 0.2,
                        "width": 0.1,
                        "height": 0.05,
                        "type": "text",
                        "source": "ocr_has",
                        "source_detail": "table_structure",
                        "warnings": ["manual-review"],
                        "selected": True,
                    },
                ],
            },
        },
    )

    resp = test_client.get(
        f"/api/v1/jobs/{job_id}/export-report",
        params={"file_ids": file_id},
    )

    assert resp.status_code == 200
    report = resp.json()
    expected_by_issue = {
        "edge_seal": 1,
        "fallback_detector": 1,
        "seam_seal": 1,
        "table_structure": 1,
    }
    expected_visual_evidence = {
        "total_boxes": 2,
        "selected_boxes": 2,
        "has_image_model": 0,
        "local_fallback": 1,
        "ocr_has": 1,
        "table_structure": 1,
        "fallback_detector": 1,
        "source_counts": {"has_image": 1, "ocr_has": 1},
        "evidence_source_counts": {"local_fallback": 1},
        "source_detail_counts": {"seal_detector": 1, "table_structure": 1},
        "warnings_by_key": {"manual-review": 1, "near-page-edge": 1},
    }
    assert report["summary"]["visual_review_issue_files"] == 1
    assert report["summary"]["visual_review_issue_count"] == 4
    assert report["summary"]["visual_review_issue_pages_count"] == 2
    assert report["summary"]["visual_review_issue_labels"] == sorted(expected_by_issue)
    assert report["summary"]["visual_review_hint"] is True
    assert report["summary"]["action_required_files"] == 0
    assert report["summary"]["delivery_status"] == "ready_for_delivery"
    assert report["summary"]["ready_for_delivery"] is True
    assert report["summary"]["visual_review_by_issue"] == expected_by_issue
    assert report["summary"]["visual_evidence"] == expected_visual_evidence
    assert report["files"][0]["delivery_status"] == "ready_for_delivery"
    assert report["files"][0]["ready_for_delivery"] is True
    assert report["files"][0]["action_required"] is False
    assert report["files"][0]["blocking"] is False
    assert report["files"][0]["blocking_reasons"] == []
    assert report["files"][0]["visual_review_hint"] is True
    assert report["files"][0]["visual_review"] == {
        "blocking": False,
        "review_hint": True,
        "issue_count": 4,
        "issue_pages": ["1", "2"],
        "issue_pages_count": 2,
        "issue_labels": sorted(expected_by_issue),
        "by_issue": expected_by_issue,
    }
    assert report["files"][0]["visual_evidence"] == expected_visual_evidence


def test_job_export_report_selected_ready_subset_is_delivery_ready(
    test_client: TestClient,
    tmp_data_dir: str,
):
    from app.services.file_management_service import get_file_store
    from app.services.job_store import JobItemStatus, get_job_store

    job_id = _create_job(test_client)
    ready_file_id = _upload_to_job(test_client, job_id, "ready.txt", b"ready")
    _upload_to_job(test_client, job_id, "pending.txt", b"pending")

    detail = test_client.get(f"/api/v1/jobs/{job_id}").json()
    ready_item_id = next(item["id"] for item in detail["items"] if item["file_id"] == ready_file_id)
    store = get_job_store()
    store.update_item_status(ready_item_id, JobItemStatus.PROCESSING)
    store.update_item_status(ready_item_id, JobItemStatus.AWAITING_REVIEW)
    store.update_item_status(ready_item_id, JobItemStatus.COMPLETED)

    output_path = Path(tmp_data_dir) / "outputs" / "redacted-ready.txt"
    output_path.write_bytes(b"redacted")
    get_file_store().update_fields(ready_file_id, {"output_path": str(output_path)})

    resp = test_client.get(
        f"/api/v1/jobs/{job_id}/export-report",
        params={"file_ids": ready_file_id},
    )

    assert resp.status_code == 200
    report = resp.json()
    assert report["summary"]["selected_files"] == 1
    assert report["summary"]["action_required_files"] == 0
    assert report["summary"]["delivery_status"] == "ready_for_delivery"
    assert report["summary"]["action_required"] is False
    assert report["summary"]["blocking_files"] == 0
    assert report["summary"]["blocking"] is False
    assert report["summary"]["ready_for_delivery"] is True
    assert report["summary"]["visual_review_hint"] is False
    assert report["summary"]["visual_review_issue_pages_count"] == 0
    assert report["summary"]["visual_review_issue_labels"] == []
    assert report["redacted_zip"]["included_count"] == 1
    assert report["redacted_zip"]["skipped"] == []
    files_by_id = {file["file_id"]: file for file in report["files"]}
    assert files_by_id[ready_file_id]["delivery_status"] == "ready_for_delivery"
    unselected_statuses = {
        file["delivery_status"]
        for file in report["files"]
        if file["file_id"] != ready_file_id
    }
    assert unselected_statuses == {"not_selected"}


def test_job_export_report_rejects_file_selection_outside_job(test_client: TestClient):
    job_id = _create_job(test_client)
    file_id = _upload_to_job(test_client, job_id, "owned.txt", b"owned")

    resp = test_client.get(
        f"/api/v1/jobs/{job_id}/export-report",
        params=[("file_ids", file_id), ("file_ids", "external-file")],
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == {
        "message": "export report file selection does not belong to the job",
        "missing": ["external-file"],
    }
