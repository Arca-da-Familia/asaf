"""v3.0 (FASE 3): exercicios_contabeis, razao contabil em partida dobrada real (lancamentos +
partidas), Numeric no financeiro

Revision ID: 1a735681510a
Revises: b0c1d2e3f4a5
Create Date: 2026-09-15 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '1a735681510a'
down_revision: Union[str, Sequence[str], None] = 'b0c1d2e3f4a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "exercicios_contabeis",
        sa.Column("id_exercicio", sa.Integer(), primary_key=True, index=True),
        sa.Column("ano", sa.Integer(), nullable=False, unique=True, index=True),
        sa.Column("status", sa.String(), nullable=False, server_default="Aberto"),
        sa.Column("data_abertura", sa.DateTime(), nullable=True),
        sa.Column("data_fechamento", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_abertura", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("id_usuario_fechamento", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
    )

    # v3.0 - money never as float again (DECISOES_CONGELADAS.md 1.2): a v0.1 prototype router
    # was never migrated when this rule was adopted. Sem dado real em produção ainda (achado
    # confirmado antes desta migração) - conversão direta de tipo, sem CASE de preservação.
    with op.batch_alter_table("titulos_financeiros") as batch_op:
        batch_op.alter_column("valor_original", type_=sa.Numeric(14, 2), existing_type=sa.Float())
        batch_op.alter_column("saldo_devedor", type_=sa.Numeric(14, 2), existing_type=sa.Float())

    # v3.0 - razão contábil real: cabeçalho (LancamentoContabil) + N partidas de débito/crédito
    # (PartidaContabil), sempre balanceado (ver app/services/contabilidade.py). Substitui
    # `livro_caixa_auditoria` (protótipo v0.1, um par origem/destino por linha - não é partida
    # dobrada de verdade, não valida natureza de conta nem soma zero). Tabela antiga sem dado
    # real a preservar (mesmo achado que motivou a conversão de Float acima) - dropada, não
    # migrada coluna a coluna.
    op.create_table(
        "lancamentos_contabeis",
        sa.Column("id_lancamento", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_exercicio", sa.Integer(), sa.ForeignKey("exercicios_contabeis.id_exercicio"), nullable=False),
        sa.Column("numero_sequencial", sa.Integer(), nullable=False),
        sa.Column("id_titulo", sa.Integer(), sa.ForeignKey("titulos_financeiros.id_titulo"), nullable=True),
        sa.Column("historico", sa.String(), nullable=False),
        sa.Column("tipo_origem", sa.String(), nullable=False),
        sa.Column("forma_pagamento", sa.String(), nullable=True),
        sa.Column("id_usuario_lancamento", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("data_lancamento", sa.DateTime(), nullable=True),
        sa.Column("estornado", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("motivo_estorno", sa.String(), nullable=True),
        sa.Column("id_lancamento_estorno", sa.Integer(), sa.ForeignKey("lancamentos_contabeis.id_lancamento"), nullable=True),
        sa.UniqueConstraint("id_exercicio", "numero_sequencial", name="uq_lancamento_numero_por_exercicio"),
    )
    op.create_table(
        "partidas_contabeis",
        sa.Column("id_partida", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_lancamento", sa.Integer(), sa.ForeignKey("lancamentos_contabeis.id_lancamento"), nullable=False),
        sa.Column("id_conta", sa.Integer(), sa.ForeignKey("plano_de_contas.id_conta"), nullable=False),
        sa.Column("tipo_partida", sa.String(), nullable=False),
        sa.Column("valor", sa.Numeric(14, 2), nullable=False),
    )
    op.drop_table("livro_caixa_auditoria")


def downgrade() -> None:
    op.drop_table("partidas_contabeis")
    op.drop_table("lancamentos_contabeis")

    op.create_table(
        "livro_caixa_auditoria",
        sa.Column("id_transacao", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_titulo", sa.Integer(), sa.ForeignKey("titulos_financeiros.id_titulo"), nullable=True),
        sa.Column("id_conta_contabil", sa.Integer(), sa.ForeignKey("plano_de_contas.id_conta"), nullable=True),
        sa.Column("tipo_movimento", sa.String(), nullable=True),
        sa.Column("valor_efetivado", sa.Float(), nullable=True),
        sa.Column("data_registro_servidor", sa.DateTime(), nullable=True),
        sa.Column("forma_pagamento", sa.String(), nullable=True),
        sa.Column("status_auditoria", sa.String(), nullable=True),
        sa.Column("observacao_auditoria", sa.String(), nullable=True),
    )

    with op.batch_alter_table("titulos_financeiros") as batch_op:
        batch_op.alter_column("saldo_devedor", type_=sa.Float(), existing_type=sa.Numeric(14, 2))
        batch_op.alter_column("valor_original", type_=sa.Float(), existing_type=sa.Numeric(14, 2))

    op.drop_table("exercicios_contabeis")
