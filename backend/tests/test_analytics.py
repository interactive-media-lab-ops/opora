from datetime import UTC, datetime

from sqlalchemy import select

from app.models import (
    AnalysisResult,
    AnalysisStatus,
    Assessment,
    AssessmentStage,
    PromptNode,
    User,
    UserRole,
)
from app.security import hash_password
from tests.conftest import PASSWORD

AXES = [
    ("a", "Комунікація", "CONVERSATION"),
    ("b", "Мотивація", "SELF"),
    ("c", "Лідерство", "REVIEWS"),
]


async def _methodology(client, method_h, nodes, title="Аналітика"):
    mid = (await client.post("/api/methodologies", json={"title": title}, headers=method_h)).json()[
        "id"
    ]
    await client.put(
        f"/api/methodologies/{mid}/profile-fields",
        json=[{"label": "Ім'я", "type": "TEXT"}],
        headers=method_h,
    )
    await client.put(
        f"/api/methodologies/{mid}/quiz-questions",
        json=[{"text": "Q", "type": "TEXT"}],
        headers=method_h,
    )
    r = await client.put(
        f"/api/methodologies/{mid}/graph", json={"nodes": nodes, "edges": []}, headers=method_h
    )
    return mid, r


def _node(key, name, axis=None, source=None, score=True):
    return {
        "key": key,
        "name": name,
        "returns_score": score,
        **({"axis": axis, "source": source} if axis else {}),
    }


async def _candidate(session_factory, mid, results: dict[str, float | None], terminal=()):
    """Подане проходження з результатами вузлів: назва вузла → бал (None — вузол ще не виконано)."""
    async with session_factory() as db:
        u = User(
            email="c@t.com",
            name="К",
            role=UserRole.CANDIDATE,
            password_hash=hash_password(PASSWORD),
        )
        db.add(u)
        await db.flush()
        a = Assessment(
            candidate_id=u.id,
            methodology_id=mid,
            stage=AssessmentStage.DONE,
            submitted_at=datetime.now(UTC),
        )
        db.add(a)
        await db.flush()
        nodes = {
            n.name: n
            for n in (
                await db.execute(select(PromptNode).where(PromptNode.methodology_id == mid))
            ).scalars()
        }
        for name, score in results.items():
            db.add(
                AnalysisResult(
                    assessment_id=a.id,
                    prompt_node_id=nodes[name].id,
                    status=AnalysisStatus.DONE if score is not None else AnalysisStatus.PENDING,
                    score=score,
                    output="СЕКРЕТНИЙ ТЕКСТ",
                    is_terminal=name in terminal,
                )
            )
        await db.commit()
        return a.id


async def _analytics(client, aid, headers):
    return (await client.get(f"/api/hr/candidates/{aid}", headers=headers)).json()["analytics"]


async def test_graph_validation(client, method_h):
    _, r = await _methodology(client, method_h, [_node("a", "A", "Вісь", None)])
    assert r.status_code == 422  # вісь без джерела
    _, r = await _methodology(
        client,
        method_h,
        [{"key": "a", "name": "A", "returns_score": True, "source": "SELF"}],
        title="2",
    )
    assert r.status_code == 422  # джерело без осі
    _, r = await _methodology(
        client, method_h, [_node("a", "A", "Вісь", "SELF", score=False)], title="3"
    )
    assert r.status_code == 422  # вісь вузлу без балу
    _, r = await _methodology(
        client,
        method_h,
        [{"key": "a", "name": "A", "returns_score": True, "axis": "Вісь", "source": "BOSS"}],
        title="4",
    )
    assert r.status_code == 422  # невідоме джерело
    mid, r = await _methodology(client, method_h, [_node("a", "A", "  Вісь  ", "SELF")], title="5")
    assert r.status_code == 200
    assert (r.json()["nodes"][0]["axis"], r.json()["nodes"][0]["source"]) == ("Вісь", "SELF")


async def test_radar_with_three_sources_and_partial_data(client, method_h, hr_h, session_factory):
    mid, _ = await _methodology(client, method_h, [_node(k, n, n, s) for k, n, s in AXES])
    aid = await _candidate(
        session_factory, mid, {"Комунікація": 8, "Мотивація": 6, "Лідерство": None}
    )
    a = await _analytics(client, aid, hr_h)
    assert a["mode"] == "radar" and a["axes"] == ["Комунікація", "Мотивація", "Лідерство"]
    assert [s["key"] for s in a["sources"]] == ["SELF", "CONVERSATION", "REVIEWS"]
    assert {s["key"]: s["has_data"] for s in a["sources"]} == {
        "SELF": True,
        "CONVERSATION": True,
        "REVIEWS": False,
    }
    assert (a["sources_total"], a["sources_with_data"]) == (3, 2)  # «за 2 з 3 джерел»
    values = {s["source"]: s["values"] for s in a["series"]}
    assert values["CONVERSATION"] == {"Комунікація": 8, "Мотивація": None, "Лідерство": None}
    assert values["REVIEWS"] == {"Комунікація": None, "Мотивація": None, "Лідерство": None}
    assert a["fallback"] is False and a["configured"] is True


async def test_same_axis_averaged_and_bars_below_three_axes(
    client, method_h, hr_h, session_factory
):
    nodes = [
        _node("a", "Розмова А", "Комунікація", "CONVERSATION"),
        _node("b", "Розмова Б", "Комунікація", "CONVERSATION"),
        _node("c", "Опитувальник", "Мотивація", "SELF"),
    ]
    mid, _ = await _methodology(client, method_h, nodes)
    aid = await _candidate(
        session_factory, mid, {"Розмова А": 8, "Розмова Б": 5, "Опитувальник": 7}
    )
    a = await _analytics(client, aid, hr_h)
    assert a["mode"] == "bars" and a["axes"] == ["Комунікація", "Мотивація"]  # 2 осі — смуги
    assert {s["source"]: s["values"] for s in a["series"]}["CONVERSATION"]["Комунікація"] == 6.5


async def test_more_than_eight_axes_use_bars(client, method_h, hr_h, session_factory):
    nodes = [_node(f"n{i}", f"Принцип {i}", f"Принцип {i}", "SELF") for i in range(9)]
    mid, _ = await _methodology(client, method_h, nodes)
    aid = await _candidate(session_factory, mid, {f"Принцип {i}": 5 for i in range(9)})
    assert (await _analytics(client, aid, hr_h))["mode"] == "bars"


async def test_fallback_to_final_scores_when_not_tagged(client, method_h, hr_h, session_factory):
    nodes = [_node("a", "Проміжний"), _node("b", "Підсумок")]
    mid, _ = await _methodology(client, method_h, nodes)
    aid = await _candidate(
        session_factory, mid, {"Проміжний": 4, "Підсумок": 9}, terminal=("Підсумок",)
    )
    a = await _analytics(client, aid, hr_h)
    assert a["fallback"] is True and a["axes"] == ["Підсумок"]
    assert [s["key"] for s in a["sources"]] == ["OVERALL"] and a["series"][0]["values"] == {
        "Підсумок": 9
    }


async def test_no_scored_nodes_means_not_configured(client, method_h, hr_h, session_factory):
    mid, _ = await _methodology(client, method_h, [_node("a", "Текстовий", score=False)])
    aid = await _candidate(session_factory, mid, {"Текстовий": None})
    a = await _analytics(client, aid, hr_h)
    assert a["configured"] is False and a["axes"] == [] and a["series"] == []


async def test_scores_exposed_but_not_text_and_not_to_candidate(
    client, method_h, hr_h, session_factory
):
    # вузол розмічено, але він не фінальний: оцінка потрапляє в аналітику, а його текст HR і далі не бачить
    nodes = [_node("a", "Проміжний", "Вісь 1", "SELF"), _node("b", "Підсумок")]
    mid, _ = await _methodology(client, method_h, nodes)
    aid = await _candidate(
        session_factory, mid, {"Проміжний": 7, "Підсумок": 9}, terminal=("Підсумок",)
    )
    detail = (await client.get(f"/api/hr/candidates/{aid}", headers=hr_h)).json()
    assert detail["analytics"]["series"][0]["values"] == {"Вісь 1": 7}
    assert (
        "СЕКРЕТНИЙ ТЕКСТ" in str(detail["final_conclusions"])
        and len(detail["final_conclusions"]) == 1
    )
    assert detail["analytics"].keys() >= {
        "mode",
        "axes",
        "series",
    } and "СЕКРЕТНИЙ ТЕКСТ" not in str(detail["analytics"])
    # кандидату аналітика недоступна: ні HR-ендпоінт, ні поля в його відповіді
    from tests.conftest import login

    cand = await login(client, "c@t.com")
    assert (await client.get(f"/api/hr/candidates/{aid}", headers=cand)).status_code == 403
    assert "analytics" not in (await client.get("/api/candidate/assessment", headers=cand)).json()
