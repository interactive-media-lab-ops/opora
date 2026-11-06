"""Початкові й демонстраційні дані.

Запуск: python -m app.seed

Завжди створює службові акаунти (адмін, методист, HR). SEED_DEMO_DATA=rich (BR-12) додає ще розширений
набір для огляду дизайну — див. app/seed_rich.py. Якщо SEED_DEMO_DATA не вимкнено (=false),
додає ще демо-методології, кандидатів на всіх етапах, висновки, вердикти й запрошення — щоб
у кожному кабінеті було що подивитися. Усе ідемпотентно: наявне не змінюється і не дублюється.

Паролі за замовчуванням — лише для розробки; задайте SEED_*_PASSWORD. Демо-висновки позначені
моделлю «demo-seed» — це приклади, а не результат справжнього аналізу.
"""

import enum
import io
import os
import wave
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_sync_db
from app.models import (
    AnalysisResult,
    AnalysisStatus,
    Assessment,
    AssessmentStage,
    HRNote,
    InterviewQuestion,
    Methodology,
    MethodologyStatus,
    PersonalInvite,
    ProfileAnswer,
    ProfileField,
    ProfileFieldType,
    PromptEdge,
    PromptNode,
    QuizAnswer,
    QuizQuestion,
    QuizQuestionType,
    Recommendation,
    RecommendationAnswer,
    RecommendationLink,
    RecommendationLinkStatus,
    RecommendationQuestion,
    RecommendationRole,
    TranscriptStatus,
    User,
    UserRole,
    Verdict,
    VerdictChange,
    VoiceAnswer,
)
from app.security import generate_code, hash_password
from app.services import graph
from app.services.storage import StorageService

DEMO_DOMAIN = "@opora.example"
DEMO_MODEL = "demo-seed"

STAFF = [
    ("admin@opora.example", "Адміністратор", UserRole.ADMIN, "SEED_ADMIN_PASSWORD"),
    (
        "methodologist@opora.example",
        "Методист Демо",
        UserRole.METHODOLOGIST,
        "SEED_METHODOLOGIST_PASSWORD",
    ),
    ("hr@opora.example", "HR Демо", UserRole.HR, "SEED_HR_PASSWORD"),
]

T = ProfileFieldType
Q = QuizQuestionType


# ---------- Методології ----------


@dataclass
class MethodologySpec:
    title: str
    description: str
    status: MethodologyStatus
    fields: list[tuple[str, ProfileFieldType, list[str] | None, bool]]
    quiz: list[tuple[str, QuizQuestionType, list | None]]
    interview: list[tuple[str, str, int]]
    nodes: list[tuple[str, str, bool, float, float]]  # назва, промт, бал?, x, y
    edges: list[tuple[str, str]]
    allow_rerecord: bool = True
    max_attempts: int = 3


SALES = MethodologySpec(
    title="Менеджер з продажів (демо)",
    description="Демонстраційна методологія оцінювання кандидата.",
    status=MethodologyStatus.ACTIVE,
    fields=[
        ("Повне ім'я", T.TEXT, None, True),
        ("Досвід роботи (років)", T.NUMBER, None, True),
        ("Розкажіть про себе", T.TEXTAREA, None, False),
    ],
    quiz=[
        (
            "Що для вас важливіше в роботі?",
            Q.SINGLE_CHOICE,
            ["Результат", "Команда", "Розвиток", "Стабільність"],
        ),
        ("Оцініть вашу стресостійкість", Q.SCALE, [1, 10]),
    ],
    interview=[
        (
            "Розкажіть про складну ситуацію з клієнтом і як ви її вирішили.",
            "Відповідайте 1–2 хвилини.",
            120,
        )
    ],
    nodes=[
        (
            "Комунікація",
            "Оціни комунікативні навички кандидата за анкетою, опитувальником і транскриптом інтерв'ю.",
            True,
            0,
            0,
        ),
        ("Мотивація", "Оціни мотивацію та цінності кандидата.", True, 0, 180),
        (
            "Підсумок",
            "На основі висновків щодо комунікації та мотивації сформуй підсумкову рекомендацію.",
            True,
            320,
            90,
        ),
    ],
    edges=[("Комунікація", "Підсумок"), ("Мотивація", "Підсумок")],
)

SUPPORT = MethodologySpec(
    title="Спеціаліст підтримки клієнтів (демо)",
    description="Оцінка емпатії, стресостійкості й мовлення кандидатів на першу лінію підтримки. Граф із двома фінальними вузлами.",
    status=MethodologyStatus.ACTIVE,
    max_attempts=2,
    fields=[
        ("Повне ім'я", T.TEXT, None, True),
        (
            "Мови спілкування",
            T.SELECT,
            ["Українська", "Українська та англійська", "Українська, англійська та польська"],
            True,
        ),
        ("Досвід у підтримці (років)", T.NUMBER, None, False),
        ("Бажаний графік", T.SELECT, ["Повний день", "Змінний", "Віддалено"], True),
    ],
    quiz=[
        (
            "Клієнт розлючений і підвищує голос. Ваші перші дії?",
            Q.SINGLE_CHOICE,
            [
                "Вибачитися й дати вислухати себе",
                "Одразу запропонувати компенсацію",
                "Передати розмову керівнику",
                "Пояснити, що так розмовляти не можна",
            ],
        ),
        (
            "Якими каналами вам комфортно працювати?",
            Q.MULTI_CHOICE,
            ["Телефон", "Чат", "Електронна пошта", "Месенджери"],
        ),
        ("Наскільки легко ви відновлюєтесь після конфліктної розмови?", Q.SCALE, [1, 5]),
    ],
    interview=[
        (
            "Опишіть випадок, коли ви допомогли незадоволеній людині.",
            "Що було, що ви зробили, чим закінчилось.",
            120,
        ),
        ("Чому ви хочете працювати саме в підтримці?", "Достатньо 1 хвилини.", 90),
    ],
    nodes=[
        ("Емпатія", "Оціни емпатію й уміння слухати за відповідями кандидата.", True, 0, 0),
        (
            "Стресостійкість",
            "Оціни стресостійкість кандидата за опитувальником та інтерв'ю.",
            True,
            0,
            170,
        ),
        (
            "Аналіз мовлення",
            "Проаналізуй мовлення за транскриптами: чіткість, структуру, тон. Лише текст, без балу.",
            False,
            0,
            340,
        ),
        (
            "Підсумок",
            "Врахуй висновки щодо емпатії, стресостійкості та мовлення й дай рекомендацію.",
            True,
            330,
            120,
        ),
        ("Ризики", "Окремо вкажи ризики й питання для уточнення на співбесіді.", False, 330, 340),
    ],
    edges=[
        ("Емпатія", "Підсумок"),
        ("Стресостійкість", "Підсумок"),
        ("Аналіз мовлення", "Підсумок"),
        ("Аналіз мовлення", "Ризики"),
    ],
)

ANALYST = MethodologySpec(
    title="Аналітик даних (чернетка)",
    description="Методологія в розробці: ще не активована, тож поля й питання можна змінювати.",
    status=MethodologyStatus.DRAFT,
    fields=[
        ("Повне ім'я", T.TEXT, None, True),
        ("Рівень SQL", T.SELECT, ["Базовий", "Середній", "Просунутий"], True),
    ],
    quiz=[
        (
            "Які інструменти візуалізації ви використовували?",
            Q.MULTI_CHOICE,
            ["Power BI", "Tableau", "Metabase", "Python"],
        )
    ],
    interview=[("Опишіть аналітичну задачу, яка принесла найбільше користі бізнесу.", "", 150)],
    nodes=[("Технічна глибина", "Оціни технічну глибину відповідей кандидата.", True, 0, 0)],
    edges=[],
)

ARCHIVED = MethodologySpec(
    title="Стажер відділу кадрів (архів)",
    description="Стара методологія, переведена в архів.",
    status=MethodologyStatus.ARCHIVED,
    fields=[("Повне ім'я", T.TEXT, None, True)],
    quiz=[("Чому ви обрали HR?", Q.TEXT, None)],
    interview=[],
    nodes=[("Загальне враження", "Дай загальне враження про кандидата.", False, 0, 0)],
    edges=[],
)

METHODOLOGIES = [SALES, SUPPORT, ANALYST, ARCHIVED]


# ---------- Тексти демо-висновків: вузол → рівень → шаблон ----------

CONCLUSIONS: dict[str, dict[str, str]] = {
    "Комунікація": {
        "high": "**Сильні сторони:** {name} говорить структуровано, наводить конкретні приклади й показує, що вміє слухати клієнта.\n\n**Зона уваги:** інколи надто деталізує — на співбесіді варто просити стислішу відповідь.",
        "mid": "**Загалом:** {name} пояснює зрозуміло, але відповідям бракує конкретики та вимірюваного результату.\n\n**Рекомендація:** попросити розповісти ще один кейс із цифрами.",
        "low": "**Ризик:** відповіді {name} уривчасті, приклади загальні, у ситуації з клієнтом акцент на власній правоті, а не на розв'язанні проблеми.",
    },
    "Мотивація": {
        "high": "{name} орієнтований на результат і розвиток: пояснює, чого хоче навчитися, і пов'язує це з роллю.",
        "mid": "Мотивація {name} переважно в стабільності та умовах; інтерес до розвитку є, але конкретних планів немає.",
        "low": "Чітких мотивів вибору ролі {name} не назвав(ла), у відповідях переважають зовнішні фактори (графік, місце роботи).",
    },
    "Підсумок": {
        "high": "**Рекомендація: запросити на наступний етап.** {name} поєднує сильну комунікацію з очевидною мотивацією. Ризики мінімальні й стосуються лише стислості відповідей.",
        "mid": "**Рекомендація: розглянути за наявності вільних місць.** {name} має базу, але для сильного кандидата не вистачає конкретики й самостійності.",
        "low": "**Рекомендація: не просувати далі.** У {name} слабкі кейси спілкування з клієнтом і нечітка мотивація.",
    },
    "Емпатія": {
        "high": "{name} щиро реагує на емоції співрозмовника, перефразовує проблему клієнта й пропонує розв'язання без тиску.",
        "mid": "{name} співчуває, але швидко переходить до технічного розв'язання, не показавши, що почув(ла) людину.",
        "low": "У прикладах {name} не видно інтересу до стану клієнта — фокус на регламенті.",
    },
    "Стресостійкість": {
        "high": "Самооцінка стресостійкості збігається з прикладами з інтерв'ю: {name} називає прийоми відновлення й не персоналізує конфлікт.",
        "mid": "{name} справляється зі звичайним навантаженням, але після конфліктів потребує часу на відновлення.",
        "low": "{name} прямо зізнається, що важко переживає конфліктні розмови, — для першої лінії це суттєвий ризик.",
    },
    "Аналіз мовлення": {
        "high": "Мовлення чітке, без слів-паразитів, структура «ситуація → дія → результат» витримана. Тон спокійний і доброзичливий.",
        "mid": "Мовлення зрозуміле, проте є повтори та слова-паразити; структура відповіді змінюється від питання до питання.",
        "low": "Відповіді розірвані, часто змінюється тема, тон місцями роздратований.",
    },
    "Ризики": {
        "high": "Суттєвих ризиків не виявлено. Уточнити на співбесіді: готовність до змінного графіка й роботи в пікові періоди.",
        "mid": "Уточнити: досвід у конфліктних ситуаціях, готовність до змінного графіка, очікування щодо навантаження.",
        "low": "Ризики: низька стійкість до конфліктів, обмежений досвід. Перед рішенням перевірити рекомендації з попередніх місць.",
    },
    "Технічна глибина": {
        "high": "Демонструє розуміння ключових концепцій і практичний досвід.",
        "mid": "Базові знання є, практичних прикладів небагато.",
        "low": "Відповіді поверхневі, практичного досвіду не видно.",
    },
}

FAILED_ERROR = (
    "Сервіс аналізу тимчасово недоступний (демо-дані: приклад помилки для перегляду методистом)."
)


# ---------- Кандидати ----------


class Step(str, enum.Enum):
    """Скільки етапів уже подано в демо-кандидата (етапи незалежні, це лише опис сценарію сиду)."""

    PROFILE = "PROFILE"  # нічого не подано
    QUIZ = "QUIZ"  # подано анкету
    INTERVIEW = "INTERVIEW"  # подано анкету й опитувальник
    PROCESSING = "PROCESSING"  # усе подано, аналіз виконується
    DONE = "DONE"  # усе подано, аналіз готовий


@dataclass
class CandidateSpec:
    email: str
    name: str
    methodology: str
    stage: Step
    profile: dict[str, str] = field(default_factory=dict)
    quiz: dict[str, object] = field(default_factory=dict)
    voice: dict[str, str] = field(default_factory=dict)  # текст питання → транскрипт
    tier: str = "mid"
    scores: dict[str, int] = field(default_factory=dict)
    verdict: Verdict | None = None
    note: str = ""
    days_ago: int = 3
    failed_nodes: tuple[str, ...] = ()


CASE = SALES.interview[0][0]
SUP_Q1, SUP_Q2 = SUPPORT.interview[0][0], SUPPORT.interview[1][0]
S_Q1, S_Q2 = SALES.quiz[0][0], SALES.quiz[1][0]
H_Q1, H_Q2, H_Q3 = SUPPORT.quiz[0][0], SUPPORT.quiz[1][0], SUPPORT.quiz[2][0]

CANDIDATES = [
    # --- Менеджер з продажів ---
    CandidateSpec(
        "olena.kovalenko@opora.example",
        "Олена Коваленко",
        SALES.title,
        Step.DONE,
        profile={
            "Повне ім'я": "Олена Коваленко",
            "Досвід роботи (років)": "6",
            "Розкажіть про себе": "Шість років у B2B-продажах, останні три — керувала групою з п'яти менеджерів. Люблю довгі угоди та складних клієнтів.",
        },
        quiz={S_Q1: "Результат", S_Q2: 8},
        voice={
            CASE: "Минулого року ключовий клієнт погрожував розірвати контракт через затримку поставки. Я зв'язалась із ним того ж дня, визнала нашу помилку, запропонувала часткову знижку й жорсткий графік. Ми зберегли контракт, а за пів року клієнт збільшив замовлення на двадцять відсотків."
        },
        tier="high",
        scores={"Комунікація": 9, "Мотивація": 8, "Підсумок": 9},
        verdict=Verdict.RECOMMENDED,
        note="Сильна кандидатка, запрошуємо на співбесіду з директором з продажів.",
        days_ago=6,
    ),
    CandidateSpec(
        "andriy.melnyk@opora.example",
        "Андрій Мельник",
        SALES.title,
        Step.DONE,
        profile={
            "Повне ім'я": "Андрій Мельник",
            "Досвід роботи (років)": "1",
            "Розкажіть про себе": "Працював у роздрібі, хочу спробувати продажі.",
        },
        quiz={S_Q1: "Стабільність", S_Q2: 4},
        voice={
            CASE: "Ну, був клієнт, він кричав. Я сказав, що так не можна. Потім він пішов. Нічого особливого."
        },
        tier="low",
        scores={"Комунікація": 4, "Мотивація": 5, "Підсумок": 4},
        verdict=Verdict.REJECTED,
        note="Замало досвіду та слабка комунікація для цієї позиції.",
        days_ago=5,
    ),
    CandidateSpec(
        "iryna.shevchenko@opora.example",
        "Ірина Шевченко",
        SALES.title,
        Step.DONE,
        profile={
            "Повне ім'я": "Ірина Шевченко",
            "Досвід роботи (років)": "3",
            "Розкажіть про себе": "Три роки в продажах ІТ-послуг, шукаю компанію з прозорою системою розвитку.",
        },
        quiz={S_Q1: "Розвиток", S_Q2: 6},
        voice={
            CASE: "Клієнт був незадоволений якістю звіту. Я перепитала, що саме не влаштовує, виправила звіт за день і додала короткий коментар. Він залишився, хоча довіра трохи впала."
        },
        tier="mid",
        scores={"Комунікація": 7, "Мотивація": 7, "Підсумок": 7},
        days_ago=2,
    ),
    CandidateSpec(
        "taras.bondar@opora.example",
        "Тарас Бондар",
        SALES.title,
        Step.PROCESSING,
        profile={
            "Повне ім'я": "Тарас Бондар",
            "Досвід роботи (років)": "4",
            "Розкажіть про себе": "Продажі у FMCG, цікавить напрям B2B.",
        },
        quiz={S_Q1: "Команда", S_Q2: 7},
        voice={
            CASE: "Було складно з дистриб'ютором, який затримував оплату. Ми домовилися про графік платежів і підписали додаткову угоду."
        },
        tier="mid",
        scores={"Комунікація": 7, "Мотивація": 6},
        failed_nodes=("Підсумок",),
        days_ago=1,
    ),
    # --- Етапи проходження (для входу від імені кандидата) ---
    CandidateSpec("demo.profile@opora.example", "Демо: на етапі анкети", SALES.title, Step.PROFILE),
    CandidateSpec(
        "demo.quiz@opora.example",
        "Демо: на етапі опитувальника",
        SALES.title,
        Step.QUIZ,
        profile={
            "Повне ім'я": "Демо Опитувальник",
            "Досвід роботи (років)": "2",
            "Розкажіть про себе": "Демонстраційний кандидат.",
        },
    ),
    CandidateSpec(
        "demo.interview@opora.example",
        "Демо: на етапі інтерв'ю",
        SALES.title,
        Step.INTERVIEW,
        profile={
            "Повне ім'я": "Демо Інтерв'ю",
            "Досвід роботи (років)": "5",
            "Розкажіть про себе": "Демонстраційний кандидат.",
        },
        quiz={S_Q1: "Результат", S_Q2: 7},
    ),
    # --- Підтримка клієнтів ---
    CandidateSpec(
        "maria.hrytsenko@opora.example",
        "Марія Гриценко",
        SUPPORT.title,
        Step.DONE,
        profile={
            "Повне ім'я": "Марія Гриценко",
            "Мови спілкування": "Українська та англійська",
            "Досвід у підтримці (років)": "2",
            "Бажаний графік": "Змінний",
        },
        quiz={H_Q1: "Вибачитися й дати вислухати себе", H_Q2: ["Телефон", "Чат"], H_Q3: 4},
        voice={
            SUP_Q1: "Жінка зателефонувала, бо їй двічі списали гроші. Я не перебивала, повторила суть, щоб вона відчула, що її почули, оформила повернення при ній і надіслала підтвердження. Наприкінці вона подякувала.",
            SUP_Q2: "Мені подобається, коли після розмови людині стає легше. Хочу розвиватися до тімліда напрямку.",
        },
        tier="high",
        scores={"Емпатія": 9, "Стресостійкість": 8, "Підсумок": 9},
        verdict=Verdict.IN_REVIEW,
        note="Чекаємо відповідь від попереднього роботодавця.",
        days_ago=4,
    ),
    CandidateSpec(
        "oleh.savchuk@opora.example",
        "Олег Савчук",
        SUPPORT.title,
        Step.DONE,
        profile={
            "Повне ім'я": "Олег Савчук",
            "Мови спілкування": "Українська",
            "Досвід у підтримці (років)": "0",
            "Бажаний графік": "Віддалено",
        },
        quiz={H_Q1: "Пояснити, що так розмовляти не можна", H_Q2: ["Електронна пошта"], H_Q3: 2},
        voice={
            SUP_Q1: "Не пригадую таких випадків. Зазвичай якщо людина незадоволена, я просто передаю її далі.",
            SUP_Q2: "Шукаю роботу вдома, щоб не їздити в офіс.",
        },
        tier="low",
        scores={"Емпатія": 4, "Стресостійкість": 3, "Підсумок": 4},
        verdict=Verdict.REJECTED,
        note="Не підходить для першої лінії.",
        days_ago=7,
    ),
    CandidateSpec(
        "nadiia.pavlenko@opora.example",
        "Надія Павленко",
        SUPPORT.title,
        Step.DONE,
        profile={
            "Повне ім'я": "Надія Павленко",
            "Мови спілкування": "Українська, англійська та польська",
            "Досвід у підтримці (років)": "4",
            "Бажаний графік": "Повний день",
        },
        quiz={
            H_Q1: "Вибачитися й дати вислухати себе",
            H_Q2: ["Телефон", "Чат", "Месенджери"],
            H_Q3: 5,
        },
        voice={
            SUP_Q1: "Клієнт кричав, що застосунок втратив його дані. Я залишалась спокійною, запитала подробиці, знайшла резервну копію і відновила дані за двадцять хвилин. Потім клієнт написав відгук.",
            SUP_Q2: "Чотири роки в підтримці, люблю, коли проблему вдається закрити з першого разу.",
        },
        tier="high",
        scores={"Емпатія": 8, "Стресостійкість": 9, "Підсумок": 9},
        days_ago=1,
    ),
    CandidateSpec(
        "demo.support@opora.example",
        "Демо: підтримка, інтерв'ю",
        SUPPORT.title,
        Step.INTERVIEW,
        profile={
            "Повне ім'я": "Демо Підтримка",
            "Мови спілкування": "Українська",
            "Досвід у підтримці (років)": "1",
            "Бажаний графік": "Змінний",
        },
        quiz={H_Q1: "Вибачитися й дати вислухати себе", H_Q2: ["Чат"], H_Q3: 3},
        voice={
            SUP_Q1: "Допомагала клієнту розібратися з доставкою, перевірила статус і запропонувала варіанти."
        },
    ),
]

PERSONAL_INVITES = [
    (SUPPORT.title, "new.candidate@example.com", None),
    (SALES.title, "olena.kovalenko@opora.example", "used"),
]


# ---------- Допоміжні функції ----------


def silent_wav(seconds: int = 3, rate: int = 8000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * rate * seconds)
    return buf.getvalue()


def _get_or_create_user(
    db: Session, email: str, name: str, role: UserRole, password: str
) -> tuple[User, bool]:
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is not None:
        return user, False
    user = User(email=email, name=name, role=role, password_hash=hash_password(password))
    db.add(user)
    db.flush()
    return user, True


def _ensure_methodology(db: Session, spec: MethodologySpec, owner: User) -> Methodology:
    m = db.execute(select(Methodology).where(Methodology.title == spec.title)).scalar_one_or_none()
    if m is not None:
        return m
    m = Methodology(
        title=spec.title,
        description=spec.description,
        status=spec.status,
        invite_code=generate_code(),
        allow_rerecord=spec.allow_rerecord,
        max_record_attempts=spec.max_attempts,
        created_by_id=owner.id,
    )
    m.profile_fields = [
        ProfileField(label=label, type=ftype, options=options, required=required, order=i)
        for i, (label, ftype, options, required) in enumerate(spec.fields)
    ]
    m.quiz_questions = [
        QuizQuestion(text=text, type=qtype, options=options, order=i)
        for i, (text, qtype, options) in enumerate(spec.quiz)
    ]
    m.interview_questions = [
        InterviewQuestion(text=text, hint=hint, max_duration_sec=sec, order=i)
        for i, (text, hint, sec) in enumerate(spec.interview)
    ]
    db.add(m)
    db.flush()
    nodes = {}
    for name, prompt, score, x, y in spec.nodes:
        node = PromptNode(
            methodology_id=m.id,
            name=name,
            prompt_text=prompt,
            returns_score=score,
            position_x=x,
            position_y=y,
        )
        db.add(node)
        nodes[name] = node
    db.flush()
    for src, dst in spec.edges:
        db.add(
            PromptEdge(
                methodology_id=m.id, source_node_id=nodes[src].id, target_node_id=nodes[dst].id
            )
        )
    db.flush()
    return m


def _add_candidate(
    db: Session, storage: StorageService, spec: CandidateSpec, m: Methodology, password: str
) -> None:
    user = User(
        email=spec.email,
        name=spec.name,
        role=UserRole.CANDIDATE,
        password_hash=hash_password(password),
    )
    db.add(user)
    db.flush()

    submitted = spec.stage in (Step.PROCESSING, Step.DONE)
    when = datetime.now(UTC) - timedelta(days=spec.days_ago, hours=2)
    done_profile = spec.stage != Step.PROFILE
    done_quiz = spec.stage in (Step.INTERVIEW, Step.PROCESSING, Step.DONE)
    assessment = Assessment(
        candidate_id=user.id,
        methodology_id=m.id,
        stage={
            Step.PROCESSING: AssessmentStage.PROCESSING,
            Step.DONE: AssessmentStage.DONE,
        }.get(spec.stage, AssessmentStage.IN_PROGRESS),
        submitted_at=when if submitted else None,
        profile_submitted_at=when if done_profile else None,
        profile_version=1 if done_profile else None,
        quiz_submitted_at=when if done_quiz else None,
        quiz_version=1 if done_quiz else None,
        interview_submitted_at=when if submitted else None,
        interview_version=1 if submitted else None,
        verdict=spec.verdict,
    )
    db.add(assessment)
    db.flush()

    fields = {f.label: f for f in m.profile_fields}
    for label, value in spec.profile.items():
        if label in fields:
            db.add(
                ProfileAnswer(
                    assessment_id=assessment.id, profile_field_id=fields[label].id, value=value
                )
            )
    questions = {q.text: q for q in m.quiz_questions}
    for text, value in spec.quiz.items():
        if text in questions:
            db.add(
                QuizAnswer(
                    assessment_id=assessment.id, quiz_question_id=questions[text].id, value=value
                )
            )
    interview = {q.text: q for q in m.interview_questions}
    for text, transcript in spec.voice.items():
        if text in interview:
            q = interview[text]
            path = storage.save(assessment.id, q.id, 1, silent_wav(), ".wav")
            db.add(
                VoiceAnswer(
                    assessment_id=assessment.id,
                    interview_question_id=q.id,
                    audio_path=path,
                    duration_sec=3,
                    attempts_used=1,
                    transcript=transcript if submitted else "",
                    transcript_status=TranscriptStatus.DONE
                    if submitted
                    else TranscriptStatus.PENDING,
                )
            )
    db.flush()

    if submitted:
        _add_results(db, assessment, m, spec)
    if spec.verdict is not None:
        hr_id = (
            db.execute(select(User.id).where(User.role == UserRole.HR).order_by(User.id))
            .scalars()
            .first()
        )
        assessment.verdict_by_id = hr_id
        _add_history(db, assessment, spec, hr_id)
        if (
            spec.note and hr_id is not None
        ):  # BR-6: нотатка HR — окремий запис автора, а не спільне поле
            db.add(HRNote(assessment_id=assessment.id, author_id=hr_id, text=spec.note))


RECOMMENDATION_QUESTIONS = [
    ("Як давно і в якому контексті ви знаєте цю людину?", "Одне-два речення."),
    ("Опишіть її сильні сторони на основі спільної роботи.", "Бажано з прикладом."),
    ("Що, на вашу думку, їй варто розвивати?", ""),
]

# email кандидата → відгуки: (роль, «текст») для надісланих, None — відмова «недостатньо знаю», «pending» — ще не відповів
DEMO_REVIEWS: dict[str, list] = {
    "olena.kovalenko@opora.example": [
        (RecommendationRole.MANAGER, "Працювали разом три роки в одному відділі."),
        (RecommendationRole.COLLEAGUE, "Колега по команді, ділили одну зміну більше року."),
        None,
        "pending",
    ],
    "maria.hrytsenko@opora.example": [
        (RecommendationRole.SUBORDINATE, "Була моєю керівницею півтора року."),
        "pending",
        "pending",
        "pending",
    ],
}


# осі й джерела аналітики для демо-вузлів (DD-06): назва вузла → (вісь, джерело)
NODE_ANALYTICS: dict[str, dict[str, tuple[str, str]]] = {
    "Менеджер з продажів (демо)": {
        "Комунікація": ("Комунікація", "CONVERSATION"),
        "Мотивація": ("Мотивація", "SELF"),
    },
    "Спеціаліст підтримки клієнтів (демо)": {
        "Емпатія": ("Емпатія", "CONVERSATION"),
        "Стресостійкість": ("Стресостійкість", "SELF"),
    },
}


def _tag_analytics(db: Session, methodologies: dict[str, Methodology]) -> None:
    """Проставляє вісь і джерело демо-вузлам, якщо методолог ще не розмічав (ідемпотентно)."""
    for title, mapping in NODE_ANALYTICS.items():
        m = methodologies.get(title)
        if m is None:
            continue
        for node in db.execute(
            select(PromptNode).where(PromptNode.methodology_id == m.id)
        ).scalars():
            if node.axis is None and node.name in mapping:
                node.axis, node.source = mapping[node.name]
    db.flush()


def _ensure_recommendations(db: Session, methodologies: dict[str, Methodology]) -> None:
    """Питання відгуків для демо-методологій і кілька демо-відгуків (ідемпотентно)."""
    for m in methodologies.values():
        if m.status == MethodologyStatus.ACTIVE and not m.recommendation_questions:
            m.recommendation_questions = [
                RecommendationQuestion(text=text, hint=hint, order=i)
                for i, (text, hint) in enumerate(RECOMMENDATION_QUESTIONS)
            ]
    db.flush()
    for email, reviews in DEMO_REVIEWS.items():
        assessment = db.execute(
            select(Assessment)
            .join(User, User.id == Assessment.candidate_id)
            .where(User.email == email)
        ).scalar_one_or_none()
        if assessment is None or assessment.recommendation_links:
            continue
        questions = assessment.methodology.recommendation_questions
        if not questions:
            continue
        for slot, review in enumerate(reviews, start=1):
            state = (
                RecommendationLinkStatus.PENDING
                if review == "pending"
                else (
                    RecommendationLinkStatus.DECLINED
                    if review is None
                    else RecommendationLinkStatus.SUBMITTED
                )
            )
            link = RecommendationLink(
                assessment_id=assessment.id,
                slot=slot,
                token=generate_code(24),
                status=state,
                expires_at=datetime.now(UTC) + timedelta(days=30),
            )
            if state == RecommendationLinkStatus.SUBMITTED:
                role, text = review
                link.recommendation = Recommendation(
                    role=role,
                    answers=[
                        RecommendationAnswer(
                            question_id=q.id,
                            question_text=q.text,
                            order=i,
                            text=f"{text} ({['так', 'відповідально', 'зростати'][i % 3]})",
                        )
                        for i, q in enumerate(questions)
                    ],
                )
            db.add(link)
    db.flush()


def _add_history(
    db: Session, assessment: Assessment, spec: CandidateSpec, hr_id: int | None
) -> None:
    """Демо-журнал змін: спершу «На розгляді», потім остаточне рішення з нотаткою."""
    base = assessment.submitted_at or datetime.now(UTC)
    if spec.verdict != Verdict.IN_REVIEW:
        db.add(
            VerdictChange(
                assessment_id=assessment.id,
                author_id=hr_id,
                changed_at=base + timedelta(hours=3),
                old_verdict=None,
                new_verdict=Verdict.IN_REVIEW,
                old_note="",
                new_note="",
            )
        )
    db.add(
        VerdictChange(
            assessment_id=assessment.id,
            author_id=hr_id,
            changed_at=base + timedelta(hours=20),
            old_verdict=None if spec.verdict == Verdict.IN_REVIEW else Verdict.IN_REVIEW,
            new_verdict=spec.verdict,
            old_note="",
            new_note="",
        )
    )


def _add_results(db: Session, assessment: Assessment, m: Methodology, spec: CandidateSpec) -> None:
    nodes = db.execute(select(PromptNode).where(PromptNode.methodology_id == m.id)).scalars().all()
    edges = [
        (e.source_node_id, e.target_node_id)
        for e in db.execute(select(PromptEdge).where(PromptEdge.methodology_id == m.id)).scalars()
    ]
    terminal = graph.terminal_nodes([n.id for n in nodes], edges)
    first_name = spec.name.split()[0]
    for node in nodes:
        texts = CONCLUSIONS.get(node.name, {})
        failed = node.name in spec.failed_nodes
        result = AnalysisResult(
            assessment_id=assessment.id,
            prompt_node_id=node.id,
            is_terminal=node.id in terminal,
            status=AnalysisStatus.FAILED if failed else AnalysisStatus.DONE,
            error=FAILED_ERROR if failed else "",
        )
        if not failed:
            result.output = texts.get(spec.tier, "Висновок відсутній.").format(name=first_name)
            result.score = (
                float(spec.scores[node.name])
                if node.returns_score and node.name in spec.scores
                else None
            )
            result.model = DEMO_MODEL
            result.input_tokens = 900
            result.output_tokens = 160
        db.add(result)


def seed(
    session_factory=get_sync_db,
    storage: StorageService | None = None,
    demo_data: bool | None = None,
) -> None:
    storage = storage or StorageService()
    mode = os.environ.get("SEED_DEMO_DATA", "true").strip().lower()
    rich = mode == "rich"
    if demo_data is None:
        demo_data = mode not in ("0", "false", "no", "off")
    candidate_password = os.environ.get("SEED_CANDIDATE_PASSWORD", "ChangeMe123!")

    db = session_factory()
    try:
        staff: dict[UserRole, User] = {}
        for email, name, role, env_name in STAFF:
            staff[role], _ = _get_or_create_user(
                db, email, name, role, os.environ.get(env_name, "ChangeMe123!")
            )

        if demo_data:
            methodologies = {
                spec.title: _ensure_methodology(db, spec, staff[UserRole.METHODOLOGIST])
                for spec in METHODOLOGIES
            }
            for spec in CANDIDATES:
                exists = db.execute(select(User.id).where(User.email == spec.email)).first()
                if exists is None:
                    _add_candidate(
                        db, storage, spec, methodologies[spec.methodology], candidate_password
                    )
            for title, email, state in PERSONAL_INVITES:
                if (
                    db.execute(
                        select(PersonalInvite.id).where(PersonalInvite.candidate_email == email)
                    ).first()
                    is None
                ):
                    db.add(
                        PersonalInvite(
                            methodology_id=methodologies[title].id,
                            code=generate_code(),
                            candidate_email=email,
                            created_by_id=staff[UserRole.HR].id,
                            used_at=datetime.now(UTC) - timedelta(days=6)
                            if state == "used"
                            else None,
                        )
                    )
            db.flush()
            _ensure_recommendations(db, methodologies)
            _tag_analytics(db, methodologies)
            if rich:
                from app.seed_rich import seed_rich

                seed_rich(db, storage, staff, candidate_password)

        # усі акаунти на демо-домені — демо: в них адмін може входити від імені кандидата
        for user in db.execute(select(User).where(User.email.like(f"%{DEMO_DOMAIN}"))).scalars():
            user.is_demo = True
        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    seed()
    print("Seed виконано")
