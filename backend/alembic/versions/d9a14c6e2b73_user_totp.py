"""user totp 2fa

Revision ID: d9a14c6e2b73
Revises: c3e8a9d57f14
Create Date: 2026-10-26 18:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'd9a14c6e2b73'
down_revision = 'c3e8a9d57f14'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('totp_secret_enc', sa.String(length=255), nullable=True))
    op.add_column('users', sa.Column('totp_enabled', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('users', sa.Column('totp_last_step', sa.BigInteger(), nullable=True))
    op.add_column('users', sa.Column('totp_failures', sa.Integer(), server_default='0', nullable=False))
    op.add_column('users', sa.Column('totp_locked_until', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'totp_locked_until')
    op.drop_column('users', 'totp_failures')
    op.drop_column('users', 'totp_last_step')
    op.drop_column('users', 'totp_enabled')
    op.drop_column('users', 'totp_secret_enc')
