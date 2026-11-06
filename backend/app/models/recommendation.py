"""Рекомендації: питання, посилання для рекомендаторів, надіслані відповіді."""

import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class RecommendationRole(str, enum.Enum):
    """Ролі рекомендатора (конфігурація КС: D-28, D-32). Вільного «Інше» немає."""

    MANAGER = "MANAGER"
    COLLEAGUE = "COLLEAGUE"
    SUBORDINATE = "SUBORDINATE"


class RecommendationLinkStatus(str, enum.Enum):
    PENDING = "PENDING"
    SUBMITTED = "SUBMITTED"
    DECLINED = (
        "DECLINED"  # «Недостатньо знаю людину»: HR не бачить (D-45), кандидату — «використано»
    )


class RecommendationQuestion(Base):
    __tablename__ = "recommendation_questions"

    id: Mapped[int] = mapped_column(primary_key=True)
    methodology_id: Mapped[int] = mapped_column(ForeignKey("methodologies.id", ondelete="CASCADE"))
    text: Mapped[str] = mapped_column(Text)
    hint: Mapped[str] = mapped_column(Text, default="")
    order: Mapped[int] = mapped_column(Integer, default=0)
    # BR-15 (Q-8): обов'язковість і ліміт знаків задає методологія
    required: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    max_length: Mapped[int | None] = mapped_column(Integer, nullable=True)

    methodology = relationship("Methodology", back_populates="recommendation_questions")


class RecommendationLink(Base):
    """Одноразове посилання рекомендатора (4 слоти на проходження, D-05). Токен — єдиний «ключ» доступу."""

    __tablename__ = "recommendation_links"
    __table_args__ = (UniqueConstraint("assessment_id", "slot", name="uq_recommendation_slot"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    assessment_id: Mapped[int] = mapped_column(
        ForeignKey("assessments.id", ondelete="CASCADE"), index=True
    )
    slot: Mapped[int] = mapped_column(Integer)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    status: Mapped[RecommendationLinkStatus] = mapped_column(
        Enum(RecommendationLinkStatus, name="recommendation_link_status"),
        default=RecommendationLinkStatus.PENDING,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    recommendation: Mapped["Recommendation | None"] = relationship(
        back_populates="link", uselist=False, cascade="all, delete-orphan"
    )


class Recommendation(Base):
    """Відгук. Навмисно без імені, IP і часу відправлення — лише роль і відповіді (D-17)."""

    __tablename__ = "recommendations"

    id: Mapped[int] = mapped_column(primary_key=True)
    link_id: Mapped[int] = mapped_column(
        ForeignKey("recommendation_links.id", ondelete="CASCADE"), unique=True
    )
    role: Mapped[RecommendationRole] = mapped_column(
        Enum(RecommendationRole, name="recommendation_role")
    )

    link: Mapped[RecommendationLink] = relationship(back_populates="recommendation")
    answers: Mapped[list["RecommendationAnswer"]] = relationship(
        back_populates="recommendation",
        order_by="RecommendationAnswer.order",
        cascade="all, delete-orphan",
    )


class RecommendationAnswer(Base):
    __tablename__ = "recommendation_answers"

    id: Mapped[int] = mapped_column(primary_key=True)
    recommendation_id: Mapped[int] = mapped_column(
        ForeignKey("recommendations.id", ondelete="CASCADE"), index=True
    )
    # питання могли замінити (методологію повертають у чернетку), тому текст зберігаємо зі знімка
    question_id: Mapped[int | None] = mapped_column(
        ForeignKey("recommendation_questions.id", ondelete="SET NULL"), nullable=True
    )
    question_text: Mapped[str] = mapped_column(Text)
    order: Mapped[int] = mapped_column(Integer, default=0)
    text: Mapped[str] = mapped_column(Text)

    recommendation: Mapped[Recommendation] = relationship(back_populates="answers")
