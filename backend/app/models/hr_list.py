"""Власні списки кандидатів HR."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class HRList(Base):
    """Список обраних кандидатів. Свій у кожного HR (D-14, D-38); один список за замовчуванням."""

    __tablename__ = "hr_lists"
    __table_args__ = (UniqueConstraint("owner_id", "name", name="uq_hr_list_owner_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    items: Mapped[list["HRListItem"]] = relationship(
        back_populates="list", cascade="all, delete-orphan"
    )


class HRListItem(Base):
    __tablename__ = "hr_list_items"

    list_id: Mapped[int] = mapped_column(
        ForeignKey("hr_lists.id", ondelete="CASCADE"), primary_key=True
    )
    assessment_id: Mapped[int] = mapped_column(
        ForeignKey("assessments.id", ondelete="CASCADE"), primary_key=True
    )
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    list: Mapped[HRList] = relationship(back_populates="items")
