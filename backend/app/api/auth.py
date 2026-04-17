"""Auth API endpoints."""

import hashlib

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from app.core.auth import (
    bump_auth_version,
    check_password,
    clear_login_attempts,
    create_token,
    get_optional_subject,
    is_login_locked,
    is_password_set,
    register_failed_login,
    require_auth,
    revoke_token,
    set_password,
    validate_password_strength,
)
from app.core.config import settings
from app.core.rate_limit import RateLimiter, get_client_ip
from app.models.schemas import AuthStatusResponse, ChangePasswordRequest, PasswordRequest, TokenResponse

router = APIRouter(tags=["auth"])

_auth_limiter = RateLimiter(max_requests=5, window_seconds=60)


async def _check_auth_rate_limit(request: Request) -> None:
    client_ip = get_client_ip(request)
    if not _auth_limiter.check(f"auth:{client_ip}"):
        raise HTTPException(status_code=429, detail="Too many authentication requests. Try again later.")


def _login_attempt_key(request: Request) -> str:
    client_ip = get_client_ip(request)
    user_agent = (request.headers.get("user-agent") or "").strip()
    if not user_agent:
        return client_ip
    user_agent_hash = hashlib.sha256(user_agent.encode("utf-8")).hexdigest()[:16]
    return f"{client_ip}:{user_agent_hash}"


def _build_token_response(token: str) -> JSONResponse:
    expires_seconds = settings.JWT_EXPIRE_MINUTES * 60
    response = JSONResponse(
        content={
            "access_token": token,
            "token_type": "bearer",
            "expires_in": expires_seconds,
        }
    )
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        samesite="strict",
        secure=not settings.DEBUG,
        max_age=expires_seconds,
        path="/",
    )
    return response


@router.get("/auth/status", response_model=AuthStatusResponse)
async def auth_status(subject: str | None = Depends(get_optional_subject)):
    return {
        "auth_enabled": settings.AUTH_ENABLED,
        "password_set": is_password_set() if settings.AUTH_ENABLED else None,
        "authenticated": bool(subject) if settings.AUTH_ENABLED else True,
    }


@router.post("/auth/setup", response_model=TokenResponse, dependencies=[Depends(_check_auth_rate_limit)])
async def setup_password(req: PasswordRequest):
    if is_password_set():
        raise HTTPException(status_code=400, detail="Password is already set. Use the login endpoint instead.")
    errors = validate_password_strength(req.password)
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))
    set_password(req.password)
    token = create_token()
    return _build_token_response(token)


@router.post("/auth/login", response_model=TokenResponse, dependencies=[Depends(_check_auth_rate_limit)])
async def login(req: PasswordRequest, request: Request):
    client_key = _login_attempt_key(request)
    if not is_password_set():
        raise HTTPException(status_code=400, detail="Set a password before logging in.")
    if is_login_locked(client_key):
        raise HTTPException(status_code=429, detail="Login is temporarily locked after repeated failures.")
    if not check_password(req.password):
        if register_failed_login(client_key):
            raise HTTPException(status_code=429, detail="Login is temporarily locked after repeated failures.")
        raise HTTPException(status_code=401, detail="Incorrect password.")
    clear_login_attempts(client_key)
    token = create_token()
    return _build_token_response(token)


@router.post(
    "/auth/change-password",
    response_model=TokenResponse,
    dependencies=[Depends(_check_auth_rate_limit)],
)
async def change_password(req: ChangePasswordRequest, _: str = Depends(require_auth)):
    """Change password after verifying the current password."""
    if not check_password(req.old_password):
        raise HTTPException(status_code=401, detail="Current password is incorrect.")
    errors = validate_password_strength(req.new_password)
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))
    set_password(req.new_password, invalidate_existing_tokens=True)
    token = create_token()
    return _build_token_response(token)


@router.post("/auth/logout")
async def logout(request: Request, _: str = Depends(require_auth)):
    """Revoke the current token and clear the auth cookie."""
    token: str | None = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
    elif request.cookies.get("access_token"):
        token = request.cookies["access_token"]

    if token:
        revoke_token(token)

    response = JSONResponse(content={"message": "Logged out."})
    response.delete_cookie(key="access_token", path="/")
    return response


@router.post("/auth/revoke-all")
async def revoke_all_tokens(_: str = Depends(require_auth)):
    """Invalidate all existing tokens and clear the current auth cookie."""
    bump_auth_version()
    response = JSONResponse(content={"message": "All existing tokens have been invalidated."})
    response.delete_cookie(key="access_token", path="/")
    return response
