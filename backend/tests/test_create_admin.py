import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import create_admin
from app.db import Base
from app.models import User, UserRole
from app.security import hash_password, verify_password


@pytest.fixture
def factory(monkeypatch):
    engine = create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(create_admin, "get_sync_db", lambda: session_factory())
    return session_factory


def test_creates_new_admin(factory):
    assert "створено" in create_admin.create_admin("boss@t.com", "Boss", "Sup3rSecret!")
    with factory() as db:
        user = db.execute(select(User)).scalar_one()
        assert user.role == UserRole.ADMIN and user.is_active
        assert verify_password("Sup3rSecret!", user.password_hash)


def test_existing_user_is_promoted_and_reactivated(factory):
    with factory() as db:
        db.add(
            User(
                email="hr@t.com",
                name="HR",
                role=UserRole.HR,
                password_hash=hash_password("old-password"),
                is_active=False,
            )
        )
        db.commit()
    assert "оновлено" in create_admin.create_admin("hr@t.com", "", "new-password-1")
    with factory() as db:
        user = db.execute(select(User)).scalar_one()
        assert user.role == UserRole.ADMIN and user.is_active and user.name == "HR"
        assert verify_password("new-password-1", user.password_hash)
        assert not verify_password("old-password", user.password_hash)
