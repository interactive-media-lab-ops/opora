"""Схеми рекомендацій."""

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.models import RecommendationRole


class RoleOut(BaseModel):
    id: RecommendationRole
    label: str


class PublicQuestionOut(BaseModel):
    id: int
    text: str
    hint: str
    required: bool = True
    max_length: int | None = None


class PublicCandidateOut(BaseModel):
    name: str
    post: str | None = None


class PublicRecommendationOut(BaseModel):
    """Те, що бачить рекомендатор за посиланням. Методологію не розкриваємо; ім'я й посаду кандидата UI показує
    лише з кроку ролі (R3 / R4), на вступі R1 їх немає (D-10, BR-14)."""

    organization: str
    candidate: PublicCandidateOut
    roles: list[RoleOut]
    questions: list[PublicQuestionOut]


class AnswerIn(BaseModel):
    question_id: int
    text: str = Field(max_length=5000)

    @field_validator("text")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


class SubmitIn(BaseModel):
    role: RecommendationRole
    answers: list[AnswerIn]


class LinkOut(BaseModel):
    slot: int
    # PENDING — очікує; USED — використано (відгук або відмова: кандидат їх не розрізняє, D-45)
    status: str
    token: str | None  # лише для невикористаних і не прострочених
    expires_at: datetime | None
    expired: bool = False


class CandidateRecommendationsOut(BaseModel):
    enabled: bool
    total: int
    used: int
    links: list[LinkOut]


class RecommendationAnswerOut(BaseModel):
    question: str
    text: str


class RecommendationOut(BaseModel):
    """Відгук для HR / методолога: лише роль і відповіді, без часу й порядку відправлення."""

    role: RecommendationRole
    role_label: str
    answers: list[RecommendationAnswerOut]
