"""v2.0 (FASE 2): documentos_estatuto e regras_estatutarias - o estatuto como configuração

Revision ID: e1f2a3b4c5d6
Revises: d4e5f6a7b8c9
Create Date: 2026-09-15 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e1f2a3b4c5d6'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "documentos_estatuto",
        sa.Column("id_documento_estatuto", sa.Integer(), primary_key=True, index=True),
        sa.Column("versao", sa.String(length=20), nullable=False),
        sa.Column("numero_registro_cartorio", sa.String(), nullable=False),
        sa.Column("comarca_registro", sa.String(), nullable=True),
        sa.Column("data_registro", sa.DateTime(), nullable=True),
        sa.Column("caminho_arquivo", sa.String(), nullable=True),
        sa.Column("vigente", sa.Boolean(), server_default=sa.true()),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "regras_estatutarias",
        sa.Column("id_regra", sa.Integer(), primary_key=True, index=True),
        sa.Column("parametro", sa.String(length=80), nullable=False, index=True),
        sa.Column("valor", sa.String(), nullable=False),
        sa.Column("tipo", sa.String(length=20), server_default="texto"),
        sa.Column("categoria", sa.String(length=50), server_default="regras"),
        sa.Column("descricao", sa.String(), nullable=True),
        sa.Column("artigo_origem", sa.String(length=50), nullable=True),
        sa.Column("id_documento_estatuto", sa.Integer(), sa.ForeignKey("documentos_estatuto.id_documento_estatuto"), nullable=True),
        sa.Column("vigencia_inicio", sa.DateTime(), nullable=False),
        sa.Column("vigencia_fim", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )

    # Dado semeado por seed_regras_estatutarias() no startup (mesmo padrão de
    # seed_configuracoes_institucionais/seed_catalogos - schema aqui, dado idempotente lá).
    bind = op.get_bind()
    configuracoes = sa.table(
        "configuracoes_institucionais", sa.column("chave_configuracao", sa.String), sa.column("descricao", sa.String)
    )
    bind.execute(
        configuracoes.update()
        .where(configuracoes.c.chave_configuracao == "PRAZO_CONVOCACAO_DIAS")
        .values(descricao="Dias mínimos de antecedência para convocação de assembleia (Art. 8º do estatuto - ver ESTATUTO_ASAF.txt).")
    )


def downgrade() -> None:
    op.drop_table("regras_estatutarias")
    op.drop_table("documentos_estatuto")
