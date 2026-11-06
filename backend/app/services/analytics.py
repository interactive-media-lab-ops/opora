"""Слот аналітики (DD-06): радар / смуги за оцінками вузлів, розмічених віссю й джерелом у методології."""

from collections import defaultdict

from app.models import AnalysisStatus, Assessment
from app.schemas.results import AnalyticsOut, AnalyticsSeriesOut, AnalyticsSourceOut

SOURCES = (
    ("SELF", "Самоподача", "Анкета й опитувальник: що кандидат розповів про себе"),
    ("CONVERSATION", "Розмова", "Відповіді кандидата в розмові"),
    ("REVIEWS", "Відгуки", "Відгуки рекомендаторів"),
)
OVERALL = ("OVERALL", "Загальна оцінка", "Підсумкові оцінки аналізу")
MAX_RADAR_AXES = 8  # далі радар нечитабельний — смуги
MIN_RADAR_AXES = 3


def _avg(values: list[float]) -> float:
    return round(sum(values) / len(values), 1)


def build_analytics(assessment: Assessment) -> AnalyticsOut:
    nodes = sorted(assessment.methodology.prompt_nodes, key=lambda n: n.id)
    tagged = [n for n in nodes if n.returns_score and n.axis and n.source]
    scores: dict[int, float] = {
        r.prompt_node_id: r.score
        for r in assessment.results
        if r.status == AnalysisStatus.DONE and r.score is not None
    }

    if tagged:
        axes = list(dict.fromkeys(n.axis for n in tagged))
        sources, series = [], []
        for key, label, hint in SOURCES:
            mine = [n for n in tagged if n.source == key]
            if not mine:
                continue  # джерело в методології не задіяне — у словнику його немає
            values: dict[str, list[float]] = defaultdict(list)
            for n in mine:
                if n.id in scores:
                    values[n.axis].append(scores[n.id])
            has = bool(values)
            sources.append(AnalyticsSourceOut(key=key, label=label, hint=hint, has_data=has))
            series.append(
                AnalyticsSeriesOut(
                    source=key, values={a: _avg(values[a]) if a in values else None for a in axes}
                )
            )
        fallback = False
    else:
        # розмітки немає: один ряд — підсумкові (фінальні) оцінки вузлів
        terminal = {r.prompt_node_id for r in assessment.results if r.is_terminal}
        final = [n for n in nodes if n.returns_score and n.id in terminal]
        axes = [n.name for n in final]
        key, label, hint = OVERALL
        values_by_axis = {n.name: scores.get(n.id) for n in final}
        sources = (
            [
                AnalyticsSourceOut(
                    key=key,
                    label=label,
                    hint=hint,
                    has_data=any(v is not None for v in values_by_axis.values()),
                )
            ]
            if final
            else []
        )
        series = [AnalyticsSeriesOut(source=key, values=values_by_axis)] if final else []
        fallback = True

    mode = "radar" if MIN_RADAR_AXES <= len(axes) <= MAX_RADAR_AXES else "bars"
    return AnalyticsOut(
        configured=bool(axes),
        fallback=fallback,
        mode=mode,
        scale_max=10,
        axes=axes,
        sources=sources,
        series=series,
        sources_total=len(sources),
        sources_with_data=sum(1 for s in sources if s.has_data),
    )
