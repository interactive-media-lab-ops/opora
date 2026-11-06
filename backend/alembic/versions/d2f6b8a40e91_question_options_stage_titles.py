"""recommendation question required/max_length, stage titles (BR-15, BR-4)

Revision ID: d2f6b8a40e91
Revises: c9e4a7b15d38
Create Date: 2026-11-03 15:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'd2f6b8a40e91'
down_revision = 'c9e4a7b15d38'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('recommendation_questions', sa.Column('required', sa.Boolean(), server_default='true', nullable=False))
    op.add_column('recommendation_questions', sa.Column('max_length', sa.Integer(), nullable=True))
    for col in ('profile_title', 'quiz_title', 'interview_title'):
        op.add_column('methodologies', sa.Column(col, sa.String(length=120), nullable=True))


def downgrade() -> None:
    for col in ('interview_title', 'quiz_title', 'profile_title'):
        op.drop_column('methodologies', col)
    op.drop_column('recommendation_questions', 'max_length')
    op.drop_column('recommendation_questions', 'required')
