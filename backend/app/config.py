"""Налаштування застосунку зі змінних середовища (.env)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    database_url: str = "postgresql+psycopg://opora:opora@localhost:5432/opora"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 30
    refresh_token_days: int = 14

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5-5"
    openai_api_key: str = ""

    # Провайдер аналізу: anthropic | near. Провайдер транскрипції: openai | near.
    # X-26 / BR-11: за замовчуванням лише NearAI. Прямі адаптери (anthropic / openai) — тільки локально й за явним прапорцем.
    ai_provider: str = "near"
    transcribe_provider: str = "near"
    allow_direct_ai: bool = False
    near_api_key: str = ""
    near_base_url: str = "https://cloud-api.near.ai/v1"
    near_model: str = "anthropic/claude-sonnet-5-5"  # id з GET /v1/models; потрібна підтримка tools
    near_transcribe_model: str = "openai/whisper-large-v3"
    near_transcribe_language: str = ""  # напр. uk; порожньо — автовизначення

    # BR-7/BR-8: 2FA обов'язкова для HR та адміна з першого входу (демо-акаунти виключені). False — лише для локальної розробки.
    require_2fa: bool = True

    # BR-16: контакт техпідтримки (зміна / скидання 2FA, D-39); порожній — кнопка в UI недоступна з причиною
    support_email: str = ""

    frontend_url: str = "http://localhost:5173"
    storage_dir: str = "../storage/audio"


@lru_cache
def get_settings() -> Settings:
    return Settings()
