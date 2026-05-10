# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

import ast
import json
from pathlib import Path

from app.core.has_image_categories import (
    DEFAULT_EXCLUDED_HAS_IMAGE_SLUGS,
    DEFAULT_HAS_IMAGE_SLUGS,
    HAS_IMAGE_CATEGORIES,
    HAS_IMAGE_MODEL_CLASS_COUNT,
    OCR_FALLBACK_ONLY_VISUAL_SLUGS,
)
from app.models.type_mapping import (
    TYPE_CN_TO_ID,
    TYPE_ID_ALIASES,
    canonical_type_id,
    cn_to_id,
    id_to_cn,
    id_to_label,
)


BACKEND_ROOT = Path(__file__).resolve().parents[1]
VISION_ROOT = BACKEND_ROOT / "app" / "services" / "vision"
VISION_CONTRACT_PATHS = (
    BACKEND_ROOT / "app" / "services" / "vision_service.py",
    *sorted(VISION_ROOT.glob("*.py")),
)
REGEX_MODULE_NAMES = {"re", "regex"}
FORBIDDEN_REGEX_DEPENDENCIES = {
    "app.core.safe_regex",
    "app.services.regex_service",
}
FORBIDDEN_HAS_IMAGE_SLUGS = {
    "signature",
    "handwritten",
    "hand_written",
    "handwriting",
    "handwritten_signature",
}


def _load_pipeline_presets() -> dict:
    return json.loads((BACKEND_ROOT / "config" / "preset_pipeline_types.json").read_text(encoding="utf-8"))


def test_vision_package_does_not_import_regex_engines() -> None:
    offenders: list[str] = []

    for path in VISION_CONTRACT_PATHS:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.split(".", maxsplit=1)[0] in REGEX_MODULE_NAMES:
                        offenders.append(f"{path.relative_to(BACKEND_ROOT)} imports {alias.name}")
            elif isinstance(node, ast.ImportFrom):
                if node.module and node.module.split(".", maxsplit=1)[0] in REGEX_MODULE_NAMES:
                    offenders.append(f"{path.relative_to(BACKEND_ROOT)} imports from {node.module}")
                if node.module in FORBIDDEN_REGEX_DEPENDENCIES:
                    offenders.append(f"{path.relative_to(BACKEND_ROOT)} imports from {node.module}")

    assert offenders == []


def test_vision_package_does_not_import_regex_service_dependencies() -> None:
    offenders: list[str] = []

    for path in VISION_CONTRACT_PATHS:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name in FORBIDDEN_REGEX_DEPENDENCIES:
                        offenders.append(f"{path.relative_to(BACKEND_ROOT)} imports {alias.name}")
            elif isinstance(node, ast.ImportFrom) and node.module in FORBIDDEN_REGEX_DEPENDENCIES:
                offenders.append(f"{path.relative_to(BACKEND_ROOT)} imports from {node.module}")

    assert offenders == []


def test_type_mapping_returns_canonical_ids_for_all_known_aliases() -> None:
    for alias, canonical in TYPE_ID_ALIASES.items():
        assert alias != canonical
        assert canonical_type_id(alias) == canonical
        assert canonical_type_id(alias.lower()) == canonical
        assert canonical_type_id(canonical) == canonical

    for chinese_name, raw_type_id in TYPE_CN_TO_ID.items():
        mapped = cn_to_id(chinese_name)
        assert mapped == canonical_type_id(raw_type_id)
        assert mapped not in TYPE_ID_ALIASES

    assert id_to_cn("COMPANY") == id_to_cn("COMPANY_NAME")
    assert id_to_cn("WORK_UNIT") == "工作单位"
    assert id_to_cn("TIME") != id_to_cn("DATE")
    assert id_to_label("WORK_UNIT") == "工作单位"
    assert id_to_label("DATETIME") == id_to_label("DATE")
    assert id_to_label("MONEY") == id_to_label("AMOUNT")


def test_has_image_pipeline_preset_is_model_only_and_has_no_regex_fields() -> None:
    pipelines = _load_pipeline_presets()
    has_image_types = pipelines["has_image"]
    model_slugs = [category.id for category in HAS_IMAGE_CATEGORIES]
    preset_slugs = [item["id"] for item in has_image_types]

    assert HAS_IMAGE_MODEL_CLASS_COUNT == 21
    assert preset_slugs == model_slugs
    assert len(preset_slugs) == len(set(preset_slugs)) == 21
    assert set(preset_slugs).isdisjoint(FORBIDDEN_HAS_IMAGE_SLUGS)
    assert set(OCR_FALLBACK_ONLY_VISUAL_SLUGS) == FORBIDDEN_HAS_IMAGE_SLUGS

    for item in has_image_types:
        assert "regex_pattern" not in item
        assert "use_llm" not in item


def test_has_image_default_selection_is_not_the_model_class_contract() -> None:
    pipelines = _load_pipeline_presets()
    has_image_types = pipelines["has_image"]

    enabled = {item["id"] for item in has_image_types if item.get("enabled") is True}
    disabled = {item["id"] for item in has_image_types if item.get("enabled") is False}

    assert DEFAULT_EXCLUDED_HAS_IMAGE_SLUGS == {"paper"}
    assert enabled == set(DEFAULT_HAS_IMAGE_SLUGS)
    assert disabled == {"paper"}
    assert len(enabled) == 20
    assert len(HAS_IMAGE_CATEGORIES) == 21
