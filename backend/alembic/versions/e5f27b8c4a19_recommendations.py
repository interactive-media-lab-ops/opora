"""recommendations

Revision ID: e5f27b8c4a19
Revises: d9a14c6e2b73
Create Date: 2026-10-26 20:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'e5f27b8c4a19'
down_revision = 'd9a14c6e2b73'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'recommendation_questions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('methodology_id', sa.Integer(), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('hint', sa.Text(), nullable=False),
        sa.Column('order', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['methodology_id'], ['methodologies.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'recommendation_links',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('assessment_id', sa.Integer(), nullable=False),
        sa.Column('slot', sa.Integer(), nullable=False),
        sa.Column('token', sa.String(length=64), nullable=False),
        sa.Column('status', sa.Enum('PENDING', 'SUBMITTED', 'DECLINED', name='recommendation_link_status'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['assessment_id'], ['assessments.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('assessment_id', 'slot', name='uq_recommendation_slot'),
    )
    op.create_index(op.f('ix_recommendation_links_assessment_id'), 'recommendation_links', ['assessment_id'], unique=False)
    op.create_index(op.f('ix_recommendation_links_token'), 'recommendation_links', ['token'], unique=True)
    op.create_table(
        'recommendations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('link_id', sa.Integer(), nullable=False),
        sa.Column('role', sa.Enum('MANAGER', 'COLLEAGUE', 'SUBORDINATE', name='recommendation_role'), nullable=False),
        sa.ForeignKeyConstraint(['link_id'], ['recommendation_links.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('link_id'),
    )
    op.create_table(
        'recommendation_answers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('recommendation_id', sa.Integer(), nullable=False),
        sa.Column('question_id', sa.Integer(), nullable=True),
        sa.Column('question_text', sa.Text(), nullable=False),
        sa.Column('order', sa.Integer(), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(['question_id'], ['recommendation_questions.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['recommendation_id'], ['recommendations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_recommendation_answers_recommendation_id'), 'recommendation_answers', ['recommendation_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_recommendation_answers_recommendation_id'), table_name='recommendation_answers')
    op.drop_table('recommendation_answers')
    op.drop_table('recommendations')
    op.drop_index(op.f('ix_recommendation_links_token'), table_name='recommendation_links')
    op.drop_index(op.f('ix_recommendation_links_assessment_id'), table_name='recommendation_links')
    op.drop_table('recommendation_links')
    op.drop_table('recommendation_questions')
    op.execute('DROP TYPE recommendation_role')
    op.execute('DROP TYPE recommendation_link_status')
