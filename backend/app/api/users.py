"""Адмін: акаунти методистів і HR, демо-кандидати, вхід від імені користувача, скидання 2FA."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_db
from app.deps import require_roles
from app.models import Assessment, Methodology, User, UserRole
from app.schemas.auth import DemoCandidateOut, ImpersonationOut, UserCreateIn, UserOut, UserUpdateIn
from app.security import create_impersonation_token, hash_password
from app.services import totp

router = APIRouter(
    prefix="/users", tags=["users"], dependencies=[Depends(require_roles(UserRole.ADMIN))]
)

STAFF_ROLES = {UserRole.METHODOLOGIST, UserRole.HR, UserRole.ADMIN}


@router.get("", response_model=list[UserOut])
async def list_users(role: UserRole | None = None, db: AsyncSession = Depends(get_db)):
    query = select(User).order_by(User.id)
    if role is not None:
        query = query.where(User.role == role)
    return (await db.execute(query)).scalars().all()


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(data: UserCreateIn, db: AsyncSession = Depends(get_db)):
    if data.role not in STAFF_ROLES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Кандидати реєструються самостійно за запрошенням"
        )
    email = data.email.lower()
    if (await db.execute(select(User).where(User.email == email))).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Користувач з такою поштою вже існує")
    user = User(
        email=email, password_hash=hash_password(data.password), name=data.name, role=data.role
    )
    db.add(user)
    await db.commit()
    return user


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: int,
    data: UserUpdateIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.ADMIN)),
):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Користувача не знайдено")
    if data.is_active is False and user.id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Не можна деактивувати власний акаунт")
    if data.name is not None:
        user.name = data.name
    if data.is_active is not None:
        user.is_active = data.is_active
    if data.password is not None:
        user.password_hash = hash_password(data.password)
    await db.commit()
    return user


@router.get("/demo-candidates", response_model=list[DemoCandidateOut])
async def demo_candidates(db: AsyncSession = Depends(get_db)):
    rows = (
        await db.execute(
            select(User, Assessment, Methodology)
            .outerjoin(Assessment, Assessment.candidate_id == User.id)
            .outerjoin(Methodology, Methodology.id == Assessment.methodology_id)
            .where(
                User.role == UserRole.CANDIDATE, User.is_demo.is_(True), User.is_active.is_(True)
            )
            .options(
                selectinload(Methodology.quiz_questions),
                selectinload(Methodology.interview_questions),
            )
            .order_by(User.id)
        )
    ).all()
    out = []
    for u, a, m in rows:
        total = done = None
        if a is not None and m is not None:
            # етапи, що є в методології: анкета завжди, опитувальник та інтерв'ю — якщо мають питання
            flags = [
                a.profile_submitted_at,
                a.quiz_submitted_at if m.quiz_questions else ...,
                a.interview_submitted_at if m.interview_questions else ...,
            ]
            present = [f for f in flags if f is not ...]
            total, done = len(present), sum(1 for f in present if f is not None)
        out.append(
            DemoCandidateOut(
                id=u.id,
                name=u.name,
                email=u.email,
                methodology_title=m.title if m else None,
                stage=a.stage.value if a else None,
                stages_done=done,
                stages_total=total,
            )
        )
    return out


@router.post("/{user_id}/impersonate", response_model=ImpersonationOut)
async def impersonate(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.ADMIN)),
):
    """Вхід адміна від імені демо-кандидата — щоб побачити й пройти кабінет кандидата по-справжньому."""
    target = await db.get(User, user_id)
    if target is None or not target.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Користувача не знайдено")
    if target.role != UserRole.CANDIDATE or not target.is_demo:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Входити від імені можна лише в демо-кандидатів, не у справжніх користувачів",
        )
    return ImpersonationOut(
        access_token=create_impersonation_token(target.id, admin.id), user=target
    )


@router.post("/{user_id}/reset-2fa", response_model=UserOut)
async def reset_2fa(user_id: int, db: AsyncSession = Depends(get_db)):
    """Скидання 2FA адміном (втрачений телефон): користувач зможе увійти лише паролем і ввімкнути 2FA знову."""
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Користувача не знайдено")
    totp.reset(user)
    await db.commit()
    return user
