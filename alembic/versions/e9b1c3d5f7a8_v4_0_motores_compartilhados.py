"""v4.0 (FASE 4): motores compartilhados - registros_presenca, inscricoes, templates_documento,
documentos_emitidos, indicadores, medicoes_indicador, compromissos_agenda

Revision ID: e9b1c3d5f7a8
Revises: d7f9b1c3e5a6
Create Date: 2026-09-18 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e9b1c3d5f7a8'
down_revision: Union[str, Sequence[str], None] = 'd7f9b1c3e5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "registros_presenca",
        sa.Column("id_registro", sa.Integer(), primary_key=True, index=True),
        sa.Column("contexto_tipo", sa.String(), nullable=False, index=True),
        sa.Column("id_contexto", sa.Integer(), nullable=False, index=True),
        sa.Column("id_pessoa", sa.Integer(), sa.ForeignKey("pessoas.id_pessoa"), nullable=False, index=True),
        sa.Column("hora_entrada", sa.DateTime(), nullable=False),
        sa.Column("hora_saida", sa.DateTime(), nullable=True),
        sa.Column("meio_registro", sa.String(), nullable=False),
        sa.Column("id_usuario_operador", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
    )

    op.create_table(
        "inscricoes",
        sa.Column("id_inscricao", sa.Integer(), primary_key=True, index=True),
        sa.Column("contexto_tipo", sa.String(), nullable=False, index=True),
        sa.Column("id_contexto", sa.Integer(), nullable=False, index=True),
        sa.Column("id_pessoa", sa.Integer(), sa.ForeignKey("pessoas.id_pessoa"), nullable=False, index=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("respostas_formulario", sa.Text(), nullable=True),
        sa.Column("id_titulo_cobranca", sa.Integer(), sa.ForeignKey("titulos_financeiros.id_titulo"), nullable=True),
        sa.Column("data_inscricao", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("contexto_tipo", "id_contexto", "id_pessoa", name="uq_inscricao_contexto_pessoa"),
    )

    op.create_table(
        "templates_documento",
        sa.Column("id_template", sa.Integer(), primary_key=True, index=True),
        sa.Column("codigo", sa.String(), nullable=False, unique=True, index=True),
        sa.Column("nome", sa.String(), nullable=False),
        sa.Column("corpo_texto", sa.Text(), nullable=False),
        sa.Column("ativo", sa.Boolean(), nullable=False, server_default=sa.true()),
    )

    op.create_table(
        "documentos_emitidos",
        sa.Column("id_documento", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_template", sa.Integer(), sa.ForeignKey("templates_documento.id_template"), nullable=False),
        sa.Column("numero_sequencial", sa.Integer(), nullable=False, unique=True, index=True),
        sa.Column("contexto_tipo", sa.String(), nullable=True, index=True),
        sa.Column("id_contexto", sa.Integer(), nullable=True, index=True),
        sa.Column("id_pessoa", sa.Integer(), sa.ForeignKey("pessoas.id_pessoa"), nullable=True),
        sa.Column("variaveis_usadas", sa.Text(), nullable=True),
        sa.Column("caminho_arquivo", sa.String(), nullable=False),
        sa.Column("id_usuario_emissao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("emitida_em", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "indicadores",
        sa.Column("id_indicador", sa.Integer(), primary_key=True, index=True),
        sa.Column("nome", sa.String(), nullable=False),
        sa.Column("unidade", sa.String(), nullable=False),
        sa.Column("meta", sa.Numeric(14, 2), nullable=True),
        sa.Column("periodicidade", sa.String(), nullable=False),
        sa.Column("contexto_tipo", sa.String(), nullable=True, index=True),
        sa.Column("id_contexto", sa.Integer(), nullable=True, index=True),
        sa.Column("ativo", sa.Boolean(), nullable=False, server_default=sa.true()),
    )

    op.create_table(
        "medicoes_indicador",
        sa.Column("id_medicao", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_indicador", sa.Integer(), sa.ForeignKey("indicadores.id_indicador"), nullable=False),
        sa.Column("valor", sa.Numeric(14, 2), nullable=False),
        sa.Column("periodo", sa.String(), nullable=False),
        sa.Column("fonte", sa.String(), nullable=True),
        sa.Column("id_usuario_medicao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("medido_em", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("id_indicador", "periodo", name="uq_medicao_indicador_periodo"),
    )

    op.create_table(
        "compromissos_agenda",
        sa.Column("id_compromisso", sa.Integer(), primary_key=True, index=True),
        sa.Column("recurso_tipo", sa.String(), nullable=False, index=True),
        sa.Column("id_recurso", sa.Integer(), nullable=False, index=True),
        sa.Column("contexto_tipo", sa.String(), nullable=False),
        sa.Column("id_contexto", sa.Integer(), nullable=False),
        sa.Column("data_hora_inicio", sa.DateTime(), nullable=False),
        sa.Column("data_hora_fim", sa.DateTime(), nullable=False),
        sa.Column("id_usuario_registro", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("compromissos_agenda")
    op.drop_table("medicoes_indicador")
    op.drop_table("indicadores")
    op.drop_table("documentos_emitidos")
    op.drop_table("templates_documento")
    op.drop_table("inscricoes")
    op.drop_table("registros_presenca")
