"""deletion requests

Revision ID: c3e8a9d57f14
Revises: b7d2f4a61c85
Create Date: 2026-10-26 16:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'c3e8a9d57f14'
down_revision = 'b7d2f4a61c85'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'deletion_requests',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.Enum('NEW', 'DONE', name='deletion_request_status'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('processed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('processed_by_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['processed_by_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_deletion_requests_user_id'), 'deletion_requests', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_deletion_requests_user_id'), table_name='deletion_requests')
    op.drop_table('deletion_requests')
    op.execute('DROP TYPE deletion_request_status')
