"""interview text answers

Revision ID: a8c3e1f47b92
Revises: f1a9c3d27e60
Create Date: 2026-10-27 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'a8c3e1f47b92'
down_revision = 'f1a9c3d27e60'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('voice_answers', sa.Column('kind', sa.String(length=8), server_default='VOICE', nullable=False))
    op.add_column('voice_answers', sa.Column('client_request_id', sa.String(length=64), nullable=True))
    op.alter_column('voice_answers', 'audio_path', existing_type=sa.String(length=512), nullable=True)


def downgrade() -> None:
    # текстові відповіді не мають файлу: без audio_path колонку NOT NULL повернути можна лише після їх видалення
    op.execute("DELETE FROM voice_answers WHERE kind = 'TEXT'")
    op.alter_column('voice_answers', 'audio_path', existing_type=sa.String(length=512), nullable=False)
    op.drop_column('voice_answers', 'client_request_id')
    op.drop_column('voice_answers', 'kind')
