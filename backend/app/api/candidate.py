"""Кабінет кандидата: анкета → опитувальник → голосове інтерв'ю, збереження й подання етапів."""

from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_db
from app.deps import require_roles
from app.models import (
    Assessment,
    AssessmentStage,
    Methodology,
    ProfileAnswer,
    ProfileFieldType,
    QuizAnswer,
    QuizQuestionType,
    TranscriptStatus,
    User,
    UserRole,
    VoiceAnswer,
)
from app.schemas.candidate import (
    AnswersIn,
    CandidateAssessmentOut,
    StageOut,
    TextAnswerIn,
    VoiceStatusOut,
)
from app.services import queue, stages
from app.services.storage import StorageService, get_storage

router = APIRouter(
    prefix="/candidate",
    tags=["candidate"],
    dependencies=[Depends(require_roles(UserRole.CANDIDATE))],
)

MAX_AUDIO_BYTES = 25 * 1024 * 1024
DURATION_TOLERANCE_SEC = 5


async def _get_assessment(db: AsyncSession, user: User) -> Assessment:
    assessment = (
        await db.execute(
            select(Assessment)
            .where(Assessment.candidate_id == user.id)
            .options(
                selectinload(Assessment.methodology).options(
                    selectinload(Methodology.profile_fields),
                    selectinload(Methodology.quiz_questions),
                    selectinload(Methodology.interview_questions),
                    selectinload(Methodology.recommendation_questions),
                ),
                selectinload(Assessment.profile_answers),
                selectinload(Assessment.quiz_answers),
                selectinload(Assessment.voice_answers),
            )
        )
    ).scalar_one_or_none()
    if assessment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Оцінювання не знайдено")
    return assessment


def _voice_status(assessment: Assessment) -> list[VoiceStatusOut]:
    m = assessment.methodology
    by_question = {v.interview_question_id: v for v in assessment.voice_answers}
    result = []
    for q in m.interview_questions:
        v = by_question.get(q.id)
        used = v.attempts_used if v else 0
        left = max(m.max_record_attempts - used, 0)
        is_text = bool(v) and v.kind == "TEXT"
        result.append(
            VoiceStatusOut(
                question_id=q.id,
                attempts_used=used,
                attempts_left=left,
                can_rerecord=bool(v) and m.allow_rerecord and left > 0,
                duration_sec=v.duration_sec if v else 0,
                kind=v.kind if v else None,
                text=v.transcript if is_text else "",
                # голос можна записати, доки є спроби; повторний запис голосу — лише якщо методологія дозволяє
                can_record=left > 0 and (v is None or is_text or m.allow_rerecord),
            )
        )
    return result


def _stage_list(assessment: Assessment) -> list[StageOut]:
    m = assessment.methodology
    busy = assessment.stage == AssessmentStage.PROCESSING
    stuck = stages.transcription_failed(assessment)
    counts = {
        "PROFILE": len(m.profile_fields),
        "QUIZ": len(m.quiz_questions),
        "INTERVIEW": len(m.interview_questions),
    }
    out = []
    for key in stages.required(assessment):
        done = stages.submitted_at(assessment, key) is not None
        out.append(
            StageOut(
                key=key,
                title=stages.title(assessment, key),
                status=stages.status(assessment, key),
                updated_at=stages.submitted_at(assessment, key),
                methodology_version=stages.version(assessment, key),
                question_count=counts[key],
                can_edit=key == "PROFILE" and done and not busy,
                can_retake=key != "PROFILE"
                and done
                and (not busy or (key == "INTERVIEW" and stuck)),
            )
        )
    return out


def _to_out(assessment: Assessment) -> CandidateAssessmentOut:
    m = assessment.methodology
    return CandidateAssessmentOut(
        id=assessment.id,
        stage=assessment.stage,
        methodology_title=m.title,
        allow_rerecord=m.allow_rerecord,
        max_record_attempts=m.max_record_attempts,
        profile_fields=m.profile_fields,
        profile_answers={a.profile_field_id: a.value for a in assessment.profile_answers},
        quiz_questions=m.quiz_questions,
        quiz_answers={a.quiz_question_id: a.value for a in assessment.quiz_answers},
        interview_questions=m.interview_questions,
        voice=_voice_status(assessment),
        recommendations_enabled=True,  # D-69: етап «Рекомендації» завжди (BR-3)
        methodology_version=m.version,
        processing_problem=stages.transcription_failed(assessment),
        stages=_stage_list(assessment),
    )


def _is_empty(value) -> bool:
    return value is None or value == "" or value == []


def _validate_profile_value(field, value) -> str:
    if _is_empty(value):
        return ""
    text = str(value).strip()
    if field.type == ProfileFieldType.NUMBER:
        try:
            float(text.replace(",", "."))
        except ValueError:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, f"«{field.label}»: потрібне число"
            ) from None
    elif field.type == ProfileFieldType.DATE:
        try:
            date.fromisoformat(text)
        except ValueError:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, f"«{field.label}»: некоректна дата"
            ) from None
    elif field.type == ProfileFieldType.SELECT and text not in (field.options or []):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"«{field.label}»: оберіть варіант зі списку"
        )
    return text


def _validate_quiz_value(question, value):
    if _is_empty(value):
        return None
    label = f"Питання «{question.text[:40]}»"
    options = question.options or []
    if question.type == QuizQuestionType.TEXT:
        return str(value).strip()
    if question.type == QuizQuestionType.SINGLE_CHOICE:
        if value not in options:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, f"{label}: оберіть варіант зі списку"
            )
        return value
    if question.type == QuizQuestionType.MULTI_CHOICE:
        if not isinstance(value, list) or not all(v in options for v in value):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, f"{label}: некоректні варіанти"
            )
        return value
    if question.type == QuizQuestionType.SCALE:
        lo, hi = options[0], options[1]
        if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, f"{label}: оцінка має бути від {lo} до {hi}"
            )
        return value
    return value


def _require_idle(assessment: Assessment, key: str | None = None) -> None:
    """Під час обробки зміни закриті. Виняток: запис не вдалося транскрибувати — кандидат може перезаписати інтерв'ю."""
    if assessment.stage == AssessmentStage.PROCESSING and not (
        key == "INTERVIEW" and stages.transcription_failed(assessment)
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Триває обробка ваших відповідей. Зачекайте кілька хвилин і спробуйте ще раз",
        )


def _require_open(assessment: Assessment, key: str) -> None:
    """Етап існує й ще не поданий (повторне проходження — через «Пройти заново»)."""
    if not stages.exists(assessment, key):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Цього етапу в методології немає")
    _require_idle(assessment, key)
    if stages.submitted_at(assessment, key) is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Цей етап уже подано. Щоб пройти його ще раз, натисніть «Пройти заново»",
        )


async def _after_stage_change(db: AsyncSession, assessment: Assessment) -> None:
    """Коммітить зміну етапу й, якщо подано все, запускає аналіз (уперше) або перезапускає його (повторно)."""
    if not stages.all_submitted(assessment):
        stages.reopen_overall(assessment)
        await db.commit()
        return
    restart = (
        assessment.submitted_at is not None
    )  # аналіз уже запускався: виводи треба перерахувати
    assessment.stage = AssessmentStage.PROCESSING
    if assessment.submitted_at is None:
        assessment.submitted_at = stages.now()
    if restart:
        stages.add_event(
            db, assessment, "ANALYSIS_RESTARTED", details={"reason": "кандидат оновив дані"}
        )
    await db.commit()
    if restart:
        queue.enqueue_retry_analysis(assessment.id, False)
    else:
        queue.enqueue_assessment_processing(assessment.id)


@router.get("/assessment", response_model=CandidateAssessmentOut)
async def my_assessment(
    db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.CANDIDATE))
):
    return _to_out(await _get_assessment(db, user))


def _profile_changes(assessment: Assessment, new_values: dict[int, str]) -> list[dict]:
    fields = {f.id: f for f in assessment.methodology.profile_fields}
    old = {a.profile_field_id: a.value for a in assessment.profile_answers}
    changes = []
    for field_id, value in new_values.items():
        if (old.get(field_id) or "") != value:
            changes.append(
                {"field": fields[field_id].label, "old": old.get(field_id) or "", "new": value}
            )
    return changes


@router.put("/assessment/profile", response_model=CandidateAssessmentOut)
async def save_profile(
    data: AnswersIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(UserRole.CANDIDATE)),
):
    """До подання — збереження чернетки. Після подання — редагування (D-24): зміни фіксуються в журналі,
    а якщо вже подано все, аналіз перераховується."""
    assessment = await _get_assessment(db, user)
    _require_idle(assessment)
    fields = {f.id: f for f in assessment.methodology.profile_fields}
    existing = {a.profile_field_id: a for a in assessment.profile_answers}
    new_values: dict[int, str] = {}
    for item in data.answers:
        field = fields.get(item.question_id)
        if field is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Невідоме поле анкети")
        new_values[field.id] = _validate_profile_value(field, item.value)

    editing = stages.submitted_at(assessment, "PROFILE") is not None
    if editing:
        merged = {**{fid: (a.value or "") for fid, a in existing.items()}, **new_values}
        missing = [f.label for f in fields.values() if f.required and _is_empty(merged.get(f.id))]
        if missing:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Заповніть обов'язкові поля: " + ", ".join(missing),
            )
        changes = _profile_changes(assessment, new_values)
        if not changes:
            return _to_out(assessment)
    for field_id, value in new_values.items():
        if field_id in existing:
            existing[field_id].value = value
        else:
            assessment.profile_answers.append(ProfileAnswer(profile_field_id=field_id, value=value))
    if editing:
        stages.mark_submitted(assessment, "PROFILE")
        stages.add_event(db, assessment, "STAGE_UPDATED", "PROFILE", {"changes": changes})
        await _after_stage_change(db, assessment)
    else:
        await db.commit()
    return _to_out(await _get_assessment(db, user))


@router.post("/assessment/profile/submit", response_model=CandidateAssessmentOut)
async def submit_profile(
    db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.CANDIDATE))
):
    assessment = await _get_assessment(db, user)
    _require_idle(assessment)
    if stages.submitted_at(assessment, "PROFILE") is not None:
        return _to_out(assessment)  # ідемпотентно; зміни вже поданого профілю зберігає PUT
    answered = {a.profile_field_id: a.value for a in assessment.profile_answers}
    missing = [
        f.label
        for f in assessment.methodology.profile_fields
        if f.required and _is_empty(answered.get(f.id))
    ]
    if missing:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Заповніть обов'язкові поля: " + ", ".join(missing),
        )
    stages.mark_submitted(assessment, "PROFILE")
    stages.add_event(db, assessment, "STAGE_SUBMITTED", "PROFILE")
    await _after_stage_change(db, assessment)
    return _to_out(await _get_assessment(db, user))


@router.put("/assessment/quiz", response_model=CandidateAssessmentOut)
async def save_quiz(
    data: AnswersIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(UserRole.CANDIDATE)),
):
    assessment = await _get_assessment(db, user)
    _require_open(assessment, "QUIZ")
    questions = {q.id: q for q in assessment.methodology.quiz_questions}
    existing = {a.quiz_question_id: a for a in assessment.quiz_answers}
    for item in data.answers:
        question = questions.get(item.question_id)
        if question is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "Невідоме питання опитувальника"
            )
        value = _validate_quiz_value(question, item.value)
        if item.question_id in existing:
            existing[item.question_id].value = value
        else:
            assessment.quiz_answers.append(QuizAnswer(quiz_question_id=question.id, value=value))
    await db.commit()
    return _to_out(await _get_assessment(db, user))


@router.post("/assessment/quiz/submit", response_model=CandidateAssessmentOut)
async def submit_quiz(
    db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.CANDIDATE))
):
    assessment = await _get_assessment(db, user)
    _require_open(assessment, "QUIZ")
    answered = {a.quiz_question_id: a.value for a in assessment.quiz_answers}
    unanswered = [q for q in assessment.methodology.quiz_questions if _is_empty(answered.get(q.id))]
    if unanswered:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Відповідайте на всі питання (без відповіді: {len(unanswered)})",
        )
    stages.mark_submitted(assessment, "QUIZ")
    stages.add_event(db, assessment, "STAGE_SUBMITTED", "QUIZ")
    await _after_stage_change(db, assessment)
    return _to_out(await _get_assessment(db, user))


@router.post("/assessment/interview/{question_id}/audio", response_model=CandidateAssessmentOut)
async def upload_audio(
    question_id: int,
    file: UploadFile = File(...),
    duration_sec: float = Form(...),
    client_request_id: str | None = Form(default=None, max_length=64),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(UserRole.CANDIDATE)),
    storage: StorageService = Depends(get_storage),
):
    assessment = await _get_assessment(db, user)
    _require_open(assessment, "INTERVIEW")
    m = assessment.methodology
    question = next((q for q in m.interview_questions if q.id == question_id), None)
    if question is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Питання інтерв'ю не знайдено")

    if duration_sec <= 0 or duration_sec > question.max_duration_sec + DURATION_TOLERANCE_SEC:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Тривалість запису має бути до {question.max_duration_sec} с",
        )
    content_type = (file.content_type or "").split(";")[0]
    if not content_type.startswith(("audio/", "video/webm", "video/mp4")):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Потрібен аудіофайл")
    data = await file.read(MAX_AUDIO_BYTES + 1)
    if not data:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Порожній запис")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Файл завеликий (максимум 25 МБ)"
        )

    voice = next(
        (v for v in assessment.voice_answers if v.interview_question_id == question_id), None
    )
    if voice is not None and client_request_id and voice.client_request_id == client_request_id:
        return _to_out(
            assessment
        )  # повтор запиту з клієнтської черги: уже збережено, спробу не витрачаємо
    if voice is not None:
        # повторний запис голосу — лише якщо дозволено; перший голос після текстової відповіді — ні
        if voice.kind == "VOICE" and not m.allow_rerecord:
            raise HTTPException(status.HTTP_409_CONFLICT, "Перезапис відповіді не дозволено")
        if voice.attempts_used >= m.max_record_attempts:
            raise HTTPException(status.HTTP_409_CONFLICT, "Ліміт спроб запису вичерпано")
        attempt = voice.attempts_used + 1
    else:
        attempt = 1

    path = storage.save(assessment.id, question_id, attempt, data, Path(file.filename or "").suffix)
    if voice is None:
        assessment.voice_answers.append(
            VoiceAnswer(
                interview_question_id=question_id,
                audio_path=path,
                duration_sec=duration_sec,
                attempts_used=1,
                client_request_id=client_request_id,
            )
        )
    else:
        if voice.audio_path and voice.audio_path != path:
            storage.delete(voice.audio_path)
        voice.kind = "VOICE"
        voice.audio_path = path
        voice.duration_sec = duration_sec
        voice.attempts_used = attempt
        voice.transcript = ""
        voice.transcript_status = TranscriptStatus.PENDING
        voice.transcript_error = ""
        voice.client_request_id = client_request_id
    await db.commit()
    return _to_out(await _get_assessment(db, user))


@router.post("/assessment/interview/{question_id}/text", response_model=CandidateAssessmentOut)
async def save_text_answer(
    question_id: int,
    data: TextAnswerIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(UserRole.CANDIDATE)),
    storage: StorageService = Depends(get_storage),
):
    """Текстова відповідь на питання розмови (D-63). Замінює попередню (текст чи запис); спроб запису не витрачає."""
    assessment = await _get_assessment(db, user)
    _require_open(assessment, "INTERVIEW")
    if not any(q.id == question_id for q in assessment.methodology.interview_questions):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Питання інтерв'ю не знайдено")
    text = data.text.strip()
    if not text:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Відповідь не може бути порожньою"
        )

    voice = next(
        (v for v in assessment.voice_answers if v.interview_question_id == question_id), None
    )
    if (
        voice is not None
        and data.client_request_id
        and voice.client_request_id == data.client_request_id
    ):
        return _to_out(assessment)
    if voice is None:
        assessment.voice_answers.append(
            VoiceAnswer(
                interview_question_id=question_id,
                kind="TEXT",
                audio_path=None,
                duration_sec=0,
                attempts_used=0,
                transcript=text,
                transcript_status=TranscriptStatus.DONE,
                client_request_id=data.client_request_id,
            )
        )
    else:
        if voice.audio_path:  # текст замінює запис: файл більше не потрібен
            storage.delete(voice.audio_path)
        voice.kind = "TEXT"
        voice.audio_path = None
        voice.duration_sec = 0
        voice.transcript = text
        voice.transcript_status = TranscriptStatus.DONE
        voice.transcript_error = ""
        voice.client_request_id = data.client_request_id
    await db.commit()
    return _to_out(await _get_assessment(db, user))


@router.post("/assessment/interview/submit", response_model=CandidateAssessmentOut)
async def submit_interview(
    db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.CANDIDATE))
):
    assessment = await _get_assessment(db, user)
    _require_open(assessment, "INTERVIEW")
    recorded = {v.interview_question_id for v in assessment.voice_answers}
    missing = [q for q in assessment.methodology.interview_questions if q.id not in recorded]
    if missing:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Запишіть відповіді на всі питання (залишилось: {len(missing)})",
        )
    stages.mark_submitted(assessment, "INTERVIEW")
    stages.add_event(db, assessment, "STAGE_SUBMITTED", "INTERVIEW")
    await _after_stage_change(db, assessment)
    return _to_out(await _get_assessment(db, user))


RETAKE_KEYS = {"quiz": "QUIZ", "interview": "INTERVIEW"}


@router.post("/assessment/{stage_name}/retake", response_model=CandidateAssessmentOut)
async def retake_stage(
    stage_name: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(UserRole.CANDIDATE)),
    storage: StorageService = Depends(get_storage),
):
    """«Пройти заново» (D-24): попередня спроба зберігається в журналі (відповіді, транскрипти, лічильники спроб),
    поточні відповіді очищаються, лічильник спроб запису починається з нуля. Аудіо архівується, а не видаляється."""
    key = RETAKE_KEYS.get(stage_name)
    if key is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Анкету не проходять заново — її можна редагувати",
        )
    assessment = await _get_assessment(db, user)
    if not stages.exists(assessment, key):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Цього етапу в методології немає")
    _require_idle(assessment, key)
    if stages.submitted_at(assessment, key) is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Етап ще не подано")

    was_stuck = stages.transcription_failed(assessment)  # до видалення записів
    if key == "QUIZ":
        snapshot = stages.quiz_snapshot(assessment)
        for a in list(assessment.quiz_answers):
            assessment.quiz_answers.remove(a)
    else:
        snapshot = stages.interview_snapshot(assessment)
        for answer in snapshot["answers"]:
            if answer["audio"]:
                answer["audio"] = storage.archive(answer["audio"])
        snapshot["attempts_reset"] = [
            {"question": a["question"], "attempts_used": a["attempts_used"]}
            for a in snapshot["answers"]
        ]
        for v in list(assessment.voice_answers):
            assessment.voice_answers.remove(v)
    stages.add_event(db, assessment, "STAGE_RETAKEN", key, snapshot)
    stages.clear_submitted(assessment, key)
    if was_stuck:
        assessment.stage = AssessmentStage.IN_PROGRESS
    else:
        stages.reopen_overall(assessment)
    await db.commit()
    return _to_out(await _get_assessment(db, user))
