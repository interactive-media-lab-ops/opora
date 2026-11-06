from app.models import User, UserRole
from app.security import hash_password
from tests.conftest import PASSWORD, login


async def _user(session_factory, email, role, **kw):
    async with session_factory() as db:
        db.add(
            User(
                email=email,
                name=email.split("@")[0],
                role=role,
                password_hash=hash_password(PASSWORD),
                **kw,
            )
        )
        await db.commit()
    return email


async def test_request_lifecycle(client, session_factory, hr_h, admin_h):
    assert (await client.get("/api/account/deletion-request", headers=hr_h)).json() is None
    r = await client.post("/api/account/deletion-request", headers=hr_h)
    assert r.status_code == 201 and r.json()["status"] == "NEW"
    assert (await client.get("/api/account/deletion-request", headers=hr_h)).json()[
        "id"
    ] == r.json()["id"]
    # повторний запит, поки перший не оброблено
    assert (await client.post("/api/account/deletion-request", headers=hr_h)).status_code == 409

    queue = (await client.get("/api/admin/deletion-requests", headers=admin_h)).json()
    assert len(queue) == 1
    assert (queue[0]["user_email"], queue[0]["user_role"], queue[0]["status"]) == (
        "hr@t.com",
        "HR",
        "NEW",
    )

    done = await client.post(f"/api/admin/deletion-requests/{queue[0]['id']}/done", headers=admin_h)
    assert done.status_code == 200
    assert done.json()["status"] == "DONE" and done.json()["processed_by_name"] == "admin"
    assert (
        await client.post(f"/api/admin/deletion-requests/{queue[0]['id']}/done", headers=admin_h)
    ).status_code == 409
    # після обробки відкритого запиту немає — можна подати новий
    assert (await client.get("/api/account/deletion-request", headers=hr_h)).json() is None
    assert (await client.post("/api/account/deletion-request", headers=hr_h)).status_code == 201
    assert (
        await client.post("/api/admin/deletion-requests/999/done", headers=admin_h)
    ).status_code == 404


async def test_candidate_can_request(client, session_factory):
    await _user(session_factory, "c@t.com", UserRole.CANDIDATE)
    h = await login(client, "c@t.com")
    assert (await client.post("/api/account/deletion-request", headers=h)).status_code == 201


async def test_admin_and_demo_candidate_cannot_request(client, session_factory, admin_h):
    assert (await client.post("/api/account/deletion-request", headers=admin_h)).status_code == 403
    await _user(session_factory, "demo@t.com", UserRole.CANDIDATE, is_demo=True)
    h = await login(client, "demo@t.com")
    assert (await client.post("/api/account/deletion-request", headers=h)).status_code == 403
    # демо-HR — звичайний вхід, запит дозволено
    await _user(session_factory, "demohr@t.com", UserRole.HR, is_demo=True)
    h = await login(client, "demohr@t.com")
    assert (await client.post("/api/account/deletion-request", headers=h)).status_code == 201


async def test_queue_is_admin_only(client, hr_h, method_h):
    assert (await client.get("/api/admin/deletion-requests", headers=hr_h)).status_code == 403
    assert (
        await client.post("/api/admin/deletion-requests/1/done", headers=method_h)
    ).status_code == 403
    assert (await client.post("/api/account/deletion-request")).status_code == 401
