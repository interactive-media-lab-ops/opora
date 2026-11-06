"""Налаштування Celery (черга на Redis)."""

from celery import Celery

from app.config import get_settings

settings = get_settings()

celery = Celery(
    "opora", broker=settings.redis_url, backend=settings.redis_url, include=["app.tasks.pipeline"]
)
celery.conf.update(
    task_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)
