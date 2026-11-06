"""Celery-задачі: тонкі обгортки над app.services.analysis (вся логіка там)."""

import logging

from app import db as db_module
from app.services import analysis
from app.services.ai import claude, whisper
from app.services.ai.errors import AIConfigError, TransientAIError
from app.services.storage import get_storage
from app.tasks.celery_app import celery

log = logging.getLogger(__name__)

MAX_RETRIES = 3


def _backoff(retries: int) -> int:
    return 15 * (2**retries)


def _enqueue_nodes(result_ids: list[int]) -> None:
    for result_id in result_ids:
        run_prompt_node.delay(result_id)


def _maybe_start_analysis(db, assessment_id: int) -> None:
    if analysis.transcripts_ready(db, assessment_id):
        _enqueue_nodes(analysis.start_analysis(db, assessment_id))


@celery.task(name="process_assessment")
def process_assessment(assessment_id: int) -> None:
    """Точка входу після подання кандидатом: транскрипція, а потім аналіз."""
    with db_module.sync_session_factory() as db:
        voice_ids = analysis.pending_voice_ids(db, assessment_id)
        if not voice_ids:
            _maybe_start_analysis(db, assessment_id)
    for voice_id in voice_ids:
        transcribe_voice_answer.delay(voice_id)


@celery.task(name="transcribe_voice_answer", bind=True)
def transcribe_voice_answer(self, voice_id: int) -> None:
    with db_module.sync_session_factory() as db:
        try:
            analysis.transcribe_voice(db, voice_id, whisper.transcribe, get_storage())
        except TransientAIError as exc:
            if self.request.retries < MAX_RETRIES:
                raise self.retry(exc=exc, countdown=_backoff(self.request.retries)) from exc
            analysis.mark_voice_failed(db, voice_id, f"Сервіс транскрипції недоступний: {exc}")
            return
        except AIConfigError as exc:
            analysis.mark_voice_failed(db, voice_id, str(exc))
            return
        except Exception as exc:  # некоректний файл, помилка API тощо
            log.exception("Помилка транскрипції voice_answer=%s", voice_id)
            analysis.mark_voice_failed(db, voice_id, f"{type(exc).__name__}: {exc}")
            return

        from app.models import VoiceAnswer

        voice = db.get(VoiceAnswer, voice_id)
        if voice is not None:
            _maybe_start_analysis(db, voice.assessment_id)


@celery.task(name="run_prompt_node", bind=True)
def run_prompt_node(self, result_id: int) -> None:
    from app.models import AnalysisResult

    with db_module.sync_session_factory() as db:
        try:
            analysis.execute_node(db, result_id, claude.analyze)
        except TransientAIError as exc:
            if self.request.retries < MAX_RETRIES:
                raise self.retry(exc=exc, countdown=_backoff(self.request.retries)) from exc
            analysis.mark_node_failed(db, result_id, f"Сервіс аналізу недоступний: {exc}")
        except AIConfigError as exc:
            analysis.mark_node_failed(db, result_id, str(exc))
        except Exception as exc:
            log.exception("Помилка виконання вузла result=%s", result_id)
            analysis.mark_node_failed(db, result_id, f"{type(exc).__name__}: {exc}")

        result = db.get(AnalysisResult, result_id)
        if result is not None:
            _enqueue_nodes(analysis.claim_ready(db, result.assessment_id))


@celery.task(name="retry_analysis")
def retry_analysis(assessment_id: int, only_failed: bool = True) -> None:
    with db_module.sync_session_factory() as db:
        voice_ids, node_ids = analysis.reset_for_retry(db, assessment_id, only_failed)
    for voice_id in voice_ids:
        transcribe_voice_answer.delay(voice_id)
    _enqueue_nodes(node_ids)
