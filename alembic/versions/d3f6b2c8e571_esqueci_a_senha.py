"""Esqueci a minha senha: o código de uso único por e-mail para trocar a senha do painel

Cria `codigos_de_nova_senha` (só a impressão do código, validade curta, tentativas contadas, ligado ao usuário). Nenhum dado existente é tocado.

Revision ID: d3f6b2c8e571
Revises: c9e5a1b3d468
Create Date: 2026-10-21 17:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd3f6b2c8e571'
down_revision: Union[str, Sequence[str], None] = 'c9e5a1b3d468'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "codigos_de_nova_senha",
        sa.Column("id_codigo", sa.Integer(), primary_key=True),
        sa.Column("id_usuario", sa.Integer(), sa.ForeignKey("usuarios.id_usuario", ondelete="CASCADE", name="fk_codigos_de_nova_senha_id_usuario"), nullable=False),
        sa.Column("codigo_hash", sa.String(length=64), nullable=False),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.Column("expira_em", sa.DateTime(), nullable=False),
        sa.Column("tentativas", sa.Integer(), nullable=False),
        sa.Column("usado_em", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_codigos_de_nova_senha_id_codigo", "codigos_de_nova_senha", ["id_codigo"])
    op.create_index("ix_codigos_de_nova_senha_id_usuario", "codigos_de_nova_senha", ["id_usuario"])
    op.create_index("ix_codigos_de_nova_senha_criado_em", "codigos_de_nova_senha", ["criado_em"])


def downgrade() -> None:
    for indice in ("criado_em", "id_usuario", "id_codigo"):
        op.drop_index(f"ix_codigos_de_nova_senha_{indice}", table_name="codigos_de_nova_senha")
    op.drop_table("codigos_de_nova_senha")
