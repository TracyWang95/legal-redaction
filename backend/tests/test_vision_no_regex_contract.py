# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

import ast
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
VISION_ROOT = BACKEND_ROOT / "app" / "services" / "vision"

REGEX_MODULE_ROOTS = {"re", "regex"}
TEXT_REGEX_MODULES = {
    "app.core.safe_regex",
    "app.services.regex_service",
}


def _vision_python_files() -> list[Path]:
    return sorted(VISION_ROOT.glob("*.py"))


def test_vision_pipeline_does_not_use_regex_engines_or_text_regex_services() -> None:
    offenders: list[str] = []

    for path in _vision_python_files():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        relative_path = path.relative_to(BACKEND_ROOT)

        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    module_root = alias.name.split(".", maxsplit=1)[0]
                    if module_root in REGEX_MODULE_ROOTS or alias.name in TEXT_REGEX_MODULES:
                        offenders.append(f"{relative_path}: imports {alias.name}")
            elif isinstance(node, ast.ImportFrom):
                module = node.module or ""
                module_root = module.split(".", maxsplit=1)[0]
                if module_root in REGEX_MODULE_ROOTS or module in TEXT_REGEX_MODULES:
                    offenders.append(f"{relative_path}: imports from {module}")
            elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                value = node.func.value
                if isinstance(value, ast.Name) and value.id in REGEX_MODULE_ROOTS:
                    offenders.append(f"{relative_path}: calls {value.id}.{node.func.attr}()")

    assert offenders == []
