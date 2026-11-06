async def test_hr_cannot_manage_users_or_create_methodology(client, hr_h):
    assert (await client.get("/api/users", headers=hr_h)).status_code == 403
    r = await client.post("/api/methodologies", json={"title": "X"}, headers=hr_h)
    assert r.status_code == 403


async def test_no_token_is_401(client):
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_cannot_activate_empty_methodology(client, method_h):
    mid = (
        await client.post("/api/methodologies", json={"title": "Порожня"}, headers=method_h)
    ).json()["id"]
    r = await client.patch(f"/api/methodologies/{mid}", json={"status": "ACTIVE"}, headers=method_h)
    assert r.status_code == 422
    assert "поле анкети" in r.json()["detail"]


async def test_questions_frozen_after_activation_but_graph_editable(
    client, method_h, active_methodology
):
    mid = active_methodology["id"]
    r = await client.put(
        f"/api/methodologies/{mid}/quiz-questions",
        json=[{"text": "Нове", "type": "TEXT"}],
        headers=method_h,
    )
    assert r.status_code == 409

    graph = (await client.get(f"/api/methodologies/{mid}/graph", headers=method_h)).json()
    node = graph["nodes"][0]
    r = await client.put(
        f"/api/methodologies/{mid}/graph",
        json={
            "nodes": [
                {
                    "key": "a",
                    "id": node["id"],
                    "name": "A2",
                    "prompt_text": "змінено",
                    "returns_score": True,
                },
                {"key": "b", "name": "B"},
            ],
            "edges": [{"source": "a", "target": "b"}],
        },
        headers=method_h,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert {n["name"] for n in body["nodes"]} == {"A2", "B"}
    assert len(body["edges"]) == 1
    assert next(n for n in body["nodes"] if n["name"] == "A2")["id"] == node["id"]


async def test_graph_cycle_rejected(client, method_h, active_methodology):
    mid = active_methodology["id"]
    r = await client.put(
        f"/api/methodologies/{mid}/graph",
        json={
            "nodes": [{"key": "a", "name": "A"}, {"key": "b", "name": "B"}],
            "edges": [{"source": "a", "target": "b"}, {"source": "b", "target": "a"}],
        },
        headers=method_h,
    )
    assert r.status_code == 422
    assert "цикл" in r.json()["detail"]


async def test_select_field_requires_options(client, method_h):
    mid = (await client.post("/api/methodologies", json={"title": "T"}, headers=method_h)).json()[
        "id"
    ]
    r = await client.put(
        f"/api/methodologies/{mid}/profile-fields",
        json=[{"label": "Вибір", "type": "SELECT", "options": ["один"]}],
        headers=method_h,
    )
    assert r.status_code == 422
