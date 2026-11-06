import pytest
import pytest_asyncio
from sqlalchemy import select

from app.main import app
from app.models import AnalysisResult, AnalysisStatus, Assessment, AssessmentStage, PromptNode
from app.services import queue
from app.services.storage import StorageService, get_storage
from tests.conftest import CONSENTS


@pytest.fixture(autouse=True)
def isolated_infra(tmp_path, monkeypatch):
    enqueued: list[int] = []
    monkeypatch.setattr(queue, "enqueue_assessment_processing", lambda aid: enqueued.append(aid))
    monkeypatch.setattr(
        queue, "enqueue_retry_analysis", lambda aid, only_failed=True: enqueued.append(-aid)
    )
    app.dependency_overrides[get_storage] = lambda: StorageService(str(tmp_path))
    yield enqueued
    app.dependency_overrides.pop(get_storage, None)


@pytest_asyncio.fixture
async def full_methodology(client, method_h):
    mid = (
        await client.post(
            "/api/methodologies",
            json={"title": "Повна", "allow_rerecord": True, "max_record_attempts": 2},
            headers=method_h,
        )
    ).json()["id"]
    base = f"/api/methodologies/{mid}"
    await client.put(
        f"{base}/profile-fields",
        json=[
            {"label": "Ім'я", "type": "TEXT", "required": True},
            {"label": "Стаж", "type": "NUMBER", "required": False},
        ],
        headers=method_h,
    )
    await client.put(
        f"{base}/quiz-questions",
        json=[
            {"text": "Пріоритет", "type": "SINGLE_CHOICE", "options": ["Гроші", "Розвиток"]},
            {"text": "Стрес", "type": "SCALE", "options": [1, 5]},
        ],
        headers=method_h,
    )
    await client.put(
        f"{base}/interview-questions",
        json=[{"text": "Розкажіть про себе", "max_duration_sec": 60}],
        headers=method_h,
    )
    await client.put(
        f"{base}/graph",
        json={
            "nodes": [
                {
                    "key": "a",
                    "name": "Комунікація",
                    "returns_score": True,
                    "prompt_text": "СЕКРЕТНИЙ ПРОМТ",
                },
                {"key": "b", "name": "Підсумок", "returns_score": True},
            ],
            "edges": [{"source": "a", "target": "b"}],
        },
        headers=method_h,
    )
    r = await client.patch(base, json={"status": "ACTIVE"}, headers=method_h)
    assert r.status_code == 200, r.text
    return r.json()


async def _register(client, method_h, mid, email="cand@t.com"):
    code = (
        (await client.get(f"/api/methodologies/{mid}/invite-link", headers=method_h))
        .json()["general_url"]
        .rsplit("/", 1)[1]
    )
    r = await client.post(
        "/api/auth/register",
        json={
            "code": code,
            "email": email,
            "password": "Passw0rd!x",
            "password_confirm": "Passw0rd!x",
            "consents": CONSENTS,
            "name": "Олена",
        },
    )
    assert r.status_code == 201, r.text
    return {"authorization": f"Bearer {r.json()['access_token']}"}


AUDIO = {"file": ("a.webm", b"fake-audio-bytes", "audio/webm")}


async def test_full_candidate_flow(
    client, method_h, hr_h, admin_h, full_methodology, session_factory, isolated_infra
):
    cand = await _register(client, method_h, full_methodology["id"])
    a = (await client.get("/api/candidate/assessment", headers=cand)).json()
    assert a["stage"] == "IN_PROGRESS"
    assert [(s["key"], s["status"]) for s in a["stages"]] == [
        ("PROFILE", "NOT_STARTED"),
        ("QUIZ", "NOT_STARTED"),
        ("INTERVIEW", "NOT_STARTED"),
    ]
    fields = {f["label"]: f["id"] for f in a["profile_fields"]}

    # обов'язкове поле не заповнене
    assert (
        await client.post("/api/candidate/assessment/profile/submit", headers=cand)
    ).status_code == 422
    # некоректне число
    bad = await client.put(
        "/api/candidate/assessment/profile",
        json={"answers": [{"question_id": fields["Стаж"], "value": "багато"}]},
        headers=cand,
    )
    assert bad.status_code == 422
    # етапи незалежні (D-50): опитувальник можна подавати до анкети, але без відповідей — ні
    assert (
        await client.post("/api/candidate/assessment/quiz/submit", headers=cand)
    ).status_code == 422

    await client.put(
        "/api/candidate/assessment/profile",
        json={
            "answers": [
                {"question_id": fields["Ім'я"], "value": "Олена"},
                {"question_id": fields["Стаж"], "value": "3"},
            ]
        },
        headers=cand,
    )
    r = await client.post("/api/candidate/assessment/profile/submit", headers=cand)
    assert r.json()["stage"] == "IN_PROGRESS"
    assert (
        r.json()["stages"][0]["status"] == "SUBMITTED" and r.json()["stages"][0]["can_edit"] is True
    )
    # порожнє збереження поданої анкети нічого не змінює
    assert (
        await client.put("/api/candidate/assessment/profile", json={"answers": []}, headers=cand)
    ).status_code == 200

    quiz = {q["text"]: q["id"] for q in r.json()["quiz_questions"]}
    # шкала поза межами
    assert (
        await client.put(
            "/api/candidate/assessment/quiz",
            json={"answers": [{"question_id": quiz["Стрес"], "value": 9}]},
            headers=cand,
        )
    ).status_code == 422
    await client.put(
        "/api/candidate/assessment/quiz",
        json={"answers": [{"question_id": quiz["Пріоритет"], "value": "Розвиток"}]},
        headers=cand,
    )
    assert (
        await client.post("/api/candidate/assessment/quiz/submit", headers=cand)
    ).status_code == 422  # не всі відповіді
    await client.put(
        "/api/candidate/assessment/quiz",
        json={"answers": [{"question_id": quiz["Стрес"], "value": 4}]},
        headers=cand,
    )
    r = await client.post("/api/candidate/assessment/quiz/submit", headers=cand)
    assert r.json()["stage"] == "IN_PROGRESS"
    qid = r.json()["interview_questions"][0]["id"]

    # подати інтерв'ю без запису не можна
    assert (
        await client.post("/api/candidate/assessment/interview/submit", headers=cand)
    ).status_code == 422
    # занадто довгий запис
    too_long = await client.post(
        f"/api/candidate/assessment/interview/{qid}/audio",
        files=AUDIO,
        data={"duration_sec": "300"},
        headers=cand,
    )
    assert too_long.status_code == 422
    # не аудіо
    not_audio = await client.post(
        f"/api/candidate/assessment/interview/{qid}/audio",
        files={"file": ("a.txt", b"x", "text/plain")},
        data={"duration_sec": "10"},
        headers=cand,
    )
    assert not_audio.status_code == 415

    first = await client.post(
        f"/api/candidate/assessment/interview/{qid}/audio",
        files=AUDIO,
        data={"duration_sec": "20"},
        headers=cand,
    )
    assert first.status_code == 200
    assert (
        first.json()["voice"][0]["attempts_left"] == 1
        and first.json()["voice"][0]["can_rerecord"] is True
    )
    second = await client.post(
        f"/api/candidate/assessment/interview/{qid}/audio",
        files=AUDIO,
        data={"duration_sec": "25"},
        headers=cand,
    )
    assert second.status_code == 200 and second.json()["voice"][0]["can_rerecord"] is False
    third = await client.post(
        f"/api/candidate/assessment/interview/{qid}/audio",
        files=AUDIO,
        data={"duration_sec": "25"},
        headers=cand,
    )
    assert third.status_code == 409  # ліміт спроб

    r = await client.post("/api/candidate/assessment/interview/submit", headers=cand)
    assert r.status_code == 200 and r.json()["stage"] == "PROCESSING"
    async with session_factory() as db:
        assessment = (await db.execute(select(Assessment))).scalar_one()
        assert assessment.submitted_at is not None
        assert isolated_infra == [assessment.id]  # обробку поставлено в чергу рівно раз
        nodes = {n.name: n for n in (await db.execute(select(PromptNode))).scalars()}
        db.add_all(
            [
                AnalysisResult(
                    assessment_id=assessment.id,
                    prompt_node_id=nodes["Комунікація"].id,
                    status=AnalysisStatus.DONE,
                    output="проміжний висновок",
                    score=6,
                    is_terminal=False,
                ),
                AnalysisResult(
                    assessment_id=assessment.id,
                    prompt_node_id=nodes["Підсумок"].id,
                    status=AnalysisStatus.DONE,
                    output="фінальний висновок",
                    score=8,
                    is_terminal=True,
                ),
            ]
        )
        assessment.stage = AssessmentStage.DONE
        await db.commit()
        aid = assessment.id

    # кандидат після подання не бачить ні результатів, ні кабінетів персоналу
    assert (await client.get("/api/hr/candidates", headers=cand)).status_code == 403
    assert (await client.get(f"/api/analysis/candidates/{aid}", headers=cand)).status_code == 403

    # HR бачить лише фінальні висновки і не бачить тексти промтів
    detail = (await client.get(f"/api/hr/candidates/{aid}", headers=hr_h)).json()
    assert [c["output"] for c in detail["final_conclusions"]] == ["фінальний висновок"]
    assert detail["summary_score"] == 8
    assert (
        "СЕКРЕТНИЙ ПРОМТ" not in (await client.get(f"/api/hr/candidates/{aid}", headers=hr_h)).text
    )
    assert "results" not in detail
    # методист даних кандидатів не бачить (BR-17); усі вузли разом із промтами бачить адмін
    assert (
        await client.get(f"/api/analysis/candidates/{aid}", headers=method_h)
    ).status_code == 403
    assert (await client.get("/api/analysis/candidates", headers=method_h)).status_code == 403
    full = (await client.get(f"/api/analysis/candidates/{aid}", headers=admin_h)).json()
    assert {r["output"] for r in full["results"]} == {"проміжний висновок", "фінальний висновок"}
    assert any(r["prompt_text"] == "СЕКРЕТНИЙ ПРОМТ" for r in full["results"])
    # HR не бачить кабінет методиста
    assert (await client.get(f"/api/analysis/candidates/{aid}", headers=hr_h)).status_code == 403

    # вердикт ставить HR; методист не може
    ok = await client.put(
        f"/api/hr/candidates/{aid}/verdict",
        json={"verdict": "RECOMMENDED", "note": "Сильна кандидатка"},
        headers=hr_h,
    )
    assert ok.status_code == 200 and ok.json()["verdict"] == "RECOMMENDED"
    assert (
        await client.put(
            f"/api/hr/candidates/{aid}/verdict", json={"verdict": "REJECTED"}, headers=method_h
        )
    ).status_code == 403
    # адмін, що працює в кабінеті HR, теж може ставити вердикт
    by_admin = await client.put(
        f"/api/hr/candidates/{aid}/verdict",
        json={"verdict": "IN_REVIEW", "note": "від адміна"},
        headers=admin_h,
    )
    assert by_admin.status_code == 200 and by_admin.json()["verdict"] == "IN_REVIEW"
    await client.put(
        f"/api/hr/candidates/{aid}/verdict",
        json={"verdict": "RECOMMENDED", "note": "Сильна кандидатка"},
        headers=hr_h,
    )

    rows = (await client.get("/api/hr/candidates?verdict=RECOMMENDED", headers=hr_h)).json()
    assert len(rows) == 1 and rows[0]["summary_score"] == 8
    assert (await client.get("/api/hr/candidates?verdict=NONE", headers=hr_h)).json() == []
    assert len((await client.get("/api/hr/candidates?search=CAND@", headers=hr_h)).json()) == 1
    assert (await client.get("/api/hr/candidates?search=nobody", headers=hr_h)).json() == []

    dash = (await client.get("/api/hr/dashboard", headers=hr_h)).json()
    assert dash["total"] == 1 and dash["by_stage"]["DONE"] == 1 and dash["awaiting_verdict"] == 0

    # аудіо доступне персоналу, але не кандидату
    voice_id = detail["voice"][0]["voice_answer_id"]
    assert (await client.get(f"/api/audio/{voice_id}", headers=hr_h)).content == b"fake-audio-bytes"
    assert (await client.get(f"/api/audio/{voice_id}", headers=cand)).status_code == 403

    # повторний аналіз ставиться в чергу тільки методистом
    assert (
        await client.post(f"/api/analysis/candidates/{aid}/retry", json={}, headers=hr_h)
    ).status_code == 403
    assert (
        await client.post(f"/api/analysis/candidates/{aid}/retry", json={}, headers=method_h)
    ).status_code == 403
    assert (
        await client.post(f"/api/analysis/candidates/{aid}/retry", json={}, headers=admin_h)
    ).status_code == 202
    assert isolated_infra[-1] == -aid


async def test_unsubmitted_candidate_is_in_hr_base_with_progress(
    client, method_h, hr_h, admin_h, full_methodology
):
    await _register(client, method_h, full_methodology["id"])
    # BR-5: HR бачить усіх кандидатів із прогресом етапів; кабінет аналізу — лише подані
    rows = (await client.get("/api/hr/candidates", headers=hr_h)).json()
    assert len(rows) == 1 and rows[0]["submitted_at"] is None and rows[0]["completeness"] == 0
    assert [s["status"] for s in rows[0]["stages"]] == ["NOT_STARTED"] * 3
    assert (await client.get("/api/hr/candidates/1", headers=hr_h)).status_code == 200
    assert (await client.get("/api/analysis/candidates", headers=admin_h)).json() == []
    assert (await client.get("/api/analysis/candidates/1", headers=admin_h)).status_code == 404
