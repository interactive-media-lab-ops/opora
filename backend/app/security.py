"""Паролі (bcrypt) і JWT-токени: доступу, оновлення, імперсонації, 2FA."""

import secrets
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from app.config import get_settings

settings = get_settings()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def _create_token(
    user_id: int, token_type: str, expires: timedelta, extra: dict | None = None
) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "type": token_type,
        "iat": now,
        "exp": now + expires,
        **(extra or {}),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_access_token(user_id: int) -> str:
    return _create_token(user_id, "access", timedelta(minutes=settings.access_token_minutes))


def create_impersonation_token(user_id: int, admin_id: int, hours: int = 8) -> str:
    """Access-токен від імені іншого користувача (лише access, без refresh); `imp` — id адміна."""
    return _create_token(user_id, "access", timedelta(hours=hours), {"imp": admin_id})


def create_refresh_token(user_id: int) -> str:
    return _create_token(user_id, "refresh", timedelta(days=settings.refresh_token_days))


def decode_token(token: str, expected_type: str) -> int | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        return None
    if payload.get("type") != expected_type:
        return None
    try:
        return int(payload["sub"])
    except (KeyError, ValueError):
        return None


def generate_code(nbytes: int = 12) -> str:
    return secrets.token_urlsafe(nbytes)


def create_mfa_setup_token(user_id: int) -> str:
    """Токен «пароль перевірено, 2FA ще не налаштовано»: дає змогу лише налаштувати 2FA, повного входу не дає."""
    return _create_token(user_id, "mfa_setup", timedelta(minutes=15))


def create_mfa_token(user_id: int) -> str:
    """Короткоживучий токен «пароль перевірено, чекаємо код 2FA»; як access/refresh не приймається."""
    return _create_token(user_id, "mfa", timedelta(minutes=5))
