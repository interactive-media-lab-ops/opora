"""verdict changes journal

Revision ID: b7d2f4a61c85
Revises: a1c7e5b93d20
Create Date: 2026-10-26 14:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'b7d2f4a61c85'
down_revision = 'a1c7e5b93d20'
branch_labels = None
depends_on = None

# тип verdict уже створено початковою міграцією
verdict = postgresql.ENUM('IN_REVIEW', 'RECOMMENDED', 'REJECTED', name='verdict', create_type=False)


def upgrade() -> None:
    op.create_table(
        'verdict_changes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('assessment_id', sa.Integer(), nullable=False),
        sa.Column('author_id', sa.Integer(), nullable=True),
        sa.Column('changed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('old_verdict', verdict, nullable=True),
        sa.Column('new_verdict', verdict, nullable=True),
        sa.Column('old_note', sa.Text(), nullable=False),
        sa.Column('new_note', sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(['assessment_id'], ['assessments.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_verdict_changes_assessment_id'), 'verdict_changes', ['assessment_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_verdict_changes_assessment_id'), table_name='verdict_changes')
    op.drop_table('verdict_changes')
