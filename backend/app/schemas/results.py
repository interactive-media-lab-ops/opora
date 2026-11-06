"""Схеми результатів: рядки списку, картки кандидата для HR і методиста, нотатки, вердикти."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.models import AnalysisStatus, AssessmentStage, TranscriptStatus, Verdict
from app.schemas.recommendation import RecommendationOut


class RowStageOut(BaseModel):
    key: str  # PROFILE | QUIZ | INTERVIEW
    title: str
    status: str  # NOT_STARTED | IN_PROGRESS | SUBMITTED


class CandidateRowOut(BaseModel):
    id: int
    candidate_name: str
    candidate_email: str
    methodology_id: int
    methodology_title: str
    stage: AssessmentStage
    submitted_at: datetime | None
    verdict: Verdict | None
    summary_score: float | None
    # лише для методиста: кількість невдалих кроків аналізу/транскрипції
    failed_steps: int | None = None
    # BR-5: прогрес етапів («N / M» = кількість SUBMITTED / довжина списку), остання зміна, частка поданих етапів 0..1
    stages: list[RowStageOut] = []
    updated_at: datetime | None = None
    completeness: float | None = None


class DashboardOut(BaseModel):
    total: int
    by_stage: dict[str, int]
    awaiting_verdict: int
    submitted_last_7_days: int


class ProfileItemOut(BaseModel):
    label: str
    value: str


class QuizItemOut(BaseModel):
    question: str
    value: Any


class VoiceItemOut(BaseModel):
    voice_answer_id: int
    question: str
    kind: str = "VOICE"  # VOICE | TEXT
    duration_sec: float
    transcript: str
    transcript_status: TranscriptStatus
    transcript_error: str | None = None


class FinalConclusionOut(BaseModel):
    node_name: str
    output: str
    score: float | None


class NodeResultOut(BaseModel):
    node_id: int
    node_name: str
    prompt_text: str
    returns_score: bool
    is_terminal: bool
    status: AnalysisStatus
    output: str
    score: float | None
    error: str
    model: str
    input_tokens: int
    output_tokens: int


class CandidateDetailBase(BaseModel):
    id: int
    candidate_name: str
    candidate_email: str
    methodology_title: str
    stage: AssessmentStage
    submitted_at: datetime | None
    profile: list[ProfileItemOut]
    quiz: list[QuizItemOut]
    voice: list[VoiceItemOut]
    # BR-4: назви розділів профілю (задає методолог) — PROFILE / QUIZ / INTERVIEW
    stage_titles: dict[str, str] = {}
    summary_score: float | None
    verdict: Verdict | None
    verdict_note: str


class VerdictChangeOut(BaseModel):
    id: int
    changed_at: datetime
    author_name: str | None
    old_verdict: Verdict | None
    new_verdict: Verdict | None
    old_note: str
    new_note: str


class AnalyticsSourceOut(BaseModel):
    key: str
    label: str
    hint: str
    has_data: bool  # false — етап ще не опрацьовано («Даних ще немає»)


class AnalyticsSeriesOut(BaseModel):
    source: str
    values: dict[str, float | None]  # вісь → оцінка 1–10 (None — немає даних)


class AnalyticsOut(BaseModel):
    configured: bool  # є що показувати (осі задані або є фінальні вузли з балом)
    fallback: bool  # розмітки немає — показано фінальні оцінки вузлів
    mode: str  # radar | bars
    scale_max: int
    axes: list[str]
    sources: list[AnalyticsSourceOut]
    series: list[AnalyticsSeriesOut]
    sources_total: int
    sources_with_data: int


class EventOut(BaseModel):
    id: int
    created_at: datetime
    kind: str
    stage: str | None
    methodology_version: int | None
    details: Any = None


class HRCandidateDetailOut(CandidateDetailBase):
    final_conclusions: list[FinalConclusionOut]
    recommendations: list[RecommendationOut]
    # від новіших до старіших; лише для HR (D-56)
    history: list[VerdictChangeOut]
    events: list[EventOut]
    analytics: AnalyticsOut


class MethodologistCandidateDetailOut(CandidateDetailBase):
    results: list[NodeResultOut]
    recommendations: list[RecommendationOut]
    events: list[EventOut]
    analytics: AnalyticsOut


class VerdictIn(BaseModel):
    verdict: Verdict | None
    # BR-6: нотатки тепер окремі (/hr/candidates/:id/notes); поле лишено для сумісності й ігнорується
    note: str = ""


class HRNoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=5000)

    @field_validator("text")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Нотатка не може бути порожньою")
        return v


class HRNoteOut(BaseModel):
    id: int
    author_id: int
    author_name: str
    text: str
    created_at: datetime
    updated_at: datetime


class RetryIn(BaseModel):
    only_failed: bool = True


class HRListOut(BaseModel):
    id: int
    name: str
    is_default: bool
    # id проходжень у списку — щоб рядки бази й профіль показували «У списку · N» без окремих запитів
    assessment_ids: list[int]


class HRListDetailOut(BaseModel):
    id: int
    name: str
    is_default: bool
    rows: list[CandidateRowOut]


class HRListIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Назва не може бути порожньою")
        return v
