# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

from fastapi.testclient import TestClient


def test_test_client_uses_temp_file_store(test_client: TestClient, tmp_data_dir: str):
    from app.services.file_management_service import get_file_store

    store = get_file_store()

    assert store.db_path.startswith(tmp_data_dir)


def test_test_client_uses_temp_json_config_stores(test_client: TestClient, tmp_data_dir: str):
    from app.core.config import settings

    assert settings.ENTITY_TYPES_STORE_PATH.startswith(tmp_data_dir)
    assert settings.PIPELINE_STORE_PATH.startswith(tmp_data_dir)
    assert settings.PRESET_STORE_PATH.startswith(tmp_data_dir)
    assert settings.MODEL_CONFIG_PATH.startswith(tmp_data_dir)
