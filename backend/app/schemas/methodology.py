"""Схеми методологій і графа промтів."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, model_validator

from app.models import MethodologyStatus, ProfileFieldType, QuizQuestionType


class ORM(BaseModel):
    model_config = {"from_attributes": True}


class MethodologyCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str = ""
    allow_rerecord: bool = True
    max_record_attempts: int = Field(default=3, ge=1, le=10)
    profile_title: str | None = Field(default=None, max_length=120)
    quiz_title: str | None = Field(default=None, max_length=120)
    interview_title: str | None = Field(default=None, max_length=120)


class MethodologyUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    status: MethodologyStatus | None = None
    allow_rerecord: bool | None = None
    max_record_attempts: int | None = Field(default=None, ge=1, le=10)
    profile_title: str | None = Field(default=None, max_length=120)
    quiz_title: str | None = Field(default=None, max_length=120)
    interview_title: str | None = Field(default=None, max_length=120)


class ProfileFieldIn(BaseModel):
    label: str = Field(min_length=1, max_length=255)
    type: ProfileFieldType
    options: list[str] | None = None
    required: bool = False

    @model_validator(mode="after")
    def check_options(self):
        if self.type == ProfileFieldType.SELECT:
            if not self.options or len(self.options) < 2:
                raise ValueError("Для списку потрібно щонайменше два варіанти")
        else:
            self.options = None
        return self


class ProfileFieldOut(ORM):
    id: int
    label: str
    type: ProfileFieldType
    options: list[str] | None
    required: bool
    order: int


class QuizQuestionIn(BaseModel):
    text: str = Field(min_length=1)
    type: QuizQuestionType
    options: list[str] | list[int] | None = None

    @model_validator(mode="after")
    def check_options(self):
        if self.type in (QuizQuestionType.SINGLE_CHOICE, QuizQuestionType.MULTI_CHOICE):
            if not self.options or len(self.options) < 2:
                raise ValueError("Для вибору потрібно щонайменше два варіанти")
        elif self.type == QuizQuestionType.SCALE:
            if self.options is None:
                self.options = [1, 10]
            if len(self.options) != 2 or not all(isinstance(o, int) for o in self.options):
                raise ValueError("Шкала задається двома числами: мінімум і максимум")
            if self.options[0] >= self.options[1]:
                raise ValueError("Мінімум шкали має бути меншим за максимум")
        else:
            self.options = None
        return self


class QuizQuestionOut(ORM):
    id: int
    text: str
    type: QuizQuestionType
    options: list | None
    order: int


class InterviewQuestionIn(BaseModel):
    text: str = Field(min_length=1)
    hint: str = ""
    max_duration_sec: int = Field(default=120, ge=10, le=900)


class InterviewQuestionOut(ORM):
    id: int
    text: str
    hint: str
    max_duration_sec: int
    order: int


class RecommendationQuestionIn(BaseModel):
    text: str = Field(min_length=1)
    hint: str = ""
    required: bool = True
    max_length: int | None = Field(default=None, ge=50, le=5000)


class RecommendationQuestionOut(ORM):
    id: int
    text: str
    hint: str
    order: int
    required: bool = True
    max_length: int | None = None


class GraphNodeIn(BaseModel):
    key: str = Field(
        description="Ключ вузла в межах запиту (для нових вузлів — довільний, для існуючих — їх id)"
    )
    id: int | None = None
    name: str = Field(min_length=1, max_length=255)
    prompt_text: str = ""
    returns_score: bool = False
    axis: str | None = Field(default=None, max_length=80)
    source: Literal["SELF", "CONVERSATION", "REVIEWS"] | None = None
    position_x: float = 0
    position_y: float = 0

    @model_validator(mode="after")
    def _analytics_fields(self):
        self.axis = (self.axis or "").strip() or None
        if (self.axis is None) != (self.source is None):
            raise ValueError("Вісь аналітики й джерело задаються разом")
        if self.axis and not self.returns_score:
            raise ValueError("Вісь аналітики можна задати лише вузлу, що повертає бал")
        return self


class GraphEdgeIn(BaseModel):
    source: str
    target: str


class GraphIn(BaseModel):
    nodes: list[GraphNodeIn]
    edges: list[GraphEdgeIn]


class GraphNodeOut(ORM):
    id: int
    name: str
    prompt_text: str
    returns_score: bool
    axis: str | None = None
    source: str | None = None
    position_x: float
    position_y: float


class GraphEdgeOut(ORM):
    id: int
    source_node_id: int
    target_node_id: int


class GraphOut(BaseModel):
    nodes: list[GraphNodeOut]
    edges: list[GraphEdgeOut]


class MethodologyListOut(ORM):
    id: int
    title: str
    description: str
    status: MethodologyStatus
    version: int = 1
    created_at: datetime


class MethodologyOut(MethodologyListOut):
    invite_code: str
    allow_rerecord: bool
    max_record_attempts: int
    profile_fields: list[ProfileFieldOut]
    quiz_questions: list[QuizQuestionOut]
    interview_questions: list[InterviewQuestionOut]
    recommendation_questions: list[RecommendationQuestionOut]
    profile_title: str | None = None
    quiz_title: str | None = None
    interview_title: str | None = None


class PersonalInviteIn(BaseModel):
    methodology_id: int
    candidate_email: EmailStr


class PersonalInviteOut(ORM):
    id: int
    methodology_id: int
    code: str
    candidate_email: str
    used_at: datetime | None
    created_at: datetime


class InviteLinksOut(BaseModel):
    general_url: str
