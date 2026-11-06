"""Журнал дій користувачів (аудит)."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.methodology import JSON_TYPE


class AuditLog(Base):
    """Журнал дій користувачів (інваріант «логуємо кожну дію», D-38): хто, що й над яким проходженням. Записи не змінюються."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(48))  # напр. CANDIDATE_PDF_EXPORT
    assessment_id: Mapped[int | None] = mapped_column(
        ForeignKey("assessments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    details: Mapped[dict | list | None] = mapped_column(JSON_TYPE, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
