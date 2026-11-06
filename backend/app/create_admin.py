"""Створення (або відновлення) адміністратора.

    python -m app.create_admin ІМЕЙЛ [--name "Ім'я"]

Пароль запитується в терміналі (не показується) або береться зі змінної ADMIN_PASSWORD.
Якщо користувач з такою поштою вже існує — він стає адміном, активується й отримує новий пароль.
"""

import argparse
import getpass
import os
import sys

from email_validator import EmailNotValidError, validate_email
from sqlalchemy import select

from app.db import get_sync_db
from app.models import User, UserRole
from app.security import hash_password

MIN_PASSWORD_LENGTH = 8


def create_admin(email: str, name: str, password: str) -> str:
    db = get_sync_db()
    try:
        user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if user is None:
            db.add(
                User(
                    email=email,
                    name=name,
                    role=UserRole.ADMIN,
                    password_hash=hash_password(password),
                )
            )
            action = "створено"
        else:
            user.role = UserRole.ADMIN
            user.is_active = True
            user.password_hash = hash_password(password)
            if name:
                user.name = name
            action = "оновлено (роль ADMIN, новий пароль)"
        db.commit()
        return action
    finally:
        db.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Створити адміністратора OPORA")
    parser.add_argument("email")
    parser.add_argument("--name", default="Адміністратор")
    args = parser.parse_args()

    try:
        email = validate_email(args.email, check_deliverability=False).normalized.lower()
    except EmailNotValidError as exc:
        print(f"Некоректна пошта: {exc}", file=sys.stderr)
        return 1

    password = os.environ.get("ADMIN_PASSWORD")
    if not password:
        if not sys.stdin.isatty():
            print(
                "Немає термінала для введення пароля: задайте змінну ADMIN_PASSWORD.",
                file=sys.stderr,
            )
            return 1
        password = getpass.getpass("Пароль: ")
        if password != getpass.getpass("Повторіть пароль: "):
            print("Паролі не збігаються.", file=sys.stderr)
            return 1
    if len(password) < MIN_PASSWORD_LENGTH:
        print(f"Пароль закороткий (мінімум {MIN_PASSWORD_LENGTH} символів).", file=sys.stderr)
        return 1

    print(f"Адміністратора {email}: {create_admin(email, args.name, password)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
