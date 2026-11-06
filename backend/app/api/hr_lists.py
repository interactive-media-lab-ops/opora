"""Власні списки кандидатів HR: створення, перейменування, наповнення, експорт у Excel."""

from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.results import HR_ROLES
from app.db import get_db
from app.deps import require_roles
from app.models import Assessment, HRList, HRListItem, User
from app.schemas.results import HRListDetailOut, HRListIn, HRListOut
from app.services.candidate_views import row_options, row_out
from app.services.export import build_list_workbook, safe_filename

router = APIRouter(prefix="/hr/lists", tags=["hr-lists"])

DEFAULT_LIST_NAME = "Обрані"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _out(lst: HRList) -> HRListOut:
    return HRListOut(
        id=lst.id,
        name=lst.name,
        is_default=lst.is_default,
        assessment_ids=sorted(i.assessment_id for i in lst.items),
    )


async def _ensure_default(db: AsyncSession, user: User) -> None:
    exists = await db.scalar(
        select(HRList.id).where(HRList.owner_id == user.id, HRList.is_default.is_(True))
    )
    if exists is None:
        db.add(HRList(owner_id=user.id, name=DEFAULT_LIST_NAME, is_default=True))
        await db.commit()


async def _own_list(db: AsyncSession, user: User, list_id: int) -> HRList:
    lst = (
        await db.execute(
            select(HRList)
            .where(HRList.id == list_id, HRList.owner_id == user.id)
            .options(selectinload(HRList.items))
        )
    ).scalar_one_or_none()
    if lst is None:  # чужий список виглядає як відсутній
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Список не знайдено")
    return lst


async def _name_taken(
    db: AsyncSession, user: User, name: str, exclude_id: int | None = None
) -> bool:
    # порівнюємо в Python: lower() у SQL залежить від СУБД і колації й не завжди розуміє кирилицю
    rows = (
        await db.execute(select(HRList.id, HRList.name).where(HRList.owner_id == user.id))
    ).all()
    return any(i != exclude_id and n.casefold() == name.casefold() for i, n in rows)


@router.get("", response_model=list[HRListOut])
async def my_lists(
    db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(*HR_ROLES))
):
    await _ensure_default(db, user)
    lists = (
        (
            await db.execute(
                select(HRList)
                .where(HRList.owner_id == user.id)
                .options(selectinload(HRList.items))
                .order_by(HRList.is_default.desc(), HRList.created_at, HRList.id)
            )
        )
        .scalars()
        .all()
    )
    return [_out(lst) for lst in lists]


@router.post("", response_model=HRListOut, status_code=status.HTTP_201_CREATED)
async def create_list(
    body: HRListIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*HR_ROLES)),
):
    if await _name_taken(db, user, body.name):
        raise HTTPException(status.HTTP_409_CONFLICT, "Список із такою назвою вже є") from None
    lst = HRList(owner_id=user.id, name=body.name)
    db.add(lst)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Список із такою назвою вже є") from None
    return HRListOut(id=lst.id, name=lst.name, is_default=False, assessment_ids=[])


@router.patch("/{list_id}", response_model=HRListOut)
async def rename_list(
    list_id: int,
    body: HRListIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*HR_ROLES)),
):
    lst = await _own_list(db, user, list_id)
    if lst.is_default:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Список за замовчуванням не можна перейменувати"
        )
    if await _name_taken(db, user, body.name, exclude_id=lst.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Список із такою назвою вже є") from None
    lst.name = body.name
    await db.commit()
    return _out(lst)


@router.delete("/{list_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_list(
    list_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(*HR_ROLES))
):
    lst = await _own_list(db, user, list_id)
    if lst.is_default:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Список за замовчуванням не можна видалити"
        )
    await db.delete(lst)
    await db.commit()


async def _rows(db: AsyncSession, lst: HRList):
    assessments = (
        (
            await db.execute(
                select(Assessment)
                .join(HRListItem, HRListItem.assessment_id == Assessment.id)
                .where(HRListItem.list_id == lst.id, Assessment.submitted_at.is_not(None))
                .order_by(HRListItem.added_at.desc(), Assessment.id.desc())
                .options(*row_options())
            )
        )
        .scalars()
        .all()
    )
    return [row_out(a, False) for a in assessments]


@router.get("/{list_id}", response_model=HRListDetailOut)
async def list_detail(
    list_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(*HR_ROLES))
):
    lst = await _own_list(db, user, list_id)
    return HRListDetailOut(
        id=lst.id, name=lst.name, is_default=lst.is_default, rows=await _rows(db, lst)
    )


@router.put("/{list_id}/items/{assessment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def add_item(
    list_id: int,
    assessment_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*HR_ROLES)),
):
    lst = await _own_list(db, user, list_id)
    assessment = await db.get(Assessment, assessment_id)
    if assessment is None or assessment.submitted_at is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Кандидата не знайдено")
    if any(i.assessment_id == assessment_id for i in lst.items):
        return Response(status_code=status.HTTP_204_NO_CONTENT)  # ідемпотентно
    db.add(HRListItem(list_id=lst.id, assessment_id=assessment_id))
    try:
        await db.commit()
    except IntegrityError:  # паралельний запит уже додав
        await db.rollback()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{list_id}/items/{assessment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_item(
    list_id: int,
    assessment_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*HR_ROLES)),
):
    lst = await _own_list(db, user, list_id)
    item = await db.get(HRListItem, (lst.id, assessment_id))
    if item is not None:
        await db.delete(item)
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{list_id}/export")
async def export_list(
    list_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(*HR_ROLES))
):
    lst = await _own_list(db, user, list_id)
    content = build_list_workbook(lst.name, await _rows(db, lst))
    filename = safe_filename(lst.name)
    return Response(
        content=content,
        media_type=XLSX,
        headers={
            "Content-Disposition": f"attachment; filename=\"list.xlsx\"; filename*=UTF-8''{quote(filename)}"
        },
    )
