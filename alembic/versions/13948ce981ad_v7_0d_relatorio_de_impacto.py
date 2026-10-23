"""v7.0d (FASE 7): o relatório de impacto à proteção de dados (RIPD) - a tabela `relatorios_de_impacto`

Cada versão do relatório de um tratamento de alto risco (app/services/relatorio_de_impacto.py), com as seções como estavam, a aprovação e a suspensão. Sem versão
APROVADA o tratamento não roda: a partir desta versão, gravar no prontuário e registrar encaminhamento à rede externa passa a exigir o relatório aprovado (nos bancos
que já existem, ele começa sem nenhum: o prontuário fica fechado até a Presidência aprovar). Nenhum dado existente é tocado. O `downgrade` apaga a tabela.

Revision ID: 13948ce981ad
Revises: 30a03a70ba56
Create Date: 2026-10-23 21:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '13948ce981ad'
down_revision: Union[str, Sequence[str], None] = '30a03a70ba56'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_JSON = postgresql.JSONB().with_variant(sa.JSON(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "relatorios_de_impacto",
        sa.Column("id_relatorio", sa.Integer(), primary_key=True),
        sa.Column("codigo_tratamento", sa.String(length=40), nullable=False),
        sa.Column("versao", sa.Integer(), nullable=False),
        sa.Column("situacao", sa.String(length=20), nullable=False),
        sa.Column("secoes", _JSON, nullable=False),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=False),
        sa.Column("atualizado_em", sa.DateTime(), nullable=True),
        sa.Column("aprovado_em", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_aprovacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("suspenso_em", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_suspensao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("motivo_suspensao", sa.String(length=500), nullable=True),
        sa.UniqueConstraint("codigo_tratamento", "versao", name="uq_versao_de_relatorio_de_impacto"),
    )
    for coluna in ("id_relatorio", "codigo_tratamento", "situacao"):
        op.create_index(f"ix_relatorios_de_impacto_{coluna}", "relatorios_de_impacto", [coluna])


def downgrade() -> None:
    for coluna in ("situacao", "codigo_tratamento", "id_relatorio"):
        op.drop_index(f"ix_relatorios_de_impacto_{coluna}", table_name="relatorios_de_impacto")
    op.drop_table("relatorios_de_impacto")
