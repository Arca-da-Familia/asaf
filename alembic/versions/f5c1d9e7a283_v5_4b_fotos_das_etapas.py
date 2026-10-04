"""v5.4b (FASE 5): fotos das etapas de parceria (com autorização de imagem)

Cria `fotos_etapa_parceria`: cada foto só existe com a autorização de imagem confirmada e o texto alternativo; o arquivo fica
em armazenamento privado (`fotos-etapas`), já regravado sem metadado. Nada de dado existente é tocado.

Revision ID: f5c1d9e7a283
Revises: e8b3c5a1f720
Create Date: 2026-10-04 17:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'f5c1d9e7a283'
down_revision: Union[str, Sequence[str], None] = 'e8b3c5a1f720'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDICES = ("id_foto", "id_etapa", "id_parceria")


def upgrade() -> None:
    op.create_table(
        "fotos_etapa_parceria",
        sa.Column("id_foto", sa.Integer(), primary_key=True),
        sa.Column("id_etapa", sa.Integer(), sa.ForeignKey("etapas_parceria.id_etapa"), nullable=False),
        sa.Column("id_parceria", sa.Integer(), sa.ForeignKey("parcerias.id_parceria"), nullable=False),
        sa.Column("arquivo_nome", sa.String(length=150), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("tamanho", sa.Integer(), nullable=False),
        sa.Column("largura", sa.Integer(), nullable=False),
        sa.Column("altura", sa.Integer(), nullable=False),
        sa.Column("alt", sa.String(length=300), nullable=False),
        sa.Column("autorizacao_imagem", sa.Boolean(), nullable=False),
        sa.Column("id_documento_autorizacao", sa.Integer(), sa.ForeignKey("documentos_institucionais.id_documento"), nullable=True),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
    )
    for coluna in _INDICES:
        op.create_index(f"ix_fotos_etapa_parceria_{coluna}", "fotos_etapa_parceria", [coluna])


def downgrade() -> None:
    for coluna in reversed(_INDICES):
        op.drop_index(f"ix_fotos_etapa_parceria_{coluna}", table_name="fotos_etapa_parceria")
    op.drop_table("fotos_etapa_parceria")
