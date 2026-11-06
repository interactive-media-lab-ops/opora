"""Файлове сховище аудіозаписів: безпечні шляхи, архівація при повторному проходженні."""

import contextlib
from pathlib import Path

from app.config import get_settings

ALLOWED_EXTENSIONS = {".webm", ".ogg", ".mp4", ".m4a", ".mp3", ".wav"}


class StorageService:
    """Локальне сховище аудіо. Інтерфейс (save/path_for/delete) сумісний із заміною на S3."""

    def __init__(self, root: str | None = None):
        self.root = Path(root or get_settings().storage_dir).resolve()

    def save(
        self, assessment_id: int, question_id: int, attempt: int, data: bytes, ext: str
    ) -> str:
        ext = ext.lower()
        if ext not in ALLOWED_EXTENSIONS:
            ext = ".webm"
        relative = Path(str(assessment_id)) / f"q{question_id}_a{attempt}{ext}"
        target = self.path_for(str(relative))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return str(relative)

    def path_for(self, relative: str) -> Path:
        path = (self.root / relative).resolve()
        if self.root not in path.parents and path != self.root:
            raise ValueError("Некоректний шлях до файлу")
        return path

    def archive(self, relative: str) -> str:
        """Переносить файл в archive/ (попередня спроба повторного проходження). Повертає новий відносний шлях."""
        try:
            source = self.path_for(relative)
        except ValueError:
            return relative
        if not source.exists():
            return relative
        target_relative = Path("archive") / f"{source.parent.name}_{source.name}"
        target = self.path_for(str(target_relative))
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():  # повторні архівації одного питання не перезаписують попередні
            target = target.with_name(f"{target.stem}_{int(source.stat().st_mtime)}{target.suffix}")
            target_relative = target.relative_to(self.root)
        source.replace(target)
        return str(target_relative)

    def delete(self, relative: str) -> None:
        with contextlib.suppress(ValueError):
            self.path_for(relative).unlink(missing_ok=True)


def get_storage() -> StorageService:
    return StorageService()
