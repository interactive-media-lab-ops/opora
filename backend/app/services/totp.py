"""2FA за TOTP (RFC 6238): секрет, перевірка коду, захист від підбору й повторного використання."""

import base64
import hashlib
import hmac
from datetime import UTC, datetime, timedelta

import pyotp
from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings
from app.models import User, UserRole

ISSUER = "Опора"
STEP_SECONDS = 30
MAX_FAILURES = 5
LOCK_MINUTES = 5
# ролі, для яких доступна й обов'язкова 2FA (BR-7: HR, BR-8: адмін)
TWO_FA_ROLES = {UserRole.HR, UserRole.ADMIN}


def _fernet() -> Fernet:
    # ключ виводиться з JWT_SECRET: якщо секрет змінити, збережені секрети 2FA стануть нечитабельними — скиньте 2FA користувачам
    key = hashlib.sha256(("opora-totp:" + get_settings().jwt_secret).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def new_secret() -> str:
    return pyotp.random_base32()


def encrypt_secret(secret: str) -> str:
    return _fernet().encrypt(secret.encode()).decode()


def decrypt_secret(token: str) -> str | None:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return None


def provisioning_uri(email: str, secret: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=ISSUER)


def is_locked(user: User, now: datetime | None = None) -> bool:
    now = now or datetime.now(UTC)
    locked = user.totp_locked_until
    if locked is None:
        return False
    if locked.tzinfo is None:  # SQLite повертає naive datetime
        locked = locked.replace(tzinfo=UTC)
    return locked > now


def verify_code(user: User, code: str, now: datetime | None = None) -> bool:
    """Перевіряє код (допуск ±1 крок) і «споживає» його. Змінює user — виклик має зробити commit.

    Повторно використати вже прийнятий код (той самий або старіший крок) не можна.
    Після MAX_FAILURES невдалих спроб поспіль — блокування на LOCK_MINUTES.
    """
    now = now or datetime.now(UTC)
    if is_locked(user, now) or not user.totp_secret_enc:
        return False
    secret = decrypt_secret(user.totp_secret_enc)
    code = code.strip().replace(" ", "")
    if secret is None or not (code.isdigit() and len(code) == 6):
        return _fail(user, now)
    totp = pyotp.TOTP(secret, interval=STEP_SECONDS)
    current = int(now.timestamp()) // STEP_SECONDS
    for step in (current - 1, current, current + 1):
        if hmac.compare_digest(totp.at(step * STEP_SECONDS), code):
            if user.totp_last_step is not None and step <= user.totp_last_step:
                return _fail(user, now)
            user.totp_last_step = step
            user.totp_failures = 0
            user.totp_locked_until = None
            return True
    return _fail(user, now)


def _fail(user: User, now: datetime) -> bool:
    user.totp_failures += 1
    if user.totp_failures >= MAX_FAILURES:
        user.totp_locked_until = now + timedelta(minutes=LOCK_MINUTES)
        user.totp_failures = 0
    return False


def reset(user: User) -> None:
    user.totp_secret_enc = None
    user.totp_enabled = False
    user.totp_last_step = None
    user.totp_failures = 0
    user.totp_locked_until = None


def setup_required(user: User) -> bool:
    """Роль вимагає 2FA, а її ще не ввімкнено: вхід неповний, доки користувач не налаштує застосунок. Демо-акаунти виключені."""
    return (
        get_settings().require_2fa
        and user.role in TWO_FA_ROLES
        and not user.is_demo
        and not user.totp_enabled
    )
