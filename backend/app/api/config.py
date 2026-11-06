"""Публічна конфігурація для фронтенду (без секретів)."""

from fastapi import APIRouter
from pydantic import BaseModel

from app.config import get_settings

router = APIRouter(prefix="/config", tags=["config"])


class PublicConfigOut(BaseModel):
    support_contact: str | None = None


@router.get("", response_model=PublicConfigOut)
async def public_config():
    """Публічна конфігурація без входу (потрібна й на екрані входу): контакт техпідтримки (BR-16)."""
    return PublicConfigOut(support_contact=get_settings().support_email.strip() or None)
