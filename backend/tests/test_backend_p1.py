"""Завдання бекенду від UI, пріоритет P1 (BACKEND-TASKS.md): BR-1, 2, 3, 5, 6, 7, 8, 14, 17."""

import time
from datetime import UTC, datetime, timedelta

import pyotp
import pytest_asyncio
from sqlalchemy import select

from app.models import (
    Assessment,
    AssessmentStage,
    ProfileAnswer,
    ProfileField,
    User,
    UserConsent,
    UserRole,
)
from app.security import hash_password
from tests.conftest import CONSENTS, PASSWORD, login


def code_for(secret: str) -> str:
    return pyotp.TOTP(secret).at(time.time())


async def _user(session_factory, email, role, **kw):
    async with session_factory() as db:
        u = User(
            email=email,
            name=email.split("@")[0],
            role=role,
            password_hash=hash_password(PASSWORD),
            **kw,
        )
        db.add(u)
        await db.commit()
        return u.id


async def _register(client, code, email="new@t.com", **over):
    body = {
        "code": code,
        "email": email,
        "password": PASSWORD,
        "password_confirm": PASSWORD,
        "name": "Кандидат",
        "consents": CONSENTS,
        **over,
    }
    return await client.post("/api/auth/register", json=body)


async def _code(client, method_h, methodology):
    url = (
        await client.get(f"/api/methodologies/{methodology['id']}/invite-link", headers=method_h)
    ).json()["general_url"]
    return url.rsplit("/", 1)[1]


# ---------- BR-7 / BR-8: обов'язкова 2FA ----------


async def test_hr_without_totp_gets_setup_required_not_tokens(client, session_factory, strict_2fa):
    await _user(session_factory, "hr2@t.com", UserRole.HR)
    r = await client.post("/api/auth/login", json={"email": "hr2@t.com", "password": PASSWORD})
    body = r.json()
    assert (
        r.status_code == 200 and body["mfa_setup_required"] is True and "access_token" not in body
    )
    token = body["setup_token"]

    # setup_token не працює як access-токен
    assert (
        await client.get("/api/auth/me", headers={"authorization": f"Bearer {token}"})
    ).status_code == 401

    secret = (await client.post("/api/auth/2fa/setup", json={"setup_token": token})).json()[
        "secret"
    ]
    bad = await client.post("/api/auth/2fa/enable", json={"setup_token": token, "code": "000000"})
    assert bad.status_code == 422
    ok = await client.post(
        "/api/auth/2fa/enable", json={"setup_token": token, "code": code_for(secret)}
    )
    assert ok.status_code == 200 and ok.json()["access_token"]

    # далі звичайний вхід з кодом
    again = (
        await client.post("/api/auth/login", json={"email": "hr2@t.com", "password": PASSWORD})
    ).json()
    assert again["mfa_required"] is True


async def test_setup_token_cannot_be_reused_after_enabled(client, session_factory, strict_2fa):
    await _user(session_factory, "hr3@t.com", UserRole.HR)
    token = (
        await client.post("/api/auth/login", json={"email": "hr3@t.com", "password": PASSWORD})
    ).json()["setup_token"]
    secret = (await client.post("/api/auth/2fa/setup", json={"setup_token": token})).json()[
        "secret"
    ]
    await client.post("/api/auth/2fa/enable", json={"setup_token": token, "code": code_for(secret)})
    assert (
        await client.post("/api/auth/2fa/setup", json={"setup_token": token})
    ).status_code == 401


async def test_admin_also_requires_2fa_but_demo_and_methodologist_do_not(
    client, session_factory, strict_2fa
):
    await _user(session_factory, "adm@t.com", UserRole.ADMIN)
    await _user(session_factory, "demo-hr@t.com", UserRole.HR, is_demo=True)
    await _user(session_factory, "m@t.com", UserRole.METHODOLOGIST)
    assert (
        await client.post("/api/auth/login", json={"email": "adm@t.com", "password": PASSWORD})
    ).json()["mfa_setup_required"]
    assert (
        "access_token"
        in (
            await client.post(
                "/api/auth/login", json={"email": "demo-hr@t.com", "password": PASSWORD}
            )
        ).json()
    )
    assert (
        "access_token"
        in (
            await client.post("/api/auth/login", json={"email": "m@t.com", "password": PASSWORD})
        ).json()
    )


async def _enabled_secret(client, headers):
    secret = (await client.post("/api/account/2fa/setup", headers=headers)).json()["secret"]
    await client.post("/api/account/2fa/enable", json={"code": code_for(secret)}, headers=headers)
    return secret


async def test_hr_cannot_disable_2fa_but_admin_can_change_own(client, hr_h, admin_h, strict_2fa):
    secret = await _enabled_secret(client, hr_h)
    r = await client.post(
        "/api/account/2fa/disable",
        json={"password": PASSWORD, "code": code_for(secret)},
        headers=hr_h,
    )
    assert r.status_code == 403
    assert (await client.get("/api/account/2fa", headers=hr_h)).json()["enabled"] is True

    assert (await client.get("/api/account/2fa", headers=admin_h)).json()[
        "available"
    ] is True  # BR-8
    assert (await client.get("/api/auth/me", headers=admin_h)).json()["totp_enabled"] is False
    # адмін запит на видалення акаунта не подає
    assert (await client.post("/api/account/deletion-request", headers=admin_h)).status_code == 403


# ---------- BR-17 ----------


async def test_methodologist_has_no_access_to_candidate_data(client, method_h, hr_h, admin_h):
    assert (await client.get("/api/analysis/candidates", headers=method_h)).status_code == 403
    assert (await client.get("/api/analysis/candidates/1", headers=method_h)).status_code == 403
    assert (
        await client.post("/api/analysis/candidates/1/retry", json={}, headers=method_h)
    ).status_code == 403
    assert (await client.get("/api/analysis/candidates", headers=admin_h)).status_code == 200
    # аудіо — теж дані кандидатів (D-77): методист отримує 403 раніше, ніж перевіряється наявність запису
    assert (await client.get("/api/audio/1", headers=method_h)).status_code == 403
    assert (await client.get("/api/audio/archive/1/0", headers=method_h)).status_code == 403
    assert (
        await client.get("/api/audio/1", headers=hr_h)
    ).status_code == 404  # HR доступ має, запису немає


# ---------- BR-1: реєстрація ----------


async def test_register_validates_confirmation_and_consents(
    client, method_h, active_methodology, session_factory
):
    code = await _code(client, method_h, active_methodology)
    r = await _register(client, code, password_confirm="інший-пароль")
    assert r.status_code == 422 and r.json()["detail"][0]["loc"][-1] == "password_confirm"
    r = await _register(client, code, consents=[CONSENTS[0]])
    assert r.status_code == 422 and r.json()["detail"][0]["loc"][-1] == "consents"
    r = await _register(client, code, consents=[])
    assert r.status_code == 422
    body = {"code": code, "email": "x@t.com", "password": PASSWORD, "name": "К"}
    assert (await client.post("/api/auth/register", json=body)).status_code == 422

    assert (await _register(client, code)).status_code == 201
    async with session_factory() as db:
        rows = (await db.execute(select(UserConsent))).scalars().all()
    assert {(c.kind, c.version) for c in rows} == {("personal_data", "draft"), ("offer", "draft")}


# ---------- BR-2: 410 з причиною ----------


async def test_invite_gone_reasons(client, method_h, hr_h, active_methodology, session_factory):
    r = await client.post(
        "/api/invites",
        json={"methodology_id": active_methodology["id"], "candidate_email": "iv@t.com"},
        headers=hr_h,
    )
    code = r.json()["code"]
    assert (await _register(client, code, email="iv@t.com")).status_code == 201
    gone = await client.get(f"/api/auth/invite/{code}")
    assert gone.status_code == 410 and gone.json()["reason"] == "used" and gone.json()["detail"]
    assert (await client.get("/api/auth/invite/nope")).status_code == 404


# ---------- BR-3 / BR-14: рекомендації ----------


async def test_recommender_page_shows_candidate_name_and_post(client, method_h, session_factory):
    mid = (await client.post("/api/methodologies", json={"title": "Р"}, headers=method_h)).json()[
        "id"
    ]
    await client.put(
        f"/api/methodologies/{mid}/profile-fields",
        json=[{"label": "Посада", "type": "TEXT"}],
        headers=method_h,
    )
    await client.put(
        f"/api/methodologies/{mid}/quiz-questions",
        json=[{"text": "Ш", "type": "SCALE"}],
        headers=method_h,
    )
    await client.put(
        f"/api/methodologies/{mid}/graph",
        json={"nodes": [{"key": "a", "name": "A", "prompt_text": "p"}], "edges": []},
        headers=method_h,
    )
    await client.put(
        f"/api/methodologies/{mid}/recommendation-questions",
        json=[{"text": "Як?", "hint": ""}],
        headers=method_h,
    )
    await client.patch(f"/api/methodologies/{mid}", json={"status": "ACTIVE"}, headers=method_h)
    inv = (await client.get(f"/api/methodologies/{mid}", headers=method_h)).json()["invite_code"]
    h = {
        "authorization": f"Bearer {(await _register(client, inv, name='Іван Петренко')).json()['access_token']}"
    }
    async with session_factory() as db:
        a = (await db.execute(select(Assessment))).scalar_one()
        field = (await db.execute(select(ProfileField))).scalar_one()
        db.add(
            ProfileAnswer(assessment_id=a.id, profile_field_id=field.id, value=" командир взводу ")
        )
        await db.commit()
    token = (await client.get("/api/candidate/recommendations", headers=h)).json()["links"][0][
        "token"
    ]
    page = (await client.get(f"/api/recommend/{token}")).json()
    assert page["candidate"] == {"name": "Іван Петренко", "post": "командир взводу"}


async def test_recommender_gone_reasons(client, session_factory, method_h, active_methodology):
    inv = active_methodology["invite_code"]
    h = {"authorization": f"Bearer {(await _register(client, inv)).json()['access_token']}"}
    token = (await client.get("/api/candidate/recommendations", headers=h)).json()["links"][1][
        "token"
    ]
    from app.models import RecommendationLink

    async with session_factory() as db:
        link = (
            await db.execute(select(RecommendationLink).where(RecommendationLink.token == token))
        ).scalar_one()
        link.expires_at = datetime.now(UTC) - timedelta(days=1)
        await db.commit()
    r = await client.get(f"/api/recommend/{token}")
    assert r.status_code == 410 and r.json()["reason"] == "expired"


# ---------- BR-5: база HR ----------


@pytest_asyncio.fixture
async def base(session_factory, active_methodology):
    """Яна — нічого не подано; Богдан — подано анкету (1 / 2); Андрій — усе подано, давніше за інших."""
    now = datetime.now(UTC)
    ids = {}
    async with session_factory() as db:
        for name, profile, quiz, created in [
            ("Яна", None, None, now - timedelta(days=1)),
            ("Богдан", now - timedelta(hours=5), None, now - timedelta(days=3)),
            ("Андрій", now - timedelta(days=10), now - timedelta(days=9), now - timedelta(days=11)),
        ]:
            u = User(email=f"{name}@t.com", name=name, role=UserRole.CANDIDATE, password_hash="x")
            db.add(u)
            await db.flush()
            a = Assessment(
                candidate_id=u.id,
                methodology_id=active_methodology["id"],
                created_at=created,
                profile_submitted_at=profile,
                quiz_submitted_at=quiz,
                submitted_at=quiz,
                stage=AssessmentStage.DONE if quiz else AssessmentStage.IN_PROGRESS,
            )
            db.add(a)
            await db.flush()
            ids[name] = a.id
        await db.commit()
    return ids


async def test_hr_base_lists_everyone_with_stage_progress(client, hr_h, base):
    rows = (await client.get("/api/hr/candidates", headers=hr_h)).json()
    assert {r["candidate_name"] for r in rows} == {"Яна", "Богдан", "Андрій"}
    by = {r["candidate_name"]: r for r in rows}
    assert [s["status"] for s in by["Богдан"]["stages"]] == ["SUBMITTED", "NOT_STARTED"]
    assert [s["key"] for s in by["Богдан"]["stages"]] == ["PROFILE", "QUIZ"]
    assert (
        by["Богдан"]["completeness"] == 0.5
        and by["Андрій"]["completeness"] == 1
        and by["Яна"]["completeness"] == 0
    )
    assert all(r["updated_at"] for r in rows)


async def test_hr_base_sorting(client, hr_h, base):
    async def names(q):
        return [
            r["candidate_name"]
            for r in (await client.get(f"/api/hr/candidates?{q}", headers=hr_h)).json()
        ]

    assert await names("") == ["Богдан", "Яна", "Андрій"]  # за замовчуванням updated desc
    assert await names("sort=updated&dir=asc") == ["Андрій", "Яна", "Богдан"]
    assert await names("sort=name") == ["Андрій", "Богдан", "Яна"]
    assert await names("sort=name&dir=desc") == ["Яна", "Богдан", "Андрій"]
    assert await names("sort=completeness") == ["Андрій", "Богдан", "Яна"]
    assert await names("sort=completeness&dir=asc") == ["Яна", "Богдан", "Андрій"]
    assert (await names("sort=date"))[0] == "Андрій"  # синонім: подані — вгорі, неподані внизу
    assert (await client.get("/api/hr/candidates?sort=wat", headers=hr_h)).status_code == 422
    assert (await client.get("/api/hr/candidates?dir=up", headers=hr_h)).status_code == 422


# ---------- BR-6: нотатки HR ----------


async def test_notes_are_private_to_author(client, session_factory, hr_h, admin_h, method_h, base):
    aid = base["Андрій"]
    await _user(session_factory, "hr-b@t.com", UserRole.HR)
    other_h = await login(client, "hr-b@t.com")

    r = await client.post(
        f"/api/hr/candidates/{aid}/notes", json={"text": "  Перша  "}, headers=hr_h
    )
    assert r.status_code == 201
    note = r.json()
    assert note["text"] == "Перша" and note["author_name"] == "hr" and note["updated_at"]
    await client.post(f"/api/hr/candidates/{aid}/notes", json={"text": "Друга"}, headers=hr_h)
    assert (
        await client.post(f"/api/hr/candidates/{aid}/notes", json={"text": "  "}, headers=hr_h)
    ).status_code == 422

    mine = (await client.get(f"/api/hr/candidates/{aid}/notes", headers=hr_h)).json()
    assert [n["text"] for n in mine] == ["Друга", "Перша"]
    assert (await client.get(f"/api/hr/candidates/{aid}/notes", headers=other_h)).json() == []
    assert (await client.get(f"/api/hr/candidates/{aid}/notes", headers=admin_h)).json() == []
    assert (
        await client.get(f"/api/hr/candidates/{aid}/notes", headers=method_h)
    ).status_code == 403

    # чужу нотатку не змінити й не видалити
    nid = note["id"]
    assert (
        await client.put(
            f"/api/hr/candidates/{aid}/notes/{nid}", json={"text": "x"}, headers=other_h
        )
    ).status_code == 404
    assert (
        await client.delete(f"/api/hr/candidates/{aid}/notes/{nid}", headers=other_h)
    ).status_code == 404
    upd = await client.put(
        f"/api/hr/candidates/{aid}/notes/{nid}", json={"text": "Оновлена"}, headers=hr_h
    )
    assert upd.status_code == 200 and upd.json()["text"] == "Оновлена"
    assert (
        await client.delete(f"/api/hr/candidates/{aid}/notes/{nid}", headers=hr_h)
    ).status_code == 204
    assert len((await client.get(f"/api/hr/candidates/{aid}/notes", headers=hr_h)).json()) == 1
    assert (await client.get("/api/hr/candidates/9999/notes", headers=hr_h)).status_code == 404


async def test_verdict_note_is_not_shared_any_more(client, hr_h, admin_h, base):
    aid = base["Андрій"]
    r = await client.put(
        f"/api/hr/candidates/{aid}/verdict",
        json={"verdict": "IN_REVIEW", "note": "секрет"},
        headers=hr_h,
    )
    assert r.status_code == 200 and r.json()["verdict_note"] == ""
    assert (
        "секрет" not in (await client.get(f"/api/analysis/candidates/{aid}", headers=admin_h)).text
    )


# ---------- P2/P3: BR-15, BR-4, BR-16, BR-11 ----------


async def test_recommendation_questions_required_and_limit(client, method_h):
    mid = (await client.post("/api/methodologies", json={"title": "Р2"}, headers=method_h)).json()[
        "id"
    ]
    await client.put(
        f"/api/methodologies/{mid}/profile-fields",
        json=[{"label": "Ім'я", "type": "TEXT"}],
        headers=method_h,
    )
    await client.put(
        f"/api/methodologies/{mid}/quiz-questions",
        json=[{"text": "Ш", "type": "SCALE"}],
        headers=method_h,
    )
    await client.put(
        f"/api/methodologies/{mid}/graph",
        json={"nodes": [{"key": "a", "name": "A", "prompt_text": "p"}], "edges": []},
        headers=method_h,
    )
    r = await client.put(
        f"/api/methodologies/{mid}/recommendation-questions",
        json=[
            {"text": "Обов'язкове", "required": True, "max_length": 100},
            {"text": "Додаткове", "required": False},
        ],
        headers=method_h,
    )
    assert r.status_code == 200 and [(q["required"], q["max_length"]) for q in r.json()] == [
        (True, 100),
        (False, None),
    ]
    await client.patch(f"/api/methodologies/{mid}", json={"status": "ACTIVE"}, headers=method_h)
    inv = (await client.get(f"/api/methodologies/{mid}", headers=method_h)).json()["invite_code"]
    h = {"authorization": f"Bearer {(await _register(client, inv)).json()['access_token']}"}
    links = (await client.get("/api/candidate/recommendations", headers=h)).json()["links"]
    page = (await client.get(f"/api/recommend/{links[0]['token']}")).json()
    q1, q2 = page["questions"]
    assert (q1["required"], q1["max_length"], q2["required"]) == (True, 100, False)

    def submit(token, answers):
        return client.post(
            f"/api/recommend/{token}/submit", json={"role": "MANAGER", "answers": answers}
        )

    t = links[0]["token"]
    r = await submit(t, [{"question_id": q2["id"], "text": "лише додаткове"}])
    assert r.status_code == 422 and r.json()["detail"].startswith("Питання 1")
    r = await submit(t, [{"question_id": q1["id"], "text": "x" * 101}])
    assert r.status_code == 422 and "100" in r.json()["detail"]
    assert (
        await submit(t, [{"question_id": q1["id"], "text": "Добре"}])
    ).status_code == 204  # необов'язкове пропущено


async def test_stage_titles_from_methodology(client, method_h, hr_h, active_methodology, base):
    mid = active_methodology["id"]
    r = await client.patch(
        f"/api/methodologies/{mid}",
        json={"profile_title": " Біографія ", "quiz_title": "Тест"},
        headers=method_h,
    )
    assert r.status_code == 200 and r.json()["profile_title"] == " Біографія "
    rows = (await client.get("/api/hr/candidates", headers=hr_h)).json()
    assert [s["title"] for s in rows[0]["stages"]] == ["Біографія", "Тест"]
    detail = (await client.get(f"/api/hr/candidates/{base['Андрій']}", headers=hr_h)).json()
    assert detail["stage_titles"] == {
        "PROFILE": "Біографія",
        "QUIZ": "Тест",
        "INTERVIEW": "Розмова",
    }


async def test_public_config_support_contact(client):
    from app.config import get_settings

    assert (await client.get("/api/config")).json() == {"support_contact": None}
    settings = get_settings()
    settings.support_email = "help@example.org"
    try:
        assert (await client.get("/api/config")).json() == {"support_contact": "help@example.org"}
    finally:
        settings.support_email = ""


def test_ai_defaults_are_near_only():
    from app.config import Settings

    s = Settings(_env_file=None)
    assert (s.ai_provider, s.transcribe_provider, s.allow_direct_ai) == ("near", "near", False)


def test_direct_providers_blocked_without_flag(monkeypatch):
    import pytest

    from app.config import get_settings
    from app.services.ai import claude, errors, whisper

    settings = get_settings()
    monkeypatch.setattr(settings, "ai_provider", "anthropic")
    monkeypatch.setattr(settings, "transcribe_provider", "openai")
    monkeypatch.setattr(settings, "allow_direct_ai", False)
    with pytest.raises(errors.AIConfigError):
        claude.analyze("i", "m", False)
    with pytest.raises(errors.AIConfigError):
        whisper.transcribe(__import__("pathlib").Path("x.webm"))


# ---------- BR-10: PDF ----------


async def test_pdf_export_content_security_and_audit(
    client, hr_h, admin_h, method_h, base, session_factory
):
    from app.models import AuditLog

    aid = base["Андрій"]
    await client.post(
        f"/api/hr/candidates/{aid}/notes", json={"text": "ПРИВАТНА-НОТАТКА-HR"}, headers=hr_h
    )
    r = await client.get(f"/api/hr/candidates/{aid}/export.pdf", headers=hr_h)
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF") and b"%%EOF" in r.content[-32:]
    assert (
        r.headers["cache-control"] == "no-store"
        and "attachment" in r.headers["content-disposition"]
    )
    # текст у PDF стиснутий — перевіряємо через розбір, а не байти
    text = _pdf_text(r.content)
    assert "Андрій" in text and "Етапи" in text and "ПРИВАТНА" not in text
    assert "Сформував: hr" in text

    # доступ: HR і адмін — так; методист і кандидат — ні; без входу — 401
    assert (
        await client.get(f"/api/hr/candidates/{aid}/export.pdf", headers=admin_h)
    ).status_code == 200
    assert (
        await client.get(f"/api/hr/candidates/{aid}/export.pdf", headers=method_h)
    ).status_code == 403
    assert (await client.get(f"/api/hr/candidates/{aid}/export.pdf")).status_code == 401
    assert (await client.get("/api/hr/candidates/9999/export.pdf", headers=hr_h)).status_code == 404

    async with session_factory() as db:
        rows = (await db.execute(select(AuditLog))).scalars().all()
    assert [(a.action, a.assessment_id) for a in rows] == [
        ("CANDIDATE_PDF_EXPORT", aid)
    ] * 2  # лише успішні виклики


def _pdf_text(data: bytes) -> str:
    import io

    from pypdf import PdfReader

    return "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(data)).pages)
