from pathlib import Path

import pytest_asyncio
from sqlalchemy import select

from app.models import Assessment, AssessmentStage
from tests.test_candidate_flow import (  # noqa: F401  (фікстури)
    AUDIO,
    _register,
    full_methodology,
    isolated_infra,
)

A = "/api/candidate/assessment"


@pytest_asyncio.fixture
async def cand(client, method_h, full_methodology):  # noqa: F811
    return await _register(client, method_h, full_methodology["id"])


async def _state(client, cand):
    return (await client.get(A, headers=cand)).json()


def _statuses(a):
    return {s["key"]: s["status"] for s in a["stages"]}


async def _do_profile(client, cand, name="Олена"):
    a = await _state(client, cand)
    fid = next(f["id"] for f in a["profile_fields"] if f["label"] == "Ім'я")
    await client.put(
        f"{A}/profile", json={"answers": [{"question_id": fid, "value": name}]}, headers=cand
    )
    return await client.post(f"{A}/profile/submit", headers=cand)


async def _do_quiz(client, cand, scale=3):
    a = await _state(client, cand)
    qs = {q["text"]: q["id"] for q in a["quiz_questions"]}
    await client.put(
        f"{A}/quiz",
        json={
            "answers": [
                {"question_id": qs["Пріоритет"], "value": "Розвиток"},
                {"question_id": qs["Стрес"], "value": scale},
            ]
        },
        headers=cand,
    )
    return await client.post(f"{A}/quiz/submit", headers=cand)


async def _do_interview(client, cand):
    a = await _state(client, cand)
    qid = a["interview_questions"][0]["id"]
    r = await client.post(
        f"{A}/interview/{qid}/audio", files=AUDIO, data={"duration_sec": "20"}, headers=cand
    )
    assert r.status_code == 200, r.text
    return await client.post(f"{A}/interview/submit", headers=cand)


async def _finish_analysis(session_factory):
    async with session_factory() as db:
        a = (await db.execute(select(Assessment))).scalar_one()
        a.stage = AssessmentStage.DONE
        await db.commit()
        return a.id


async def test_stages_in_any_order_and_analysis_starts_after_last(client, cand, isolated_infra):  # noqa: F811
    r = await _do_interview(client, cand)  # інтерв'ю першим: порядку немає (D-50)
    assert r.status_code == 200 and _statuses(r.json()) == {
        "PROFILE": "NOT_STARTED",
        "QUIZ": "NOT_STARTED",
        "INTERVIEW": "SUBMITTED",
    }
    assert r.json()["stage"] == "IN_PROGRESS" and isolated_infra == []

    r = await _do_quiz(client, cand)
    assert r.json()["stage"] == "IN_PROGRESS" and isolated_infra == []
    r = await _do_profile(client, cand)
    assert r.json()["stage"] == "PROCESSING"  # останній етап запускає обробку, рівно раз
    a_id = (await _state(client, cand))["id"]
    assert isolated_infra == [a_id]
    assert all(
        s["status"] == "SUBMITTED" and s["methodology_version"] == 1 and s["updated_at"]
        for s in r.json()["stages"]
    )


async def test_submitted_stage_is_closed_and_processing_blocks_changes(client, cand):
    await _do_quiz(client, cand)
    assert (await client.put(f"{A}/quiz", json={"answers": []}, headers=cand)).status_code == 409
    assert (await client.post(f"{A}/quiz/submit", headers=cand)).status_code == 409
    await _do_interview(client, cand)
    await _do_profile(client, cand)  # усе подано → PROCESSING
    assert (
        await client.post(f"{A}/quiz/retake", headers=cand)
    ).status_code == 409  # триває обробка
    a = await _state(client, cand)
    fid = next(f["id"] for f in a["profile_fields"] if f["label"] == "Ім'я")
    assert (
        await client.put(
            f"{A}/profile", json={"answers": [{"question_id": fid, "value": "Нове"}]}, headers=cand
        )
    ).status_code == 409
    assert not any(s["can_edit"] or s["can_retake"] for s in a["stages"])


async def test_profile_edit_is_logged_and_restarts_analysis(
    client, cand, session_factory, hr_h, isolated_infra
):  # noqa: F811
    await _do_quiz(client, cand)
    await _do_interview(client, cand)
    await _do_profile(client, cand, "Олена")
    aid = await _finish_analysis(session_factory)
    a = await _state(client, cand)
    assert [s["can_edit"] for s in a["stages"]] == [True, False, False]

    fid = next(f["id"] for f in a["profile_fields"] if f["label"] == "Ім'я")
    # порожня правка: без запису й перезапуску
    same = await client.put(
        f"{A}/profile", json={"answers": [{"question_id": fid, "value": "Олена"}]}, headers=cand
    )
    assert same.status_code == 200 and same.json()["stage"] == "DONE"
    r = await client.put(
        f"{A}/profile",
        json={"answers": [{"question_id": fid, "value": "Олена Іванівна"}]},
        headers=cand,
    )
    assert r.status_code == 200 and r.json()["stage"] == "PROCESSING"
    assert isolated_infra[-1] == -aid  # аналіз перезапущено

    # обов'язкове поле не можна стерти
    async with session_factory() as db:
        (await db.execute(select(Assessment))).scalar_one().stage = AssessmentStage.DONE
        await db.commit()
    assert (
        await client.put(
            f"{A}/profile", json={"answers": [{"question_id": fid, "value": ""}]}, headers=cand
        )
    ).status_code == 422

    events = (await client.get(f"/api/hr/candidates/{aid}", headers=hr_h)).json()["events"]
    kinds = [e["kind"] for e in events]
    assert kinds[:2] == ["ANALYSIS_RESTARTED", "STAGE_UPDATED"]
    updated = next(e for e in events if e["kind"] == "STAGE_UPDATED")
    assert updated["stage"] == "PROFILE" and updated["methodology_version"] == 1
    assert updated["details"]["changes"] == [
        {"field": "Ім'я", "old": "Олена", "new": "Олена Іванівна"}
    ]


async def test_quiz_retake_archives_attempt_and_reruns_analysis(
    client, cand, session_factory, hr_h, isolated_infra
):  # noqa: F811
    await _do_profile(client, cand)
    await _do_interview(client, cand)
    await _do_quiz(client, cand, scale=2)
    aid = await _finish_analysis(session_factory)

    r = await client.post(f"{A}/quiz/retake", headers=cand)
    assert r.status_code == 200
    body = r.json()
    assert body["stage"] == "IN_PROGRESS" and _statuses(body)["QUIZ"] == "NOT_STARTED"
    assert body["quiz_answers"] == {}  # поточні відповіді очищено
    # HR бачить попередню спробу в журналі
    events = (await client.get(f"/api/hr/candidates/{aid}", headers=hr_h)).json()["events"]
    retaken = next(e for e in events if e["kind"] == "STAGE_RETAKEN")
    assert retaken["stage"] == "QUIZ"
    assert {a["question"]: a["value"] for a in retaken["details"]["answers"]} == {
        "Пріоритет": "Розвиток",
        "Стрес": 2,
    }

    r = await _do_quiz(client, cand, scale=5)
    assert r.json()["stage"] == "PROCESSING" and isolated_infra[-1] == -aid
    kinds = [
        e["kind"]
        for e in (await client.get(f"/api/hr/candidates/{aid}", headers=hr_h)).json()["events"]
    ]
    assert kinds.count("STAGE_RETAKEN") == 1 and "ANALYSIS_RESTARTED" in kinds


async def test_interview_retake_resets_attempts_and_logs_it(
    client, cand, session_factory, hr_h, tmp_path
):
    await _do_profile(client, cand)
    await _do_quiz(client, cand)
    a = await _state(client, cand)
    qid = a["interview_questions"][0]["id"]
    for dur in ("20", "25"):  # дві спроби — ліміт методології
        await client.post(
            f"{A}/interview/{qid}/audio", files=AUDIO, data={"duration_sec": dur}, headers=cand
        )
    await client.post(f"{A}/interview/submit", headers=cand)
    aid = await _finish_analysis(session_factory)
    assert (await _state(client, cand))["voice"][0]["attempts_left"] == 0

    r = await client.post(f"{A}/interview/retake", headers=cand)
    assert r.status_code == 200
    v = r.json()["voice"][0]
    assert (
        v["attempts_used"] == 0 and v["attempts_left"] == 2 and not v["can_rerecord"]
    )  # лічильник скинуто

    events = (await client.get(f"/api/hr/candidates/{aid}", headers=hr_h)).json()["events"]
    d = next(e for e in events if e["kind"] == "STAGE_RETAKEN")["details"]
    assert d["attempts_reset"] == [{"question": "Розкажіть про себе", "attempts_used": 2}]
    archived = d["answers"][0]["audio"]
    assert (
        archived.startswith("archive/") and (Path(tmp_path) / archived).exists()
    )  # аудіо збережено, а не видалено
    # новий запис не затирає архів
    await client.post(
        f"{A}/interview/{qid}/audio", files=AUDIO, data={"duration_sec": "10"}, headers=cand
    )
    assert (Path(tmp_path) / archived).exists()


async def test_retake_rules(client, cand):
    assert (
        await client.post(f"{A}/profile/retake", headers=cand)
    ).status_code == 422  # анкету редагують, а не проходять заново
    assert (await client.post(f"{A}/quiz/retake", headers=cand)).status_code == 409  # ще не подано
    assert (await client.post(f"{A}/nonsense/retake", headers=cand)).status_code == 422


async def test_events_hidden_from_candidate_and_version_bump(
    client, cand, method_h, full_methodology
):  # noqa: F811
    assert "events" not in await _state(client, cand)
    # версія методології: v1; повернення в чернетку (кандидатів уже немає — інша методологія) збільшує її
    m = (await client.post("/api/methodologies", json={"title": "Нова"}, headers=method_h)).json()
    assert m["version"] == 1
    await client.put(
        f"/api/methodologies/{m['id']}/profile-fields",
        json=[{"label": "Ім'я", "type": "TEXT"}],
        headers=method_h,
    )
    await client.put(
        f"/api/methodologies/{m['id']}/quiz-questions",
        json=[{"text": "Q", "type": "TEXT"}],
        headers=method_h,
    )
    await client.put(
        f"/api/methodologies/{m['id']}/graph",
        json={"nodes": [{"key": "a", "name": "A"}], "edges": []},
        headers=method_h,
    )
    assert (
        await client.patch(
            f"/api/methodologies/{m['id']}", json={"status": "ACTIVE"}, headers=method_h
        )
    ).json()["version"] == 1
    back = await client.patch(
        f"/api/methodologies/{m['id']}", json={"status": "DRAFT"}, headers=method_h
    )
    assert back.status_code == 200 and back.json()["version"] == 2


async def test_failed_transcription_lets_candidate_rerecord(
    client, cand, session_factory, hr_h, isolated_infra
):  # noqa: F811
    await _do_profile(client, cand)
    await _do_quiz(client, cand)
    await _do_interview(client, cand)  # усе подано → PROCESSING
    a = await _state(client, cand)
    assert a["stage"] == "PROCESSING" and a["processing_problem"] is False
    assert (
        await client.post(f"{A}/interview/retake", headers=cand)
    ).status_code == 409  # поки що обробка йде

    from app.models import TranscriptStatus, VoiceAnswer

    async with session_factory() as db:  # транскрипція не вдалася (наприклад, немає ключа сервісу)
        v = (await db.execute(select(VoiceAnswer))).scalar_one()
        v.transcript_status = TranscriptStatus.FAILED
        v.transcript_error = "Немає ключа OPENAI_API_KEY"
        await db.commit()
    a = await _state(client, cand)
    assert a["processing_problem"] is True
    interview = next(s for s in a["stages"] if s["key"] == "INTERVIEW")
    assert interview["can_retake"] is True
    # технічна помилка кандидату не показується
    assert "OPENAI" not in str(a)
    # інші етапи під час обробки лишаються закритими
    quiz = next(s for s in a["stages"] if s["key"] == "QUIZ")
    assert (
        quiz["can_retake"] is False
        and (await client.post(f"{A}/quiz/retake", headers=cand)).status_code == 409
    )

    r = await client.post(f"{A}/interview/retake", headers=cand)
    assert (
        r.status_code == 200
        and r.json()["stage"] == "IN_PROGRESS"
        and r.json()["processing_problem"] is False
    )
    r = await _do_interview(client, cand)
    assert r.json()["stage"] == "PROCESSING"
    assert isolated_infra[-1] < 0  # аналіз перезапущено


async def test_hr_can_play_archived_attempt(client, cand, session_factory, hr_h, tmp_path):  # noqa: F811
    await _do_profile(client, cand)
    await _do_quiz(client, cand)
    await _do_interview(client, cand)
    aid = await _finish_analysis(session_factory)
    await client.post(f"{A}/interview/retake", headers=cand)
    events = (await client.get(f"/api/hr/candidates/{aid}", headers=hr_h)).json()["events"]
    ev = next(e for e in events if e["kind"] == "STAGE_RETAKEN")
    r = await client.get(f"/api/audio/archive/{ev['id']}/0", headers=hr_h)
    assert r.status_code == 200 and r.content == b"fake-audio-bytes"
    # кандидат до архіву не має доступу; неіснуючий індекс і подія іншого типу — 404
    assert (await client.get(f"/api/audio/archive/{ev['id']}/0", headers=cand)).status_code == 403
    assert (await client.get(f"/api/audio/archive/{ev['id']}/5", headers=hr_h)).status_code == 404
    other = next(e for e in events if e["kind"] == "STAGE_SUBMITTED")
    assert (
        await client.get(f"/api/audio/archive/{other['id']}/0", headers=hr_h)
    ).status_code == 404
    # шлях з журналу не виходить за межі сховища
    async with session_factory() as db:
        from app.models import AssessmentEvent

        e = await db.get(AssessmentEvent, ev["id"])
        e.details = {
            **e.details,
            "answers": [{**e.details["answers"][0], "audio": "archive/../../etc/passwd"}],
        }
        await db.commit()
    assert (await client.get(f"/api/audio/archive/{ev['id']}/0", headers=hr_h)).status_code == 404
