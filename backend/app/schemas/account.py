"""Схеми кабінету: запити на видалення даних."""

from datetime import datetime

from pydantic import BaseModel

from app.models import DeletionRequestStatus, UserRole


class DeletionRequestOut(BaseModel):
    id: int
    status: DeletionRequestStatus
    created_at: datetime
    processed_at: datetime | None


class AdminDeletionRequestOut(DeletionRequestOut):
    user_id: int
    user_name: str
    user_email: str
    user_role: UserRole
    user_is_active: bool
    processed_by_name: str | None
