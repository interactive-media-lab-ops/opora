"""Запити на видалення персональних даних."""

import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class DeletionRequestStatus(str, enum.Enum):
    NEW = "NEW"
    DONE = "DONE"


class DeletionRequest(Base):
    """Запит на видалення акаунта (D-57). Дані не видаляються автоматично: запит обробляє адміністратор."""

    __tablename__ = "deletion_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[DeletionRequestStatus] = mapped_column(
        Enum(DeletionRequestStatus, name="deletion_request_status"),
        default=DeletionRequestStatus.NEW,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    processed_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    user = relationship("User", foreign_keys=[user_id])
    processed_by = relationship("User", foreign_keys=[processed_by_id])
