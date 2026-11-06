"""Методологія: поля анкети, питання опитувальника й інтерв'ю, вузли та ребра графа промтів."""

import enum
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    JSON,
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
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.recommendation import RecommendationQuestion

JSON_TYPE = JSONB().with_variant(JSON(), "sqlite")


class MethodologyStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"


class ProfileFieldType(str, enum.Enum):
    TEXT = "TEXT"
    TEXTAREA = "TEXTAREA"
    DATE = "DATE"
    NUMBER = "NUMBER"
    SELECT = "SELECT"


class QuizQuestionType(str, enum.Enum):
    TEXT = "TEXT"
    SINGLE_CHOICE = "SINGLE_CHOICE"
    MULTI_CHOICE = "MULTI_CHOICE"
    SCALE = "SCALE"


class Methodology(Base):
    __tablename__ = "methodologies"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[MethodologyStatus] = mapped_column(
        Enum(MethodologyStatus, name="methodology_status"), default=MethodologyStatus.DRAFT
    )
    invite_code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    allow_rerecord: Mapped[bool] = mapped_column(default=True)
    max_record_attempts: Mapped[int] = mapped_column(Integer, default=3)
    # v1 → збільшується щоразу, коли методологію повертають у чернетку для зміни питань (D-25)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    # BR-4 (D-73): назви етапів задає методолог; порожньо — типова назва («Анкета» / «Опитувальник» / «Розмова»)
    profile_title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    quiz_title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    interview_title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    profile_fields: Mapped[list["ProfileField"]] = relationship(
        back_populates="methodology", order_by="ProfileField.order", cascade="all, delete-orphan"
    )
    quiz_questions: Mapped[list["QuizQuestion"]] = relationship(
        back_populates="methodology", order_by="QuizQuestion.order", cascade="all, delete-orphan"
    )
    interview_questions: Mapped[list["InterviewQuestion"]] = relationship(
        back_populates="methodology",
        order_by="InterviewQuestion.order",
        cascade="all, delete-orphan",
    )
    recommendation_questions: Mapped[list["RecommendationQuestion"]] = relationship(
        back_populates="methodology",
        order_by="RecommendationQuestion.order",
        cascade="all, delete-orphan",
    )
    prompt_nodes: Mapped[list["PromptNode"]] = relationship(
        back_populates="methodology", cascade="all, delete-orphan"
    )
    prompt_edges: Mapped[list["PromptEdge"]] = relationship(
        back_populates="methodology", cascade="all, delete-orphan"
    )


class PersonalInvite(Base):
    __tablename__ = "personal_invites"

    id: Mapped[int] = mapped_column(primary_key=True)
    methodology_id: Mapped[int] = mapped_column(ForeignKey("methodologies.id", ondelete="CASCADE"))
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    candidate_email: Mapped[str] = mapped_column(String(255))
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ProfileField(Base):
    __tablename__ = "profile_fields"

    id: Mapped[int] = mapped_column(primary_key=True)
    methodology_id: Mapped[int] = mapped_column(ForeignKey("methodologies.id", ondelete="CASCADE"))
    label: Mapped[str] = mapped_column(String(255))
    type: Mapped[ProfileFieldType] = mapped_column(
        Enum(ProfileFieldType, name="profile_field_type")
    )
    options: Mapped[list | None] = mapped_column(JSON_TYPE, nullable=True)
    required: Mapped[bool] = mapped_column(default=False)
    order: Mapped[int] = mapped_column(Integer, default=0)

    methodology: Mapped[Methodology] = relationship(back_populates="profile_fields")


class QuizQuestion(Base):
    __tablename__ = "quiz_questions"

    id: Mapped[int] = mapped_column(primary_key=True)
    methodology_id: Mapped[int] = mapped_column(ForeignKey("methodologies.id", ondelete="CASCADE"))
    text: Mapped[str] = mapped_column(Text)
    type: Mapped[QuizQuestionType] = mapped_column(
        Enum(QuizQuestionType, name="quiz_question_type")
    )
    options: Mapped[list | None] = mapped_column(JSON_TYPE, nullable=True)
    order: Mapped[int] = mapped_column(Integer, default=0)

    methodology: Mapped[Methodology] = relationship(back_populates="quiz_questions")


class InterviewQuestion(Base):
    __tablename__ = "interview_questions"

    id: Mapped[int] = mapped_column(primary_key=True)
    methodology_id: Mapped[int] = mapped_column(ForeignKey("methodologies.id", ondelete="CASCADE"))
    text: Mapped[str] = mapped_column(Text)
    hint: Mapped[str] = mapped_column(Text, default="")
    max_duration_sec: Mapped[int] = mapped_column(Integer, default=120)
    order: Mapped[int] = mapped_column(Integer, default=0)

    methodology: Mapped[Methodology] = relationship(back_populates="interview_questions")


class PromptNode(Base):
    __tablename__ = "prompt_nodes"

    id: Mapped[int] = mapped_column(primary_key=True)
    methodology_id: Mapped[int] = mapped_column(ForeignKey("methodologies.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255))
    prompt_text: Mapped[str] = mapped_column(Text, default="")
    returns_score: Mapped[bool] = mapped_column(default=False)
    # аналітика (DD-06): якою віссю (принципом) і з якого джерела цей вузол потрапляє на діаграму; обидва або жодного
    axis: Mapped[str | None] = mapped_column(String(80), nullable=True)
    source: Mapped[str | None] = mapped_column(
        String(16), nullable=True
    )  # SELF | CONVERSATION | REVIEWS
    position_x: Mapped[float] = mapped_column(Float, default=0)
    position_y: Mapped[float] = mapped_column(Float, default=0)

    methodology: Mapped[Methodology] = relationship(back_populates="prompt_nodes")


class PromptEdge(Base):
    __tablename__ = "prompt_edges"
    __table_args__ = (UniqueConstraint("source_node_id", "target_node_id", name="uq_prompt_edge"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    methodology_id: Mapped[int] = mapped_column(ForeignKey("methodologies.id", ondelete="CASCADE"))
    source_node_id: Mapped[int] = mapped_column(ForeignKey("prompt_nodes.id", ondelete="CASCADE"))
    target_node_id: Mapped[int] = mapped_column(ForeignKey("prompt_nodes.id", ondelete="CASCADE"))

    methodology: Mapped[Methodology] = relationship(back_populates="prompt_edges")
