"""v6.2c (FASE 6): modelos de mensagem versionados e avisos agendados

Cria `modelos_de_aviso` (textos prontos, versionados: editar cria versão nova) e `avisos_agendados` (aviso para publicar depois, pela tarefa periódica) e acrescenta
`avisos.id_modelo` (a versão do modelo que o aviso usou; vazio nos avisos que já existem). Nada é apagado.

Revision ID: c9e5a1b3d468
Revises: b8d4f0a2c357
Create Date: 2026-10-21 15:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'c9e5a1b3d468'
down_revision: Union[str, Sequence[str], None] = 'b8d4f0a2c357'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
_INDICES_MODELOS = ("id_modelo", "grupo")
_INDICES_AGENDADOS = ("id_agendado", "publicar_em", "situacao")


def upgrade() -> None:
    op.create_table(
        "modelos_de_aviso",
        sa.Column("id_modelo", sa.Integer(), primary_key=True),
        sa.Column("grupo", sa.String(length=36), nullable=False),
        sa.Column("versao", sa.Integer(), nullable=False),
        sa.Column("nome", sa.String(length=100), nullable=False),
        sa.Column("titulo", sa.String(length=150), nullable=False),
        sa.Column("texto", sa.Text(), nullable=False),
        sa.Column("categoria", sa.String(length=40), nullable=False),
        sa.Column("exige_confirmacao", sa.Boolean(), nullable=False),
        sa.Column("por_email", sa.Boolean(), nullable=False),
        sa.Column("ativo", sa.Boolean(), nullable=False),
        sa.Column("id_usuario_autor", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=False),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("grupo", "versao", name="uq_modelo_de_aviso_versao"),
    )
    for coluna in _INDICES_MODELOS:
        op.create_index(f"ix_modelos_de_aviso_{coluna}", "modelos_de_aviso", [coluna])
    with op.batch_alter_table("avisos") as lote:
        lote.add_column(sa.Column("id_modelo", sa.Integer(), sa.ForeignKey("modelos_de_aviso.id_modelo", name="fk_avisos_id_modelo"), nullable=True))
    op.create_table(
        "avisos_agendados",
        sa.Column("id_agendado", sa.Integer(), primary_key=True),
        sa.Column("publicar_em", sa.DateTime(), nullable=False),
        sa.Column("situacao", sa.String(length=20), nullable=False),
        sa.Column("titulo", sa.String(length=150), nullable=False),
        sa.Column("texto", sa.Text(), nullable=False),
        sa.Column("categoria", sa.String(length=40), nullable=False),
        sa.Column("valido_ate", sa.Date(), nullable=False),
        sa.Column("exige_confirmacao", sa.Boolean(), nullable=False),
        sa.Column("por_email", sa.Boolean(), nullable=False),
        sa.Column("publico", _JSON, nullable=False),
        sa.Column("publico_descricao", sa.String(length=400), nullable=False),
        sa.Column("total_conferido", sa.Integer(), nullable=False),
        sa.Column("id_modelo", sa.Integer(), sa.ForeignKey("modelos_de_aviso.id_modelo"), nullable=True),
        sa.Column("id_usuario_autor", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=False),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.Column("id_aviso", sa.Integer(), sa.ForeignKey("avisos.id_aviso"), nullable=True),
        sa.Column("motivo", sa.String(length=500), nullable=True),
        sa.Column("id_usuario_cancelamento", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
    )
    for coluna in _INDICES_AGENDADOS:
        op.create_index(f"ix_avisos_agendados_{coluna}", "avisos_agendados", [coluna])


def downgrade() -> None:
    for coluna in reversed(_INDICES_AGENDADOS):
        op.drop_index(f"ix_avisos_agendados_{coluna}", table_name="avisos_agendados")
    op.drop_table("avisos_agendados")
    with op.batch_alter_table("avisos") as lote:
        lote.drop_constraint("fk_avisos_id_modelo", type_="foreignkey")
        lote.drop_column("id_modelo")
    for coluna in reversed(_INDICES_MODELOS):
        op.drop_index(f"ix_modelos_de_aviso_{coluna}", table_name="modelos_de_aviso")
    op.drop_table("modelos_de_aviso")
