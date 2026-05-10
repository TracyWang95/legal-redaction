"""Shared pytest fixtures for the backend test suite."""
from __future__ import annotations

import os
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def tmp_data_dir(tmp_path) -> str:
    """Return a temporary directory for test data (uploads, outputs, db, etc.)."""
    for sub in ("uploads", "outputs", "data"):
        os.makedirs(os.path.join(str(tmp_path), sub), exist_ok=True)
    return str(tmp_path)


@pytest.fixture()
def test_client(tmp_data_dir: str) -> Generator[TestClient, None, None]:
    """Create a FastAPI ``TestClient`` with isolated data directories.

    All file / DB paths are redirected to *tmp_data_dir* so tests never
    touch production data.  Auth is disabled to simplify most tests; if you
    need auth-enabled tests, create a separate fixture that sets
    ``AUTH_ENABLED=true``.
    """
    # Override settings BEFORE importing the app so validators resolve paths
    # against the temp directory.
    os.environ["UPLOAD_DIR"] = os.path.join(tmp_data_dir, "uploads")
    os.environ["OUTPUT_DIR"] = os.path.join(tmp_data_dir, "outputs")
    os.environ["DATA_DIR"] = os.path.join(tmp_data_dir, "data")
    os.environ["JOB_DB_PATH"] = os.path.join(tmp_data_dir, "data", "jobs.db")
    os.environ["ENTITY_TYPES_STORE_PATH"] = os.path.join(tmp_data_dir, "data", "entity_types.json")
    os.environ["PIPELINE_STORE_PATH"] = os.path.join(tmp_data_dir, "data", "pipelines.json")
    os.environ["PRESET_STORE_PATH"] = os.path.join(tmp_data_dir, "data", "presets.json")
    os.environ["MODEL_CONFIG_PATH"] = os.path.join(tmp_data_dir, "data", "model_config.json")
    os.environ["AUTH_ENABLED"] = "false"
    os.environ["DEBUG"] = "true"

    # Import app lazily so env overrides take effect
    import app.services.entity_type_service as ets
    import app.services.file_management_service as fms
    import app.services.pipeline_service as pls
    from app.core.auth import require_auth
    from app.core.config import settings
    from app.main import app
    from app.services.file_store_db import FileStoreDB

    # The settings singleton is cached at first app import. If an earlier
    # fixture (e.g. auth_client) flipped AUTH_ENABLED=True, that leaks into
    # later tests and causes CSRFMiddleware to reject POST/DELETE with 403.
    # Force it off for this fixture and restore on teardown.
    _prev_paths = {
        "UPLOAD_DIR": settings.UPLOAD_DIR,
        "OUTPUT_DIR": settings.OUTPUT_DIR,
        "DATA_DIR": settings.DATA_DIR,
        "JOB_DB_PATH": settings.JOB_DB_PATH,
        "ENTITY_TYPES_STORE_PATH": settings.ENTITY_TYPES_STORE_PATH,
        "PIPELINE_STORE_PATH": settings.PIPELINE_STORE_PATH,
        "PRESET_STORE_PATH": settings.PRESET_STORE_PATH,
        "MODEL_CONFIG_PATH": settings.MODEL_CONFIG_PATH,
    }
    _prev_auth_enabled = settings.AUTH_ENABLED
    _prev_file_store = fms.file_store
    _prev_entity_types_db = ets.entity_types_db
    _prev_pipelines_db = pls.pipelines_db

    settings.UPLOAD_DIR = os.environ["UPLOAD_DIR"]
    settings.OUTPUT_DIR = os.environ["OUTPUT_DIR"]
    settings.DATA_DIR = os.environ["DATA_DIR"]
    settings.JOB_DB_PATH = os.environ["JOB_DB_PATH"]
    settings.ENTITY_TYPES_STORE_PATH = os.environ["ENTITY_TYPES_STORE_PATH"]
    settings.PIPELINE_STORE_PATH = os.environ["PIPELINE_STORE_PATH"]
    settings.PRESET_STORE_PATH = os.environ["PRESET_STORE_PATH"]
    settings.MODEL_CONFIG_PATH = os.environ["MODEL_CONFIG_PATH"]
    settings.AUTH_ENABLED = False

    # Module-level singletons are cached on first import, so environment
    # overrides alone do not move file_store off the developer's real DB.
    # Rebind it explicitly; clearing the old singleton would wipe local data.
    test_file_store = FileStoreDB(os.path.join(settings.DATA_DIR, "file_store.sqlite3"))
    fms.file_store = test_file_store
    test_file_store.clear()

    # JSON-backed config services also keep module-level mutable state. Rebind
    # them to temp files so CRUD API tests never write into the developer's real
    # product configuration.
    ets.entity_types_db = ets._load_entity_types()
    ets._persist_entity_types()
    pls.pipelines_db = pls._load_pipelines()
    pls._persist_pipelines()

    # Bypass auth for convenience — individual tests can remove this override
    app.dependency_overrides[require_auth] = lambda: "test_user"

    with TestClient(app) as client:
        yield client

    app.dependency_overrides.clear()
    test_file_store.clear()
    fms.file_store = _prev_file_store
    ets.entity_types_db = _prev_entity_types_db
    pls.pipelines_db = _prev_pipelines_db
    settings.AUTH_ENABLED = _prev_auth_enabled
    settings.UPLOAD_DIR = _prev_paths["UPLOAD_DIR"]
    settings.OUTPUT_DIR = _prev_paths["OUTPUT_DIR"]
    settings.DATA_DIR = _prev_paths["DATA_DIR"]
    settings.JOB_DB_PATH = _prev_paths["JOB_DB_PATH"]
    settings.ENTITY_TYPES_STORE_PATH = _prev_paths["ENTITY_TYPES_STORE_PATH"]
    settings.PIPELINE_STORE_PATH = _prev_paths["PIPELINE_STORE_PATH"]
    settings.PRESET_STORE_PATH = _prev_paths["PRESET_STORE_PATH"]
    settings.MODEL_CONFIG_PATH = _prev_paths["MODEL_CONFIG_PATH"]

    # Clean up env overrides
    for key in (
        "UPLOAD_DIR",
        "OUTPUT_DIR",
        "DATA_DIR",
        "JOB_DB_PATH",
        "ENTITY_TYPES_STORE_PATH",
        "PIPELINE_STORE_PATH",
        "PRESET_STORE_PATH",
        "MODEL_CONFIG_PATH",
        "AUTH_ENABLED",
        "DEBUG",
    ):
        os.environ.pop(key, None)
