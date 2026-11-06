import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.config import get_settings
from app.db import Base, get_db
from app.main import app
from app.models import User, UserRole
from app.security import hash_password

PASSWORD = "Passw0rd!x"
CONSENTS = [
    {"kind": "personal_data", "version": "draft", "accepted_at": "2026-11-03T10:00:00Z"},
    {"kind": "offer", "version": "draft", "accepted_at": "2026-11-03T10:00:00Z"},
]


@pytest.fixture(autouse=True)
def relaxed_2fa():
    """Більшість тестів входять HR / адміном лише паролем; обов'язкова 2FA (BR-7/8) перевіряється окремо з `strict_2fa`."""
    settings = get_settings()
    settings.require_2fa = False
    yield
    settings.require_2fa = True


@pytest.fixture
def strict_2fa():
    get_settings().require_2fa = True


@pytest_asyncio.fixture
async def session_factory():
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    yield factory
    await engine.dispose()


@pytest_asyncio.fixture
async def client(session_factory):
    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def _make_user(session_factory, email: str, role: UserRole) -> None:
    async with session_factory() as db:
        db.add(
            User(
                email=email,
                name=email.split("@")[0],
                role=role,
                password_hash=hash_password(PASSWORD),
            )
        )
        await db.commit()


@pytest_asyncio.fixture
async def users(session_factory):
    await _make_user(session_factory, "admin@t.com", UserRole.ADMIN)
    await _make_user(session_factory, "method@t.com", UserRole.METHODOLOGIST)
    await _make_user(session_factory, "hr@t.com", UserRole.HR)


async def login(client: AsyncClient, email: str) -> dict[str, str]:
    r = await client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return {"authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture
async def method_h(client, users):
    return await login(client, "method@t.com")


@pytest_asyncio.fixture
async def hr_h(client, users):
    return await login(client, "hr@t.com")


@pytest_asyncio.fixture
async def admin_h(client, users):
    return await login(client, "admin@t.com")


@pytest_asyncio.fixture
async def active_methodology(client, method_h):
    """Активна методологія з полем анкети, питанням опитувальника і одним вузлом промта."""
    r = await client.post("/api/methodologies", json={"title": "Тест"}, headers=method_h)
    assert r.status_code == 201, r.text
    mid = r.json()["id"]
    await client.put(
        f"/api/methodologies/{mid}/profile-fields",
        json=[{"label": "Ім'я", "type": "TEXT", "required": True}],
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
    r = await client.patch(f"/api/methodologies/{mid}", json={"status": "ACTIVE"}, headers=method_h)
    assert r.status_code == 200, r.text
    return r.json()
