"""Збірка контексту для вузла промта: дані кандидата + висновки попередніх вузлів."""

from app.models import Assessment, QuizQuestionType


def _fmt_quiz_value(value) -> str:
    if isinstance(value, list):
        return ", ".join(str(v) for v in value)
    return "" if value is None else str(value)


def _recommendations_block(assessment: Assessment) -> str:
    """Анонімні відгуки рекомендаторів: лише роль і відповіді. Беруться ті, що надійшли до запуску аналізу."""
    from app.services.recommendations import anonymous_reviews

    reviews = anonymous_reviews(assessment)
    if not reviews:
        return ""
    blocks = []
    for i, r in enumerate(reviews, start=1):
        lines = "\n".join(f"Питання: {a.question}\nВідповідь: {a.text}" for a in r.answers)
        blocks.append(f"### Відгук {i} (роль рекомендатора: {r.role_label})\n{lines}")
    return "## Відгуки рекомендаторів\n" + "\n\n".join(blocks)


def build_candidate_context(assessment: Assessment) -> str:
    m = assessment.methodology
    parts: list[str] = []

    profile = {a.profile_field_id: a.value for a in assessment.profile_answers}
    lines = []
    for f in m.profile_fields:
        value = profile.get(f.id, "").strip() or "(не заповнено)"
        lines.append(f"- {f.label}: {value}")
    if lines:
        parts.append("## Анкета\n" + "\n".join(lines))

    quiz = {a.quiz_question_id: a.value for a in assessment.quiz_answers}
    lines = []
    for q in m.quiz_questions:
        value = _fmt_quiz_value(quiz.get(q.id)) or "(без відповіді)"
        suffix = ""
        if q.type == QuizQuestionType.SCALE and q.options:
            suffix = f" (шкала {q.options[0]}–{q.options[1]})"
        lines.append(f"- {q.text}{suffix}: {value}")
    if lines:
        parts.append("## Опитувальник\n" + "\n".join(lines))

    voice = {v.interview_question_id: v for v in assessment.voice_answers}
    blocks = []
    for q in m.interview_questions:
        v = voice.get(q.id)
        is_text = bool(v) and v.kind == "TEXT"
        text = (v.transcript.strip() if v else "") or (
            "(відповідь відсутня)" if is_text else "(транскрипт відсутній)"
        )
        label = "Відповідь кандидата (текст)" if is_text else "Відповідь кандидата (транскрипт)"
        blocks.append(f"Питання: {q.text}\n{label}: {text}")
    if blocks:
        parts.append("## Розмова (інтерв'ю)\n" + "\n\n".join(blocks))

    reviews = _recommendations_block(assessment)
    if reviews:
        parts.append(reviews)

    return "\n\n".join(parts) if parts else "(даних немає)"


def build_node_user_message(
    assessment: Assessment, predecessors: list[tuple[str, str, float | None]]
) -> str:
    """predecessors — список (назва вузла, висновок, бал) завершених вузлів-попередників."""
    message = f"<candidate_data>\n{build_candidate_context(assessment)}\n</candidate_data>"
    if predecessors:
        blocks = []
        for name, output, score in predecessors:
            score_line = f"\nБал: {score:g}/10" if score is not None else ""
            blocks.append(f"### {name}{score_line}\n{output}")
        message += (
            "\n\n<previous_conclusions>\n" + "\n\n".join(blocks) + "\n</previous_conclusions>"
        )
    return message
