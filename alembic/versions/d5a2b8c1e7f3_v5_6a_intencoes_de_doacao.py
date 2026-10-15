"""v5.6a (FASE 5): doar pelo site com Pix estático e confirmação manual

Cria `intencoes_de_doacao`: quem escolhe doar pelo site identificado deixa aqui o que vai fazer (nome, e-mail, valor, campanha) e recebe um protocolo; o Tesoureiro confirma, no painel, quando acha o
dinheiro no extrato do banco (só então nasce a `Doacao` com o recibo). Nenhum dado existente é tocado.

Revision ID: d5a2b8c1e7f3
Revises: c4f1a9d6e8b2
Create Date: 2026-10-16 09:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd5a2b8c1e7f3'
down_revision: Union[str, Sequence[str], None] = 'c4f1a9d6e8b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "intencoes_de_doacao",
        sa.Column("id_intencao", sa.Integer(), primary_key=True),
        sa.Column("protocolo", sa.String(length=30), nullable=False),
        sa.Column("nome_doador", sa.String(), nullable=False),
        sa.Column("email_doador", sa.String(), nullable=False),
        sa.Column("documento_doador", sa.String(), nullable=True),
        sa.Column("valor_informado", sa.Numeric(14, 2), nullable=True),
        sa.Column("id_campanha", sa.Integer(), sa.ForeignKey("campanhas_arrecadacao.id_campanha"), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("impressao_do_pedido", sa.String(length=64), nullable=True),
        sa.Column("consentimento_lgpd_versao", sa.String(), nullable=False),
        sa.Column("consentimento_lgpd_em", sa.DateTime(), nullable=False),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.Column("expira_em", sa.DateTime(), nullable=False),
        sa.Column("resolvido_em", sa.DateTime(), nullable=True),
        sa.Column("id_doacao", sa.Integer(), sa.ForeignKey("doacoes.id_doacao"), nullable=True),
        sa.Column("id_usuario_resolucao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("observacao", sa.String(length=300), nullable=True),
        sa.Column("recibo_enviado_por_email", sa.Boolean(), nullable=True),
    )
    op.create_index("ix_intencoes_de_doacao_id_intencao", "intencoes_de_doacao", ["id_intencao"])
    op.create_index("ix_intencoes_de_doacao_protocolo", "intencoes_de_doacao", ["protocolo"], unique=True)
    op.create_index("ix_intencoes_de_doacao_email_doador", "intencoes_de_doacao", ["email_doador"])
    op.create_index("ix_intencoes_de_doacao_status", "intencoes_de_doacao", ["status"])
    op.create_index("ix_intencoes_de_doacao_impressao_do_pedido", "intencoes_de_doacao", ["impressao_do_pedido"])


def downgrade() -> None:
    for indice in ("impressao_do_pedido", "status", "email_doador", "protocolo", "id_intencao"):
        op.drop_index(f"ix_intencoes_de_doacao_{indice}", table_name="intencoes_de_doacao")
    op.drop_table("intencoes_de_doacao")
