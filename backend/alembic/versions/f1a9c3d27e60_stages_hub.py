"""candidate stages hub: per-stage submission, methodology version, assessment events

Revision ID: f1a9c3d27e60
Revises: e5f27b8c4a19
Create Date: 2026-10-26 22:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'f1a9c3d27e60'
down_revision = 'e5f27b8c4a19'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # нове значення enum треба зафіксувати до першого використання
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE assessment_stage ADD VALUE IF NOT EXISTS 'IN_PROGRESS'")

    op.add_column('methodologies', sa.Column('version', sa.Integer(), server_default='1', nullable=False))
    for name in ('profile', 'quiz', 'interview'):
        op.add_column('assessments', sa.Column(f'{name}_submitted_at', sa.DateTime(timezone=True), nullable=True))
        op.add_column('assessments', sa.Column(f'{name}_version', sa.Integer(), nullable=True))
    op.create_table(
        'assessment_events',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('assessment_id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(length=32), nullable=False),
        sa.Column('stage', sa.String(length=16), nullable=True),
        sa.Column('methodology_version', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('details', sa.dialects.postgresql.JSONB(), nullable=True),
        sa.ForeignKeyConstraint(['assessment_id'], ['assessments.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_assessment_events_assessment_id'), 'assessment_events', ['assessment_id'], unique=False)

    # існуючі проходження: з лінійного stage відновлюємо, які етапи вже подано
    op.execute("""UPDATE assessments SET profile_submitted_at = COALESCE(submitted_at, created_at), profile_version = 1
                  WHERE stage IN ('QUIZ', 'INTERVIEW', 'PROCESSING', 'DONE')""")
    op.execute("""UPDATE assessments SET quiz_submitted_at = COALESCE(submitted_at, created_at), quiz_version = 1
                  WHERE stage IN ('INTERVIEW', 'PROCESSING', 'DONE')""")
    op.execute("""UPDATE assessments SET interview_submitted_at = COALESCE(submitted_at, created_at), interview_version = 1
                  WHERE stage IN ('PROCESSING', 'DONE')""")
    op.execute("UPDATE assessments SET stage = 'IN_PROGRESS' WHERE stage IN ('PROFILE', 'QUIZ', 'INTERVIEW')")


def downgrade() -> None:
    # лінійний stage відновлюється за поданими етапами; значення IN_PROGRESS у типі лишається (PostgreSQL не вміє його прибрати)
    op.execute("""UPDATE assessments SET stage = CASE
                      WHEN profile_submitted_at IS NULL THEN 'PROFILE'
                      WHEN quiz_submitted_at IS NULL THEN 'QUIZ'
                      ELSE 'INTERVIEW' END
                  WHERE stage = 'IN_PROGRESS'""")
    op.drop_index(op.f('ix_assessment_events_assessment_id'), table_name='assessment_events')
    op.drop_table('assessment_events')
    for name in ('interview', 'quiz', 'profile'):
        op.drop_column('assessments', f'{name}_version')
        op.drop_column('assessments', f'{name}_submitted_at')
    op.drop_column('methodologies', 'version')
