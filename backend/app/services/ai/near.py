"""NEAR AI Cloud — OpenAI-сумісний API (приватний інференс). Той самий SDK `openai`, інша адреса."""

import json
from pathlib import Path

import openai

from app.config import get_settings
from app.services.ai.claude import FRAMING, SCORE_TOOL, NodeOutput
from app.services.ai.errors import AIConfigError, TransientAIError


def _client(timeout: int) -> openai.OpenAI:
    settings = get_settings()
    if not settings.near_api_key:
        raise AIConfigError("Не задано NEAR_API_KEY")
    return openai.OpenAI(
        api_key=settings.near_api_key,
        base_url=settings.near_base_url,
        max_retries=0,
        timeout=timeout,
    )


def _call(fn):
    try:
        return fn()
    except (openai.APIConnectionError, openai.RateLimitError) as exc:
        raise TransientAIError(str(exc)) from exc
    except openai.APIStatusError as exc:
        if exc.status_code >= 500:
            raise TransientAIError(str(exc)) from exc
        raise


def _parse_score(raw: dict) -> tuple[str, float]:
    score = float(min(max(int(raw.get("score", 0)), 1), 10))
    return str(raw.get("conclusion", "")), score


def analyze(instruction: str, user_message: str, returns_score: bool) -> NodeOutput:
    settings = get_settings()
    if not settings.near_model:
        raise AIConfigError("Не задано NEAR_MODEL")
    client = _client(120)
    kwargs: dict = dict(
        model=settings.near_model,
        max_tokens=16000,  # токени міркування (reasoning) входять у ліміт
        messages=[
            {
                "role": "system",
                "content": FRAMING.format(
                    instruction=instruction.strip() or "Зроби висновок про кандидата."
                ),
            },
            {"role": "user", "content": user_message},
        ],
    )
    if returns_score:
        tool = {
            "type": "function",
            "function": {k: SCORE_TOOL[k] for k in ("name", "description")}
            | {"parameters": SCORE_TOOL["input_schema"]},
        }
        kwargs["tools"] = [tool]
        kwargs["tool_choice"] = {"type": "function", "function": {"name": SCORE_TOOL["name"]}}

    try:
        response = _call(lambda: client.chat.completions.create(**kwargs))
    except openai.BadRequestError:
        if "tool_choice" not in kwargs:
            raise
        # не всі моделі (особливо з міркуванням) приймають примусовий tool_choice
        kwargs["tool_choice"] = "auto"
        response = _call(lambda: client.chat.completions.create(**kwargs))
    message = response.choices[0].message
    usage = response.usage
    tokens = (usage.prompt_tokens if usage else 0, usage.completion_tokens if usage else 0)

    if not returns_score:
        return NodeOutput((message.content or "").strip(), None, response.model, *tokens)

    raw: dict | None = None
    if message.tool_calls:
        raw = json.loads(message.tool_calls[0].function.arguments or "{}")
    elif message.content:  # частина моделей ігнорує tool_choice й відповідає JSON-ом у тексті
        text = (
            message.content.strip()
            .removeprefix("```json")
            .removeprefix("```")
            .removesuffix("```")
            .strip()
        )
        try:
            raw = json.loads(text)
        except ValueError:
            raw = None
    if not isinstance(raw, dict):
        raise ValueError("Модель не повернула структурований висновок")
    conclusion, score = _parse_score(raw)
    return NodeOutput(conclusion, score, response.model, *tokens)


def transcribe(path: Path) -> str:
    settings = get_settings()
    client = _client(180)
    extra = (
        {"language": settings.near_transcribe_language} if settings.near_transcribe_language else {}
    )
    with path.open("rb") as f:
        data = f.read()  # до 25 МБ; формати mp3, wav, webm, flac, ogg, m4a
    result = _call(
        lambda: client.audio.transcriptions.create(
            model=settings.near_transcribe_model,
            file=(path.name, data),
            response_format="json",
            **extra,
        )
    )
    return result.text.strip()
