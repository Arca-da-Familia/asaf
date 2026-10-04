"""v5.5 (FASE 5): projeto em destaque (Despertai) e o contexto do evento

  - `projetos_eventos.destaque_no_site`: o projeto principal da associação aparece em destaque na página inicial do site;
  - `eventos.id_projeto`: cada evento (edição) pode pertencer a um projeto — a página do projeto lista as edições;
  - `fotos_evento`: fotos do evento, cada uma só com a autorização de imagem confirmada e o texto alternativo; o arquivo
    fica em armazenamento privado (`fotos-eventos`), já regravado sem metadado.

Nada de dado existente é tocado: tudo entra com valor neutro (destaque desligado, evento sem projeto).

Revision ID: a7d2f4c8b931
Revises: f5c1d9e7a283
Create Date: 2026-10-04 20:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a7d2f4c8b931'
down_revision: Union[str, Sequence[str], None] = 'f5c1d9e7a283'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDICES_DAS_FOTOS = ("id_foto", "id_evento")


def upgrade() -> None:
    with op.batch_alter_table("projetos_eventos") as batch_op:
        batch_op.add_column(sa.Column("destaque_no_site", sa.Boolean(), nullable=False, server_default=sa.false()))
    with op.batch_alter_table("eventos") as batch_op:
        batch_op.add_column(sa.Column("id_projeto", sa.Integer(), sa.ForeignKey("projetos_eventos.id_projeto", name="fk_eventos_id_projeto"), nullable=True))
        batch_op.create_index("ix_eventos_id_projeto", ["id_projeto"])

    op.create_table(
        "fotos_evento",
        sa.Column("id_foto", sa.Integer(), primary_key=True),
        sa.Column("id_evento", sa.Integer(), sa.ForeignKey("eventos.id_evento"), nullable=False),
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
    for coluna in _INDICES_DAS_FOTOS:
        op.create_index(f"ix_fotos_evento_{coluna}", "fotos_evento", [coluna])


def downgrade() -> None:
    for coluna in reversed(_INDICES_DAS_FOTOS):
        op.drop_index(f"ix_fotos_evento_{coluna}", table_name="fotos_evento")
    op.drop_table("fotos_evento")
    with op.batch_alter_table("eventos") as batch_op:
        batch_op.drop_index("ix_eventos_id_projeto")
        batch_op.drop_column("id_projeto")
    with op.batch_alter_table("projetos_eventos") as batch_op:
        batch_op.drop_column("destaque_no_site")
