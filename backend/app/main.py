"""Точка входу FastAPI: middleware, обробники помилок, підключення роутерів."""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    account,
    audio,
    auth,
    candidate,
    hr_lists,
    hr_notes,
    methodologies,
    recommendations,
    results,
    users,
)
from app.api import (
    config as config_api,
)
from app.config import get_settings
from app.errors import register_handlers

settings = get_settings()

if settings.jwt_secret in ("", "change-me"):
    logging.getLogger("uvicorn.error").warning(
        "JWT_SECRET не змінено (значення за замовчуванням) — токени можна підробити. "
        "Задайте випадковий секрет у .env (openssl rand -hex 32), особливо в продакшні."
    )

app = FastAPI(
    title="OPORA — HR-платформа оцінки кандидатів",
    version="0.1.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

register_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(config_api.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(candidate.router, prefix="/api")
app.include_router(recommendations.candidate_router, prefix="/api")
app.include_router(recommendations.public_router, prefix="/api")
app.include_router(results.hr_router, prefix="/api")
app.include_router(hr_notes.router, prefix="/api")
app.include_router(account.router, prefix="/api")
app.include_router(account.admin_router, prefix="/api")
app.include_router(hr_lists.router, prefix="/api")
app.include_router(results.analysis_router, prefix="/api")
app.include_router(audio.router, prefix="/api")
app.include_router(methodologies.router, prefix="/api")
app.include_router(methodologies.invites_router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
