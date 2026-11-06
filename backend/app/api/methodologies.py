"""Методист: методології (анкета, опитувальник, інтерв'ю, граф промтів) і запрошення кандидатів."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.db import get_db
from app.deps import require_roles
from app.models import (
    Assessment,
    InterviewQuestion,
    Methodology,
    MethodologyStatus,
    PersonalInvite,
    ProfileField,
    PromptEdge,
    PromptNode,
    QuizQuestion,
    RecommendationQuestion,
    User,
    UserRole,
)
from app.schemas.methodology import (
    GraphIn,
    GraphOut,
    InterviewQuestionIn,
    InterviewQuestionOut,
    InviteLinksOut,
    MethodologyCreateIn,
    MethodologyListOut,
    MethodologyOut,
    MethodologyUpdateIn,
    PersonalInviteIn,
    PersonalInviteOut,
    ProfileFieldIn,
    ProfileFieldOut,
    QuizQuestionIn,
    QuizQuestionOut,
    RecommendationQuestionIn,
    RecommendationQuestionOut,
)
from app.security import generate_code
from app.services.graph import GraphError, validate_dag

settings = get_settings()

METHODOLOGIST_ROLES = (UserRole.METHODOLOGIST, UserRole.ADMIN)

router = APIRouter(prefix="/methodologies", tags=["methodologies"])
invites_router = APIRouter(prefix="/invites", tags=["invites"])


async def _load(db: AsyncSession, methodology_id: int) -> Methodology:
    methodology = (
        await db.execute(
            select(Methodology)
            .where(Methodology.id == methodology_id)
            .options(
                selectinload(Methodology.profile_fields),
                selectinload(Methodology.quiz_questions),
                selectinload(Methodology.interview_questions),
                selectinload(Methodology.recommendation_questions),
            )
        )
    ).scalar_one_or_none()
    if methodology is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Методологію не знайдено")
    return methodology


def _require_draft(methodology: Methodology) -> None:
    if methodology.status != MethodologyStatus.DRAFT:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Питання й поля анкети можна змінювати лише в чернетці — після активації вони зафіксовані",
        )


# ---------- Методології ----------


@router.get("", response_model=list[MethodologyListOut])
async def list_methodologies(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*METHODOLOGIST_ROLES, UserRole.HR)),
):
    query = select(Methodology).order_by(Methodology.id.desc())
    if user.role == UserRole.HR:
        query = query.where(Methodology.status == MethodologyStatus.ACTIVE)
    return (await db.execute(query)).scalars().all()


@router.post("", response_model=MethodologyOut, status_code=status.HTTP_201_CREATED)
async def create_methodology(
    data: MethodologyCreateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*METHODOLOGIST_ROLES)),
):
    methodology = Methodology(
        **data.model_dump(), invite_code=generate_code(), created_by_id=user.id
    )
    db.add(methodology)
    await db.commit()
    return await _load(db, methodology.id)


@router.get("/{methodology_id}", response_model=MethodologyOut)
async def get_methodology(
    methodology_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*METHODOLOGIST_ROLES, UserRole.HR)),
):
    methodology = await _load(db, methodology_id)
    if user.role == UserRole.HR and methodology.status != MethodologyStatus.ACTIVE:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Методологію не знайдено")
    return methodology


@router.patch("/{methodology_id}", response_model=MethodologyOut)
async def update_methodology(
    methodology_id: int,
    data: MethodologyUpdateIn,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*METHODOLOGIST_ROLES)),
):
    methodology = await _load(db, methodology_id)
    changes = data.model_dump(exclude_unset=True)

    new_status = changes.get("status")
    if new_status is not None and new_status != methodology.status:
        if new_status == MethodologyStatus.ACTIVE:
            problems = []
            if not methodology.profile_fields:
                problems.append("додайте хоча б одне поле анкети")
            if not methodology.quiz_questions and not methodology.interview_questions:
                problems.append("додайте питання опитувальника або інтерв'ю")
            node_count = await db.scalar(
                select(func.count())
                .select_from(PromptNode)
                .where(PromptNode.methodology_id == methodology_id)
            )
            if not node_count:
                problems.append("додайте хоча б один промт на канвасі")
            if problems:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    "Неможливо активувати методологію: " + "; ".join(problems),
                )
        elif new_status == MethodologyStatus.DRAFT:
            has_assessments = await db.scalar(
                select(func.count())
                .select_from(Assessment)
                .where(Assessment.methodology_id == methodology_id)
            )
            if has_assessments:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "Не можна повернути в чернетку методологію, яку вже проходять кандидати",
                )
            methodology.version += 1  # нова редакція питань = нова версія (D-25)

    for key, value in changes.items():
        setattr(methodology, key, value)
    await db.commit()
    return await _load(db, methodology_id)


@router.delete("/{methodology_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_methodology(
    methodology_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*METHODOLOGIST_ROLES)),
):
    methodology = await _load(db, methodology_id)
    has_assessments = await db.scalar(
        select(func.count())
        .select_from(Assessment)
        .where(Assessment.methodology_id == methodology_id)
    )
    if has_assessments:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Є кандидати, що проходили цю методологію — заархівуйте її замість видалення",
        )
    await db.delete(methodology)
    await db.commit()


# ---------- Конструктори (заміна всього списку; лише в чернетці) ----------


@router.put("/{methodology_id}/profile-fields", response_model=list[ProfileFieldOut])
async def replace_profile_fields(
    methodology_id: int,
    data: list[ProfileFieldIn],
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*METHODOLOGIST_ROLES)),
):
    methodology = await _load(db, methodology_id)
    _require_draft(methodology)
    methodology.profile_fields = [
        ProfileField(order=i, **item.model_dump()) for i, item in enumerate(data)
    ]
    await db.commit()
    return (await _load(db, methodology_id)).profile_fields


@router.put("/{methodology_id}/quiz-questions", response_model=list[QuizQuestionOut])
async def replace_quiz_questions(
    methodology_id: int,
    data: list[QuizQuestionIn],
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*METHODOLOGIST_ROLES)),
):
    methodology = await _load(db, methodology_id)
    _require_draft(methodology)
    methodology.quiz_questions = [
        QuizQuestion(order=i, **item.model_dump()) for i, item in enumerate(data)
    ]
    await db.commit()
    return (await _load(db, methodology_id)).quiz_questions


@router.put("/{methodology_id}/interview-questions", response_model=list[InterviewQuestionOut])
async def replace_interview_questions(
    methodology_id: int,
    data: list[InterviewQuestionIn],
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*METHODOLOGIST_ROLES)),
):
    methodology = await _load(db, methodology_id)
    _require_draft(methodology)
    methodology.interview_questions = [
        InterviewQuestion(order=i, **item.model_dump()) for i, item in enumerate(data)
    ]
    await db.commit()
    return (await _load(db, methodology_id)).interview_questions


@router.put(
    "/{methodology_id}/recommendation-questions", response_model=list[RecommendationQuestionOut]
)
async def replace_recommendation_questions(
    methodology_id: int,
    data: list[RecommendationQuestionIn],
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*METHODOLOGIST_ROLES)),
):
    methodology = await _load(db, methodology_id)
    _require_draft(methodology)
    methodology.recommendation_questions = [
        RecommendationQuestion(order=i, **item.model_dump()) for i, item in enumerate(data)
    ]
    await db.commit()
    return (await _load(db, methodology_id)).recommendation_questions


# ---------- Граф промтів (редагується в будь-який момент) ----------


async def _graph(db: AsyncSession, methodology_id: int) -> GraphOut:
    nodes = (
        (
            await db.execute(
                select(PromptNode)
                .where(PromptNode.methodology_id == methodology_id)
                .order_by(PromptNode.id)
            )
        )
        .scalars()
        .all()
    )
    edges = (
        (
            await db.execute(
                select(PromptEdge)
                .where(PromptEdge.methodology_id == methodology_id)
                .order_by(PromptEdge.id)
            )
        )
        .scalars()
        .all()
    )
    return GraphOut(nodes=nodes, edges=edges)


@router.get("/{methodology_id}/graph", response_model=GraphOut)
async def get_graph(
    methodology_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*METHODOLOGIST_ROLES)),
):
    await _load(db, methodology_id)
    return await _graph(db, methodology_id)


@router.put("/{methodology_id}/graph", response_model=GraphOut)
async def save_graph(
    methodology_id: int,
    data: GraphIn,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*METHODOLOGIST_ROLES)),
):
    await _load(db, methodology_id)

    keys = [n.key for n in data.nodes]
    if len(set(keys)) != len(keys):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Ключі вузлів мають бути унікальними"
        )
    try:
        validate_dag(keys, [(e.source, e.target) for e in data.edges])
    except GraphError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc

    existing = {
        n.id: n
        for n in (
            await db.execute(select(PromptNode).where(PromptNode.methodology_id == methodology_id))
        ).scalars()
    }
    kept_ids: set[int] = set()
    key_to_node: dict[str, PromptNode] = {}

    for item in data.nodes:
        fields = dict(
            name=item.name,
            prompt_text=item.prompt_text,
            returns_score=item.returns_score,
            axis=item.axis,
            source=item.source,
            position_x=item.position_x,
            position_y=item.position_y,
        )
        if item.id is not None:
            node = existing.get(item.id)
            if node is None:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    f"Вузол {item.id} не належить цій методології",
                )
            for k, v in fields.items():
                setattr(node, k, v)
            kept_ids.add(node.id)
        else:
            node = PromptNode(methodology_id=methodology_id, **fields)
            db.add(node)
        key_to_node[item.key] = node

    for node_id, node in existing.items():
        if node_id not in kept_ids:
            await db.delete(node)
    await db.flush()

    old_edges = (
        (await db.execute(select(PromptEdge).where(PromptEdge.methodology_id == methodology_id)))
        .scalars()
        .all()
    )
    for edge in old_edges:
        await db.delete(edge)
    await db.flush()

    seen: set[tuple[str, str]] = set()
    for e in data.edges:
        if (e.source, e.target) in seen:
            continue
        seen.add((e.source, e.target))
        db.add(
            PromptEdge(
                methodology_id=methodology_id,
                source_node_id=key_to_node[e.source].id,
                target_node_id=key_to_node[e.target].id,
            )
        )
    await db.commit()
    return await _graph(db, methodology_id)


# ---------- Запрошення (HR, методист, адмін) ----------

INVITE_ROLES = (UserRole.HR, *METHODOLOGIST_ROLES)


@router.get("/{methodology_id}/invite-link", response_model=InviteLinksOut)
async def invite_link(
    methodology_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*INVITE_ROLES)),
):
    methodology = await _load(db, methodology_id)
    if methodology.status != MethodologyStatus.ACTIVE:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Запрошувати можна лише на активну методологію"
        )
    return InviteLinksOut(general_url=f"{settings.frontend_url}/register/{methodology.invite_code}")


@invites_router.get("", response_model=list[PersonalInviteOut])
async def list_personal_invites(
    methodology_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*INVITE_ROLES)),
):
    query = select(PersonalInvite).order_by(PersonalInvite.id.desc())
    if methodology_id is not None:
        query = query.where(PersonalInvite.methodology_id == methodology_id)
    return (await db.execute(query)).scalars().all()


@invites_router.post("", response_model=PersonalInviteOut, status_code=status.HTTP_201_CREATED)
async def create_personal_invite(
    data: PersonalInviteIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*INVITE_ROLES)),
):
    methodology = await db.get(Methodology, data.methodology_id)
    if methodology is None or methodology.status != MethodologyStatus.ACTIVE:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Активну методологію не знайдено")
    invite = PersonalInvite(
        methodology_id=methodology.id,
        code=generate_code(),
        candidate_email=data.candidate_email.lower(),
        created_by_id=user.id,
    )
    db.add(invite)
    await db.commit()
    return invite
