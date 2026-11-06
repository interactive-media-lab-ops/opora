from tests.conftest import CONSENTS


async def _general_code(client, method_h, active_methodology) -> str:
    url = (
        await client.get(
            f"/api/methodologies/{active_methodology['id']}/invite-link", headers=method_h
        )
    ).json()["general_url"]
    return url.rsplit("/", 1)[1]


async def test_register_with_general_invite(client, method_h, active_methodology):
    code = await _general_code(client, method_h, active_methodology)
    r = await client.post(
        "/api/auth/register",
        json={
            "code": code,
            "email": "Cand@T.com",
            "password": "Passw0rd!x",
            "password_confirm": "Passw0rd!x",
            "consents": CONSENTS,
            "name": "Кандидат",
        },
    )
    assert r.status_code == 201, r.text
    h = {"authorization": f"Bearer {r.json()['access_token']}"}
    me = (await client.get("/api/auth/me", headers=h)).json()
    assert me["role"] == "CANDIDATE" and me["email"] == "cand@t.com"
    # кандидат не має доступу до кабінету методиста
    assert (await client.get("/api/methodologies", headers=h)).status_code == 403


async def test_register_rejects_bad_code(client, active_methodology):
    r = await client.post(
        "/api/auth/register",
        json={
            "code": "nope",
            "email": "a@t.com",
            "password": "Passw0rd!x",
            "password_confirm": "Passw0rd!x",
            "consents": CONSENTS,
            "name": "A",
        },
    )
    assert r.status_code == 404


async def test_personal_invite_is_one_time_and_email_bound(client, hr_h, active_methodology):
    r = await client.post(
        "/api/invites",
        json={"methodology_id": active_methodology["id"], "candidate_email": "ivan@t.com"},
        headers=hr_h,
    )
    assert r.status_code == 201, r.text
    code = r.json()["code"]

    wrong = await client.post(
        "/api/auth/register",
        json={
            "code": code,
            "email": "other@t.com",
            "password": "Passw0rd!x",
            "password_confirm": "Passw0rd!x",
            "consents": CONSENTS,
            "name": "Інший",
        },
    )
    assert wrong.status_code == 400

    ok = await client.post(
        "/api/auth/register",
        json={
            "code": code,
            "email": "ivan@t.com",
            "password": "Passw0rd!x",
            "password_confirm": "Passw0rd!x",
            "consents": CONSENTS,
            "name": "Іван",
        },
    )
    assert ok.status_code == 201

    again = await client.post(
        "/api/auth/register",
        json={
            "code": code,
            "email": "ivan@t.com",
            "password": "Passw0rd!x",
            "password_confirm": "Passw0rd!x",
            "consents": CONSENTS,
            "name": "Іван",
        },
    )
    assert again.status_code == 410


async def test_cannot_invite_to_draft_methodology(client, hr_h, method_h):
    mid = (
        await client.post("/api/methodologies", json={"title": "Чернетка"}, headers=method_h)
    ).json()["id"]
    r = await client.post(
        "/api/invites", json={"methodology_id": mid, "candidate_email": "x@t.com"}, headers=hr_h
    )
    assert r.status_code == 404
