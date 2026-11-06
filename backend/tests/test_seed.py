from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import seed as seed_module
from app.db import Base
from app.models import (
    AnalysisResult,
    AnalysisStatus,
    Assessment,
    AssessmentStage,
    Methodology,
    MethodologyStatus,
    PersonalInvite,
    User,
    UserRole,
    Verdict,
    VoiceAnswer,
)
from app.services.storage import StorageService


@pytest.fixture
def env(tmp_path):
    engine = create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    return sessionmaker(engine, expire_on_commit=False), StorageService(str(tmp_path))


def counts(factory):
    with factory() as db:
        return {
            "users": db.scalar(select(func.count()).select_from(User)),
            "methodologies": db.scalar(select(func.count()).select_from(Methodology)),
            "assessments": db.scalar(select(func.count()).select_from(Assessment)),
            "results": db.scalar(select(func.count()).select_from(AnalysisResult)),
            "voices": db.scalar(select(func.count()).select_from(VoiceAnswer)),
            "invites": db.scalar(select(func.count()).select_from(PersonalInvite)),
        }


def test_seed_is_idempotent_and_fills_every_cabinet(env):
    factory, storage = env
    seed_module.seed(factory, storage, demo_data=True)
    first = counts(factory)
    seed_module.seed(factory, storage, demo_data=True)
    assert counts(factory) == first

    with factory() as db:
        roles = {r for (r,) in db.execute(select(User.role)).all()}
        assert roles == set(UserRole)
        # методології всіх статусів
        assert {s for (s,) in db.execute(select(Methodology.status)).all()} == set(
            MethodologyStatus
        )
        # кандидати на всіх етапах
        assert {s for (s,) in db.execute(select(Assessment.stage)).all()} == set(AssessmentStage)
        # усі вердикти представлені, є й кандидати без вердикту серед завершених
        verdicts = {v for (v,) in db.execute(select(Assessment.verdict)).all()}
        assert {Verdict.RECOMMENDED, Verdict.REJECTED, Verdict.IN_REVIEW, None} <= verdicts
        # є невдалий крок, який бачить методист
        assert (
            db.scalar(select(func.count()).where(AnalysisResult.status == AnalysisStatus.FAILED))
            == 1
        )
        # демо-кандидати позначені, щоб адмін міг у них входити
        assert (
            db.scalar(
                select(func.count())
                .select_from(User)
                .where(User.role == UserRole.CANDIDATE, User.is_demo.is_(False))
            )
            == 0
        )
        # аудіо справді записані
        for voice in db.execute(select(VoiceAnswer)).scalars():
            assert storage.path_for(voice.audio_path).exists()


def test_final_nodes_have_results_with_scores(env):
    factory, storage = env
    seed_module.seed(factory, storage, demo_data=True)
    with factory() as db:
        finals = (
            db.execute(
                select(AnalysisResult).where(
                    AnalysisResult.is_terminal.is_(True),
                    AnalysisResult.status == AnalysisStatus.DONE,
                )
            )
            .scalars()
            .all()
        )
        assert finals and all(r.output for r in finals)
        assert any(r.score is not None for r in finals)
        assert all(r.model == "demo-seed" for r in finals)


def test_demo_data_can_be_disabled(env):
    factory, storage = env
    seed_module.seed(factory, storage, demo_data=False)
    assert counts(factory) == {
        "users": 3,
        "methodologies": 0,
        "assessments": 0,
        "results": 0,
        "voices": 0,
        "invites": 0,
    }


def test_rich_profile_is_idempotent_and_covers_design_cases(env, monkeypatch, capsys):
    from app.models import HRNote, RecommendationLink, RecommendationLinkStatus
    from app.services import totp

    factory, storage = env
    monkeypatch.setenv("SEED_DEMO_DATA", "rich")
    seed_module.seed(factory, storage)
    first = counts(factory)
    seed_module.seed(factory, storage)
    assert counts(factory) == first

    with factory() as db:
        axes = {}
        for m in db.execute(
            select(Methodology).where(Methodology.title.like("Лідерство%"))
        ).scalars():
            axes[m.title] = len({n.axis for n in m.prompt_nodes if n.axis})
        assert sorted(axes.values()) == [3, 8]
        hr = db.execute(select(User).where(User.email == "hr.real@example.org")).scalar_one()
        assert (
            hr.is_demo is False
            and hr.totp_enabled is True
            and totp.decrypt_secret(hr.totp_secret_enc)
        )
        longest = max(db.execute(select(User.name)).scalars(), key=len)
        assert len(longest) > 40
        # прострочене, використане й живе посилання рекомендатора
        links = db.execute(select(RecommendationLink)).scalars().all()
        now = datetime.now(UTC)
        exp = [
            link
            for link in links
            if link.status == RecommendationLinkStatus.PENDING
            and link.expires_at.replace(tzinfo=UTC) < now
        ]
        assert exp and any(link.status == RecommendationLinkStatus.SUBMITTED for link in links)
        # збої аналізу й кілька проходжень; нотатки демо-HR — в окремій таблиці
        assert (
            db.scalar(
                select(func.count())
                .select_from(AnalysisResult)
                .where(AnalysisResult.status == AnalysisStatus.FAILED)
            )
            >= 2
        )
        assert db.scalar(select(func.count()).select_from(HRNote)) >= 1
        assert all(a.verdict_note == "" for a in db.execute(select(Assessment)).scalars())
