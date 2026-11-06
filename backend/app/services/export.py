"""Експорт списку кандидатів у Excel (openpyxl)."""

import re
from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

from app.schemas.results import CandidateRowOut

STAGE_LABEL = {
    "IN_PROGRESS": "В процесі",
    "PROCESSING": "Обробка",
    "DONE": "Завершено",
}
VERDICT_LABEL = {
    "IN_REVIEW": "На розгляді",
    "RECOMMENDED": "Рекомендовано",
    "REJECTED": "Відхилено",
}
HEADERS = ["Кандидат", "Пошта", "Методологія", "Подано", "Етап", "Зведений бал", "Вердикт"]


def _text(ws, row: int, col: int, value: str):
    """Рядок завжди текстом: openpyxl інакше вважає значення на «=» формулою (ім'я кандидата — ввід користувача)."""
    cell = ws.cell(row=row, column=col, value=value)
    cell.data_type = "s"
    return cell


def safe_sheet_title(name: str) -> str:
    title = re.sub(r"[\[\]:*?/\\]", " ", name).strip().strip("'")
    return (title or "Список")[:31]


def safe_filename(name: str) -> str:
    stem = re.sub(r'[\\/:*?"<>|\r\n]', "_", name).strip(" .") or "list"
    return f"{stem[:80]}.xlsx"


def build_list_workbook(list_name: str, rows: list[CandidateRowOut]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = safe_sheet_title(list_name)
    for col, header in enumerate(HEADERS, start=1):
        _text(ws, 1, col, header).font = Font(bold=True)
    for r, row in enumerate(rows, start=2):
        _text(ws, r, 1, row.candidate_name)
        _text(ws, r, 2, row.candidate_email)
        _text(ws, r, 3, row.methodology_title)
        if row.submitted_at:
            c = ws.cell(row=r, column=4, value=row.submitted_at.replace(tzinfo=None))
            c.number_format = "DD.MM.YYYY HH:MM"
        _text(ws, r, 5, STAGE_LABEL.get(row.stage.value, row.stage.value))
        if row.summary_score is not None:
            ws.cell(row=r, column=6, value=row.summary_score)
        _text(ws, r, 7, VERDICT_LABEL.get(row.verdict.value, "") if row.verdict else "")
    for col in range(1, len(HEADERS) + 1):
        width = max(len(str(c.value or "")) for c in ws[get_column_letter(col)])
        ws.column_dimensions[get_column_letter(col)].width = min(max(width + 2, 12), 48)
    ws.freeze_panes = "A2"
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
