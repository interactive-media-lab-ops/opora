"""prompt node analytics axis and source

Revision ID: b4d6f9a2c1e7
Revises: a8c3e1f47b92
Create Date: 2026-10-27 14:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'b4d6f9a2c1e7'
down_revision = 'a8c3e1f47b92'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('prompt_nodes', sa.Column('axis', sa.String(length=80), nullable=True))
    op.add_column('prompt_nodes', sa.Column('source', sa.String(length=16), nullable=True))


def downgrade() -> None:
    op.drop_column('prompt_nodes', 'source')
    op.drop_column('prompt_nodes', 'axis')
