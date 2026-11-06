"""Схеми автентифікації: вхід, реєстрація, токени, 2FA."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, ValidationInfo, field_validator

from app.models import UserRole


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ConsentIn(BaseModel):
    kind: Literal["personal_data", "offer"]
    version: str = Field(
        min_length=1, max_length=64
    )  # версія тексту; до погодження текстів — "draft"
    accepted_at: datetime


class RegisterIn(BaseModel):
    code: str = Field(
        description="Загальний invite-код методології або персональний одноразовий код"
    )
    email: EmailStr
    password: str = Field(min_length=8)
    password_confirm: str
    name: str = Field(min_length=1, max_length=255)
    consents: list[ConsentIn] = Field(default_factory=list)

    @field_validator("password_confirm")
    @classmethod
    def _same_password(cls, v: str, info: ValidationInfo) -> str:
        if v != info.data.get("password"):
            raise ValueError("Паролі не збігаються")
        return v

    @field_validator("consents")
    @classmethod
    def _both_consents(cls, v: list[ConsentIn]) -> list[ConsentIn]:
        missing = {"personal_data", "offer"} - {c.kind for c in v}
        if missing:
            raise ValueError("Потрібні згода на обробку персональних даних і згода з офертою")
        return v


class MfaRequiredOut(BaseModel):
    mfa_required: bool = True
    mfa_token: str


class MfaSetupRequiredOut(BaseModel):
    """Пароль вірний, але 2FA обов'язкова й ще не налаштована: токенів немає, лише `setup_token` для /auth/2fa/*."""

    mfa_setup_required: bool = True
    setup_token: str


class LoginSetup2FAIn(BaseModel):
    setup_token: str


class LoginEnable2FAIn(BaseModel):
    setup_token: str
    code: str


class Login2FAIn(BaseModel):
    mfa_token: str
    code: str


class TwoFASetupOut(BaseModel):
    secret: str
    otpauth_uri: str


class TwoFAStatusOut(BaseModel):
    available: bool
    enabled: bool


class TwoFAEnableIn(BaseModel):
    code: str


class TwoFADisableIn(BaseModel):
    password: str
    code: str


class RefreshIn(BaseModel):
    refresh_token: str


class TokensOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    email: str
    name: str
    role: UserRole
    is_active: bool
    is_demo: bool = False
    totp_enabled: bool = False


class InvitePreviewOut(BaseModel):
    methodology_title: str
    personal: bool
    candidate_email: str | None = None


class UserCreateIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str
    role: UserRole


class UserUpdateIn(BaseModel):
    name: str | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8)


class DemoCandidateOut(BaseModel):
    id: int
    name: str
    email: str
    methodology_title: str | None
    stage: str | None
    stages_done: int | None = None
    stages_total: int | None = None


class ImpersonationOut(BaseModel):
    access_token: str
    user: UserOut
