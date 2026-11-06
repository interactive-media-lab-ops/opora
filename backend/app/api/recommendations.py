"""Рекомендації: кандидат роздає посилання, рекомендатор анонімно заповнює форму."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_db
from app.deps import require_roles
from app.errors import GoneError
from app.models import (
    Assessment,
    Methodology,
    Recommendation,
    RecommendationAnswer,
    RecommendationLink,
    RecommendationLinkStatus,
    RecommendationQuestion,
    User,
    UserRole,
)
from app.schemas.recommendation import (
    CandidateRecommendationsOut,
    LinkOut,
    PublicCandidateOut,
    PublicQuestionOut,
    PublicRecommendationOut,
    RoleOut,
    SubmitIn,
)
from app.services import recommendations as svc

candidate_router = APIRouter(
    prefix="/candidate/recommendations",
    tags=["recommendations"],
    dependencies=[Depends(require_roles(UserRole.CANDIDATE))],
)
public_router = APIRouter(prefix="/recommend", tags=["recommend"])


# ---------- Кабінет кандидата ----------


async def _my_assessment(db: AsyncSession, user: User) -> Assessment:
    assessment = (
        await db.execute(
            select(Assessment)
            .where(Assessment.candidate_id == user.id)
            .options(
                selectinload(Assessment.methodology).selectinload(
                    Methodology.recommendation_questions
                ),
                selectinload(Assessment.recommendation_links),
            )
            .execution_options(
                populate_existing=True
            )  # після commit повертаємо свіжі слоти, а не кеш сесії
        )
    ).scalar_one_or_none()
    if assessment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Оцінювання не знайдено")
    return assessment


def _candidate_out(assessment: Assessment) -> CandidateRecommendationsOut:
    links = []
    for link in assessment.recommendation_links:
        if link.status != RecommendationLinkStatus.PENDING:
            links.append(LinkOut(slot=link.slot, status="USED", token=None, expires_at=None))
            continue
        expired = svc.is_expired(link)
        links.append(
            LinkOut(
                slot=link.slot,
                status="PENDING",
                token=None if expired else link.token,
                expires_at=link.expires_at,
                expired=expired,
            )
        )
    used = sum(1 for link in links if link.status == "USED")
    return CandidateRecommendationsOut(
        enabled=svc.feature_enabled(assessment), total=svc.SLOTS, used=used, links=links
    )


@candidate_router.get("", response_model=CandidateRecommendationsOut)
async def my_recommendations(
    db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.CANDIDATE))
):
    """Чотири слоти. Посилання створюються при першому зверненні (одноразово), далі лише читаються."""
    assessment = await _my_assessment(db, user)
    if svc.feature_enabled(assessment):
        have = {link.slot for link in assessment.recommendation_links}
        missing = [s for s in range(1, svc.SLOTS + 1) if s not in have]
        for slot in missing:
            db.add(
                RecommendationLink(
                    assessment_id=assessment.id,
                    slot=slot,
                    token=svc.new_token(),
                    expires_at=svc.new_expiry(),
                )
            )
        if missing:
            await db.commit()
            assessment = await _my_assessment(db, user)
    return _candidate_out(assessment)


@candidate_router.post("/{slot}/renew", response_model=CandidateRecommendationsOut)
async def renew_link(
    slot: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(UserRole.CANDIDATE)),
):
    """Нове посилання замість простроченого чи неотриманого: старе одразу перестає діяти. Використане не змінюється."""
    assessment = await _my_assessment(db, user)
    link = next((link for link in assessment.recommendation_links if link.slot == slot), None)
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Посилання не знайдено")
    if link.status != RecommendationLinkStatus.PENDING:
        raise HTTPException(status.HTTP_409_CONFLICT, "Це посилання вже використано")
    link.token = svc.new_token()
    link.expires_at = svc.new_expiry()
    await db.commit()
    return _candidate_out(await _my_assessment(db, user))


# ---------- Публічна сторінка рекомендатора ----------


async def _open_link(db: AsyncSession, token: str) -> RecommendationLink:
    link = (
        await db.execute(select(RecommendationLink).where(RecommendationLink.token == token))
    ).scalar_one_or_none()
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Посилання недійсне")
    if link.status != RecommendationLinkStatus.PENDING:
        raise GoneError("Це посилання вже використано", "used")
    if svc.is_expired(link):
        raise GoneError("Термін дії посилання минув", "expired")
    return link


async def _questions(db: AsyncSession, link: RecommendationLink) -> list[RecommendationQuestion]:
    return list(
        (
            await db.execute(
                select(RecommendationQuestion)
                .join(
                    Assessment, Assessment.methodology_id == RecommendationQuestion.methodology_id
                )
                .where(Assessment.id == link.assessment_id)
                .order_by(RecommendationQuestion.order, RecommendationQuestion.id)
            )
        ).scalars()
    )


@public_router.get("/{token}", response_model=PublicRecommendationOut)
async def open_recommendation(token: str, db: AsyncSession = Depends(get_db)):
    link = await _open_link(db, token)
    questions = await _questions(db, link)
    if not questions:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Посилання недійсне")
    assessment = (
        await db.execute(
            select(Assessment)
            .where(Assessment.id == link.assessment_id)
            .options(
                selectinload(Assessment.candidate),
                selectinload(Assessment.methodology).selectinload(Methodology.profile_fields),
                selectinload(Assessment.profile_answers),
            )
        )
    ).scalar_one()
    return PublicRecommendationOut(
        organization=svc.ORGANIZATION,
        candidate=PublicCandidateOut(
            name=assessment.candidate.name, post=svc.candidate_post(assessment)
        ),
        roles=[RoleOut(id=r, label=label) for r, label in svc.ROLE_LABELS.items()],
        questions=[
            PublicQuestionOut(
                id=q.id, text=q.text, hint=q.hint, required=q.required, max_length=q.max_length
            )
            for q in questions
        ],
    )


async def _consume(
    db: AsyncSession, link: RecommendationLink, new_status: RecommendationLinkStatus
) -> None:
    """Атомарно переводить PENDING → новий статус: паралельні запити не можуть використати посилання двічі."""
    result = await db.execute(
        update(RecommendationLink)
        .where(
            RecommendationLink.id == link.id,
            RecommendationLink.status == RecommendationLinkStatus.PENDING,
            RecommendationLink.expires_at > datetime.now(UTC),
        )
        .values(status=new_status)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        await db.rollback()
        raise GoneError("Це посилання вже використано", "used")


@public_router.post("/{token}/submit", status_code=status.HTTP_204_NO_CONTENT)
async def submit_recommendation(token: str, data: SubmitIn, db: AsyncSession = Depends(get_db)):
    link = await _open_link(db, token)
    questions = await _questions(db, link)
    by_id = {q.id: q for q in questions}
    given = {a.question_id: a.text for a in data.answers}
    if len(given) != len(data.answers) or not set(given) <= set(by_id):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Невідоме або повторене питання")
    # BR-15: питання з required=false можна пропустити; порушення — 422 з номером питання
    for number, q in enumerate(questions, start=1):
        text = given.get(q.id, "")
        if q.required and not text:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, f"Питання {number}: дайте відповідь"
            )
        if q.max_length is not None and len(text) > q.max_length:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"Питання {number}: не більше {q.max_length} знаків",
            )
    if not any(given.values()):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Дайте відповідь хоча б на одне питання"
        )
    await _consume(db, link, RecommendationLinkStatus.SUBMITTED)
    rec = Recommendation(link_id=link.id, role=data.role)
    rec.answers = [
        RecommendationAnswer(question_id=q.id, question_text=q.text, order=i, text=given[q.id])
        for i, q in enumerate(questions)
        if given.get(q.id)  # пропущені необов'язкові питання не зберігаємо
    ]
    db.add(rec)
    await db.commit()


@public_router.post("/{token}/decline", status_code=status.HTTP_204_NO_CONTENT)
async def decline_recommendation(token: str, db: AsyncSession = Depends(get_db)):
    """«Недостатньо знаю людину»: посилання вважається використаним, відгуку не створюється (D-45)."""
    link = await _open_link(db, token)
    await _consume(db, link, RecommendationLinkStatus.DECLINED)
    await db.commit()
