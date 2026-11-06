"""Побудова відповідей API для перегляду кандидатів (HR і методист).

Тут зібрано все, що завантажує проходження (``Assessment``) з усіма зв'язками
й перетворює його на схеми ``app.schemas.results``: рядки списку, базова деталь,
журнал подій, сортування. Роутери в ``app.api.results`` лише викликають ці функції.
"""

from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import (
    AnalysisResult,
    AnalysisStatus,
    Assessment,
    AssessmentStage,
    Methodology,
    Recommendation,
    RecommendationLink,
    TranscriptStatus,
    User,
    Verdict,
    VerdictChange,
)
from app.schemas.results import (
    CandidateRowOut,
    EventOut,
    ProfileItemOut,
    QuizItemOut,
    RowStageOut,
    VoiceItemOut,
)
from app.services import stages

# Старі значення sort — синоніми на період переходу (BR-5).
SORT_ALIASES = {"date": "submitted", "score": "score"}
SORT_KEYS = {"name", "completeness", "updated", "submitted", "score"}


# ---------- Завантаження ----------


def detail_options():
    """Зв'язки, потрібні для повної картки кандидата."""
    return (
        selectinload(Assessment.candidate),
        selectinload(Assessment.methodology).options(
            selectinload(Methodology.profile_fields),
            selectinload(Methodology.quiz_questions),
            selectinload(Methodology.interview_questions),
            selectinload(Methodology.prompt_nodes),
        ),
        selectinload(Assessment.profile_answers),
        selectinload(Assessment.quiz_answers),
        selectinload(Assessment.voice_answers),
        selectinload(Assessment.results).selectinload(AnalysisResult.node),
        selectinload(Assessment.verdict_changes).selectinload(VerdictChange.author),
        selectinload(Assessment.events),
        selectinload(Assessment.recommendation_links)
        .selectinload(RecommendationLink.recommendation)
        .selectinload(Recommendation.answers),
    )


def row_options():
    """Зв'язки, достатні для рядка у списку кандидатів."""
    return (
        selectinload(Assessment.candidate),
        selectinload(Assessment.methodology).options(
            selectinload(Methodology.quiz_questions),
            selectinload(Methodology.interview_questions),
        ),
        selectinload(Assessment.results),
        selectinload(Assessment.voice_answers),
        selectinload(Assessment.profile_answers),
        selectinload(Assessment.quiz_answers),
    )


async def load_assessment(
    db: AsyncSession, assessment_id: int, allow_unsubmitted: bool = False
) -> Assessment:
    """Проходження з усіма зв'язками або 404."""
    query = select(Assessment).where(Assessment.id == assessment_id).options(*detail_options())
    assessment = (await db.execute(query)).scalar_one_or_none()
    if assessment is None or (assessment.submitted_at is None and not allow_unsubmitted):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Кандидата не знайдено")
    return assessment


# ---------- Обчислювані поля ----------


def aware(moment: datetime) -> datetime:
    """SQLite повертає naive datetime — вважаємо його UTC."""
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def summary_score(assessment: Assessment) -> float | None:
    """Середній бал фінальних (термінальних) вузлів графа."""
    scores = [
        r.score
        for r in assessment.results
        if r.is_terminal and r.status == AnalysisStatus.DONE and r.score is not None
    ]
    return round(sum(scores) / len(scores), 1) if scores else None


def failed_steps(assessment: Assessment) -> int:
    """Кількість впалих кроків: вузли аналізу + транскрипції."""
    failed_nodes = sum(1 for r in assessment.results if r.status == AnalysisStatus.FAILED)
    failed_transcripts = sum(
        1 for v in assessment.voice_answers if v.transcript_status == TranscriptStatus.FAILED
    )
    return failed_nodes + failed_transcripts


def updated_at(assessment: Assessment) -> datetime:
    """Остання зміна: найпізніше подання етапу або створення проходження."""
    moments = [stages.submitted_at(assessment, k) for k in stages.KEYS] + [assessment.created_at]
    return max(aware(m) for m in moments if m is not None)


# ---------- Серіалізація ----------


def events_out(assessment: Assessment) -> list[EventOut]:
    return [
        EventOut(
            id=e.id,
            created_at=e.created_at,
            kind=e.kind,
            stage=e.stage,
            methodology_version=e.methodology_version,
            details=e.details,
        )
        for e in assessment.events
    ]


def row_out(assessment: Assessment, with_failures: bool) -> CandidateRowOut:
    keys = stages.required(assessment)
    row_stages = [
        RowStageOut(key=k, title=stages.title(assessment, k), status=stages.status(assessment, k))
        for k in keys
    ]
    done = sum(1 for s in row_stages if s.status == "SUBMITTED")
    return CandidateRowOut(
        stages=row_stages,
        updated_at=updated_at(assessment),
        completeness=round(done / len(row_stages), 2) if row_stages else None,
        id=assessment.id,
        candidate_name=assessment.candidate.name,
        candidate_email=assessment.candidate.email,
        methodology_id=assessment.methodology_id,
        methodology_title=assessment.methodology.title,
        stage=assessment.stage,
        submitted_at=assessment.submitted_at,
        verdict=assessment.verdict,
        summary_score=summary_score(assessment),
        failed_steps=failed_steps(assessment) if with_failures else None,
    )


def base_detail(assessment: Assessment, include_errors: bool) -> dict:
    """Спільна частина картки кандидата для HR і методиста."""
    m = assessment.methodology
    profile = {a.profile_field_id: a.value for a in assessment.profile_answers}
    quiz = {a.quiz_question_id: a.value for a in assessment.quiz_answers}
    voice = {v.interview_question_id: v for v in assessment.voice_answers}
    return dict(
        id=assessment.id,
        candidate_name=assessment.candidate.name,
        candidate_email=assessment.candidate.email,
        methodology_title=m.title,
        stage=assessment.stage,
        submitted_at=assessment.submitted_at,
        profile=[
            ProfileItemOut(label=f.label, value=profile.get(f.id, "")) for f in m.profile_fields
        ],
        quiz=[QuizItemOut(question=q.text, value=quiz.get(q.id)) for q in m.quiz_questions],
        voice=[
            VoiceItemOut(
                voice_answer_id=voice[q.id].id,
                question=q.text,
                kind=voice[q.id].kind,
                duration_sec=voice[q.id].duration_sec,
                transcript=voice[q.id].transcript,
                transcript_status=voice[q.id].transcript_status,
                transcript_error=voice[q.id].transcript_error if include_errors else None,
            )
            for q in m.interview_questions
            if q.id in voice
        ],
        stage_titles={k: stages.title(assessment, k) for k in stages.KEYS},
        summary_score=summary_score(assessment),
        verdict=assessment.verdict,
        verdict_note="",  # BR-6: спільної нотатки більше немає — див. /hr/candidates/:id/notes
    )


# ---------- Список і сортування ----------


async def list_rows(
    db: AsyncSession,
    with_failures: bool,
    methodology_id: int | None,
    stage: AssessmentStage | None,
    verdict: str | None,
    search: str | None,
    sort: str,
    direction: str | None = None,
    include_unsubmitted: bool = False,
) -> list[CandidateRowOut]:
    """Відфільтрований і відсортований список кандидатів."""
    query = (
        select(Assessment).join(User, User.id == Assessment.candidate_id).options(*row_options())
    )
    if not include_unsubmitted:
        query = query.where(Assessment.submitted_at.is_not(None))
    if methodology_id is not None:
        query = query.where(Assessment.methodology_id == methodology_id)
    if stage is not None:
        query = query.where(Assessment.stage == stage)
    if verdict == "NONE":
        query = query.where(Assessment.verdict.is_(None))
    elif verdict:
        try:
            query = query.where(Assessment.verdict == Verdict(verdict))
        except ValueError:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "Невідомий вердикт"
            ) from None
    if search:
        like = f"%{search.strip().lower()}%"
        query = query.where(func.lower(User.name).like(like) | func.lower(User.email).like(like))
    rows = [row_out(a, with_failures) for a in (await db.execute(query)).scalars().all()]
    return sort_rows(rows, sort, direction)


def sort_rows(
    rows: list[CandidateRowOut], sort: str, direction: str | None
) -> list[CandidateRowOut]:
    key = SORT_ALIASES.get(sort, sort)
    if key not in SORT_KEYS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Невідоме сортування")
    if direction not in (None, "asc", "desc"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "dir: asc або desc")
    desc = (direction or ("asc" if key == "name" else "desc")) == "desc"
    epoch = datetime.min.replace(tzinfo=UTC)

    def value(r: CandidateRowOut):
        if key == "name":
            return r.candidate_name.casefold()
        if key == "completeness":
            return r.completeness or 0
        if key == "updated":
            return aware(r.updated_at) if r.updated_at else epoch
        if key == "submitted":
            return aware(r.submitted_at) if r.submitted_at else epoch
        return r.summary_score if r.summary_score is not None else -1.0

    def missing(r: CandidateRowOut) -> bool:
        """Порожні значення (немає балу / дати) завжди внизу, незалежно від напряму."""
        return (key == "score" and r.summary_score is None) or (
            key == "submitted" and r.submitted_at is None
        )

    present = sorted((r for r in rows if not missing(r)), key=value, reverse=desc)
    return present + [r for r in rows if missing(r)]
