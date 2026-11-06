"""hr lists

Revision ID: a1c7e5b93d20
Revises: 02fcd5ef78e6
Create Date: 2026-10-26 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'a1c7e5b93d20'
down_revision = '02fcd5ef78e6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'hr_lists',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=80), nullable=False),
        sa.Column('is_default', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('owner_id', 'name', name='uq_hr_list_owner_name'),
    )
    op.create_index(op.f('ix_hr_lists_owner_id'), 'hr_lists', ['owner_id'], unique=False)
    op.create_table(
        'hr_list_items',
        sa.Column('list_id', sa.Integer(), nullable=False),
        sa.Column('assessment_id', sa.Integer(), nullable=False),
        sa.Column('added_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['assessment_id'], ['assessments.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['list_id'], ['hr_lists.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('list_id', 'assessment_id'),
    )


def downgrade() -> None:
    op.drop_table('hr_list_items')
    op.drop_index(op.f('ix_hr_lists_owner_id'), table_name='hr_lists')
    op.drop_table('hr_lists')
