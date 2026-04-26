"""Add data change audit log.

Revision ID: 20260426_06
Revises: 20260407_05
Create Date: 2026-04-26 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260426_06"
down_revision = "20260407_05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "data_change_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("proposal_id", sa.Integer(), nullable=True),
        sa.Column("incentive_id", sa.Integer(), nullable=False),
        sa.Column("field_name", sa.String(), nullable=False),
        sa.Column("old_value", sa.String(), nullable=True),
        sa.Column("new_value", sa.String(), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("changed_at", sa.String(), nullable=False),
        sa.Column("changed_by", sa.String(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_data_change_logs_proposal_id"), "data_change_logs", ["proposal_id"], unique=False)
    op.create_index(op.f("ix_data_change_logs_incentive_id"), "data_change_logs", ["incentive_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_data_change_logs_incentive_id"), table_name="data_change_logs")
    op.drop_index(op.f("ix_data_change_logs_proposal_id"), table_name="data_change_logs")
    op.drop_table("data_change_logs")
