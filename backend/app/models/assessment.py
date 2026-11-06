"""Проходження кандидата: відповіді анкети й опитувальника, голосові відповіді, результати аналізу, журнал подій."""

import enum
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.methodology import JSON_TYPE

if TYPE_CHECKING:
    from app.models.recommendation import RecommendationLink


class AssessmentStage(str, enum.Enum):
    """Загальний стан оцінювання. Етапи кандидата незалежні (D-50), їхні стани — у *_submitted_at.

    У БД тип assessment_stage ще містить застарілі PROFILE / QUIZ / INTERVIEW (міграція перевела їх в IN_PROGRESS).
    """

    IN_PROGRESS = "IN_PROGRESS"  # є не подані етапи
    PROCESSING = "PROCESSING"  # усі етапи подано, триває транскрипція / аналіз
    DONE = "DONE"


class Verdict(str, enum.Enum):
    IN_REVIEW = "IN_REVIEW"
    RECOMMENDED = "RECOMMENDED"
    REJECTED = "REJECTED"


class TranscriptStatus(str, enum.Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    DONE = "DONE"
    FAILED = "FAILED"


class AnalysisStatus(str, enum.Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    DONE = "DONE"
    FAILED = "FAILED"


class Assessment(Base):
    __tablename__ = "assessments"
    __table_args__ = (
        UniqueConstraint("candidate_id", "methodology_id", name="uq_assessment_candidate"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    candidate_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    methodology_id: Mapped[int] = mapped_column(ForeignKey("methodologies.id"), index=True)
    stage: Mapped[AssessmentStage] = mapped_column(
        Enum(AssessmentStage, name="assessment_stage"), default=AssessmentStage.IN_PROGRESS
    )
    # коли подано всі етапи вперше (з цього моменту кандидат видимий HR)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # стан кожного етапу: подано коли й за якою версією методології (D-25)
    profile_submitted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    quiz_submitted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    interview_submitted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    profile_version: Mapped[int | None] = mapped_column(nullable=True)
    quiz_version: Mapped[int | None] = mapped_column(nullable=True)
    interview_version: Mapped[int | None] = mapped_column(nullable=True)
    verdict: Mapped[Verdict | None] = mapped_column(Enum(Verdict, name="verdict"), nullable=True)
    verdict_note: Mapped[str] = mapped_column(Text, default="")
    verdict_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    candidate = relationship("User", foreign_keys=[candidate_id])
    methodology = relationship("Methodology")
    profile_answers: Mapped[list["ProfileAnswer"]] = relationship(
        back_populates="assessment", cascade="all, delete-orphan"
    )
    quiz_answers: Mapped[list["QuizAnswer"]] = relationship(
        back_populates="assessment", cascade="all, delete-orphan"
    )
    voice_answers: Mapped[list["VoiceAnswer"]] = relationship(
        back_populates="assessment", cascade="all, delete-orphan"
    )
    results: Mapped[list["AnalysisResult"]] = relationship(
        back_populates="assessment", cascade="all, delete-orphan"
    )
    recommendation_links: Mapped[list["RecommendationLink"]] = relationship(
        order_by="RecommendationLink.slot", cascade="all, delete-orphan", passive_deletes=True
    )
    events: Mapped[list["AssessmentEvent"]] = relationship(
        order_by="AssessmentEvent.id.desc()", cascade="all, delete-orphan", passive_deletes=True
    )
    verdict_changes: Mapped[list["VerdictChange"]] = relationship(
        order_by="VerdictChange.id.desc()", cascade="all, delete-orphan", passive_deletes=True
    )


class AssessmentEvent(Base):
    """Журнал подій проходження (D-56): подання етапів, повторні проходження зі знімком попередньої спроби,
    скидання спроб запису, перезапуск аналізу. Бачить лише HR / методист."""

    __tablename__ = "assessment_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    assessment_id: Mapped[int] = mapped_column(
        ForeignKey("assessments.id", ondelete="CASCADE"), index=True
    )
    # STAGE_SUBMITTED | STAGE_UPDATED | STAGE_RETAKEN | ANALYSIS_RESTARTED
    kind: Mapped[str] = mapped_column(String(32))
    stage: Mapped[str | None] = mapped_column(
        String(16), nullable=True
    )  # PROFILE | QUIZ | INTERVIEW
    methodology_version: Mapped[int | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    details: Mapped[dict | list | None] = mapped_column(JSON_TYPE, nullable=True)


class VerdictChange(Base):
    """Журнал змін вердикту й нотатки HR (D-56): кожне збереження, що щось змінило. Бачить лише HR."""

    __tablename__ = "verdict_changes"

    id: Mapped[int] = mapped_column(primary_key=True)
    assessment_id: Mapped[int] = mapped_column(
        ForeignKey("assessments.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    old_verdict: Mapped[Verdict | None] = mapped_column(
        Enum(Verdict, name="verdict"), nullable=True
    )
    new_verdict: Mapped[Verdict | None] = mapped_column(
        Enum(Verdict, name="verdict"), nullable=True
    )
    old_note: Mapped[str] = mapped_column(Text, default="")
    new_note: Mapped[str] = mapped_column(Text, default="")

    author = relationship("User", foreign_keys=[author_id])


class ProfileAnswer(Base):
    __tablename__ = "profile_answers"
    __table_args__ = (
        UniqueConstraint("assessment_id", "profile_field_id", name="uq_profile_answer"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    assessment_id: Mapped[int] = mapped_column(ForeignKey("assessments.id", ondelete="CASCADE"))
    profile_field_id: Mapped[int] = mapped_column(ForeignKey("profile_fields.id"))
    value: Mapped[str] = mapped_column(Text, default="")

    assessment: Mapped[Assessment] = relationship(back_populates="profile_answers")
    field = relationship("ProfileField")


class QuizAnswer(Base):
    __tablename__ = "quiz_answers"
    __table_args__ = (UniqueConstraint("assessment_id", "quiz_question_id", name="uq_quiz_answer"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    assessment_id: Mapped[int] = mapped_column(ForeignKey("assessments.id", ondelete="CASCADE"))
    quiz_question_id: Mapped[int] = mapped_column(ForeignKey("quiz_questions.id"))
    value: Mapped[dict | list | str | int | None] = mapped_column(JSON_TYPE, nullable=True)

    assessment: Mapped[Assessment] = relationship(back_populates="quiz_answers")
    question = relationship("QuizQuestion")


class VoiceAnswer(Base):
    __tablename__ = "voice_answers"
    __table_args__ = (
        UniqueConstraint("assessment_id", "interview_question_id", name="uq_voice_answer"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    assessment_id: Mapped[int] = mapped_column(ForeignKey("assessments.id", ondelete="CASCADE"))
    interview_question_id: Mapped[int] = mapped_column(ForeignKey("interview_questions.id"))
    # VOICE — запис із транскриптом; TEXT — текстова відповідь (лежить у transcript, аудіо немає)
    kind: Mapped[str] = mapped_column(String(8), default="VOICE", server_default="VOICE")
    audio_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    duration_sec: Mapped[float] = mapped_column(Float, default=0)
    # скільки голосових записів уже використано (текст спроб не витрачає)
    attempts_used: Mapped[int] = mapped_column(Integer, default=1)
    # ключ ідемпотентності з клієнтської черги: повторна відправка того самого запиту не витрачає спробу
    client_request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    transcript: Mapped[str] = mapped_column(Text, default="")
    transcript_status: Mapped[TranscriptStatus] = mapped_column(
        Enum(TranscriptStatus, name="transcript_status"), default=TranscriptStatus.PENDING
    )
    transcript_error: Mapped[str] = mapped_column(Text, default="")

    assessment: Mapped[Assessment] = relationship(back_populates="voice_answers")
    question = relationship("InterviewQuestion")


class AnalysisResult(Base):
    __tablename__ = "analysis_results"
    __table_args__ = (
        UniqueConstraint("assessment_id", "prompt_node_id", name="uq_analysis_result"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    assessment_id: Mapped[int] = mapped_column(ForeignKey("assessments.id", ondelete="CASCADE"))
    prompt_node_id: Mapped[int] = mapped_column(ForeignKey("prompt_nodes.id", ondelete="CASCADE"))
    output: Mapped[str] = mapped_column(Text, default="")
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    model: Mapped[str] = mapped_column(String(100), default="")
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[AnalysisStatus] = mapped_column(
        Enum(AnalysisStatus, name="analysis_status"), default=AnalysisStatus.PENDING
    )
    error: Mapped[str] = mapped_column(Text, default="")
    is_terminal: Mapped[bool] = mapped_column(default=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    assessment: Mapped[Assessment] = relationship(back_populates="results")
    node = relationship("PromptNode")
