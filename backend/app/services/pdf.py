"""PDF-профіль кандидата для HR (BR-10, 64A): шапка, етапи, аналітика, висновок ШІ, вердикт, відгуки за ролями.

Навмисно НЕ потрапляють: нотатки HR (особисті, 79A), журнал змін і подій, сирі відповіді й транскрипти, промти й помилки
аналізу (бачить лише методист), пошта рекомендаторів (її в системі немає). Тексти — вигадані лише в демо.
"""

import re
from datetime import datetime
from pathlib import Path

from fpdf import FPDF

from app.models import AnalysisStatus, Assessment
from app.services import recommendations as recommendation_service
from app.services import stages
from app.services.analytics import build_analytics

FONTS = Path(__file__).resolve().parent.parent / "assets" / "fonts"
VERDICT = {"IN_REVIEW": "На розгляді", "RECOMMENDED": "Рекомендовано", "REJECTED": "Відхилено"}
STATUS = {"NOT_STARTED": "не розпочато", "IN_PROGRESS": "в процесі", "SUBMITTED": "надіслано"}
MUTED = (110, 110, 110)


def _plain(text: str) -> str:
    """Висновки ШІ — markdown-подібний текст; у PDF лишаємо читабельний простий текст."""
    text = re.sub(r"```.*?```", "", text or "", flags=re.S)
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.M)
    text = re.sub(r"(\*\*|__|`)", "", text)
    text = re.sub(r"^\s*[-*]\s+", "• ", text, flags=re.M)
    return text.strip()


class _Pdf(FPDF):
    def __init__(self, footer_text: str):
        super().__init__(format="A4")
        self.footer_text = footer_text
        self.set_margins(18, 16, 18)
        self.set_auto_page_break(True, margin=18)
        self.add_font("DejaVu", "", str(FONTS / "DejaVuSans.ttf"))
        self.add_font("DejaVu", "B", str(FONTS / "DejaVuSans-Bold.ttf"))
        self.set_title("Профіль кандидата")
        self.set_creator("Опора")
        self.alias_nb_pages()

    def footer(self):
        self.set_y(-12)
        self.set_font("DejaVu", "", 8)
        self.set_text_color(*MUTED)
        self.cell(0, 6, self.footer_text, align="L")
        self.set_x(self.l_margin)
        self.cell(0, 6, f"{self.page_no()} / {{nb}}", align="R")

    def h2(self, text: str):
        self.ln(4)
        self.set_font("DejaVu", "B", 12)
        self.set_text_color(0, 0, 0)
        self.cell(0, 7, text, new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(200, 200, 200)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(2)

    def body(self, text: str, size: int = 10, bold: bool = False, color=(0, 0, 0)):
        self.set_font("DejaVu", "B" if bold else "", size)
        self.set_text_color(*color)
        self.multi_cell(0, 5.2, text, new_x="LMARGIN", new_y="NEXT", align="L")


def _fmt(n: float | None) -> str:
    return "—" if n is None else f"{n:g}".replace(".", ",")


def build_candidate_pdf(assessment: Assessment, generated_by: str, now: datetime) -> bytes:
    stamp = now.strftime("%d.%m.%Y %H:%M")
    pdf = _Pdf(f"Опора · конфіденційно · сформовано {stamp}")
    pdf.add_page()
    m = assessment.methodology

    # шапка
    pdf.set_font("DejaVu", "B", 18)
    pdf.multi_cell(0, 8, assessment.candidate.name, new_x="LMARGIN", new_y="NEXT", align="L")
    pdf.body(f"{assessment.candidate.email} · {m.title}", color=MUTED)
    submitted = (
        assessment.submitted_at.strftime("%d.%m.%Y") if assessment.submitted_at else "ще не подано"
    )
    verdict = VERDICT.get(assessment.verdict.value if assessment.verdict else "", "ще не ухвалено")
    pdf.body(f"Подано: {submitted} · Рішення HR: {verdict}", color=MUTED)
    pdf.body(f"Сформував: {generated_by}", size=9, color=MUTED)

    # етапи
    keys = stages.required(assessment)
    done = sum(1 for k in keys if stages.status(assessment, k) == "SUBMITTED")
    pdf.h2(f"Етапи · {done} / {len(keys)} надіслано")
    for k in keys:
        pdf.body(f"{stages.title(assessment, k)} — {STATUS[stages.status(assessment, k)]}")

    # аналітика
    a = build_analytics(assessment)
    if a.configured and a.axes:
        pdf.h2("Аналітика" + (" (фінальні оцінки вузлів)" if a.fallback else ""))
        pdf.body(f"Оцінки за шкалою 1–{a.scale_max}. «—» — даних ще немає.", size=9, color=MUTED)
        shown = [
            s
            for s in a.series
            if a.sources
            and any(src.key == s.source and src.has_data for src in a.sources)
            or not a.sources
        ]
        labels = {src.key: src.label for src in a.sources}
        col = (pdf.w - pdf.l_margin - pdf.r_margin) / (1 + max(len(shown), 1))
        pdf.set_font("DejaVu", "B", 9)
        pdf.cell(col, 6, "Вісь")
        for s in shown:
            pdf.cell(col, 6, labels.get(s.source, s.source)[:18])
        pdf.ln(6)
        pdf.set_font("DejaVu", "", 9)
        for axis in a.axes:
            pdf.cell(col, 6, axis[:28])
            for s in shown:
                pdf.cell(col, 6, _fmt(s.values.get(axis)))
            pdf.ln(6)

    # висновок
    final = [
        r
        for r in sorted(assessment.results, key=lambda r: r.prompt_node_id)
        if r.is_terminal and r.status == AnalysisStatus.DONE
    ]
    pdf.h2("Висновок")
    if not final:
        pdf.body("Висновку ще немає: аналіз не завершено.", color=MUTED)
    for r in final:
        score = f" · {_fmt(r.score)}/10" if r.score is not None else ""
        pdf.ln(1)
        pdf.body(f"{r.node.name}{score}", bold=True)
        pdf.body(_plain(r.output))

    # відгуки
    reviews = recommendation_service.anonymous_reviews(assessment)
    if reviews:
        pdf.h2(f"Відгуки · {len(reviews)}")
        for i, rev in enumerate(reviews, start=1):
            pdf.ln(1)
            pdf.body(f"{rev.role_label} (анонімно) · відгук {i}", bold=True)
            for ans in rev.answers:
                pdf.body(ans.question, size=9, color=MUTED)
                pdf.body(ans.text)

    return bytes(pdf.output())
