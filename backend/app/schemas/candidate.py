"""Схеми кабінету кандидата."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.models import AssessmentStage
from app.schemas.methodology import (
    InterviewQuestionOut,
    ProfileFieldOut,
    QuizQuestionOut,
)


class AnswerIn(BaseModel):
    question_id: int
    value: Any = None


class TextAnswerIn(BaseModel):
    text: str = Field(max_length=10000)
    client_request_id: str | None = Field(default=None, max_length=64)


class AnswersIn(BaseModel):
    answers: list[AnswerIn]


class VoiceStatusOut(BaseModel):
    question_id: int
    attempts_used: int
    attempts_left: int
    can_rerecord: bool
    duration_sec: float
    kind: str | None = None  # VOICE | TEXT | None (ще без відповіді)
    text: str = ""  # текстова відповідь кандидата
    can_record: bool = True  # можна записати голос (ліміт спроб не вичерпано)


class StageOut(BaseModel):
    key: str  # PROFILE | QUIZ | INTERVIEW
    title: str
    status: str  # NOT_STARTED | IN_PROGRESS | SUBMITTED
    updated_at: datetime | None
    methodology_version: int | None  # версія методології, за якою подано етап (D-25)
    question_count: int
    can_edit: bool  # анкета після подання
    can_retake: bool  # опитувальник / інтерв'ю після подання


class CandidateAssessmentOut(BaseModel):
    id: int
    stage: AssessmentStage
    methodology_title: str
    allow_rerecord: bool
    max_record_attempts: int
    profile_fields: list[ProfileFieldOut]
    profile_answers: dict[int, str]
    quiz_questions: list[QuizQuestionOut]
    quiz_answers: dict[int, Any]
    interview_questions: list[InterviewQuestionOut]
    voice: list[VoiceStatusOut]
    # у методології є питання для рекомендаторів — кандидату показуємо етап «Рекомендації»
    recommendations_enabled: bool = False
    methodology_version: int = 1
    # запис не вдалося обробити: кандидат може перезаписати інтерв'ю (технічні подробиці бачить лише методист)
    processing_problem: bool = False
    stages: list[StageOut] = []
