"""v2.3 (FASE 2): credenciamentos_assembleia, itens_pauta, ocorrencias_sessao

Revision ID: b4c5d6e7f8a9
Revises: a3b4c5d6e7f8
Create Date: 2026-09-15 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b4c5d6e7f8a9'
down_revision: Union[str, Sequence[str], None] = 'a3b4c5d6e7f8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "credenciamentos_assembleia",
        sa.Column("id_credenciamento", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_assembleia", sa.Integer(), sa.ForeignKey("assembleias.id_assembleia"), nullable=False, index=True),
        sa.Column("id_associado", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False, index=True),
        sa.Column("modalidade", sa.String(length=20), nullable=False),
        sa.Column("hora_entrada", sa.DateTime(), nullable=True),
        sa.Column("hora_saida", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_registro", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.UniqueConstraint("id_assembleia", "id_associado", name="uq_credenciamento_assembleia_associado"),
    )

    op.create_table(
        "itens_pauta",
        sa.Column("id_item", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_assembleia", sa.Integer(), sa.ForeignKey("assembleias.id_assembleia"), nullable=False, index=True),
        sa.Column("ordem", sa.Integer(), server_default="0"),
        sa.Column("titulo", sa.String(), nullable=False),
        sa.Column("descricao", sa.Text(), nullable=True),
        sa.Column("tempo_fala_minutos", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="Aguardando", index=True),
        sa.Column("aberto_em", sa.DateTime(), nullable=True),
        sa.Column("encerrado_em", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "ocorrencias_sessao",
        sa.Column("id_ocorrencia", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_assembleia", sa.Integer(), sa.ForeignKey("assembleias.id_assembleia"), nullable=False, index=True),
        sa.Column("id_item_pauta", sa.Integer(), sa.ForeignKey("itens_pauta.id_item"), nullable=True),
        sa.Column("descricao", sa.Text(), nullable=False),
        sa.Column("id_usuario_registro", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("ocorrencias_sessao")
    op.drop_table("itens_pauta")
    op.drop_table("credenciamentos_assembleia")
