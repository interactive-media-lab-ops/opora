"""Автентифікація: запрошення, реєстрація кандидата, вхід, двофакторна перевірка (TOTP)."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.errors import GoneError
from app.models import (
    Assessment,
    Methodology,
    MethodologyStatus,
    PersonalInvite,
    User,
    UserConsent,
    UserRole,
)
from app.schemas.auth import (
    InvitePreviewOut,
    Login2FAIn,
    LoginEnable2FAIn,
    LoginIn,
    LoginSetup2FAIn,
    MfaRequiredOut,
    MfaSetupRequiredOut,
    RefreshIn,
    RegisterIn,
    TokensOut,
    TwoFASetupOut,
    UserOut,
)
from app.security import (
    create_access_token,
    create_mfa_setup_token,
    create_mfa_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.services import totp

router = APIRouter(prefix="/auth", tags=["auth"])


def _tokens(user: User) -> TokensOut:
    return TokensOut(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


async def _resolve_invite(db: AsyncSession, code: str) -> tuple[Methodology, PersonalInvite | None]:
    """Знаходить методологію за загальним або персональним кодом."""
    personal = (
        await db.execute(select(PersonalInvite).where(PersonalInvite.code == code))
    ).scalar_one_or_none()
    if personal is not None:
        if personal.used_at is not None:
            raise GoneError("Це персональне запрошення вже використано", "used")
        methodology = await db.get(Methodology, personal.methodology_id)
    else:
        methodology = (
            await db.execute(select(Methodology).where(Methodology.invite_code == code))
        ).scalar_one_or_none()
    if methodology is None or methodology.status != MethodologyStatus.ACTIVE:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Запрошення недійсне")
    return methodology, personal


@router.get("/invite/{code}", response_model=InvitePreviewOut)
async def preview_invite(code: str, db: AsyncSession = Depends(get_db)):
    methodology, personal = await _resolve_invite(db, code)
    return InvitePreviewOut(
        methodology_title=methodology.title,
        personal=personal is not None,
        candidate_email=personal.candidate_email if personal else None,
    )


@router.post("/register", response_model=TokensOut, status_code=status.HTTP_201_CREATED)
async def register(data: RegisterIn, db: AsyncSession = Depends(get_db)):
    methodology, personal = await _resolve_invite(db, data.code)

    email = data.email.lower()
    if personal is not None and personal.candidate_email.lower() != email:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Персональне запрошення видано на іншу електронну адресу"
        )

    existing = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Користувач з такою поштою вже існує")

    user = User(
        email=email,
        password_hash=hash_password(data.password),
        name=data.name.strip(),
        role=UserRole.CANDIDATE,
    )
    db.add(user)
    await db.flush()
    for c in data.consents:
        db.add(
            UserConsent(user_id=user.id, kind=c.kind, version=c.version, accepted_at=c.accepted_at)
        )
    db.add(Assessment(candidate_id=user.id, methodology_id=methodology.id))
    if personal is not None:
        personal.used_at = datetime.now(UTC)
    await db.commit()
    return _tokens(user)


@router.post("/login", response_model=TokensOut | MfaRequiredOut | MfaSetupRequiredOut)
async def login(data: LoginIn, db: AsyncSession = Depends(get_db)):
    user = (
        await db.execute(select(User).where(User.email == data.email.lower()))
    ).scalar_one_or_none()
    if user is None or not user.is_active or not verify_password(data.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Невірна пошта або пароль")
    if user.totp_enabled and user.role in totp.TWO_FA_ROLES:
        return MfaRequiredOut(mfa_token=create_mfa_token(user.id))
    if totp.setup_required(user):  # BR-7 / BR-8: без налаштованої 2FA повного входу немає
        return MfaSetupRequiredOut(setup_token=create_mfa_setup_token(user.id))
    return _tokens(user)


async def _setup_user(db: AsyncSession, setup_token: str) -> User:
    user_id = decode_token(setup_token, "mfa_setup")
    user = await db.get(User, user_id) if user_id else None
    if user is None or not user.is_active or user.totp_enabled or not totp.setup_required(user):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Сеанс входу застарів. Увійдіть знову")
    return user


@router.post("/2fa/setup", response_model=TwoFASetupOut)
async def login_2fa_setup(data: LoginSetup2FAIn, db: AsyncSession = Depends(get_db)):
    """Перше налаштування 2FA під час входу: генерує секрет (повторний виклик замінює незавершений)."""
    user = await _setup_user(db, data.setup_token)
    secret = totp.new_secret()
    user.totp_secret_enc = totp.encrypt_secret(secret)
    user.totp_last_step = None
    await db.commit()
    return TwoFASetupOut(secret=secret, otpauth_uri=totp.provisioning_uri(user.email, secret))


@router.post("/2fa/enable", response_model=TokensOut)
async def login_2fa_enable(data: LoginEnable2FAIn, db: AsyncSession = Depends(get_db)):
    """Підтверджує перший код, вмикає 2FA і лише тоді видає токени."""
    user = await _setup_user(db, data.setup_token)
    if not user.totp_secret_enc:
        raise HTTPException(status.HTTP_409_CONFLICT, "Спершу почніть налаштування")
    if totp.is_locked(user):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Забагато невдалих спроб. Спробуйте за кілька хвилин"
        )
    ok = totp.verify_code(user, data.code)
    if ok:
        user.totp_enabled = True
    await db.commit()
    if not ok:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Невірний код")
    return _tokens(user)


@router.post("/login/2fa", response_model=TokensOut)
async def login_2fa(data: Login2FAIn, db: AsyncSession = Depends(get_db)):
    user_id = decode_token(data.mfa_token, "mfa")
    user = await db.get(User, user_id) if user_id else None
    if user is None or not user.is_active or not user.totp_enabled:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Сеанс входу застарів. Увійдіть знову")
    if totp.is_locked(user):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Забагато невдалих спроб. Спробуйте за кілька хвилин"
        )
    ok = totp.verify_code(user, data.code)
    await db.commit()  # лічильник спроб і крок коду зберігаються і при невдачі
    if not ok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Невірний код")
    return _tokens(user)


@router.post("/refresh", response_model=TokensOut)
async def refresh(data: RefreshIn, db: AsyncSession = Depends(get_db)):
    user_id = decode_token(data.refresh_token, "refresh")
    user = await db.get(User, user_id) if user_id else None
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Недійсний refresh-токен")
    return _tokens(user)


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return user
