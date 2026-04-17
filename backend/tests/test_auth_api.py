"""Auth API endpoint tests."""
from __future__ import annotations

import os
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def auth_client(tmp_data_dir: str) -> Generator[TestClient, None, None]:
    """TestClient with AUTH_ENABLED=true and NO auth bypass."""
    os.environ["UPLOAD_DIR"] = os.path.join(tmp_data_dir, "uploads")
    os.environ["OUTPUT_DIR"] = os.path.join(tmp_data_dir, "outputs")
    os.environ["DATA_DIR"] = os.path.join(tmp_data_dir, "data")
    os.environ["JOB_DB_PATH"] = os.path.join(tmp_data_dir, "data", "jobs.db")
    os.environ["AUTH_ENABLED"] = "true"
    os.environ["DEBUG"] = "true"

    from app.core.config import settings
    from app.main import app
    # Clear any leftover overrides from other fixtures
    app.dependency_overrides.clear()

    _prev_auth = settings.AUTH_ENABLED
    _prev_debug = settings.DEBUG
    settings.AUTH_ENABLED = True
    settings.DEBUG = True

    # Reset the auth module's cached file path to use the temp DATA_DIR
    import app.core.auth as _auth_mod
    _auth_mod._AUTH_FILE = os.path.join(tmp_data_dir, "data", "auth.json")
    _auth_mod.clear_login_attempts("testclient")
    _auth_mod._login_attempts.clear()

    # Reset rate limiter state so tests don't interfere with each other
    from app.api.auth import _auth_limiter
    _auth_limiter._hits.clear()

    with TestClient(app) as client:
        yield client

    settings.AUTH_ENABLED = _prev_auth
    settings.DEBUG = _prev_debug
    app.dependency_overrides.clear()
    for key in ("UPLOAD_DIR", "OUTPUT_DIR", "DATA_DIR", "JOB_DB_PATH",
                "AUTH_ENABLED", "DEBUG"):
        os.environ.pop(key, None)


# Strong passwords that meet all complexity requirements
_GOOD_PWD = "Str0ng!Pass#99"
_GOOD_PWD2 = "N3w!Secure#77"


# ── Auth status ──────────────────────────────────────────────

def test_auth_status_returns_enabled_flag(auth_client: TestClient):
    resp = auth_client.get("/api/v1/auth/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["auth_enabled"] is True
    assert "password_set" in body
    assert body["authenticated"] is False


def test_auth_status_reports_authenticated_after_setup(auth_client: TestClient):
    auth_client.post("/api/v1/auth/setup", json={"password": _GOOD_PWD})
    resp = auth_client.get("/api/v1/auth/status")
    assert resp.status_code == 200
    assert resp.json()["authenticated"] is True


# ── Setup password ───────────────────────────────────────────

def test_setup_password_success(auth_client: TestClient):
    resp = auth_client.post("/api/v1/auth/setup", json={"password": _GOOD_PWD})
    assert resp.status_code == 200
    body = resp.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"
    assert body["expires_in"] > 0


def test_setup_password_too_short_returns_400(auth_client: TestClient):
    resp = auth_client.post("/api/v1/auth/setup", json={"password": "Ab1!"})
    assert resp.status_code == 400


def test_setup_password_twice_returns_400(auth_client: TestClient):
    auth_client.post("/api/v1/auth/setup", json={"password": _GOOD_PWD})
    resp = auth_client.post("/api/v1/auth/setup", json={"password": _GOOD_PWD2})
    assert resp.status_code == 400


# ── Login ────────────────────────────────────────────────────

def test_login_success(auth_client: TestClient):
    auth_client.post("/api/v1/auth/setup", json={"password": _GOOD_PWD})
    resp = auth_client.post("/api/v1/auth/login", json={"password": _GOOD_PWD})
    assert resp.status_code == 200
    assert "access_token" in resp.json()


def test_login_wrong_password_returns_401(auth_client: TestClient):
    auth_client.post("/api/v1/auth/setup", json={"password": _GOOD_PWD})
    resp = auth_client.post("/api/v1/auth/login", json={"password": "Wr0ng!Pass#11"})
    assert resp.status_code == 401


def test_login_no_password_set_returns_400(auth_client: TestClient):
    resp = auth_client.post("/api/v1/auth/login", json={"password": "anything"})
    assert resp.status_code == 400


# ── Login / Setup set httpOnly cookie ────────────────────────

def test_login_sets_access_token_cookie(auth_client: TestClient):
    """Login response should include an httpOnly Set-Cookie for access_token."""
    auth_client.post("/api/v1/auth/setup", json={"password": _GOOD_PWD})
    resp = auth_client.post("/api/v1/auth/login", json={"password": _GOOD_PWD})
    assert resp.status_code == 200
    assert resp.cookies.get("access_token"), "Login should set access_token cookie"
    set_cookie = resp.headers.get("set-cookie", "")
    assert "httponly" in set_cookie.lower(), "access_token cookie must be httpOnly"


def test_setup_sets_access_token_cookie(auth_client: TestClient):
    """Setup response should include an httpOnly Set-Cookie for access_token."""
    resp = auth_client.post("/api/v1/auth/setup", json={"password": _GOOD_PWD})
    assert resp.status_code == 200
    assert resp.cookies.get("access_token"), "Setup should set access_token cookie"


# ── Cookie-based auth ────────────────────────────────────────

def test_cookie_auth_works_without_bearer_header(auth_client: TestClient):
    """Cookie auth should work without Authorization when the CSRF header is present."""
    auth_client.post("/api/v1/auth/setup", json={"password": _GOOD_PWD})
    login_resp = auth_client.post("/api/v1/auth/login", json={"password": _GOOD_PWD})
    token = login_resp.json()["access_token"]
    auth_client.cookies.set("access_token", token)
    csrf = auth_client.cookies.get("csrf_token")
    resp = auth_client.post("/api/v1/auth/logout", headers={"X-CSRF-Token": csrf})
    assert resp.status_code == 200


# ── Change password ──────────────────────────────────────────

def test_change_password_success(auth_client: TestClient):
    setup = auth_client.post("/api/v1/auth/setup", json={"password": _GOOD_PWD})
    token = setup.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    resp = auth_client.post(
        "/api/v1/auth/change-password",
        json={"old_password": _GOOD_PWD, "new_password": _GOOD_PWD2},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "access_token" in body


def test_change_password_invalidates_old_token(auth_client: TestClient):
    setup = auth_client.post("/api/v1/auth/setup", json={"password": _GOOD_PWD})
    old_token = setup.json()["access_token"]
    headers = {"Authorization": f"Bearer {old_token}"}

    resp = auth_client.post(
        "/api/v1/auth/change-password",
        json={"old_password": _GOOD_PWD, "new_password": _GOOD_PWD2},
        headers=headers,
    )
    assert resp.status_code == 200

    old_token_resp = auth_client.get("/api/v1/files", headers={"Authorization": f"Bearer {old_token}"})
    assert old_token_resp.status_code == 401


def test_change_password_wrong_old_returns_401(auth_client: TestClient):
    setup = auth_client.post("/api/v1/auth/setup", json={"password": _GOOD_PWD})
    token = setup.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    resp = auth_client.post(
        "/api/v1/auth/change-password",
        json={"old_password": "Wr0ng!Old#11", "new_password": _GOOD_PWD2},
        headers=headers,
    )
    assert resp.status_code == 401


def test_change_password_new_too_short_returns_400(auth_client: TestClient):
    setup = auth_client.post("/api/v1/auth/setup", json={"password": _GOOD_PWD})
    token = setup.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    resp = auth_client.post(
        "/api/v1/auth/change-password",
        json={"old_password": _GOOD_PWD, "new_password": "ab"},
        headers=headers,
    )
    assert resp.status_code == 400


# ── Logout ───────────────────────────────────────────────────

def test_logout_success(auth_client: TestClient):
    setup = auth_client.post("/api/v1/auth/setup", json={"password": _GOOD_PWD})
    token = setup.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    resp = auth_client.post("/api/v1/auth/logout", headers=headers)
    assert resp.status_code == 200


def test_revoke_all_invalidates_existing_tokens(auth_client: TestClient):
    setup = auth_client.post("/api/v1/auth/setup", json={"password": _GOOD_PWD})
    token = setup.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    resp = auth_client.post("/api/v1/auth/revoke-all", headers=headers)
    assert resp.status_code == 200

    old_token_resp = auth_client.get("/api/v1/files", headers={"Authorization": f"Bearer {token}"})
    assert old_token_resp.status_code == 401


def test_corrupted_auth_state_returns_503_not_500(auth_client: TestClient, tmp_data_dir: str):
    setup = auth_client.post("/api/v1/auth/setup", json={"password": _GOOD_PWD})
    token = setup.json()["access_token"]

    auth_path = os.path.join(tmp_data_dir, "data", "auth.json")
    backup_path = f"{auth_path}.bak"
    with open(auth_path, "w", encoding="utf-8") as handle:
        handle.write("{")
    with open(backup_path, "w", encoding="utf-8") as handle:
        handle.write("{")

    resp = auth_client.get("/api/v1/files", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 503
    assert resp.json()["error_code"] == "HTTP_503"


# ── Rate limiting ────────────────────────────────────────────

def test_rate_limit_returns_429_after_too_many_requests(auth_client: TestClient):
    """The auth endpoints allow 5 req/min; the 6th should be rejected."""
    for _ in range(5):
        auth_client.post("/api/v1/auth/login", json={"password": "x"})
    resp = auth_client.post("/api/v1/auth/login", json={"password": "x"})
    assert resp.status_code == 429


def test_failed_login_attempts_expire_after_ttl(auth_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    import app.core.auth as auth_mod

    current_time = 1_000.0

    def fake_monotonic() -> float:
        return current_time

    monkeypatch.setattr(auth_mod.time, "monotonic", fake_monotonic)

    for _ in range(4):
        assert auth_mod.register_failed_login("shared-ip") is False

    current_time += auth_mod._LOGIN_ATTEMPT_TTL_SECONDS + 1

    assert auth_mod.register_failed_login("shared-ip") is False
    assert auth_mod.is_login_locked("shared-ip") is False


def test_register_failed_login_prunes_stale_attempt_entries(
    auth_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    import app.core.auth as auth_mod

    current_time = 2_000.0

    def fake_monotonic() -> float:
        return current_time

    monkeypatch.setattr(auth_mod.time, "monotonic", fake_monotonic)

    auth_mod.register_failed_login("stale-ip")
    assert "stale-ip" in auth_mod._login_attempts

    current_time += auth_mod._LOGIN_ATTEMPT_TTL_SECONDS + 1
    auth_mod.register_failed_login("fresh-ip")

    assert "stale-ip" not in auth_mod._login_attempts


def test_login_lockout_is_scoped_by_user_agent(auth_client: TestClient):
    from app.api.auth import _auth_limiter

    original_max_requests = _auth_limiter.max_requests
    _auth_limiter.max_requests = 200
    _auth_limiter._hits.clear()

    try:
        auth_client.post("/api/v1/auth/setup", json={"password": _GOOD_PWD})

        ua_a = {"User-Agent": "test-agent-a"}
        ua_b = {"User-Agent": "test-agent-b"}

        for _ in range(4):
            resp = auth_client.post("/api/v1/auth/login", json={"password": "Wr0ng!Pass#11"}, headers=ua_a)
            assert resp.status_code == 401

        fifth = auth_client.post("/api/v1/auth/login", json={"password": "Wr0ng!Pass#11"}, headers=ua_a)
        assert fifth.status_code == 429

        isolated = auth_client.post("/api/v1/auth/login", json={"password": "Wr0ng!Pass#11"}, headers=ua_b)
        assert isolated.status_code == 401
    finally:
        _auth_limiter.max_requests = original_max_requests
        _auth_limiter._hits.clear()
