"""hr notes and user consents (BR-6, BR-1)

Revision ID: c9e4a7b15d38
Revises: b4d6f9a2c1e7
Create Date: 2026-11-03 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'c9e4a7b15d38'
down_revision = 'b4d6f9a2c1e7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'hr_notes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('assessment_id', sa.Integer(), nullable=False),
        sa.Column('author_id', sa.Integer(), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['assessment_id'], ['assessments.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_hr_notes_assessment_id'), 'hr_notes', ['assessment_id'], unique=False)
    op.create_index(op.f('ix_hr_notes_author_id'), 'hr_notes', ['author_id'], unique=False)
    op.create_table(
        'user_consents',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(length=32), nullable=False),
        sa.Column('version', sa.String(length=64), nullable=False),
        sa.Column('accepted_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('recorded_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_user_consents_user_id'), 'user_consents', ['user_id'], unique=False)
    # Наявна спільна нотатка verdict_note переходить в особисту нотатку її автора (verdict_by_id).
    # Колонку assessments.verdict_note не видаляємо: вона лишається порожнім архівом до окремого рішення.
    op.execute(
        """
        INSERT INTO hr_notes (assessment_id, author_id, text)
        SELECT id, verdict_by_id, verdict_note FROM assessments
        WHERE verdict_by_id IS NOT NULL AND verdict_note IS NOT NULL AND btrim(verdict_note) <> ''
        """
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_user_consents_user_id'), table_name='user_consents')
    op.drop_table('user_consents')
    op.drop_index(op.f('ix_hr_notes_author_id'), table_name='hr_notes')
    op.drop_index(op.f('ix_hr_notes_assessment_id'), table_name='hr_notes')
    op.drop_table('hr_notes')
