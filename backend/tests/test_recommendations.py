from datetime import UTC, datetime, timedelta

import pytest_asyncio
from sqlalchemy import select, update

from app.models import Assessment, AssessmentStage, RecommendationLink
from app.services.context_builder import build_candidate_context
from tests.conftest import CONSENTS, PASSWORD

QUESTIONS = [
    {"text": "Як ви працювали разом?", "hint": "Коротко"},
    {"text": "Сильні сторони?", "hint": ""},
]


@pytest_asyncio.fixture
async def methodology(client, method_h):
    mid = (await client.post("/api/methodologies", json={"title": "Рек"}, headers=method_h)).json()[
        "id"
    ]
    await client.put(
        f"/api/methodologies/{mid}/profile-fields",
        json=[{"label": "Ім'я", "type": "TEXT"}],
        headers=method_h,
    )
    await client.put(
        f"/api/methodologies/{mid}/quiz-questions",
        json=[{"text": "Шкала", "type": "SCALE"}],
        headers=method_h,
    )
    await client.put(
        f"/api/methodologies/{mid}/graph",
        json={"nodes": [{"key": "a", "name": "A", "prompt_text": "p"}], "edges": []},
        headers=method_h,
    )
    r = await client.put(
        f"/api/methodologies/{mid}/recommendation-questions", json=QUESTIONS, headers=method_h
    )
    assert r.status_code == 200 and [q["order"] for q in r.json()] == [0, 1]
    assert (
        await client.patch(f"/api/methodologies/{mid}", json={"status": "ACTIVE"}, headers=method_h)
    ).status_code == 200
    return (await client.get(f"/api/methodologies/{mid}", headers=method_h)).json()


@pytest_asyncio.fixture
async def cand_h(client, methodology):
    r = await client.post(
        "/api/auth/register",
        json={
            "code": methodology["invite_code"],
            "email": "cand@t.com",
            "password": PASSWORD,
            "password_confirm": PASSWORD,
            "consents": CONSENTS,
            "name": "Олена Кандидатка",
        },
    )
    assert r.status_code == 201, r.text
    return {"authorization": f"Bearer {r.json()['access_token']}"}


async def _links(client, h):
    return (await client.get("/api/candidate/recommendations", headers=h)).json()


def _answers(public, text="Відповідь"):
    return [{"question_id": q["id"], "text": text} for q in public["questions"]]


async def test_questions_frozen_after_activation(client, method_h, methodology):
    r = await client.put(
        f"/api/methodologies/{methodology['id']}/recommendation-questions",
        json=QUESTIONS,
        headers=method_h,
    )
    assert r.status_code == 409
    assert [q["text"] for q in methodology["recommendation_questions"]] == [
        q["text"] for q in QUESTIONS
    ]


async def test_candidate_gets_four_stable_links(client, cand_h):
    first = await _links(client, cand_h)
    assert first["enabled"] and first["total"] == 4 and first["used"] == 0
    assert [link["slot"] for link in first["links"]] == [1, 2, 3, 4]
    tokens = [link["token"] for link in first["links"]]
    assert len(set(tokens)) == 4 and all(len(t) >= 40 for t in tokens)
    assert [
        link["token"] for link in (await _links(client, cand_h))["links"]
    ] == tokens  # повторний запит не змінює


async def test_always_enabled_even_without_questions(client, active_methodology):
    r = await client.post(
        "/api/auth/register",
        json={
            "code": active_methodology["invite_code"],
            "email": "c2@t.com",
            "password": PASSWORD,
            "password_confirm": PASSWORD,
            "consents": CONSENTS,
            "name": "К",
        },
    )
    h = {"authorization": f"Bearer {r.json()['access_token']}"}
    out = await _links(client, h)
    # D-69 / BR-3: етап «Рекомендації» є завжди, навіть без питань у методології
    assert out["enabled"] is True and len(out["links"]) == 4


async def test_public_page_hides_candidate(client, cand_h):
    token = (await _links(client, cand_h))["links"][0]["token"]
    page = await client.get(f"/api/recommend/{token}")
    assert page.status_code == 200
    body = page.json()
    assert [r["id"] for r in body["roles"]] == ["MANAGER", "COLLEAGUE", "SUBORDINATE"]
    assert len(body["questions"]) == 2
    # BR-14: ім'я кандидата віддається (UI показує його з кроку ролі), але не пошта й не методологія
    assert body["candidate"] == {"name": "Олена Кандидатка", "post": None}
    assert "cand@t.com" not in page.text and "Рек" not in page.text
    assert (await client.get("/api/recommend/no-such-token")).status_code == 404


async def test_submit_is_one_time_and_validated(client, cand_h):
    token = (await _links(client, cand_h))["links"][0]["token"]
    pub = (await client.get(f"/api/recommend/{token}")).json()
    # не всі питання / порожня відповідь / невідоме питання / чужа роль
    assert (
        await client.post(
            f"/api/recommend/{token}/submit", json={"role": "MANAGER", "answers": _answers(pub)[:1]}
        )
    ).status_code == 422
    assert (
        await client.post(
            f"/api/recommend/{token}/submit",
            json={"role": "MANAGER", "answers": _answers(pub, "   ")},
        )
    ).status_code == 422
    assert (
        await client.post(
            f"/api/recommend/{token}/submit", json={"role": "BOSS", "answers": _answers(pub)}
        )
    ).status_code == 422
    bad_q = _answers(pub)
    bad_q[0]["question_id"] = 99999
    assert (
        await client.post(
            f"/api/recommend/{token}/submit", json={"role": "MANAGER", "answers": bad_q}
        )
    ).status_code == 422

    ok = await client.post(
        f"/api/recommend/{token}/submit",
        json={"role": "COLLEAGUE", "answers": _answers(pub, "Чудовий колега")},
    )
    assert ok.status_code == 204
    # вдруге — «використано»
    assert (await client.get(f"/api/recommend/{token}")).status_code == 410
    assert (
        await client.post(
            f"/api/recommend/{token}/submit", json={"role": "COLLEAGUE", "answers": _answers(pub)}
        )
    ).status_code == 410
    assert (await client.post(f"/api/recommend/{token}/decline")).status_code == 410


async def test_expired_link(client, session_factory, cand_h):
    token = (await _links(client, cand_h))["links"][0]["token"]
    async with session_factory() as db:
        await db.execute(
            update(RecommendationLink)
            .where(RecommendationLink.token == token)
            .values(expires_at=datetime.now(UTC) - timedelta(days=1))
        )
        await db.commit()
    r = await client.get(f"/api/recommend/{token}")
    assert r.status_code == 410 and "Термін" in r.json()["detail"]
    assert (await client.post(f"/api/recommend/{token}/decline")).status_code == 410
    mine = await _links(client, cand_h)
    assert mine["links"][0]["expired"] is True and mine["links"][0]["token"] is None


async def test_decline_counts_as_used_but_hidden_from_hr(client, session_factory, cand_h, hr_h):
    links = (await _links(client, cand_h))["links"]
    assert (await client.post(f"/api/recommend/{links[0]['token']}/decline")).status_code == 204
    pub = (await client.get(f"/api/recommend/{links[1]['token']}")).json()
    await client.post(
        f"/api/recommend/{links[1]['token']}/submit",
        json={"role": "MANAGER", "answers": _answers(pub)},
    )

    mine = await _links(client, cand_h)
    assert mine["used"] == 2
    # кандидат не бачить різниці між відгуком і відмовою
    assert {link["status"] for link in mine["links"] if link["slot"] in (1, 2)} == {"USED"}
    assert all(link["token"] is None for link in mine["links"] if link["status"] == "USED")

    aid = await _submit_assessment(session_factory)
    detail = (await client.get(f"/api/hr/candidates/{aid}", headers=hr_h)).json()
    assert [r["role"] for r in detail["recommendations"]] == ["MANAGER"]  # відмову HR не бачить


async def _submit_assessment(session_factory) -> int:
    async with session_factory() as db:
        a = (await db.execute(select(Assessment))).scalars().first()
        a.stage = AssessmentStage.DONE
        a.submitted_at = datetime.now(UTC)
        await db.commit()
        return a.id


async def test_hr_view_is_anonymous_and_grouped_by_role(
    client, session_factory, cand_h, hr_h, method_h, admin_h
):
    links = (await _links(client, cand_h))["links"]
    for link, role in zip(links, ["SUBORDINATE", "MANAGER", "COLLEAGUE", "MANAGER"], strict=True):
        pub = (await client.get(f"/api/recommend/{link['token']}")).json()
        r = await client.post(
            f"/api/recommend/{link['token']}/submit",
            json={"role": role, "answers": _answers(pub, f"текст {role}")},
        )
        assert r.status_code == 204
    aid = await _submit_assessment(session_factory)

    detail = (await client.get(f"/api/hr/candidates/{aid}", headers=hr_h)).json()
    assert [r["role"] for r in detail["recommendations"]] == [
        "MANAGER",
        "MANAGER",
        "COLLEAGUE",
        "SUBORDINATE",
    ]
    assert detail["recommendations"][0]["role_label"] == "Керівник"
    first = detail["recommendations"][0]
    assert set(first) == {"role", "role_label", "answers"}  # без часу, id, посилання
    assert [a["question"] for a in first["answers"]] == [q["text"] for q in QUESTIONS]
    # методолог бачить те саме
    assert (
        await client.get(f"/api/analysis/candidates/{aid}", headers=method_h)
    ).status_code == 403  # BR-17
    full = (await client.get(f"/api/analysis/candidates/{aid}", headers=admin_h)).json()
    assert len(full["recommendations"]) == 4


async def test_renew_replaces_token_but_not_used(client, cand_h):
    links = (await _links(client, cand_h))["links"]
    old = links[0]["token"]
    r = await client.post("/api/candidate/recommendations/1/renew", headers=cand_h)
    assert r.status_code == 200
    new = r.json()["links"][0]["token"]
    assert new != old
    assert (await client.get(f"/api/recommend/{old}")).status_code == 404
    assert (await client.get(f"/api/recommend/{new}")).status_code == 200
    await client.post(f"/api/recommend/{new}/decline")
    assert (
        await client.post("/api/candidate/recommendations/1/renew", headers=cand_h)
    ).status_code == 409
    assert (
        await client.post("/api/candidate/recommendations/9/renew", headers=cand_h)
    ).status_code == 404


async def test_candidate_only_and_isolated(client, session_factory, cand_h, hr_h, methodology):
    assert (await client.get("/api/candidate/recommendations", headers=hr_h)).status_code == 403
    assert (await client.get("/api/candidate/recommendations")).status_code == 401
    # другий кандидат має власні, інші токени
    r = await client.post(
        "/api/auth/register",
        json={
            "code": methodology["invite_code"],
            "email": "cand2@t.com",
            "password": PASSWORD,
            "password_confirm": PASSWORD,
            "consents": CONSENTS,
            "name": "Інший",
        },
    )
    h2 = {"authorization": f"Bearer {r.json()['access_token']}"}
    t1 = {link["token"] for link in (await _links(client, cand_h))["links"]}
    t2 = {link["token"] for link in (await _links(client, h2))["links"]}
    assert t1.isdisjoint(t2)


async def test_reviews_reach_ai_context(client, session_factory, cand_h):
    links = (await _links(client, cand_h))["links"]
    pub = (await client.get(f"/api/recommend/{links[0]['token']}")).json()
    await client.post(
        f"/api/recommend/{links[0]['token']}/submit",
        json={"role": "SUBORDINATE", "answers": _answers(pub, "Вимогливий, але справедливий")},
    )
    await client.post(f"/api/recommend/{links[1]['token']}/decline")
    aid = await _submit_assessment(session_factory)
    async with session_factory() as db:
        from sqlalchemy.orm import selectinload

        from app.models import Methodology

        a = (
            await db.execute(
                select(Assessment)
                .where(Assessment.id == aid)
                .options(
                    selectinload(Assessment.methodology).options(
                        selectinload(Methodology.profile_fields),
                        selectinload(Methodology.quiz_questions),
                        selectinload(Methodology.interview_questions),
                    ),
                    selectinload(Assessment.profile_answers),
                    selectinload(Assessment.quiz_answers),
                    selectinload(Assessment.voice_answers),
                    selectinload(Assessment.recommendation_links)
                    .selectinload(RecommendationLink.recommendation)
                    .selectinload(
                        __import__("app.models", fromlist=["Recommendation"]).Recommendation.answers
                    ),
                )
            )
        ).scalar_one()
        ctx = await db.run_sync(lambda _s: build_candidate_context(a))
    assert "## Відгуки рекомендаторів" in ctx
    assert "роль рекомендатора: Підлеглий" in ctx and "Вимогливий, але справедливий" in ctx
    assert "Олена" not in ctx.split("## Відгуки рекомендаторів")[1]
