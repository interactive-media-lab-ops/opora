"""Розширені демо-дані для огляду дизайну (BR-12): `SEED_DEMO_DATA=rich`.

Додає до звичайного демо: методології з 3 і 8 осями аналітики, кандидатів з довгими іменами й текстами,
кілька проходжень, збої аналізу, відгуки з усіма станами посилань (надіслано / відмова / очікує / прострочене),
HR не-демо з увімкненою 2FA. Усі люди й тексти вигадані (DD-03). Ідемпотентно.

ЛИШЕ для локального огляду: акаунт `hr.real@example.org` має відомий пароль і відомий ключ 2FA.
"""

import os
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import seed as base
from app.models import (
    Assessment,
    MethodologyStatus,
    PromptNode,
    Recommendation,
    RecommendationAnswer,
    RecommendationLink,
    RecommendationLinkStatus,
    RecommendationRole,
    User,
    UserRole,
    Verdict,
)
from app.security import generate_code
from app.services import totp
from app.services.storage import StorageService

T, Q = base.T, base.Q

# відомий ключ 2FA для не-демо HR: щоб переглянути екран входу з кодом (лише локально)
RICH_HR_EMAIL = "hr.real@example.org"
RICH_HR_TOTP_SECRET = os.environ.get("SEED_RICH_HR_TOTP_SECRET", "JBSWY3DPEHPK3PXP")

AXES8 = [
    ("Відповідальність", "SELF"),
    ("Ініціативність", "SELF"),
    ("Командна взаємодія", "CONVERSATION"),
    ("Чесність", "CONVERSATION"),
    ("Стійкість", "CONVERSATION"),
    ("Навчання", "REVIEWS"),
    ("Вплив", "REVIEWS"),
    ("Комунікація", "CONVERSATION"),
]
AXES3 = [("Рішучість", "SELF"), ("Турбота про людей", "CONVERSATION"), ("Прикладність", "REVIEWS")]


def _spec(title: str, description: str, axes: list[tuple[str, str]]) -> base.MethodologySpec:
    return base.MethodologySpec(
        title=title,
        description=description,
        status=MethodologyStatus.ACTIVE,
        fields=[
            ("Повне ім'я", T.TEXT, None, True),
            ("Посада", T.TEXT, None, False),
            ("Про себе", T.TEXTAREA, None, False),
        ],
        quiz=[
            ("Що вам ближче?", Q.SINGLE_CHOICE, ["Вести за собою", "Підтримувати", "Аналізувати"]),
            ("Оцініть свою рішучість", Q.SCALE, [1, 10]),
        ],
        interview=[
            (
                "Опишіть ситуацію, коли ви взяли на себе відповідальність за чужу помилку.",
                "До двох хвилин.",
                120,
            )
        ],
        nodes=[
            (
                name,
                f"Оціни ознаку «{name}» за відповідями кандидата.",
                True,
                (i % 4) * 260,
                (i // 4) * 180,
            )
            for i, (name, _) in enumerate(axes)
        ],
        edges=[],
    )


LEAD8 = _spec(
    "Лідерство · 8 осей (демо)",
    "Радар із максимумом осей: перевірка розкладки легенди й підписів.",
    AXES8,
)
LEAD3 = _spec("Лідерство · 3 осі (демо)", "Мінімум осей для радара.", AXES3)

L8_Q, L3_Q = LEAD8.quiz[0][0], LEAD8.quiz[1][0]
L8_I = LEAD8.interview[0][0]
LONG_NAME = "Олександра-Вікторія Святославівна Кошовенко-Заблоцька"
LONG_TEXT = (
    "Понад п'ятнадцять років працювала на посадах від молодшого фахівця до заступника начальника управління; "
    "відповідала за підготовку команд, ротацію кадрів і взаємодію з суміжними підрозділами. " * 3
)


def _scores(names: list[str], tier: int) -> dict[str, int]:
    return {n: max(1, min(10, tier + (i * 3) % 5 - 2)) for i, n in enumerate(names)}


def _cand(email, name, spec, step, tier, **kw) -> base.CandidateSpec:
    names = [n for n, *_ in spec.nodes]
    return base.CandidateSpec(
        email,
        name,
        spec.title,
        step,
        profile={
            "Повне ім'я": name,
            "Посада": kw.pop("post", "Командир відділення"),
            "Про себе": kw.pop("about", "Вигадана біографія для перегляду розкладки."),
        },
        quiz={spec.quiz[0][0]: "Вести за собою", spec.quiz[1][0]: 7},
        voice={
            spec.interview[0][0]: kw.pop(
                "voice",
                "Одного разу підвели терміни через мою ділянку. Я сказав про це першим, зібрав людей і виправив за ніч.",
            )
        },
        tier={9: "high", 6: "mid", 3: "low"}[tier],
        scores=_scores(names, tier),
        **kw,
    )


RICH_CANDIDATES = [
    _cand(
        "rich.1@opora.example",
        "Анна Мельник",
        LEAD8,
        base.Step.DONE,
        9,
        verdict=Verdict.RECOMMENDED,
        note="Сильна кандидатка",
        days_ago=9,
    ),
    _cand(
        "rich.2@opora.example",
        "Богдан Савчук",
        LEAD8,
        base.Step.DONE,
        6,
        verdict=Verdict.IN_REVIEW,
        days_ago=6,
    ),
    _cand(
        "rich.3@opora.example",
        "Валентин Руденко",
        LEAD8,
        base.Step.DONE,
        3,
        verdict=Verdict.REJECTED,
        note="Не підходить за стійкістю",
        days_ago=12,
    ),
    _cand(
        "rich.4@opora.example",
        LONG_NAME,
        LEAD8,
        base.Step.DONE,
        9,
        post="Заступник начальника управління з розвитку персоналу та взаємодії з суміжними підрозділами",
        about=LONG_TEXT,
        voice=LONG_TEXT,
        days_ago=2,
    ),
    _cand(
        "rich.5@opora.example",
        "Григорій Іваненко",
        LEAD8,
        base.Step.DONE,
        6,
        failed_nodes=("Чесність", "Вплив"),
        days_ago=4,
    ),
    _cand("rich.6@opora.example", "Дарина Шевчук", LEAD8, base.Step.PROCESSING, 6, days_ago=1),
    _cand("rich.7@opora.example", "Едуард Гнатюк", LEAD8, base.Step.INTERVIEW, 6, days_ago=2),
    _cand("rich.8@opora.example", "Жанна Лисенко", LEAD8, base.Step.QUIZ, 6, days_ago=3),
    _cand("rich.9@opora.example", "Захар Бондар", LEAD8, base.Step.PROFILE, 6, days_ago=5),
    _cand(
        "rich.10@opora.example",
        "Інна Ковальчук",
        LEAD3,
        base.Step.DONE,
        9,
        verdict=Verdict.RECOMMENDED,
        days_ago=7,
    ),
    _cand("rich.11@opora.example", "Кирило Мороз", LEAD3, base.Step.DONE, 3, days_ago=8),
    _cand("rich.12@opora.example", "Любов Остапчук", LEAD3, base.Step.PROCESSING, 6, days_ago=1),
]

# axis/source для розмітки вузлів (ідемпотентно, як у base._tag_analytics)
TAGS = {LEAD8.title: dict(AXES8), LEAD3.title: dict(AXES3)}

CONCLUSION_TEXT = {
    "high": "{name}: ознака виражена, підтверджена прикладами з розмови й відгуками.",
    "mid": "{name}: ознака проявляється нерівномірно, потрібні додаткові приклади.",
    "low": "{name}: ознака майже не простежується у відповідях.",
}

# відгуки: (роль, текст) — надіслано, None — відмова, "pending" — очікує, "expired" — очікує, але строк минув
RICH_REVIEWS = {
    "rich.1@opora.example": [
        (RecommendationRole.MANAGER, "Керував її підрозділом два роки."),
        (RecommendationRole.COLLEAGUE, "Працювали пліч-о-пліч."),
        (RecommendationRole.SUBORDINATE, "Була моєю керівницею."),
        None,
    ],
    "rich.2@opora.example": [
        (RecommendationRole.COLLEAGUE, "Колега з сусіднього відділу."),
        "pending",
        "expired",
        None,
    ],
    "rich.4@opora.example": [
        (RecommendationRole.MANAGER, LONG_TEXT),
        "pending",
        "pending",
        "expired",
    ],
}


def _add_review_links(db: Session) -> dict[str, str]:
    """Посилання у всіх станах; повертає токени «живих» і прострочених для огляду (друкуються у виводі сиду)."""
    shown: dict[str, str] = {}
    for email, reviews in RICH_REVIEWS.items():
        a = db.execute(
            select(Assessment)
            .join(User, User.id == Assessment.candidate_id)
            .where(User.email == email)
        ).scalar_one_or_none()
        if a is None or a.recommendation_links:
            continue
        questions = a.methodology.recommendation_questions
        for slot, review in enumerate(reviews, start=1):
            expired = review == "expired"
            pending = review in ("pending", "expired")
            status = (
                RecommendationLinkStatus.PENDING
                if pending
                else RecommendationLinkStatus.DECLINED
                if review is None
                else RecommendationLinkStatus.SUBMITTED
            )
            link = RecommendationLink(
                assessment_id=a.id,
                slot=slot,
                token=generate_code(24),
                status=status,
                expires_at=datetime.now(UTC)
                + (timedelta(days=-2) if expired else timedelta(days=30)),
            )
            if status == RecommendationLinkStatus.SUBMITTED:
                role, text = review
                link.recommendation = Recommendation(
                    role=role,
                    answers=[
                        RecommendationAnswer(
                            question_id=q.id, question_text=q.text, order=i, text=text
                        )
                        for i, q in enumerate(questions)
                    ],
                )
            if expired or review == "pending":
                shown[f"{email} · слот {slot} · {'прострочене' if expired else 'живе'}"] = (
                    link.token
                )
            elif status != RecommendationLinkStatus.PENDING:
                shown[f"{email} · слот {slot} · використане"] = link.token
            db.add(link)
    db.flush()
    return shown


def _ensure_hr_with_2fa(db: Session, password: str) -> None:
    user, created = base._get_or_create_user(
        db, RICH_HR_EMAIL, "HR Реальний (вигаданий)", UserRole.HR, password
    )
    if created or not user.totp_enabled:
        user.totp_secret_enc = totp.encrypt_secret(RICH_HR_TOTP_SECRET)
        user.totp_enabled = True
        user.is_demo = False
    db.flush()


def seed_rich(
    db: Session, storage: StorageService, staff: dict[UserRole, User], password: str
) -> None:
    base.CONCLUSIONS.update(
        {name: CONCLUSION_TEXT for name in {n for n, _ in AXES8} | {n for n, _ in AXES3}}
    )
    methodologies = {
        s.title: base._ensure_methodology(db, s, staff[UserRole.METHODOLOGIST])
        for s in (LEAD8, LEAD3)
    }
    for spec in RICH_CANDIDATES:
        if db.execute(select(User.id).where(User.email == spec.email)).first() is None:
            base._add_candidate(db, storage, spec, methodologies[spec.methodology], password)
    db.flush()
    base._ensure_recommendations(db, methodologies)
    for title, mapping in TAGS.items():
        for node in db.execute(
            select(PromptNode).where(PromptNode.methodology_id == methodologies[title].id)
        ).scalars():
            if node.axis is None and node.name in mapping:
                node.axis, node.source = node.name, mapping[node.name]
    db.flush()
    shown = _add_review_links(db)
    _ensure_hr_with_2fa(db, password)
    for label, token in shown.items():
        print(f"  {label}: /r/{token}")
