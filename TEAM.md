# Для команди

Внутрішні посилання та домовленості, що не стосуються самого застосунку. Документація застосунку — [README.md](README.md).

- **Репозиторій:** <http://10.1.0.20/m.mokrytskyi/opora> (внутрішня мережа), клон — `git clone git@10.1.0.20:m.mokrytskyi/opora.git`
- **Як працюємо разом** (гілки, MR, коміти, що не комітимо) — [CONTRIBUTING.md](CONTRIBUTING.md)
- **Завдання бекенду від UI** — [BACKEND-TASKS.md](BACKEND-TASKS.md)

## Що де лежить

| Тека / файл | Що в ній | Відповідає |
|---|---|---|
| `frontend/` | React 19 + Vite + TypeScript + Tailwind v4 | UI-шар (`index.css`, `components/ui/`, розмітка сторінок) — Max; логіка й API-клієнт — бекенд-розробник |
| `backend/` | FastAPI, SQLAlchemy, Alembic, Celery, тести | бекенд-розробник |
| `docker-compose.yml`, `.env.example`, `storage/` | локальний запуск, шаблон змінних, том для аудіо | бекенд-розробник |
| `BACKEND-TASKS.md` | список BR-n для бекенду | Max пише, бекенд-розробник закриває |

Розподіл відповідальності — рішення DD-43 (злиття репозиторіїв, 30.10).
