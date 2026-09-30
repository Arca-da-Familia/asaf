"""v4.9 (FASE 4): financeiro de projeto/evento - cobranca de inscricao/uso de espaco (faixa de
preco, cupom, isencao justificada), reembolso por cancelamento e fechamento financeiro automatico

Revision ID: 5c3d174cb796
Revises: f725cc1267a1
Create Date: 2026-09-30 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '5c3d174cb796'
down_revision: Union[str, Sequence[str], None] = 'f725cc1267a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # v4.9 - SQLite (usado localmente/CI) recria a tabela inteira por trás de `batch_alter_table`
    # pra simular ALTER TABLE ADD COLUMN com FK - o Alembic exige nome explícito pra toda
    # constraint nesse caminho, mesmo que o Postgres de produção nunca precise disso (lá é um
    # ADD COLUMN de verdade, sem recriar tabela).
    with op.batch_alter_table("centros_de_custo") as batch_op:
        batch_op.add_column(sa.Column("id_evento", sa.Integer(), sa.ForeignKey("eventos.id_evento", name="fk_centros_de_custo_id_evento"), nullable=True))

    with op.batch_alter_table("titulos_financeiros") as batch_op:
        batch_op.add_column(sa.Column("id_titulo_reembolso_de", sa.Integer(), sa.ForeignKey("titulos_financeiros.id_titulo", name="fk_titulos_financeiros_id_titulo_reembolso_de"), nullable=True))

    with op.batch_alter_table("eventos") as batch_op:
        batch_op.add_column(sa.Column("valor_base", sa.Numeric(10, 2), nullable=True))
        batch_op.add_column(sa.Column("id_conta_contabil_receita", sa.Integer(), sa.ForeignKey("plano_de_contas.id_conta", name="fk_eventos_id_conta_contabil_receita"), nullable=True))
        batch_op.add_column(sa.Column("id_centro_custo", sa.Integer(), sa.ForeignKey("centros_de_custo.id_centro_custo", name="fk_eventos_id_centro_custo"), nullable=True))
        batch_op.add_column(sa.Column("prazo_cancelamento_horas", sa.Integer(), nullable=False, server_default="24"))
        batch_op.add_column(sa.Column("percentual_reembolso_cancelamento", sa.Numeric(5, 2), nullable=True))

    with op.batch_alter_table("espacos") as batch_op:
        batch_op.add_column(sa.Column("percentual_reembolso_cancelamento", sa.Numeric(5, 2), nullable=True))

    op.create_table(
        "faixas_preco_evento",
        sa.Column("id_faixa", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_evento", sa.Integer(), sa.ForeignKey("eventos.id_evento"), nullable=False, index=True),
        sa.Column("categoria", sa.String(), nullable=False),
        sa.Column("valor", sa.Numeric(10, 2), nullable=False),
        sa.Column("data_vigencia_inicio", sa.DateTime(), nullable=False),
        sa.Column("data_vigencia_fim", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_registro", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("id_evento", "categoria", "data_vigencia_inicio", name="uq_faixa_preco_evento_categoria_vigencia"),
    )

    op.create_table(
        "cupons_desconto",
        sa.Column("id_cupom", sa.Integer(), primary_key=True, index=True),
        sa.Column("codigo", sa.String(), nullable=False),
        sa.Column("contexto_tipo", sa.String(), nullable=False, index=True),
        sa.Column("id_contexto", sa.Integer(), nullable=False, index=True),
        sa.Column("tipo_desconto", sa.String(), nullable=False),
        sa.Column("valor_desconto", sa.Numeric(10, 2), nullable=False),
        sa.Column("limite_uso", sa.Integer(), nullable=True),
        sa.Column("usos_atuais", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("data_vigencia_inicio", sa.DateTime(), nullable=True),
        sa.Column("data_vigencia_fim", sa.DateTime(), nullable=True),
        sa.Column("ativo", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_cupons_desconto_codigo", "cupons_desconto", ["codigo"], unique=True)

    op.create_table(
        "isencoes_taxa_contexto",
        sa.Column("id_isencao", sa.Integer(), primary_key=True, index=True),
        sa.Column("contexto_tipo", sa.String(), nullable=False, index=True),
        sa.Column("id_contexto", sa.Integer(), nullable=False, index=True),
        sa.Column("id_pessoa", sa.Integer(), sa.ForeignKey("pessoas.id_pessoa"), nullable=False),
        sa.Column("motivo", sa.String(), nullable=False),
        sa.Column("percentual_isencao", sa.Numeric(5, 2), nullable=False),
        sa.Column("id_usuario_aprovador", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "fechamentos_evento",
        sa.Column("id_fechamento", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_evento", sa.Integer(), sa.ForeignKey("eventos.id_evento"), nullable=False, index=True),
        sa.Column("gerado_em", sa.DateTime(), nullable=True),
        sa.Column("total_inscritos", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_presentes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_arrecadado", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("total_custos", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("resultado", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("id_usuario_geracao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("fechamentos_evento")
    op.drop_table("isencoes_taxa_contexto")
    op.drop_index("ix_cupons_desconto_codigo", table_name="cupons_desconto")
    op.drop_table("cupons_desconto")
    op.drop_table("faixas_preco_evento")

    with op.batch_alter_table("espacos") as batch_op:
        batch_op.drop_column("percentual_reembolso_cancelamento")

    with op.batch_alter_table("eventos") as batch_op:
        batch_op.drop_column("percentual_reembolso_cancelamento")
        batch_op.drop_column("prazo_cancelamento_horas")
        batch_op.drop_column("id_centro_custo")
        batch_op.drop_column("id_conta_contabil_receita")
        batch_op.drop_column("valor_base")

    with op.batch_alter_table("titulos_financeiros") as batch_op:
        batch_op.drop_column("id_titulo_reembolso_de")

    with op.batch_alter_table("centros_de_custo") as batch_op:
        batch_op.drop_column("id_evento")
