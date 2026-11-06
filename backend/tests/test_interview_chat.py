from pathlib import Path

from sqlalchemy import select

from app.models import Assessment, TranscriptStatus, VoiceAnswer
from app.services.context_builder import build_candidate_context
from tests.test_candidate_flow import (  # noqa: F401  (фікстури)
    AUDIO,
    _register,
    full_methodology,
    isolated_infra,
)
from tests.test_stage_hub import (  # noqa: F401
    A,
    _do_profile,
    _do_quiz,
    _finish_analysis,
    _state,
    cand,
)

# ключ ідемпотентності і текстові відповіді — розмова-чат (D-63)


async def _qid(client, cand):
    return (await _state(client, cand))["interview_questions"][0]["id"]


def _voice(a):
    return a["voice"][0]


async def _text(client, cand, qid, text, rid=None):
    body = {"text": text, **({"client_request_id": rid} if rid else {})}
    return await client.post(f"{A}/interview/{qid}/text", json=body, headers=cand)


async def _audio(client, cand, qid, rid=None, dur="10"):
    data = {"duration_sec": dur, **({"client_request_id": rid} if rid else {})}
    return await client.post(f"{A}/interview/{qid}/audio", files=AUDIO, data=data, headers=cand)


async def test_text_answer_flow_and_hr_view(client, cand, session_factory, hr_h, isolated_infra):  # noqa: F811
    await _do_profile(client, cand)
    await _do_quiz(client, cand)
    qid = await _qid(client, cand)
    r = await _text(client, cand, qid, "  Розв'язав конфлікт спокійно.  ")
    assert r.status_code == 200
    v = _voice(r.json())
    assert (v["kind"], v["text"], v["attempts_used"], v["attempts_left"]) == (
        "TEXT",
        "Розв'язав конфлікт спокійно.",
        0,
        2,
    )
    assert v["can_record"] is True

    # текстова відповідь рахується відповіддю: етап можна подати без запису
    sub = await client.post(f"{A}/interview/submit", headers=cand)
    assert sub.status_code == 200 and sub.json()["stage"] == "PROCESSING"
    aid = (await _state(client, cand))["id"]
    assert isolated_infra == [aid]

    async with session_factory() as db:
        row = (await db.execute(select(VoiceAnswer))).scalar_one()
        assert (
            row.kind == "TEXT"
            and row.audio_path is None
            and row.transcript_status == TranscriptStatus.DONE
        )
    detail = (await client.get(f"/api/hr/candidates/{aid}", headers=hr_h)).json()
    item = detail["voice"][0]
    assert (
        item["kind"] == "TEXT"
        and item["transcript"] == "Розв'язав конфлікт спокійно."
        and item["transcript_status"] == "DONE"
    )
    assert (
        await client.get(f"/api/audio/{item['voice_answer_id']}", headers=hr_h)
    ).status_code == 404  # аудіо немає


async def test_text_validation_and_closed_after_submit(client, cand):
    qid = await _qid(client, cand)
    assert (await _text(client, cand, qid, "   ")).status_code == 422
    assert (await _text(client, cand, 99999, "x")).status_code == 404
    await _do_profile(client, cand)
    await _do_quiz(client, cand)
    await _text(client, cand, qid, "відповідь")
    await client.post(f"{A}/interview/submit", headers=cand)
    assert (await _text(client, cand, qid, "ще")).status_code == 409  # етап подано


async def test_switching_between_text_and_voice(client, cand, tmp_path):
    qid = await _qid(client, cand)
    await _text(client, cand, qid, "спершу текстом")
    r = await _audio(client, cand, qid)  # перший голос після тексту
    v = _voice(r.json())
    assert (v["kind"], v["attempts_used"], v["text"]) == ("VOICE", 1, "")
    path = next(Path(tmp_path).rglob("q*_a1.webm"))
    assert path.exists()

    r = await _text(
        client, cand, qid, "знову текстом"
    )  # текст замінює запис, файл видаляється, спроба лишається витраченою
    v = _voice(r.json())
    assert (v["kind"], v["attempts_used"], v["text"]) == ("TEXT", 1, "знову текстом")
    assert not path.exists()

    assert (
        _voice((await _audio(client, cand, qid)).json())["attempts_used"] == 2
    )  # друга спроба голосу
    assert (await _audio(client, cand, qid)).status_code == 409  # ліміт методології (2)
    r = await _text(client, cand, qid, "лишився текст")  # текст після вичерпання спроб — можна
    assert _voice(r.json())["can_record"] is False


async def test_idempotency_key_does_not_spend_attempts(client, cand):
    qid = await _qid(client, cand)
    first = await _audio(client, cand, qid, rid="req-1")
    again = await _audio(client, cand, qid, rid="req-1")  # повтор із черги після обриву
    assert _voice(first.json())["attempts_used"] == 1 and _voice(again.json())["attempts_used"] == 1
    assert (
        _voice((await _audio(client, cand, qid, rid="req-2")).json())["attempts_used"] == 2
    )  # інший ключ — нова спроба

    await _text(client, cand, qid, "один", rid="t-1")
    same = await _text(client, cand, qid, "інший текст, але той самий ключ", rid="t-1")
    assert _voice(same.json())["text"] == "один"  # повтор не перезаписує


async def test_text_answers_reach_ai_context_with_label(client, cand, session_factory):
    qid = await _qid(client, cand)
    await _text(client, cand, qid, "Текстова відповідь про конфлікт")
    async with session_factory() as db:
        from sqlalchemy.orm import selectinload

        from app.models import Methodology

        a = (
            await db.execute(
                select(Assessment).options(
                    selectinload(Assessment.methodology).options(
                        selectinload(Methodology.profile_fields),
                        selectinload(Methodology.quiz_questions),
                        selectinload(Methodology.interview_questions),
                    ),
                    selectinload(Assessment.profile_answers),
                    selectinload(Assessment.quiz_answers),
                    selectinload(Assessment.voice_answers),
                    selectinload(Assessment.recommendation_links),
                )
            )
        ).scalar_one()
        ctx = await db.run_sync(lambda _s: build_candidate_context(a))
    assert "Відповідь кандидата (текст): Текстова відповідь про конфлікт" in ctx
    assert "(транскрипт)" not in ctx


async def test_retake_snapshot_includes_text_answers(client, cand, session_factory, hr_h):
    await _do_profile(client, cand)
    await _do_quiz(client, cand)
    qid = await _qid(client, cand)
    await _text(client, cand, qid, "стара відповідь")
    await client.post(f"{A}/interview/submit", headers=cand)
    aid = await _finish_analysis(session_factory)
    assert (await client.post(f"{A}/interview/retake", headers=cand)).status_code == 200
    ev = next(
        e
        for e in (await client.get(f"/api/hr/candidates/{aid}", headers=hr_h)).json()["events"]
        if e["kind"] == "STAGE_RETAKEN"
    )
    ans = ev["details"]["answers"][0]
    assert (ans["kind"], ans["transcript"], ans["audio"]) == ("TEXT", "стара відповідь", None)
