"""Транскрипція аудіо."""

from pathlib import Path

import openai

from app.config import get_settings
from app.services.ai.errors import AIConfigError, TransientAIError


def transcribe(path: Path) -> str:
    settings = get_settings()
    if settings.transcribe_provider == "near":
        from app.services.ai import near

        return near.transcribe(path)
    if not settings.allow_direct_ai:
        raise AIConfigError(
            "Прямі виклики OpenAI вимкнено (X-26): TRANSCRIBE_PROVIDER=near або ALLOW_DIRECT_AI=true лише для локальної розробки"
        )
    if not settings.openai_api_key:
        raise AIConfigError("Не задано OPENAI_API_KEY")

    client = openai.OpenAI(api_key=settings.openai_api_key, max_retries=0, timeout=180)
    try:
        with path.open("rb") as f:
            result = client.audio.transcriptions.create(
                model="whisper-1", file=(path.name, f.read())
            )
    except (openai.APIConnectionError, openai.RateLimitError) as exc:
        raise TransientAIError(str(exc)) from exc
    except openai.APIStatusError as exc:
        if exc.status_code >= 500:
            raise TransientAIError(str(exc)) from exc
        raise
    return result.text.strip()
