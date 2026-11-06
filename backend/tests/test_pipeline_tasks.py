"""Перевіряє проводку Celery-задач (pipeline.py) наскрізь: транскрипція → граф → стадія DONE.

AI-виклики підмінені; Celery працює в eager-режимі (задачі виконуються синхронно).
"""

from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import db as db_module
from app.db import Base
from app.models import (
    AnalysisResult,
    AnalysisStatus,
    Assessment,
    AssessmentStage,
    InterviewQuestion,
    Methodology,
    MethodologyStatus,
    PromptEdge,
    PromptNode,
    TranscriptStatus,
    User,
    UserRole,
    VoiceAnswer,
)
from app.services.ai import claude, whisper
from app.services.ai.claude import NodeOutput
from app.services.ai.errors import AIConfigError
from app.services.storage import StorageService
from app.tasks import pipeline
from app.tasks.celery_app import celery


@pytest.fixture
def factory(monkeypatch, tmp_path):
    engine = create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(db_module, "sync_session_factory", session_factory)
    monkeypatch.setattr(pipeline, "get_storage", lambda: StorageService(str(tmp_path)))
    celery.conf.task_always_eager = True
    celery.conf.task_eager_propagates = True
    yield session_factory
    celery.conf.task_always_eager = False


@pytest.fixture
def submitted(factory, tmp_path):
    (tmp_path / "1").mkdir()
    (tmp_path / "1" / "q1_a1.webm").write_bytes(b"audio")
    with factory() as db:
        staff = User(email="m@t.com", name="M", role=UserRole.METHODOLOGIST, password_hash="x")
        cand = User(email="c@t.com", name="C", role=UserRole.CANDIDATE, password_hash="x")
        db.add_all([staff, cand])
        db.flush()
        m = Methodology(
            title="T", status=MethodologyStatus.ACTIVE, invite_code="c", created_by_id=staff.id
        )
        m.interview_questions = [InterviewQuestion(text="Розкажіть", order=0)]
        db.add(m)
        db.flush()
        a = PromptNode(methodology_id=m.id, name="A", prompt_text="a", returns_score=True)
        b = PromptNode(methodology_id=m.id, name="B", prompt_text="b", returns_score=False)
        db.add_all([a, b])
        db.flush()
        db.add(PromptEdge(methodology_id=m.id, source_node_id=a.id, target_node_id=b.id))
        assessment = Assessment(
            candidate_id=cand.id,
            methodology_id=m.id,
            stage=AssessmentStage.PROCESSING,
            submitted_at=datetime.now(UTC),
        )
        assessment.voice_answers = [
            VoiceAnswer(
                interview_question_id=m.interview_questions[0].id, audio_path="1/q1_a1.webm"
            )
        ]
        db.add(assessment)
        db.commit()
        return assessment.id


def test_happy_path_runs_transcription_then_graph(factory, submitted, monkeypatch):
    seen_messages = []

    def fake_analyze(instruction, message, returns_score):
        seen_messages.append(message)
        return NodeOutput(f"out-{instruction}", 9.0 if returns_score else None, "fake", 1, 1)

    monkeypatch.setattr(whisper, "transcribe", lambda path: "Я розповіла про складного клієнта")
    monkeypatch.setattr(claude, "analyze", fake_analyze)

    pipeline.process_assessment.delay(submitted)

    with factory() as db:
        assessment = db.get(Assessment, submitted)
        assert assessment.stage == AssessmentStage.DONE
        voice = db.execute(select(VoiceAnswer)).scalar_one()
        assert voice.transcript_status == TranscriptStatus.DONE
        results = {r.node.name: r for r in db.execute(select(AnalysisResult)).scalars()}
        assert results["A"].score == 9.0 and results["A"].is_terminal is False
        assert results["B"].is_terminal is True and results["B"].output == "out-b"
    # транскрипт дійшов до першого вузла, а висновок A — до другого
    assert "Я розповіла про складного клієнта" in seen_messages[0]
    assert "out-a" in seen_messages[1]


def test_missing_openai_key_fails_gracefully_and_retry_recovers(factory, submitted, monkeypatch):
    def no_key(path):
        raise AIConfigError("Не задано OPENAI_API_KEY")

    monkeypatch.setattr(whisper, "transcribe", no_key)
    pipeline.process_assessment.delay(submitted)

    with factory() as db:
        voice = db.execute(select(VoiceAnswer)).scalar_one()
        assert voice.transcript_status == TranscriptStatus.FAILED
        assert "OPENAI_API_KEY" in voice.transcript_error
        assert db.get(Assessment, submitted).stage == AssessmentStage.PROCESSING
        assert (
            db.execute(select(AnalysisResult)).first() is None
        )  # аналіз без транскрипту не стартує

    monkeypatch.setattr(whisper, "transcribe", lambda path: "текст")
    monkeypatch.setattr(
        claude,
        "analyze",
        lambda instruction, message, returns_score: NodeOutput(
            "ок", 5.0 if returns_score else None, "fake", 1, 1
        ),
    )
    pipeline.retry_analysis.delay(submitted, True)

    with factory() as db:
        assert db.get(Assessment, submitted).stage == AssessmentStage.DONE


def test_failed_node_is_recorded_and_blocks_stage(factory, submitted, monkeypatch):
    monkeypatch.setattr(whisper, "transcribe", lambda path: "текст")

    def broken(instruction, message, returns_score):
        raise AIConfigError("Не задано ANTHROPIC_API_KEY")

    monkeypatch.setattr(claude, "analyze", broken)
    pipeline.process_assessment.delay(submitted)

    with factory() as db:
        assert db.get(Assessment, submitted).stage == AssessmentStage.PROCESSING
        statuses = {r.node.name: r.status for r in db.execute(select(AnalysisResult)).scalars()}
        assert statuses == {"A": AnalysisStatus.FAILED, "B": AnalysisStatus.PENDING}
        failed = db.execute(
            select(AnalysisResult).where(AnalysisResult.status == AnalysisStatus.FAILED)
        ).scalar_one()
        assert "ANTHROPIC_API_KEY" in failed.error
