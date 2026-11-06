"""Нотатки HR до кандидата (BR-6): у кожного HR свої, чужі не видно."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.results import HR_ROLES
from app.db import get_db
from app.deps import require_roles
from app.models import Assessment, HRNote, User
from app.schemas.results import HRNoteIn, HRNoteOut

router = APIRouter(prefix="/hr/candidates/{assessment_id}/notes", tags=["hr"])


def _note_out(note: HRNote, author_name: str) -> HRNoteOut:
    return HRNoteOut(
        id=note.id,
        author_id=note.author_id,
        author_name=author_name,
        text=note.text,
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


async def _require_assessment(db: AsyncSession, assessment_id: int) -> None:
    if await db.scalar(select(Assessment.id).where(Assessment.id == assessment_id)) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Кандидата не знайдено")


async def _own_note(db: AsyncSession, assessment_id: int, note_id: int, user: User) -> HRNote:
    note = await db.scalar(
        select(HRNote).where(
            HRNote.id == note_id,
            HRNote.assessment_id == assessment_id,
            HRNote.author_id == user.id,
        )
    )
    if note is None:  # чужа нотатка виглядає як відсутня
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Нотатку не знайдено")
    return note


@router.get("", response_model=list[HRNoteOut])
async def list_notes(
    assessment_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*HR_ROLES)),
):
    await _require_assessment(db, assessment_id)
    notes = (
        await db.execute(
            select(HRNote)
            .where(HRNote.assessment_id == assessment_id, HRNote.author_id == user.id)
            .order_by(HRNote.updated_at.desc(), HRNote.id.desc())
        )
    ).scalars()
    return [_note_out(n, user.name) for n in notes]


@router.post("", response_model=HRNoteOut, status_code=status.HTTP_201_CREATED)
async def create_note(
    assessment_id: int,
    data: HRNoteIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*HR_ROLES)),
):
    await _require_assessment(db, assessment_id)
    now = datetime.now(UTC)
    note = HRNote(
        assessment_id=assessment_id,
        author_id=user.id,
        text=data.text,
        created_at=now,
        updated_at=now,
    )
    db.add(note)
    await db.commit()
    await db.refresh(note)
    return _note_out(note, user.name)


@router.put("/{note_id}", response_model=HRNoteOut)
async def update_note(
    assessment_id: int,
    note_id: int,
    data: HRNoteIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*HR_ROLES)),
):
    note = await _own_note(db, assessment_id, note_id, user)
    note.text = data.text
    note.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(note)
    return _note_out(note, user.name)


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note(
    assessment_id: int,
    note_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*HR_ROLES)),
):
    note = await _own_note(db, assessment_id, note_id, user)
    await db.delete(note)
    await db.commit()
