"""Особистий кабінет: запит на видалення даних (D-38) і 2FA для службових ролей; адмінська черга запитів."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.db import get_db
from app.deps import get_current_user, require_roles
from app.models import DeletionRequest, DeletionRequestStatus, User, UserRole
from app.schemas.account import AdminDeletionRequestOut, DeletionRequestOut
from app.schemas.auth import TwoFADisableIn, TwoFAEnableIn, TwoFASetupOut, TwoFAStatusOut
from app.security import verify_password
from app.services import totp

router = APIRouter(prefix="/account", tags=["account"])
admin_router = APIRouter(
    prefix="/admin/deletion-requests",
    tags=["admin"],
    dependencies=[Depends(require_roles(UserRole.ADMIN))],
)


def _out(r: DeletionRequest) -> DeletionRequestOut:
    return DeletionRequestOut(
        id=r.id, status=r.status, created_at=r.created_at, processed_at=r.processed_at
    )


async def _open_request(db: AsyncSession, user_id: int) -> DeletionRequest | None:
    return (
        (
            await db.execute(
                select(DeletionRequest)
                .where(
                    DeletionRequest.user_id == user_id,
                    DeletionRequest.status == DeletionRequestStatus.NEW,
                )
                .order_by(DeletionRequest.id.desc())
            )
        )
        .scalars()
        .first()
    )


@router.get("/deletion-request", response_model=DeletionRequestOut | None)
async def my_deletion_request(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    """Мій необроблений запит (або null)."""
    req = await _open_request(db, user.id)
    return _out(req) if req else None


@router.post(
    "/deletion-request", response_model=DeletionRequestOut, status_code=status.HTTP_201_CREATED
)
async def request_deletion(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    if user.role == UserRole.ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Акаунт адміністратора видаляється вручну")
    # демо-кандидатів адмін відкриває в режимі перегляду: запит від їхнього імені не має сенсу
    if user.is_demo and user.role == UserRole.CANDIDATE:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Для демо-акаунта запит недоступний")
    if await _open_request(db, user.id) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Запит уже надіслано й очікує на обробку")
    req = DeletionRequest(user_id=user.id)
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return _out(req)


def _admin_out(r: DeletionRequest) -> AdminDeletionRequestOut:
    return AdminDeletionRequestOut(
        id=r.id,
        status=r.status,
        created_at=r.created_at,
        processed_at=r.processed_at,
        user_id=r.user_id,
        user_name=r.user.name,
        user_email=r.user.email,
        user_role=r.user.role,
        user_is_active=r.user.is_active,
        processed_by_name=r.processed_by.name if r.processed_by else None,
    )


@admin_router.get("", response_model=list[AdminDeletionRequestOut])
async def list_requests(db: AsyncSession = Depends(get_db)):
    rows = (
        (
            await db.execute(
                select(DeletionRequest)
                .options(
                    selectinload(DeletionRequest.user), selectinload(DeletionRequest.processed_by)
                )
                .order_by(
                    DeletionRequest.status.asc(),
                    DeletionRequest.created_at.desc(),
                    DeletionRequest.id.desc(),
                )
            )
        )
        .scalars()
        .all()
    )
    return [_admin_out(r) for r in rows]


@admin_router.post("/{request_id}/done", response_model=AdminDeletionRequestOut)
async def mark_done(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.ADMIN)),
):
    req = (
        await db.execute(
            select(DeletionRequest)
            .where(DeletionRequest.id == request_id)
            .options(selectinload(DeletionRequest.user), selectinload(DeletionRequest.processed_by))
        )
    ).scalar_one_or_none()
    if req is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Запит не знайдено")
    if req.status == DeletionRequestStatus.DONE:
        raise HTTPException(status.HTTP_409_CONFLICT, "Запит уже оброблено")
    req.status = DeletionRequestStatus.DONE
    req.processed_at = datetime.now(UTC)
    req.processed_by_id = admin.id
    await db.commit()
    await db.refresh(req, attribute_names=["processed_by"])
    return _admin_out(req)


# ---------- 2FA (TOTP) ----------


def _require_2fa_role(user: User) -> None:
    if user.role not in totp.TWO_FA_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "2FA для вашої ролі недоступна")
    if user.is_demo:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Для демо-акаунта 2FA недоступна")


@router.get("/2fa", response_model=TwoFAStatusOut)
async def twofa_status(user: User = Depends(get_current_user)):
    return TwoFAStatusOut(
        available=user.role in totp.TWO_FA_ROLES and not user.is_demo, enabled=user.totp_enabled
    )


@router.post("/2fa/setup", response_model=TwoFASetupOut)
async def twofa_setup(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Генерує новий секрет (ще не діє, доки код не підтверджено). Повторний виклик замінює незавершене налаштування."""
    _require_2fa_role(user)
    if user.totp_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "2FA уже ввімкнено")
    secret = totp.new_secret()
    user.totp_secret_enc = totp.encrypt_secret(secret)
    user.totp_last_step = None
    await db.commit()
    return TwoFASetupOut(secret=secret, otpauth_uri=totp.provisioning_uri(user.email, secret))


@router.post("/2fa/enable", response_model=TwoFAStatusOut)
async def twofa_enable(
    data: TwoFAEnableIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    _require_2fa_role(user)
    if user.totp_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "2FA уже ввімкнено")
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
    return TwoFAStatusOut(available=True, enabled=True)


@router.post("/2fa/disable", response_model=TwoFAStatusOut)
async def twofa_disable(
    data: TwoFADisableIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    """Вимкнення вимагає і пароль, і поточний код: викрадений токен сам по собі не знімає захист."""
    _require_2fa_role(user)
    if user.role == UserRole.HR and get_settings().require_2fa:
        # BR-7: для HR 2FA обов'язкова; зміна й скидання — через підтримку (D-39)
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Вимкнути 2FA може лише підтримка")
    if not user.totp_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "2FA не ввімкнено")
    if totp.is_locked(user):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Забагато невдалих спроб. Спробуйте за кілька хвилин"
        )
    if not verify_password(data.password, user.password_hash):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Невірний пароль")
    ok = totp.verify_code(user, data.code)
    if ok:
        totp.reset(user)
    await db.commit()
    if not ok:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Невірний код")
    return TwoFAStatusOut(available=True, enabled=False)
