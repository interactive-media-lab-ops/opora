import time
from datetime import UTC, datetime, timedelta

import pyotp
import pytest_asyncio

from app.models import User, UserRole
from app.security import hash_password
from app.services import totp as totp_service
from tests.conftest import PASSWORD, login


def code_at(secret: str, offset_steps: int = 0) -> str:
    return pyotp.TOTP(secret).at(time.time() + 30 * offset_steps)


@pytest_asyncio.fixture
async def real_hr(session_factory):
    async with session_factory() as db:
        db.add(
            User(
                email="real-hr@t.com",
                name="Real HR",
                role=UserRole.HR,
                password_hash=hash_password(PASSWORD),
            )
        )
        await db.commit()
    return "real-hr@t.com"


async def _enable(client, headers) -> str:
    setup = await client.post("/api/account/2fa/setup", headers=headers)
    assert setup.status_code == 200, setup.text
    secret = setup.json()["secret"]
    assert setup.json()["otpauth_uri"].startswith("otpauth://totp/")
    ok = await client.post(
        "/api/account/2fa/enable", json={"code": code_at(secret)}, headers=headers
    )
    assert ok.status_code == 200 and ok.json()["enabled"] is True
    return secret


async def _password_login(client, email):
    return await client.post("/api/auth/login", json={"email": email, "password": PASSWORD})


async def test_status_and_availability(client, real_hr, method_h):
    h = await login(client, real_hr)
    assert (await client.get("/api/account/2fa", headers=h)).json() == {
        "available": True,
        "enabled": False,
    }
    # методист: 2FA недоступна
    assert (await client.get("/api/account/2fa", headers=method_h)).json()["available"] is False
    assert (await client.post("/api/account/2fa/setup", headers=method_h)).status_code == 403


async def test_demo_hr_cannot_enable(client, session_factory):
    async with session_factory() as db:
        db.add(
            User(
                email="demo-hr@t.com",
                name="d",
                role=UserRole.HR,
                is_demo=True,
                password_hash=hash_password(PASSWORD),
            )
        )
        await db.commit()
    h = await login(client, "demo-hr@t.com")
    assert (await client.post("/api/account/2fa/setup", headers=h)).status_code == 403


async def test_enable_requires_valid_code(client, real_hr):
    h = await login(client, real_hr)
    assert (
        await client.post("/api/account/2fa/enable", json={"code": "123456"}, headers=h)
    ).status_code == 409  # без setup
    await client.post("/api/account/2fa/setup", headers=h)
    assert (
        await client.post("/api/account/2fa/enable", json={"code": "000000"}, headers=h)
    ).status_code == 422
    assert (await client.get("/api/account/2fa", headers=h)).json()["enabled"] is False


async def test_login_requires_second_factor(client, real_hr):
    h = await login(client, real_hr)
    secret = await _enable(client, h)

    r = await _password_login(client, real_hr)
    assert (
        r.status_code == 200 and r.json()["mfa_required"] is True and "access_token" not in r.json()
    )
    mfa = r.json()["mfa_token"]

    # mfa-токен не працює як access
    assert (
        await client.get("/api/auth/me", headers={"authorization": f"Bearer {mfa}"})
    ).status_code == 401
    # хибний код
    assert (
        await client.post("/api/auth/login/2fa", json={"mfa_token": mfa, "code": "000000"})
    ).status_code == 401
    # код наступного кроку (поточний уже спожито під час ввімкнення)
    ok = await client.post(
        "/api/auth/login/2fa", json={"mfa_token": mfa, "code": code_at(secret, 1)}
    )
    assert ok.status_code == 200
    me = await client.get(
        "/api/auth/me", headers={"authorization": f"Bearer {ok.json()['access_token']}"}
    )
    assert me.json()["totp_enabled"] is True


async def test_code_cannot_be_reused(client, real_hr):
    h = await login(client, real_hr)
    secret = await _enable(client, h)
    mfa = (await _password_login(client, real_hr)).json()["mfa_token"]
    used = code_at(secret, 1)
    assert (
        await client.post("/api/auth/login/2fa", json={"mfa_token": mfa, "code": used})
    ).status_code == 200
    mfa2 = (await _password_login(client, real_hr)).json()["mfa_token"]
    assert (
        await client.post("/api/auth/login/2fa", json={"mfa_token": mfa2, "code": used})
    ).status_code == 401
    # код, взятий до вже прийнятого кроку, теж не діє
    assert (
        await client.post(
            "/api/auth/login/2fa", json={"mfa_token": mfa2, "code": code_at(secret, 0)}
        )
    ).status_code == 401


async def test_lockout_after_repeated_failures(client, real_hr):
    h = await login(client, real_hr)
    secret = await _enable(client, h)
    mfa = (await _password_login(client, real_hr)).json()["mfa_token"]
    for _ in range(5):
        assert (
            await client.post("/api/auth/login/2fa", json={"mfa_token": mfa, "code": "000000"})
        ).status_code == 401
    # навіть правильний код тепер відхиляється — блокування
    r = await client.post(
        "/api/auth/login/2fa", json={"mfa_token": mfa, "code": code_at(secret, 1)}
    )
    assert r.status_code == 429


async def test_disable_needs_password_and_code(client, real_hr):
    h = await login(client, real_hr)
    secret = await _enable(client, h)
    bad_pw = await client.post(
        "/api/account/2fa/disable",
        json={"password": "wrong", "code": code_at(secret, 1)},
        headers=h,
    )
    assert bad_pw.status_code == 422
    bad_code = await client.post(
        "/api/account/2fa/disable", json={"password": PASSWORD, "code": "000000"}, headers=h
    )
    assert bad_code.status_code == 422
    ok = await client.post(
        "/api/account/2fa/disable",
        json={"password": PASSWORD, "code": code_at(secret, 1)},
        headers=h,
    )
    assert ok.status_code == 200 and ok.json()["enabled"] is False
    assert "access_token" in (await _password_login(client, real_hr)).json()


async def test_admin_reset(client, session_factory, real_hr, admin_h):
    h = await login(client, real_hr)
    await _enable(client, h)
    async with session_factory() as db:
        uid = (
            await db.execute(__import__("sqlalchemy").select(User.id).where(User.email == real_hr))
        ).scalar_one()
    r = await client.post(f"/api/users/{uid}/reset-2fa", headers=admin_h)
    assert r.status_code == 200 and r.json()["totp_enabled"] is False
    assert "access_token" in (await _password_login(client, real_hr)).json()
    # лише адмін
    assert (await client.post(f"/api/users/{uid}/reset-2fa", headers=h)).status_code == 403


def test_secret_is_encrypted_and_unit_lock():
    secret = totp_service.new_secret()
    enc = totp_service.encrypt_secret(secret)
    assert secret not in enc and totp_service.decrypt_secret(enc) == secret
    assert totp_service.decrypt_secret("garbage") is None
    u = User(
        email="x@t.com",
        name="x",
        role=UserRole.HR,
        password_hash="x",
        totp_secret_enc=enc,
        totp_failures=0,
    )
    now = datetime.now(UTC)
    for _ in range(5):
        assert totp_service.verify_code(u, "000000", now) is False
    assert totp_service.is_locked(u, now) and not totp_service.is_locked(
        u, now + timedelta(minutes=6)
    )
