from datetime import UTC, datetime
from io import BytesIO

import pytest_asyncio
from openpyxl import load_workbook

from app.models import Assessment, AssessmentStage, User, UserRole, Verdict
from app.security import hash_password
from tests.conftest import PASSWORD, login


@pytest_asyncio.fixture
async def assessments(session_factory, active_methodology):
    """Два подані проходження і одне неподане."""
    ids = []
    async with session_factory() as db:
        for i, (name, submitted) in enumerate(
            [("Олена =cmd|' /C calc'!A0", True), ("Андрій", True), ("Чернетка", False)]
        ):
            u = User(
                email=f"c{i}@t.com",
                name=name,
                role=UserRole.CANDIDATE,
                password_hash=hash_password(PASSWORD),
            )
            db.add(u)
            await db.flush()
            a = Assessment(
                candidate_id=u.id,
                methodology_id=active_methodology["id"],
                stage=AssessmentStage.DONE if submitted else AssessmentStage.IN_PROGRESS,
                submitted_at=datetime.now(UTC) if submitted else None,
                verdict=Verdict.RECOMMENDED if i == 0 else None,
            )
            db.add(a)
            await db.flush()
            ids.append(a.id)
        await db.commit()
    return ids


async def test_default_list_created_once(client, hr_h):
    lists = (await client.get("/api/hr/lists", headers=hr_h)).json()
    assert [(x["name"], x["is_default"], x["assessment_ids"]) for x in lists] == [
        ("Обрані", True, [])
    ]
    assert len((await client.get("/api/hr/lists", headers=hr_h)).json()) == 1


async def test_lists_are_hr_only(client, method_h):
    assert (await client.get("/api/hr/lists", headers=method_h)).status_code == 403
    assert (await client.get("/api/hr/lists")).status_code == 401


async def test_create_rename_delete(client, hr_h):
    default = (await client.get("/api/hr/lists", headers=hr_h)).json()[0]
    r = await client.post("/api/hr/lists", json={"name": "  Фіналісти  "}, headers=hr_h)
    assert r.status_code == 201 and r.json()["name"] == "Фіналісти"
    lid = r.json()["id"]
    # дубль без урахування регістру
    assert (
        await client.post("/api/hr/lists", json={"name": "фіналісти"}, headers=hr_h)
    ).status_code == 409
    assert (
        await client.post("/api/hr/lists", json={"name": "   "}, headers=hr_h)
    ).status_code == 422
    assert (await client.patch(f"/api/hr/lists/{lid}", json={"name": "Топ"}, headers=hr_h)).json()[
        "name"
    ] == "Топ"
    # список за замовчуванням не змінюється й не видаляється
    assert (
        await client.patch(f"/api/hr/lists/{default['id']}", json={"name": "X"}, headers=hr_h)
    ).status_code == 400
    assert (await client.delete(f"/api/hr/lists/{default['id']}", headers=hr_h)).status_code == 400
    assert (await client.delete(f"/api/hr/lists/{lid}", headers=hr_h)).status_code == 204
    assert (await client.get(f"/api/hr/lists/{lid}", headers=hr_h)).status_code == 404


async def test_items_and_rows(client, hr_h, assessments):
    lid = (await client.get("/api/hr/lists", headers=hr_h)).json()[0]["id"]
    for a in assessments[:2]:
        assert (await client.put(f"/api/hr/lists/{lid}/items/{a}", headers=hr_h)).status_code == 204
    assert (
        await client.put(f"/api/hr/lists/{lid}/items/{assessments[0]}", headers=hr_h)
    ).status_code == 204  # ідемпотентно
    # неподане проходження і неіснуюче — 404
    assert (
        await client.put(f"/api/hr/lists/{lid}/items/{assessments[2]}", headers=hr_h)
    ).status_code == 404
    assert (await client.put(f"/api/hr/lists/{lid}/items/9999", headers=hr_h)).status_code == 404

    lists = (await client.get("/api/hr/lists", headers=hr_h)).json()
    assert lists[0]["assessment_ids"] == sorted(assessments[:2])
    detail = (await client.get(f"/api/hr/lists/{lid}", headers=hr_h)).json()
    assert {r["id"] for r in detail["rows"]} == set(assessments[:2])

    assert (
        await client.delete(f"/api/hr/lists/{lid}/items/{assessments[0]}", headers=hr_h)
    ).status_code == 204
    assert (
        await client.delete(f"/api/hr/lists/{lid}/items/{assessments[0]}", headers=hr_h)
    ).status_code == 204
    detail = (await client.get(f"/api/hr/lists/{lid}", headers=hr_h)).json()
    assert [r["id"] for r in detail["rows"]] == [assessments[1]]


async def test_lists_are_private_per_hr(client, session_factory, hr_h, assessments):
    async with session_factory() as db:
        db.add(
            User(
                email="hr2@t.com",
                name="hr2",
                role=UserRole.HR,
                password_hash=hash_password(PASSWORD),
            )
        )
        await db.commit()
    hr2 = await login(client, "hr2@t.com")
    lid = (await client.get("/api/hr/lists", headers=hr_h)).json()[0]["id"]
    await client.put(f"/api/hr/lists/{lid}/items/{assessments[0]}", headers=hr_h)
    # інший HR не бачить чужого списку, не змінює й не експортує його
    assert (await client.get(f"/api/hr/lists/{lid}", headers=hr2)).status_code == 404
    assert (
        await client.put(f"/api/hr/lists/{lid}/items/{assessments[1]}", headers=hr2)
    ).status_code == 404
    assert (await client.delete(f"/api/hr/lists/{lid}", headers=hr2)).status_code == 404
    assert (await client.get(f"/api/hr/lists/{lid}/export", headers=hr2)).status_code == 404
    own = (await client.get("/api/hr/lists", headers=hr2)).json()
    assert len(own) == 1 and own[0]["id"] != lid and own[0]["assessment_ids"] == []


async def test_export_xlsx(client, hr_h, assessments):
    lid = (
        await client.post("/api/hr/lists", json={"name": "Фін/алісти: [1]"}, headers=hr_h)
    ).json()["id"]
    for a in assessments[:2]:
        await client.put(f"/api/hr/lists/{lid}/items/{a}", headers=hr_h)
    r = await client.get(f"/api/hr/lists/{lid}/export", headers=hr_h)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/vnd.openxmlformats")
    assert "filename*=UTF-8''" in r.headers["content-disposition"]
    ws = load_workbook(BytesIO(r.content)).active
    assert ws.title == "Фін алісти   1"
    assert [c.value for c in ws[1]][:3] == ["Кандидат", "Пошта", "Методологія"]
    assert ws.max_row == 3
    names = {ws.cell(row=i, column=1).value for i in (2, 3)}
    # ім'я з «=» лишається текстом, а не формулою
    assert "Олена =cmd|' /C calc'!A0" in names
    formula_cell = next(
        ws.cell(row=i, column=1)
        for i in (2, 3)
        if ws.cell(row=i, column=1).value.startswith("Олена")
    )
    assert formula_cell.data_type == "s"
