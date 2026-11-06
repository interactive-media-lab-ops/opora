"""Оркестрація аналізу: транскрипти → виконання графа промтів вузол за вузлом.

Функції приймають синхронну сесію БД і не залежать від Celery: черга лише викликає їх.
Усі зміни стану «зайнято вузол» відбуваються під блокуванням рядка оцінювання, а виклики
`.delay()` роблять ПІСЛЯ коміту — інакше воркер може стартувати до видимості змін.
"""

from collections.abc import Callable
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    AnalysisResult,
    AnalysisStatus,
    Assessment,
    AssessmentStage,
    Methodology,
    PromptEdge,
    PromptNode,
    TranscriptStatus,
    VoiceAnswer,
)
from app.services import graph
from app.services.ai.claude import NodeOutput
from app.services.context_builder import build_node_user_message
from app.services.storage import StorageService


def _lock_assessment(db: Session, assessment_id: int) -> Assessment | None:
    return db.execute(
        select(Assessment).where(Assessment.id == assessment_id).with_for_update()
    ).scalar_one_or_none()


def _edges(db: Session, methodology_id: int) -> list[tuple[int, int]]:
    rows = db.execute(
        select(PromptEdge.source_node_id, PromptEdge.target_node_id).where(
            PromptEdge.methodology_id == methodology_id
        )
    ).all()
    return [(s, t) for s, t in rows]


# ---------- Транскрипція ----------


def pending_voice_ids(db: Session, assessment_id: int) -> list[int]:
    """Голосові відповіді, які ще треба транскрибувати (включно з невдалими — для повтору)."""
    return list(
        db.execute(
            select(VoiceAnswer.id).where(
                VoiceAnswer.assessment_id == assessment_id,
                VoiceAnswer.transcript_status.in_(
                    [TranscriptStatus.PENDING, TranscriptStatus.FAILED]
                ),
            )
        ).scalars()
    )


def transcribe_voice(
    db: Session, voice_id: int, transcribe_fn: Callable[[Path], str], storage: StorageService
) -> None:
    voice = db.get(VoiceAnswer, voice_id)
    if voice is None or voice.transcript_status == TranscriptStatus.DONE:
        return
    voice.transcript_status = TranscriptStatus.PROCESSING
    voice.transcript_error = ""
    db.commit()
    text = transcribe_fn(storage.path_for(voice.audio_path))
    voice.transcript = text
    voice.transcript_status = TranscriptStatus.DONE
    db.commit()


def mark_voice_failed(db: Session, voice_id: int, error: str) -> None:
    voice = db.get(VoiceAnswer, voice_id)
    if voice is not None:
        voice.transcript_status = TranscriptStatus.FAILED
        voice.transcript_error = error[:2000]
        db.commit()


def transcripts_ready(db: Session, assessment_id: int) -> bool:
    statuses = (
        db.execute(
            select(VoiceAnswer.transcript_status).where(VoiceAnswer.assessment_id == assessment_id)
        )
        .scalars()
        .all()
    )
    return all(s == TranscriptStatus.DONE for s in statuses)


# ---------- Граф промтів ----------


def start_analysis(db: Session, assessment_id: int) -> list[int]:
    """Створює рядки результатів для всіх вузлів і повертає id вузлів, готових до запуску.

    Ідемпотентна: якщо аналіз уже створено, нічого не дублює.
    """
    assessment = _lock_assessment(db, assessment_id)
    if assessment is None or assessment.stage != AssessmentStage.PROCESSING:
        db.rollback()
        return []

    exists = db.execute(
        select(AnalysisResult.id).where(AnalysisResult.assessment_id == assessment_id).limit(1)
    ).first()
    if exists is None:
        nodes = (
            db.execute(
                select(PromptNode).where(PromptNode.methodology_id == assessment.methodology_id)
            )
            .scalars()
            .all()
        )
        if not nodes:
            assessment.stage = AssessmentStage.DONE
            db.commit()
            return []
        edges = _edges(db, assessment.methodology_id)
        terminal = graph.terminal_nodes([n.id for n in nodes], edges)
        for node in nodes:
            db.add(
                AnalysisResult(
                    assessment_id=assessment_id,
                    prompt_node_id=node.id,
                    is_terminal=node.id in terminal,
                )
            )
        db.flush()
    return _claim_ready(db, assessment)


def claim_ready(db: Session, assessment_id: int) -> list[int]:
    assessment = _lock_assessment(db, assessment_id)
    if assessment is None:
        db.rollback()
        return []
    return _claim_ready(db, assessment)


def _claim_ready(db: Session, assessment: Assessment) -> list[int]:
    """Позначає готові вузли як RUNNING, коммітить і повертає їхні id. Викликати під блокуванням."""
    results = (
        db.execute(select(AnalysisResult).where(AnalysisResult.assessment_id == assessment.id))
        .scalars()
        .all()
    )
    by_node = {r.prompt_node_id: r for r in results}
    edges = [
        (s, t) for s, t in _edges(db, assessment.methodology_id) if s in by_node and t in by_node
    ]

    done = {n for n, r in by_node.items() if r.status == AnalysisStatus.DONE}
    started = {n for n, r in by_node.items() if r.status != AnalysisStatus.PENDING}
    ready = graph.ready_nodes(by_node.keys(), edges, done, started)

    claimed = []
    for node_id in ready:
        by_node[node_id].status = AnalysisStatus.RUNNING
        by_node[node_id].error = ""
        claimed.append(by_node[node_id].id)

    if results and len(done) == len(by_node):
        assessment.stage = AssessmentStage.DONE
    db.commit()
    return claimed


def execute_node(
    db: Session, result_id: int, analyze_fn: Callable[[str, str, bool], NodeOutput]
) -> bool:
    """Виконує вузол. Повертає True, якщо вузол завершено успішно.

    Виключення з analyze_fn (зокрема TransientAIError) пробрасуються — рішення про повтор приймає черга.
    """
    result = db.execute(
        select(AnalysisResult)
        .where(AnalysisResult.id == result_id)
        .options(selectinload(AnalysisResult.node))
    ).scalar_one_or_none()
    if result is None or result.status == AnalysisStatus.DONE:
        return False

    assessment = db.execute(
        select(Assessment)
        .where(Assessment.id == result.assessment_id)
        .options(
            selectinload(Assessment.methodology).options(
                selectinload(Methodology.profile_fields),
                selectinload(Methodology.quiz_questions),
                selectinload(Methodology.interview_questions),
            ),
            selectinload(Assessment.profile_answers),
            selectinload(Assessment.quiz_answers),
            selectinload(Assessment.voice_answers),
        )
    ).scalar_one()

    pred_ids = [s for s, t in _edges(db, assessment.methodology_id) if t == result.prompt_node_id]
    predecessors = []
    if pred_ids:
        rows = (
            db.execute(
                select(AnalysisResult)
                .where(
                    AnalysisResult.assessment_id == assessment.id,
                    AnalysisResult.prompt_node_id.in_(pred_ids),
                    AnalysisResult.status == AnalysisStatus.DONE,
                )
                .options(selectinload(AnalysisResult.node))
                .order_by(AnalysisResult.prompt_node_id)
            )
            .scalars()
            .all()
        )
        predecessors = [(r.node.name, r.output, r.score) for r in rows]

    node = result.node
    output = analyze_fn(
        node.prompt_text, build_node_user_message(assessment, predecessors), node.returns_score
    )

    result.output = output.conclusion
    result.score = output.score if node.returns_score else None
    result.model = output.model
    result.input_tokens = output.input_tokens
    result.output_tokens = output.output_tokens
    result.status = AnalysisStatus.DONE
    result.error = ""
    db.commit()
    return True


def mark_node_failed(db: Session, result_id: int, error: str) -> None:
    result = db.get(AnalysisResult, result_id)
    if result is not None:
        result.status = AnalysisStatus.FAILED
        result.error = error[:2000]
        db.commit()


# ---------- Повторний запуск ----------


def reset_for_retry(
    db: Session, assessment_id: int, only_failed: bool
) -> tuple[list[int], list[int]]:
    """Готує повторний запуск. Повертає (id голосових для повторної транскрипції, id вузлів до запуску).

    only_failed=True — повторити лише невдалі кроки; False — перезапустити весь граф заново
    (з актуальними на цей момент промтами й стрілками).
    """
    assessment = _lock_assessment(db, assessment_id)
    if assessment is None or assessment.submitted_at is None:
        db.rollback()
        return [], []

    assessment.stage = AssessmentStage.PROCESSING
    if only_failed:
        for r in db.execute(
            select(AnalysisResult).where(
                AnalysisResult.assessment_id == assessment_id,
                AnalysisResult.status == AnalysisStatus.FAILED,
            )
        ).scalars():
            r.status = AnalysisStatus.PENDING
            r.error = ""
    else:
        db.execute(delete(AnalysisResult).where(AnalysisResult.assessment_id == assessment_id))
    db.flush()

    voice_ids = pending_voice_ids(db, assessment_id)
    if voice_ids:
        db.commit()
        return voice_ids, []
    db.commit()
    return [], start_analysis(db, assessment_id)
