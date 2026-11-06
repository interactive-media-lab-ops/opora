from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models import (
    AnalysisResult,
    AnalysisStatus,
    Assessment,
    AssessmentStage,
    Methodology,
    MethodologyStatus,
    ProfileAnswer,
    ProfileField,
    ProfileFieldType,
    PromptEdge,
    PromptNode,
    User,
    UserRole,
)
from app.services import analysis
from app.services.ai.claude import NodeOutput


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    with sessionmaker(engine, expire_on_commit=False)() as session:
        yield session


@pytest.fixture
def diamond(db):
    """Вузли A і B ведуть у C. У кандидата заповнена анкета, і він уже подав відповіді."""
    method_user = User(email="m@t.com", name="M", role=UserRole.METHODOLOGIST, password_hash="x")
    cand = User(email="c@t.com", name="C", role=UserRole.CANDIDATE, password_hash="x")
    db.add_all([method_user, cand])
    db.flush()
    m = Methodology(
        title="T", status=MethodologyStatus.ACTIVE, invite_code="code", created_by_id=method_user.id
    )
    m.profile_fields = [ProfileField(label="Ім'я", type=ProfileFieldType.TEXT, order=0)]
    db.add(m)
    db.flush()
    a = PromptNode(methodology_id=m.id, name="A", prompt_text="оціни A", returns_score=True)
    b = PromptNode(methodology_id=m.id, name="B", prompt_text="оціни B", returns_score=True)
    c = PromptNode(methodology_id=m.id, name="C", prompt_text="підсумуй", returns_score=False)
    db.add_all([a, b, c])
    db.flush()
    db.add_all(
        [
            PromptEdge(methodology_id=m.id, source_node_id=a.id, target_node_id=c.id),
            PromptEdge(methodology_id=m.id, source_node_id=b.id, target_node_id=c.id),
        ]
    )
    assessment = Assessment(
        candidate_id=cand.id,
        methodology_id=m.id,
        stage=AssessmentStage.PROCESSING,
        submitted_at=datetime.now(UTC),
    )
    assessment.profile_answers = [
        ProfileAnswer(profile_field_id=m.profile_fields[0].id, value="Олена")
    ]
    db.add(assessment)
    db.commit()
    return assessment, {"a": a, "b": b, "c": c}


class FakeAI:
    def __init__(self):
        self.calls: list[tuple[str, str, bool]] = []

    def __call__(self, instruction, message, returns_score):
        self.calls.append((instruction, message, returns_score))
        return NodeOutput(f"висновок: {instruction}", 7.0 if returns_score else None, "fake", 10, 5)


def _result(db, assessment, node):
    return db.execute(
        select(AnalysisResult).where(
            AnalysisResult.assessment_id == assessment.id, AnalysisResult.prompt_node_id == node.id
        )
    ).scalar_one()


def test_graph_runs_in_dependency_order(db, diamond):
    assessment, nodes = diamond
    ai = FakeAI()

    first = analysis.start_analysis(db, assessment.id)
    assert {r for r in first} == {
        _result(db, assessment, nodes["a"]).id,
        _result(db, assessment, nodes["b"]).id,
    }
    # повторний виклик нічого не дублює і нічого не запускає вдруге
    assert analysis.start_analysis(db, assessment.id) == []

    for rid in first:
        assert analysis.execute_node(db, rid, ai)
    second = analysis.claim_ready(db, assessment.id)
    assert second == [_result(db, assessment, nodes["c"]).id]
    assert analysis.claim_ready(db, assessment.id) == []

    analysis.execute_node(db, second[0], ai)
    analysis.claim_ready(db, assessment.id)
    db.refresh(assessment)
    assert assessment.stage == AssessmentStage.DONE

    # C отримала висновки обох попередників і дані кандидата в обгортці <candidate_data>
    _, message_c, returns_score_c = ai.calls[-1]
    assert returns_score_c is False
    assert "висновок: оціни A" in message_c and "висновок: оціни B" in message_c
    assert "Бал: 7/10" in message_c
    assert "<candidate_data>" in message_c and "Олена" in message_c

    # фінальним є лише C; бал є лише в вузлів з returns_score
    assert _result(db, assessment, nodes["c"]).is_terminal is True
    assert _result(db, assessment, nodes["a"]).is_terminal is False
    assert _result(db, assessment, nodes["c"]).score is None
    assert _result(db, assessment, nodes["a"]).score == 7.0


def test_failed_node_blocks_downstream_and_retry_resumes(db, diamond):
    assessment, nodes = diamond
    ai = FakeAI()
    a_id, b_id = analysis.start_analysis(db, assessment.id)

    analysis.mark_node_failed(db, a_id, "boom")
    analysis.execute_node(db, b_id, ai)
    assert analysis.claim_ready(db, assessment.id) == []  # C чекає на A
    db.refresh(assessment)
    assert assessment.stage == AssessmentStage.PROCESSING

    voice_ids, node_ids = analysis.reset_for_retry(db, assessment.id, only_failed=True)
    assert voice_ids == [] and node_ids == [a_id]
    assert _result(db, assessment, nodes["b"]).status == AnalysisStatus.DONE  # успішне не чіпаємо

    analysis.execute_node(db, a_id, ai)
    assert analysis.claim_ready(db, assessment.id) == [_result(db, assessment, nodes["c"]).id]


def test_full_reset_rebuilds_graph(db, diamond):
    assessment, nodes = diamond
    ai = FakeAI()
    for rid in analysis.start_analysis(db, assessment.id):
        analysis.execute_node(db, rid, ai)
    analysis.claim_ready(db, assessment.id)

    _, node_ids = analysis.reset_for_retry(db, assessment.id, only_failed=False)
    assert len(node_ids) == 2
    assert all(
        _result(db, assessment, nodes[k]).status in (AnalysisStatus.RUNNING,) for k in ("a", "b")
    )


def test_no_nodes_finishes_immediately(db, diamond):
    assessment, nodes = diamond
    for node in nodes.values():
        db.delete(node)
    db.commit()
    assert analysis.start_analysis(db, assessment.id) == []
    db.refresh(assessment)
    assert assessment.stage == AssessmentStage.DONE
