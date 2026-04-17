"""Authentication module for JWT-based local authentication."""

import hashlib
import hmac
import json
import logging
import os
import tempfile
import threading
import time
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings
from app.core.token_blacklist import get_blacklist

security = HTTPBearer(auto_error=False)

_AUTH_FILE = os.path.join(settings.DATA_DIR, "auth.json")
_PBKDF2_ITERATIONS = 600_000  # NIST SP 800-132 (2023) recommended minimum
_LOGIN_LOCKOUT_THRESHOLD = 5
_LOGIN_LOCKOUT_SECONDS = 15 * 60
_LOGIN_ATTEMPT_TTL_SECONDS = _LOGIN_LOCKOUT_SECONDS
_login_attempts: dict[str, dict[str, float]] = {}
_login_attempts_lock = threading.Lock()
_auth_file_lock = threading.RLock()
_auth_version_cache: int | None = None
_auth_version_cache_mtime: float | None = None
_auth_version_cache_path: str | None = None
logger = logging.getLogger(__name__)


class AuthStateError(RuntimeError):
    """Raised when the persisted auth state cannot be read safely."""


def _get_auth_backup_file() -> str:
    return f"{_AUTH_FILE}.bak"


def _atomic_write_json(path: str, data: dict) -> None:
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=f"{os.path.basename(path)}.", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, path)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def _load_json_file(path: str) -> dict:
    with open(path, encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise AuthStateError(f"Auth state at {path!r} is not a JSON object.")
    return payload


def _auth_state_unavailable() -> HTTPException:
    return HTTPException(status_code=503, detail="Authentication state is temporarily unavailable.")


def _load_auth_unlocked() -> dict:
    backup_path = _get_auth_backup_file()
    main_exists = os.path.exists(_AUTH_FILE)
    if main_exists:
        try:
            return _load_json_file(_AUTH_FILE)
        except (AuthStateError, OSError, json.JSONDecodeError) as exc:
            logger.warning("Primary auth state is unreadable, attempting backup recovery: %s", exc)

    if os.path.exists(backup_path):
        try:
            backup_payload = _load_json_file(backup_path)
        except (AuthStateError, OSError, json.JSONDecodeError) as exc:
            logger.error("Backup auth state is unreadable: %s", exc)
            raise AuthStateError("Authentication state could not be recovered.") from exc

        try:
            _atomic_write_json(_AUTH_FILE, backup_payload)
        except OSError as exc:
            logger.warning("Recovered auth state from backup but could not restore primary file: %s", exc)
        return backup_payload

    if main_exists:
        raise AuthStateError("Authentication state could not be recovered.")
    return {}


def _load_auth() -> dict:
    with _auth_file_lock:
        return _load_auth_unlocked()


def _save_auth_unlocked(data: dict) -> None:
    global _auth_version_cache, _auth_version_cache_mtime, _auth_version_cache_path
    _atomic_write_json(_AUTH_FILE, data)
    _atomic_write_json(_get_auth_backup_file(), data)
    _auth_version_cache = _extract_auth_version(data)
    _auth_version_cache_path = _AUTH_FILE
    _auth_version_cache_mtime = _get_auth_file_mtime()


def _save_auth(data: dict) -> None:
    with _auth_file_lock:
        _save_auth_unlocked(data)


def _extract_auth_version(auth: dict) -> int:
    raw = auth.get("auth_version", 0)
    try:
        return max(0, int(raw))
    except (TypeError, ValueError):
        return 0


def _get_auth_file_mtime() -> float | None:
    try:
        return os.path.getmtime(_AUTH_FILE)
    except OSError:
        return None


def _invalidate_auth_version_cache_unlocked() -> None:
    global _auth_version_cache, _auth_version_cache_mtime, _auth_version_cache_path
    _auth_version_cache = None
    _auth_version_cache_mtime = None
    _auth_version_cache_path = None


def get_auth_version() -> int:
    """Return the global auth version used to invalidate older tokens."""
    global _auth_version_cache, _auth_version_cache_mtime, _auth_version_cache_path
    try:
        with _auth_file_lock:
            if _auth_version_cache_path != _AUTH_FILE:
                _invalidate_auth_version_cache_unlocked()

            current_mtime = _get_auth_file_mtime()
            if (
                _auth_version_cache is not None
                and current_mtime is not None
                and _auth_version_cache_mtime == current_mtime
            ):
                return _auth_version_cache

            auth = _load_auth_unlocked()
            version = _extract_auth_version(auth)
            _auth_version_cache = version
            _auth_version_cache_path = _AUTH_FILE
            _auth_version_cache_mtime = _get_auth_file_mtime()
            return version
    except AuthStateError as exc:
        raise _auth_state_unavailable() from exc


def bump_auth_version() -> int:
    """Invalidate all previously issued tokens by incrementing auth_version."""
    try:
        with _auth_file_lock:
            auth = _load_auth_unlocked()
            current_version = _extract_auth_version(auth)

            next_version = current_version + 1
            auth["auth_version"] = next_version
            _save_auth_unlocked(auth)
            return next_version
    except AuthStateError as exc:
        raise _auth_state_unavailable() from exc


def hash_password(password: str) -> str:
    salt = os.urandom(16).hex()
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), _PBKDF2_ITERATIONS).hex()
    return f"{salt}:{hashed}"


def verify_password(password: str, stored: str) -> bool:
    if ":" not in stored:
        return False
    salt, hashed = stored.split(":", 1)

    # Preserve compatibility with older hashes during migration.
    check = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), _PBKDF2_ITERATIONS).hex()
    if hmac.compare_digest(check, hashed):
        return True

    legacy_check = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000).hex()
    return hmac.compare_digest(legacy_check, hashed)


def create_token(subject: str = "local_user") -> str:
    expire = datetime.now(UTC) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    payload = {
        "sub": subject,
        "exp": expire,
        "jti": uuid.uuid4().hex,
        "auth_version": get_auth_version(),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Token has expired.") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid token.") from exc

    jti = payload.get("jti")
    if jti and get_blacklist().is_revoked(jti):
        raise HTTPException(status_code=401, detail="Token has been revoked.")

    if int(payload.get("auth_version", 0)) != get_auth_version():
        raise HTTPException(status_code=401, detail="Token is no longer valid.")
    return payload


def revoke_token(token: str) -> None:
    """Decode a token and add its JTI to the blacklist."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
            options={"verify_exp": False},
        )
    except jwt.InvalidTokenError:
        return

    jti = payload.get("jti")
    exp = payload.get("exp", 0)
    if jti:
        get_blacklist().revoke(jti, int(exp))


def validate_password_strength(password: str) -> list[str]:
    """Validate password complexity. Returns a list of error messages."""
    errors: list[str] = []
    if len(password) < 8:
        errors.append("Password must be at least 8 characters long.")
    if not any(c.isupper() for c in password):
        errors.append("Password must include at least one uppercase letter.")
    if not any(c.islower() for c in password):
        errors.append("Password must include at least one lowercase letter.")
    if not any(c.isdigit() for c in password):
        errors.append("Password must include at least one number.")
    if not any(not c.isalnum() for c in password):
        errors.append("Password must include at least one symbol.")
    return errors


def is_password_set() -> bool:
    try:
        auth = _load_auth()
    except AuthStateError as exc:
        raise _auth_state_unavailable() from exc
    return bool(auth.get("password_hash"))


def set_password(password: str, *, invalidate_existing_tokens: bool = False) -> int:
    try:
        with _auth_file_lock:
            auth = _load_auth_unlocked()
            auth["password_hash"] = hash_password(password)

            current_version = _extract_auth_version(auth)

            if invalidate_existing_tokens:
                current_version += 1
                auth["auth_version"] = current_version

            _save_auth_unlocked(auth)
            return current_version
    except AuthStateError as exc:
        raise _auth_state_unavailable() from exc


def check_password(password: str) -> bool:
    try:
        auth = _load_auth()
    except AuthStateError as exc:
        raise _auth_state_unavailable() from exc
    stored = auth.get("password_hash", "")
    if not stored:
        return False
    return verify_password(password, stored)


def _cleanup_lockout_entry(key: str, now: float | None = None) -> None:
    current_time = now if now is not None else time.monotonic()
    state = _login_attempts.get(key)
    if not state:
        return
    locked_until = float(state.get("locked_until", 0) or 0)
    last_failed_at = float(state.get("last_failed_at", 0) or 0)
    count = float(state.get("count", 0) or 0)
    if locked_until > current_time:
        return
    if count <= 0 or (
        last_failed_at
        and current_time - last_failed_at >= _LOGIN_ATTEMPT_TTL_SECONDS
    ):
        _login_attempts.pop(key, None)


def _prune_login_attempts_unlocked(now: float) -> None:
    for key in list(_login_attempts):
        _cleanup_lockout_entry(key, now)


def is_login_locked(key: str) -> bool:
    now = time.monotonic()
    with _login_attempts_lock:
        _prune_login_attempts_unlocked(now)
        state = _login_attempts.get(key)
        if not state:
            return False
        locked_until = state.get("locked_until", 0)
        if locked_until > now:
            return True
        if locked_until:
            state["locked_until"] = 0
            state["count"] = 0
            _cleanup_lockout_entry(key, now)
        return False


def register_failed_login(key: str) -> bool:
    now = time.monotonic()
    with _login_attempts_lock:
        _prune_login_attempts_unlocked(now)
        state = _login_attempts.setdefault(key, {"count": 0, "locked_until": 0, "last_failed_at": 0})
        locked_until = state.get("locked_until", 0)
        if locked_until > now:
            return True
        if locked_until:
            state["count"] = 0
            state["locked_until"] = 0
        last_failed_at = float(state.get("last_failed_at", 0) or 0)
        if last_failed_at and now - last_failed_at >= _LOGIN_ATTEMPT_TTL_SECONDS:
            state["count"] = 0
        state["count"] = state.get("count", 0) + 1
        state["last_failed_at"] = now
        if state["count"] >= _LOGIN_LOCKOUT_THRESHOLD:
            state["locked_until"] = now + _LOGIN_LOCKOUT_SECONDS
            return True
        return False


def clear_login_attempts(key: str) -> None:
    with _login_attempts_lock:
        _login_attempts.pop(key, None)


async def require_auth(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> str | None:
    """Require a valid JWT when auth is enabled."""
    if not settings.AUTH_ENABLED:
        return "anonymous"

    token: str | None = None
    if credentials is not None:
        token = credentials.credentials

    if token is None:
        token = request.cookies.get("access_token")

    if token is None:
        raise HTTPException(status_code=401, detail="Authentication is required.")

    payload = decode_token(token)
    return payload.get("sub", "unknown")


async def get_optional_subject(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> str | None:
    """Return the authenticated subject when present, otherwise ``None``."""
    if not settings.AUTH_ENABLED:
        return "anonymous"

    token: str | None = None
    if credentials is not None:
        token = credentials.credentials

    if token is None:
        token = request.cookies.get("access_token")

    if token is None:
        return None

    try:
        payload = decode_token(token)
    except HTTPException:
        return None

    return payload.get("sub", "unknown")
