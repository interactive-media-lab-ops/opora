"""Віддача аудіозаписів інтерв'ю. Доступ — HR і адмін (D-77: методист записів не чує)."""

import mimetypes
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import require_roles
from app.models import AssessmentEvent, User, UserRole, VoiceAnswer
from app.services.storage import StorageService, get_storage

VIEW_ROLES = (UserRole.HR, UserRole.ADMIN)

router = APIRouter(prefix="/audio", tags=["audio"])


def _file_response(storage: StorageService, relative: str) -> FileResponse:
    """Файл зі сховища або 404, якщо шлях некоректний чи файл зник."""
    try:
        path: Path = storage.path_for(relative)
    except ValueError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Запис не знайдено") from None
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Файл запису відсутній")
    return FileResponse(path, media_type=mimetypes.guess_type(path.name)[0] or "audio/webm")


@router.get("/archive/{event_id}/{index}")
async def get_archived_audio(
    event_id: int,
    index: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*VIEW_ROLES)),
    storage: StorageService = Depends(get_storage),
):
    """Запис із попередньої спроби інтерв'ю (знімок у журналі подій)."""
    event = await db.get(AssessmentEvent, event_id)
    is_interview_retake = (
        event is not None and event.kind == "STAGE_RETAKEN" and event.stage == "INTERVIEW"
    )
    answers = (event.details or {}).get("answers") if is_interview_retake else None
    if not isinstance(answers, list) or not 0 <= index < len(answers):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Запис не знайдено")
    relative = answers[index].get("audio")
    if not isinstance(relative, str) or not relative.startswith("archive/"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Запис не знайдено")
    return _file_response(storage, relative)


@router.get("/{voice_answer_id}")
async def get_audio(
    voice_answer_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*VIEW_ROLES)),
    storage: StorageService = Depends(get_storage),
):
    voice = await db.get(VoiceAnswer, voice_answer_id)
    if voice is None or not voice.audio_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Запис не знайдено")
    return _file_response(storage, voice.audio_path)
