"""Користувачі та їхні ролі."""

import enum
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Enum, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    METHODOLOGIST = "METHODOLOGIST"
    HR = "HR"
    CANDIDATE = "CANDIDATE"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, name="user_role"))
    is_active: Mapped[bool] = mapped_column(default=True)
    # демо-акаунти: адмін може входити від їхнього імені; справжніх користувачів це не стосується
    is_demo: Mapped[bool] = mapped_column(default=False, server_default="false")
    # 2FA (TOTP): секрет зберігається зашифрованим (див. services/totp.py); увімкнена — лише після підтвердження кодом
    totp_secret_enc: Mapped[str | None] = mapped_column(String(255), nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(default=False, server_default="false")
    totp_last_step: Mapped[int | None] = mapped_column(
        BigInteger, nullable=True
    )  # захист від повторного використання коду
    totp_failures: Mapped[int] = mapped_column(default=0, server_default="0")
    totp_locked_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
