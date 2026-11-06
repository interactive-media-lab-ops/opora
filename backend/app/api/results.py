"""Результати оцінювання: база кандидатів для HR і повні результати для методиста.

- ``/hr/*`` — дашборд, список, картка з фінальними висновками, вердикт, PDF.
- ``/analysis/*`` — список і картка з усіма вузлами графа, перезапуск аналізу.

Нотатки HR — ``app.api.hr_notes``, аудіозаписи — ``app.api.audio``.
"""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import require_roles
from app.models import (
    AnalysisStatus,
    Assessment,
    AssessmentStage,
    AuditLog,
    User,
    UserRole,
    VerdictChange,
)
from app.schemas.results import (
    CandidateRowOut,
    DashboardOut,
    FinalConclusionOut,
    HRCandidateDetailOut,
    MethodologistCandidateDetailOut,
    NodeResultOut,
    RetryIn,
    VerdictChangeOut,
    VerdictIn,
)
from app.services import queue
from app.services import recommendations as recommendation_service
from app.services.analytics import build_analytics
from app.services.candidate_views import base_detail, events_out, list_rows, load_assessment
from app.services.pdf import build_candidate_pdf

HR_ROLES = (UserRole.HR, UserRole.ADMIN)
# BR-17 / D-77: методист даних кандидатів не бачить — лише методології.
# Ендпоінти /analysis залишено адміну (перезапуск аналізу).
METHODOLOGIST_ROLES = (UserRole.ADMIN,)

hr_router = APIRouter(prefix="/hr", tags=["hr"])
analysis_router = APIRouter(prefix="/analysis", tags=["analysis"])


# ---------- HR ----------


@hr_router.get("/dashboard", response_model=DashboardOut)
async def dashboard(
    db: AsyncSession = Depends(get_db), _: User = Depends(require_roles(*HR_ROLES))
):
    submitted = Assessment.submitted_at.is_not(None)
    by_stage = {
        stage.value: count
        for stage, count in (
            await db.execute(select(Assessment.stage, func.count()).group_by(Assessment.stage))
        ).all()
    }
    awaiting = await db.scalar(
        select(func.count()).where(
            Assessment.stage == AssessmentStage.DONE, Assessment.verdict.is_(None), submitted
        )
    )
    week_ago = datetime.now(UTC) - timedelta(days=7)
    recent = await db.scalar(select(func.count()).where(Assessment.submitted_at >= week_ago))
    total = await db.scalar(select(func.count()).where(submitted))
    return DashboardOut(
        total=total or 0,
        by_stage={s.value: by_stage.get(s.value, 0) for s in AssessmentStage},
        awaiting_verdict=awaiting or 0,
        submitted_last_7_days=recent or 0,
    )


@hr_router.get("/candidates", response_model=list[CandidateRowOut])
async def hr_candidates(
    methodology_id: int | None = None,
    stage: AssessmentStage | None = None,
    verdict: str | None = None,
    search: str | None = None,
    sort: str = "updated",
    dir: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*HR_ROLES)),
):
    """База HR (BR-5): усі кандидати, не лише ті, що подали всі етапи.

    sort: name | completeness | updated | submitted | score (date — синонім submitted).
    """
    return await list_rows(
        db, False, methodology_id, stage, verdict, search, sort, dir, include_unsubmitted=True
    )


@hr_router.get("/candidates/{assessment_id}", response_model=HRCandidateDetailOut)
async def hr_candidate_detail(
    assessment_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*HR_ROLES)),
):
    """Картка для HR: лише фінальні висновки (вузли без вихідних стрілок)."""
    assessment = await load_assessment(db, assessment_id, allow_unsubmitted=True)
    final = [
        FinalConclusionOut(node_name=r.node.name, output=r.output, score=r.score)
        for r in sorted(assessment.results, key=lambda r: r.prompt_node_id)
        if r.is_terminal and r.status == AnalysisStatus.DONE
    ]
    history = [
        VerdictChangeOut(
            id=c.id,
            changed_at=c.changed_at,
            author_name=c.author.name if c.author else None,
            old_verdict=c.old_verdict,
            new_verdict=c.new_verdict,
            old_note=c.old_note,
            new_note=c.new_note,
        )
        for c in assessment.verdict_changes
    ]
    return HRCandidateDetailOut(
        **base_detail(assessment, include_errors=False),
        final_conclusions=final,
        history=history,
        recommendations=recommendation_service.anonymous_reviews(assessment),
        events=events_out(assessment),
        analytics=build_analytics(assessment),
    )


@hr_router.put("/candidates/{assessment_id}/verdict", response_model=HRCandidateDetailOut)
async def set_verdict(
    assessment_id: int,
    data: VerdictIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*HR_ROLES)),
):
    assessment = await load_assessment(db, assessment_id, allow_unsubmitted=True)
    if data.verdict != assessment.verdict:
        # BR-6: нотатки окремо (hr_notes); у журналі вердиктів лише зміна вердикту
        db.add(
            VerdictChange(
                assessment_id=assessment.id,
                author_id=user.id,
                old_verdict=assessment.verdict,
                new_verdict=data.verdict,
                old_note="",
                new_note="",
            )
        )
    assessment.verdict = data.verdict
    assessment.verdict_by_id = user.id
    await db.commit()
    db.expire_all()  # деталь перечитується з журналом, що містить щойно додану зміну
    return await hr_candidate_detail(assessment_id, db, user)


@hr_router.get("/candidates/{assessment_id}/export.pdf")
async def export_candidate_pdf(
    assessment_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*HR_ROLES)),
):
    """PDF профілю кандидата (BR-10, 64A): без нотаток HR, журналу й сирих даних.

    Кожен виклик логується (D-38).
    """
    assessment = await load_assessment(db, assessment_id, allow_unsubmitted=True)
    content = build_candidate_pdf(assessment, user.name, datetime.now(UTC))
    db.add(
        AuditLog(
            user_id=user.id,
            action="CANDIDATE_PDF_EXPORT",
            assessment_id=assessment.id,
            details={"bytes": len(content)},
        )
    )
    await db.commit()
    return Response(
        content=content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="opora-candidate-{assessment.id}.pdf"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


# ---------- Методист: повні результати ----------


@analysis_router.get("/candidates", response_model=list[CandidateRowOut])
async def methodologist_candidates(
    methodology_id: int | None = None,
    stage: AssessmentStage | None = None,
    verdict: str | None = None,
    search: str | None = None,
    sort: str = "date",
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*METHODOLOGIST_ROLES)),
):
    return await list_rows(db, True, methodology_id, stage, verdict, search, sort)


@analysis_router.get("/candidates/{assessment_id}", response_model=MethodologistCandidateDetailOut)
async def methodologist_candidate_detail(
    assessment_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*METHODOLOGIST_ROLES)),
):
    """Картка з результатами кожного вузла графа, включно з помилками."""
    assessment = await load_assessment(db, assessment_id)
    results = [
        NodeResultOut(
            node_id=r.prompt_node_id,
            node_name=r.node.name,
            prompt_text=r.node.prompt_text,
            returns_score=r.node.returns_score,
            is_terminal=r.is_terminal,
            status=r.status,
            output=r.output,
            score=r.score,
            error=r.error,
            model=r.model,
            input_tokens=r.input_tokens,
            output_tokens=r.output_tokens,
        )
        for r in sorted(assessment.results, key=lambda r: r.prompt_node_id)
    ]
    return MethodologistCandidateDetailOut(
        **base_detail(assessment, include_errors=True),
        results=results,
        recommendations=recommendation_service.anonymous_reviews(assessment),
        events=events_out(assessment),
        analytics=build_analytics(assessment),
    )


@analysis_router.post("/candidates/{assessment_id}/retry", status_code=status.HTTP_202_ACCEPTED)
async def retry_analysis(
    assessment_id: int,
    data: RetryIn,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*METHODOLOGIST_ROLES)),
):
    await load_assessment(db, assessment_id)
    queue.enqueue_retry_analysis(assessment_id, data.only_failed)
    return {"status": "queued"}
