"""Етапи кандидата (хаб, D-50): незалежні, у будь-якому порядку. Стан етапу — у полях *_submitted_at проходження."""

from datetime import UTC, datetime

from app.models import Assessment, AssessmentEvent, AssessmentStage, TranscriptStatus

KEYS = ("PROFILE", "QUIZ", "INTERVIEW")
TITLES = {"PROFILE": "Анкета", "QUIZ": "Опитувальник", "INTERVIEW": "Розмова"}
_ATTR = {"PROFILE": "profile", "QUIZ": "quiz", "INTERVIEW": "interview"}


def title(assessment: Assessment, key: str) -> str:
    """Назва етапу: задана методологом (BR-4, D-73) або типова."""
    custom = getattr(assessment.methodology, f"{_ATTR[key]}_title", None)
    return (custom or "").strip() or TITLES[key]


def now() -> datetime:
    return datetime.now(UTC)


def exists(assessment: Assessment, key: str) -> bool:
    """Анкета є завжди; опитувальник та інтерв'ю — лише якщо в методології є питання."""
    m = assessment.methodology
    if key == "QUIZ":
        return bool(m.quiz_questions)
    if key == "INTERVIEW":
        return bool(m.interview_questions)
    return True


def required(assessment: Assessment) -> list[str]:
    """Усі наявні етапи обов'язкові (рішення власника). «Рекомендації» не входять — аналіз їх не чекає."""
    return [k for k in KEYS if exists(assessment, k)]


def submitted_at(assessment: Assessment, key: str) -> datetime | None:
    return getattr(assessment, f"{_ATTR[key]}_submitted_at")


def version(assessment: Assessment, key: str) -> int | None:
    return getattr(assessment, f"{_ATTR[key]}_version")


def mark_submitted(assessment: Assessment, key: str) -> None:
    setattr(assessment, f"{_ATTR[key]}_submitted_at", now())
    setattr(assessment, f"{_ATTR[key]}_version", assessment.methodology.version)


def clear_submitted(assessment: Assessment, key: str) -> None:
    setattr(assessment, f"{_ATTR[key]}_submitted_at", None)
    setattr(assessment, f"{_ATTR[key]}_version", None)


def has_answers(assessment: Assessment, key: str) -> bool:
    if key == "PROFILE":
        return any((a.value or "").strip() for a in assessment.profile_answers)
    if key == "QUIZ":
        return bool(assessment.quiz_answers)
    return bool(assessment.voice_answers)


def status(assessment: Assessment, key: str) -> str:
    if submitted_at(assessment, key) is not None:
        return "SUBMITTED"
    return "IN_PROGRESS" if has_answers(assessment, key) else "NOT_STARTED"


def all_submitted(assessment: Assessment) -> bool:
    return all(submitted_at(assessment, k) is not None for k in required(assessment))


def add_event(
    db, assessment: Assessment, kind: str, stage: str | None = None, details=None
) -> AssessmentEvent:
    event = AssessmentEvent(
        assessment_id=assessment.id,
        kind=kind,
        stage=stage,
        methodology_version=assessment.methodology.version,
        details=details,
    )
    db.add(event)  # без звернення до assessment.events: колекція не завантажена (async)
    return event


def quiz_snapshot(assessment: Assessment) -> dict:
    by_id = {a.quiz_question_id: a.value for a in assessment.quiz_answers}
    return {
        "submitted_at": submitted_at(assessment, "QUIZ").isoformat()
        if submitted_at(assessment, "QUIZ")
        else None,
        "version": version(assessment, "QUIZ"),
        "answers": [
            {"question": q.text, "value": by_id.get(q.id)}
            for q in assessment.methodology.quiz_questions
        ],
    }


def interview_snapshot(assessment: Assessment) -> dict:
    by_id = {v.interview_question_id: v for v in assessment.voice_answers}
    answers = []
    for q in assessment.methodology.interview_questions:
        v = by_id.get(q.id)
        answers.append(
            {
                "question": q.text,
                "kind": v.kind if v else None,
                "transcript": v.transcript if v else "",
                "duration_sec": v.duration_sec if v else 0,
                # скільки спроб запису використано до скидання — фіксується в журналі (рішення власника)
                "attempts_used": v.attempts_used if v else 0,
                "audio": v.audio_path if v else None,
            }
        )
    at = submitted_at(assessment, "INTERVIEW")
    return {
        "submitted_at": at.isoformat() if at else None,
        "version": version(assessment, "INTERVIEW"),
        "answers": answers,
    }


def transcription_failed(assessment: Assessment) -> bool:
    """Обробка «застрягла»: хоч одну голосову відповідь не вдалося транскрибувати, тож аналіз не стартує."""
    return assessment.stage == AssessmentStage.PROCESSING and any(
        v.transcript_status == TranscriptStatus.FAILED for v in assessment.voice_answers
    )


def reopen_overall(assessment: Assessment) -> None:
    """Після повторного проходження етапу загальний стан знову «в процесі» (аналіз буде перезапущено після подання)."""
    if assessment.stage != AssessmentStage.PROCESSING or transcription_failed(assessment):
        assessment.stage = AssessmentStage.IN_PROGRESS
