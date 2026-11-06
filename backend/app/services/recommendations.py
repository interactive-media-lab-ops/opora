"""Рекомендації: слоти посилань, одноразове використання, анонімне представлення відгуків."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from app.models import (
    Assessment,
    Recommendation,
    RecommendationLink,
    RecommendationLinkStatus,
    RecommendationRole,
)
from app.schemas.recommendation import RecommendationAnswerOut, RecommendationOut

SLOTS = 4  # D-05
LINK_TTL_DAYS = 30  # D-66
ORGANIZATION = "Опора"  # D-47: для КС — платформа

ROLE_LABELS: dict[RecommendationRole, str] = {
    RecommendationRole.MANAGER: "Керівник",
    RecommendationRole.COLLEAGUE: "Колега",
    RecommendationRole.SUBORDINATE: "Підлеглий",
}
_ROLE_ORDER = {r: i for i, r in enumerate(RecommendationRole)}


def new_token() -> str:
    return secrets.token_urlsafe(32)


def new_expiry(now: datetime | None = None) -> datetime:
    return (now or datetime.now(UTC)) + timedelta(days=LINK_TTL_DAYS)


def is_expired(link: RecommendationLink, now: datetime | None = None) -> bool:
    now = now or datetime.now(UTC)
    expires = link.expires_at
    if expires.tzinfo is None:  # SQLite повертає naive datetime
        expires = expires.replace(tzinfo=UTC)
    return expires <= now


def feature_enabled(assessment: Assessment) -> bool:
    """D-69 (82C, тимчасово): етап «Рекомендації» є завжди, навіть без питань у методології."""
    return True


def _shuffle_key(rec: Recommendation) -> str:
    # стабільний, але не пов'язаний із часом відправлення порядок: за id він би розкривав, хто відповів першим
    return hashlib.sha256(f"{rec.link.assessment_id}:{rec.id}".encode()).hexdigest()


def anonymous_reviews(assessment: Assessment) -> list[RecommendationOut]:
    """Надіслані відгуки (відмови «не знаю» не показуємо): за ролями, всередині ролі — у «перемішаному» порядку."""
    recs = [
        link.recommendation
        for link in assessment.recommendation_links
        if link.status == RecommendationLinkStatus.SUBMITTED and link.recommendation is not None
    ]
    recs.sort(key=lambda r: (_ROLE_ORDER[r.role], _shuffle_key(r)))
    return [
        RecommendationOut(
            role=r.role,
            role_label=ROLE_LABELS[r.role],
            answers=[
                RecommendationAnswerOut(question=a.question_text, text=a.text) for a in r.answers
            ],
        )
        for r in recs
    ]


def candidate_post(assessment: Assessment) -> str | None:
    """Посада кандидата: відповідь на поле анкети з назвою «Посада» (окремого поля в моделі немає). Немає — None."""
    answers = {a.profile_field_id: (a.value or "").strip() for a in assessment.profile_answers}
    for f in assessment.methodology.profile_fields:
        if "посад" in f.label.casefold() and answers.get(f.id):
            return answers[f.id]
    return None
