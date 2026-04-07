"""Add selective-fund metadata to incentives.

Revision ID: 20260407_05
Revises: 20260327_04
Create Date: 2026-04-07 12:30:00.000000
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260407_05"
down_revision = "20260327_04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("incentives", sa.Column("selection_mode", sa.String(), nullable=False, server_default="automatic"))
    op.add_column("incentives", sa.Column("operator_type", sa.String(), nullable=False, server_default="government"))
    op.add_column("incentives", sa.Column("application_status", sa.String(), nullable=False, server_default="unknown"))
    op.add_column("incentives", sa.Column("application_note", sa.String(), nullable=True))
    op.add_column("incentives", sa.Column("typical_award_amount", sa.Float(), nullable=True))
    op.add_column("incentives", sa.Column("typical_award_currency", sa.String(length=3), nullable=True))


def downgrade() -> None:
    op.drop_column("incentives", "typical_award_currency")
    op.drop_column("incentives", "typical_award_amount")
    op.drop_column("incentives", "application_note")
    op.drop_column("incentives", "application_status")
    op.drop_column("incentives", "operator_type")
    op.drop_column("incentives", "selection_mode")
