"""v0.3.3: campos personalizados (DefinicaoCampo/ValorCampo)

Revision ID: e3f4a5b6c7d8
Revises: d2e3f4a5b6c7
Create Date: 2026-09-12 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = 'e3f4a5b6c7d8'
down_revision: Union[str, Sequence[str], None] = 'd2e3f4a5b6c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "definicoes_campo",
        sa.Column("id_definicao", sa.Integer(), primary_key=True, index=True),
        sa.Column("entidade", sa.String(length=50), nullable=False, index=True),
        sa.Column("rotulo", sa.String(length=200), nullable=True),
        sa.Column("tipo", sa.String(length=20), nullable=False),
        sa.Column("id_catalogo", sa.Integer(), sa.ForeignKey("catalogos.id_catalogo"), nullable=True),
        sa.Column("obrigatorio", sa.Boolean(), server_default=sa.false()),
        sa.Column("ordem", sa.Integer(), server_default="0"),
        sa.Column("ativo", sa.Boolean(), server_default=sa.true()),
        sa.Column("niveis_visiveis", JSONB().with_variant(sa.JSON(), "sqlite"), nullable=True),
    )
    op.create_table(
        "valores_campo",
        sa.Column("id_valor", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_definicao", sa.Integer(), sa.ForeignKey("definicoes_campo.id_definicao"), index=True),
        sa.Column("id_registro", sa.Integer(), index=True, nullable=False),
        sa.Column("valor", sa.String(), nullable=True),
        sa.UniqueConstraint("id_definicao", "id_registro", name="uq_valor_campo_registro"),
    )


def downgrade() -> None:
    op.drop_table("valores_campo")
    op.drop_table("definicoes_campo")
