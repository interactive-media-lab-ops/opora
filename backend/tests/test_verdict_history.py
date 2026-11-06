from datetime import UTC, datetime

import pytest_asyncio

from app.models import Assessment, AssessmentStage, User, UserRole
from app.security import hash_password
from tests.conftest import PASSWORD, login


@pytest_asyncio.fixture
async def aid(session_factory, active_methodology):
    async with session_factory() as db:
        u = User(
            email="c@t.com",
            name="Кандидат",
            role=UserRole.CANDIDATE,
            password_hash=hash_password(PASSWORD),
        )
        db.add(u)
        await db.flush()
        a = Assessment(
            candidate_id=u.id,
            methodology_id=active_methodology["id"],
            stage=AssessmentStage.DONE,
            submitted_at=datetime.now(UTC),
        )
        db.add(a)
        await db.commit()
        return a.id


async def _put(client, aid, headers, verdict, note=""):
    r = await client.put(
        f"/api/hr/candidates/{aid}/verdict",
        json={"verdict": verdict, "note": note},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return r.json()


async def test_history_starts_empty(client, hr_h, aid):
    d = (await client.get(f"/api/hr/candidates/{aid}", headers=hr_h)).json()
    assert d["history"] == []


async def test_changes_are_logged_newest_first(client, hr_h, admin_h, aid):
    await _put(client, aid, hr_h, "IN_REVIEW")
    await _put(client, aid, admin_h, "RECOMMENDED", "Сильна кандидатка")
    # BR-6: нотатка більше не зберігається з вердиктом, тож зміна самої нотатки запису не створює
    d = await _put(client, aid, hr_h, "RECOMMENDED", "Сильна кандидатка; запросити на співбесіду")

    h = d["history"]
    assert len(h) == 2
    assert (h[0]["old_verdict"], h[0]["new_verdict"], h[0]["author_name"]) == (
        "IN_REVIEW",
        "RECOMMENDED",
        "admin",
    )
    assert (h[1]["old_verdict"], h[1]["new_verdict"]) == (None, "IN_REVIEW")
    assert d["verdict_note"] == ""


async def test_noop_save_adds_no_entry(client, hr_h, aid):
    await _put(client, aid, hr_h, "REJECTED", "Не підходить")
    d = await _put(client, aid, hr_h, "REJECTED", "Не підходить")
    assert len(d["history"]) == 1


async def test_reset_verdict_is_logged(client, hr_h, aid):
    await _put(client, aid, hr_h, "REJECTED", "н")
    d = await _put(client, aid, hr_h, None, "н")
    assert (d["history"][0]["old_verdict"], d["history"][0]["new_verdict"]) == ("REJECTED", None)


async def test_history_hidden_from_other_roles(client, method_h, hr_h, aid):
    await _put(client, aid, hr_h, "IN_REVIEW")
    full = (await client.get(f"/api/analysis/candidates/{aid}", headers=method_h)).json()
    assert "history" not in full
    assert (await client.get(f"/api/hr/candidates/{aid}", headers=method_h)).status_code == 403
    # кандидат не має доступу до жодного HR-ендпоінту
    cand = await login(client, "c@t.com")
    assert (await client.get(f"/api/hr/candidates/{aid}", headers=cand)).status_code == 403
