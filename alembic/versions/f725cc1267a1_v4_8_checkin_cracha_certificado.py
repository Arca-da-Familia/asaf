"""v4.8 (FASE 4): check-in sem login (codigo/QR/carteirinha), modo offline com idempotencia,
checkout, cracha e certificado em PDF com verificacao publica, elegibilidade configuravel

Revision ID: f725cc1267a1
Revises: f0a2c4e6b8d0
Create Date: 2026-09-30 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'f725cc1267a1'
down_revision: Union[str, Sequence[str], None] = 'f0a2c4e6b8d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("eventos") as batch_op:
        batch_op.add_column(sa.Column("carga_horaria_horas", sa.Numeric(6, 2), nullable=True))
        batch_op.add_column(sa.Column("percentual_minimo_certificado", sa.Numeric(5, 2), nullable=True))

    with op.batch_alter_table("documentos_emitidos") as batch_op:
        batch_op.add_column(sa.Column("codigo_verificacao", sa.String(), nullable=True))
        batch_op.create_index("ix_documentos_emitidos_codigo_verificacao", ["codigo_verificacao"], unique=True)

    op.create_table(
        "tokens_portaria",
        sa.Column("id_token_portaria", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_evento", sa.Integer(), sa.ForeignKey("eventos.id_evento"), nullable=False, index=True),
        sa.Column("descricao", sa.String(), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
        sa.Column("expira_em", sa.DateTime(), nullable=False),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("revogado_em", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_revogacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
    )

    op.create_table(
        "operacoes_portaria_idempotentes",
        sa.Column("id_operacao", sa.Integer(), primary_key=True, index=True),
        sa.Column("chave_idempotencia", sa.String(), nullable=False),
        sa.Column("id_registro_presenca", sa.Integer(), sa.ForeignKey("registros_presenca.id_registro"), nullable=False),
        sa.Column("tipo", sa.String(), nullable=False),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_operacoes_portaria_idempotentes_chave_idempotencia", "operacoes_portaria_idempotentes", ["chave_idempotencia"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_operacoes_portaria_idempotentes_chave_idempotencia", table_name="operacoes_portaria_idempotentes")
    op.drop_table("operacoes_portaria_idempotentes")

    op.drop_table("tokens_portaria")

    with op.batch_alter_table("documentos_emitidos") as batch_op:
        batch_op.drop_index("ix_documentos_emitidos_codigo_verificacao")
        batch_op.drop_column("codigo_verificacao")

    with op.batch_alter_table("eventos") as batch_op:
        batch_op.drop_column("percentual_minimo_certificado")
        batch_op.drop_column("carga_horaria_horas")
