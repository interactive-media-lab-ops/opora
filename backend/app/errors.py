"""Помилки з машинозчитуваною причиною: `{"detail": "...", "reason": "used" | "expired"}`."""

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse


class GoneError(Exception):
    """410: посилання чи запрошення більше не діє. `reason` — used | expired."""

    def __init__(self, message: str, reason: str):
        self.message = message
        self.reason = reason


def register_handlers(app: FastAPI) -> None:
    @app.exception_handler(GoneError)
    async def _gone(_: Request, exc: GoneError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_410_GONE, content={"detail": exc.message, "reason": exc.reason}
        )
