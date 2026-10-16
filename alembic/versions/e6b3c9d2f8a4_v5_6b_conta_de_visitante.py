"""v5.6b (FASE 5): conta de visitante (e-mail + código de uso único, sem senha)

Cria `codigos_de_visitante` (só a impressão do código, validade curta, tentativas contadas) e `sessoes_de_visitante` (só a impressão do código da sessão) e acrescenta `inscricoes.email_da_inscricao` (o e-mail digitado na
inscrição pública, a chave da conta; nula nas inscrições que já existem). Nenhum dado existente é tocado.

Revision ID: e6b3c9d2f8a4
Revises: d5a2b8c1e7f3
Create Date: 2026-10-16 17:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e6b3c9d2f8a4'
down_revision: Union[str, Sequence[str], None] = 'd5a2b8c1e7f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("inscricoes", sa.Column("email_da_inscricao", sa.String(), nullable=True))
    op.create_index("ix_inscricoes_email_da_inscricao", "inscricoes", ["email_da_inscricao"])

    op.create_table(
        "codigos_de_visitante",
        sa.Column("id_codigo", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("codigo_hash", sa.String(length=64), nullable=False),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.Column("expira_em", sa.DateTime(), nullable=False),
        sa.Column("tentativas", sa.Integer(), nullable=False),
        sa.Column("usado_em", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_codigos_de_visitante_id_codigo", "codigos_de_visitante", ["id_codigo"])
    op.create_index("ix_codigos_de_visitante_email", "codigos_de_visitante", ["email"])
    op.create_index("ix_codigos_de_visitante_criado_em", "codigos_de_visitante", ["criado_em"])

    op.create_table(
        "sessoes_de_visitante",
        sa.Column("id_sessao", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.Column("expira_em", sa.DateTime(), nullable=False),
        sa.Column("encerrada_em", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_sessoes_de_visitante_id_sessao", "sessoes_de_visitante", ["id_sessao"])
    op.create_index("ix_sessoes_de_visitante_email", "sessoes_de_visitante", ["email"])
    op.create_index("ix_sessoes_de_visitante_token_hash", "sessoes_de_visitante", ["token_hash"], unique=True)
    op.create_index("ix_sessoes_de_visitante_criado_em", "sessoes_de_visitante", ["criado_em"])


def downgrade() -> None:
    for indice in ("criado_em", "token_hash", "email", "id_sessao"):
        op.drop_index(f"ix_sessoes_de_visitante_{indice}", table_name="sessoes_de_visitante")
    op.drop_table("sessoes_de_visitante")
    for indice in ("criado_em", "email", "id_codigo"):
        op.drop_index(f"ix_codigos_de_visitante_{indice}", table_name="codigos_de_visitante")
    op.drop_table("codigos_de_visitante")
    op.drop_index("ix_inscricoes_email_da_inscricao", table_name="inscricoes")
    with op.batch_alter_table("inscricoes") as lote:
        lote.drop_column("email_da_inscricao")
