from sqlalchemy import select

from app.models import User
from tests.conftest import CONSENTS


async def _register(client, method_h, active_methodology, email):
    code = (
        (
            await client.get(
                f"/api/methodologies/{active_methodology['id']}/invite-link", headers=method_h
            )
        )
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
            "name": email.split("@")[0],
        },
    )
    assert r.status_code == 201, r.text


async def _user_id(session_factory, email):
    async with session_factory() as db:
        return (await db.execute(select(User.id).where(User.email == email))).scalar_one()


async def _mark_demo(session_factory, email):
    async with session_factory() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        user.is_demo = True
        await db.commit()


async def test_admin_enters_demo_candidate_cabinet(
    client, session_factory, method_h, admin_h, active_methodology
):
    await _register(client, method_h, active_methodology, "demo@t.com")
    await _mark_demo(session_factory, "demo@t.com")
    uid = await _user_id(session_factory, "demo@t.com")

    listed = (await client.get("/api/users/demo-candidates", headers=admin_h)).json()
    assert [c["email"] for c in listed] == ["demo@t.com"]
    assert listed[0]["stage"] == "IN_PROGRESS" and listed[0]["methodology_title"] == "Тест"

    r = await client.post(f"/api/users/{uid}/impersonate", headers=admin_h)
    assert r.status_code == 200, r.text
    assert r.json()["user"]["email"] == "demo@t.com"
    as_candidate = {"authorization": f"Bearer {r.json()['access_token']}"}

    me = (await client.get("/api/auth/me", headers=as_candidate)).json()
    assert me["role"] == "CANDIDATE"
    assert (await client.get("/api/candidate/assessment", headers=as_candidate)).status_code == 200
    # у ролі кандидата не відкриваються чужі кабінети
    assert (await client.get("/api/users", headers=as_candidate)).status_code == 403


async def test_real_candidates_and_staff_cannot_be_impersonated(
    client, session_factory, method_h, admin_h, active_methodology
):
    await _register(client, method_h, active_methodology, "real@t.com")
    real_id = await _user_id(session_factory, "real@t.com")
    assert (
        await client.post(f"/api/users/{real_id}/impersonate", headers=admin_h)
    ).status_code == 403
    assert (await client.get("/api/users/demo-candidates", headers=admin_h)).json() == []

    hr_id = await _user_id(session_factory, "hr@t.com")
    assert (
        await client.post(f"/api/users/{hr_id}/impersonate", headers=admin_h)
    ).status_code == 403
    assert (await client.post("/api/users/9999/impersonate", headers=admin_h)).status_code == 404


async def test_only_admin_can_impersonate(
    client, session_factory, method_h, hr_h, active_methodology
):
    await _register(client, method_h, active_methodology, "demo2@t.com")
    await _mark_demo(session_factory, "demo2@t.com")
    uid = await _user_id(session_factory, "demo2@t.com")
    assert (await client.post(f"/api/users/{uid}/impersonate", headers=hr_h)).status_code == 403
    assert (await client.post(f"/api/users/{uid}/impersonate", headers=method_h)).status_code == 403
    assert (await client.get("/api/users/demo-candidates", headers=hr_h)).status_code == 403
