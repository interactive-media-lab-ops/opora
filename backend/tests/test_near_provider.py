import json
from types import SimpleNamespace

import pytest

from app.config import Settings
from app.services.ai import claude, near, whisper
from app.services.ai.errors import AIConfigError


def _settings(**kw):
    return Settings(
        _env_file=None,
        ai_provider="near",
        transcribe_provider="near",
        near_api_key="k",
        near_model="m",
        **kw,
    )


class _FakeClient:
    def __init__(self, message):
        usage = SimpleNamespace(prompt_tokens=3, completion_tokens=2)
        self.response = SimpleNamespace(
            choices=[SimpleNamespace(message=message)], model="m", usage=usage
        )
        self.kwargs = None
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))
        self.audio = SimpleNamespace(
            transcriptions=SimpleNamespace(create=lambda **kw: SimpleNamespace(text=" привіт "))
        )

    def _create(self, **kwargs):
        self.kwargs = kwargs
        return self.response


@pytest.fixture
def patch(monkeypatch):
    def apply(message):
        client = _FakeClient(message)
        monkeypatch.setattr(near, "get_settings", lambda: _settings())
        monkeypatch.setattr(near, "_client", lambda timeout: client)
        monkeypatch.setattr(claude, "get_settings", lambda: _settings())
        monkeypatch.setattr(whisper, "get_settings", lambda: _settings())
        return client

    return apply


def test_dispatch_tool_call_score_is_clamped(patch):
    call = SimpleNamespace(
        function=SimpleNamespace(arguments=json.dumps({"conclusion": "добре", "score": 42}))
    )
    client = patch(SimpleNamespace(tool_calls=[call], content=None))
    out = claude.analyze("оціни", "дані", True)
    assert (out.conclusion, out.score, out.input_tokens, out.output_tokens) == ("добре", 10.0, 3, 2)
    assert client.kwargs["tool_choice"]["function"]["name"] == "submit_conclusion"


def test_json_in_text_fallback(patch):
    patch(
        SimpleNamespace(tool_calls=None, content='```json\n{"conclusion": "ок", "score": 7}\n```')
    )
    assert claude.analyze("i", "m", True).score == 7.0


def test_text_node_without_score(patch):
    patch(SimpleNamespace(tool_calls=None, content=" текст "))
    out = claude.analyze("i", "m", False)
    assert out.conclusion == "текст" and out.score is None


def test_unstructured_answer_raises(patch):
    patch(SimpleNamespace(tool_calls=None, content="не json"))
    with pytest.raises(ValueError):
        claude.analyze("i", "m", True)


def test_transcribe_dispatch(patch, tmp_path):
    patch(SimpleNamespace(tool_calls=None, content=""))
    f = tmp_path / "a.webm"
    f.write_bytes(b"x")
    assert whisper.transcribe(f) == "привіт"


def test_missing_key_and_model(monkeypatch):
    monkeypatch.setattr(near, "get_settings", lambda: Settings(_env_file=None, near_model="m"))
    with pytest.raises(AIConfigError, match="NEAR_API_KEY"):
        near.analyze("i", "m", False)
    monkeypatch.setattr(
        near, "get_settings", lambda: Settings(_env_file=None, near_api_key="k", near_model="")
    )
    with pytest.raises(AIConfigError, match="NEAR_MODEL"):
        near.analyze("i", "m", False)


def test_forced_tool_choice_rejected_falls_back_to_auto(patch):
    import httpx
    import openai

    call = SimpleNamespace(
        function=SimpleNamespace(arguments=json.dumps({"conclusion": "ок", "score": 5}))
    )
    client = patch(SimpleNamespace(tool_calls=[call], content=None))
    seen = []

    def create(**kwargs):
        seen.append(kwargs["tool_choice"])
        if len(seen) == 1:
            req = httpx.Request("POST", "https://x")
            raise openai.BadRequestError("no", response=httpx.Response(400, request=req), body=None)
        return client.response

    client.chat.completions.create = create
    assert claude.analyze("i", "m", True).score == 5.0
    assert seen[1] == "auto"
