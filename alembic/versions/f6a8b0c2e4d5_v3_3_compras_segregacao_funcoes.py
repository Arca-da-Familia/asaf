"""v3.3 (FASE 3): contas a pagar, compras e segregacao de funcoes - dados_bancarios_fornecedor,
alcadas_aprovacao, delegacoes_aprovacao, solicitacoes_compra, cotacoes_compra, aprovacoes_compra,
reembolsos_despesa, contas_a_pagar_recorrentes; Fornecedor.situacao_cadastral; declaracoes_conflito_interesse.id_fornecedor;
titulos_financeiros.id_conta_a_pagar_recorrente

Revision ID: f6a8b0c2e4d5
Revises: e5f7a9c1d3b4
Create Date: 2026-09-17 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'f6a8b0c2e4d5'
down_revision: Union[str, Sequence[str], None] = 'e5f7a9c1d3b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("fornecedores") as batch_op:
        batch_op.add_column(sa.Column("situacao_cadastral", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("data_ultima_validacao_cadastral", sa.DateTime(), nullable=True))

    with op.batch_alter_table("declaracoes_conflito_interesse") as batch_op:
        batch_op.add_column(sa.Column(
            "id_fornecedor", sa.Integer(),
            sa.ForeignKey("fornecedores.id_fornecedor", name="fk_declaracoes_conflito_interesse_id_fornecedor"),
            nullable=True,
        ))

    op.create_table(
        "dados_bancarios_fornecedor",
        sa.Column("id_dados_bancarios", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_fornecedor", sa.Integer(), sa.ForeignKey("fornecedores.id_fornecedor"), nullable=False),
        sa.Column("banco", sa.String(), nullable=False),
        sa.Column("agencia", sa.String(), nullable=False),
        sa.Column("conta", sa.String(), nullable=False),
        sa.Column("tipo_conta", sa.String(), nullable=False),
        sa.Column("titular", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="Pendente"),
        sa.Column("id_usuario_solicitante", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("id_usuario_aprovador", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("motivo_rejeicao", sa.String(), nullable=True),
        sa.Column("data_solicitacao", sa.DateTime(), nullable=True),
        sa.Column("data_aprovacao", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "alcadas_aprovacao",
        sa.Column("id_alcada", sa.Integer(), primary_key=True, index=True),
        sa.Column("valor_minimo", sa.Numeric(14, 2), nullable=False),
        sa.Column("valor_maximo", sa.Numeric(14, 2), nullable=True),
        sa.Column("cargos_autorizados", sa.String(), nullable=False),
        sa.Column("exige_dupla_assinatura", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("ativo", sa.Boolean(), nullable=False, server_default=sa.true()),
    )

    op.create_table(
        "delegacoes_aprovacao",
        sa.Column("id_delegacao", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_associado_delegante", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False),
        sa.Column("id_associado_delegado", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False),
        sa.Column("data_inicio", sa.DateTime(), nullable=False),
        sa.Column("data_fim", sa.DateTime(), nullable=False),
        sa.Column("motivo", sa.String(), nullable=False),
        sa.Column("id_usuario_registro", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "solicitacoes_compra",
        sa.Column("id_solicitacao", sa.Integer(), primary_key=True, index=True),
        sa.Column("descricao", sa.String(), nullable=False),
        sa.Column("justificativa", sa.Text(), nullable=True),
        sa.Column("id_fornecedor", sa.Integer(), sa.ForeignKey("fornecedores.id_fornecedor"), nullable=True),
        sa.Column("valor_estimado", sa.Numeric(14, 2), nullable=False),
        sa.Column("id_conta_contabil", sa.Integer(), sa.ForeignKey("plano_de_contas.id_conta"), nullable=False),
        sa.Column("id_centro_custo", sa.Integer(), sa.ForeignKey("centros_de_custo.id_centro_custo"), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="Aguardando Cotação"),
        sa.Column("id_usuario_solicitante", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("motivo_reprovacao", sa.String(), nullable=True),
        sa.Column("id_titulo_gerado", sa.Integer(), sa.ForeignKey("titulos_financeiros.id_titulo"), nullable=True),
        sa.Column("data_solicitacao", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "cotacoes_compra",
        sa.Column("id_cotacao", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_solicitacao", sa.Integer(), sa.ForeignKey("solicitacoes_compra.id_solicitacao"), nullable=False),
        sa.Column("id_fornecedor", sa.Integer(), sa.ForeignKey("fornecedores.id_fornecedor"), nullable=False),
        sa.Column("valor", sa.Numeric(14, 2), nullable=False),
        sa.Column("anexo", sa.String(), nullable=True),
        sa.Column("id_usuario_registro", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("data_cotacao", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "aprovacoes_compra",
        sa.Column("id_aprovacao", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_solicitacao", sa.Integer(), sa.ForeignKey("solicitacoes_compra.id_solicitacao"), nullable=False),
        sa.Column("id_usuario_aprovador", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=False),
        sa.Column("id_associado_creditado", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=True),
        sa.Column("id_delegacao_usada", sa.Integer(), sa.ForeignKey("delegacoes_aprovacao.id_delegacao"), nullable=True),
        sa.Column("data_aprovacao", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("id_solicitacao", "id_usuario_aprovador", name="uq_aprovacao_por_solicitacao_e_usuario"),
    )

    op.create_table(
        "reembolsos_despesa",
        sa.Column("id_reembolso", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_associado", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False),
        sa.Column("descricao", sa.String(), nullable=False),
        sa.Column("valor", sa.Numeric(14, 2), nullable=False),
        sa.Column("comprovante", sa.String(), nullable=False),
        sa.Column("id_conta_contabil", sa.Integer(), sa.ForeignKey("plano_de_contas.id_conta"), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="Solicitado"),
        sa.Column("id_usuario_solicitante", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("id_usuario_aprovador", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("motivo_reprovacao", sa.String(), nullable=True),
        sa.Column("id_titulo_gerado", sa.Integer(), sa.ForeignKey("titulos_financeiros.id_titulo"), nullable=True),
        sa.Column("data_solicitacao", sa.DateTime(), nullable=True),
        sa.Column("data_aprovacao", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "contas_a_pagar_recorrentes",
        sa.Column("id_conta_recorrente", sa.Integer(), primary_key=True, index=True),
        sa.Column("descricao", sa.String(), nullable=False),
        sa.Column("valor", sa.Numeric(14, 2), nullable=False),
        sa.Column("id_conta_contabil", sa.Integer(), sa.ForeignKey("plano_de_contas.id_conta"), nullable=False),
        sa.Column("id_fornecedor", sa.Integer(), sa.ForeignKey("fornecedores.id_fornecedor"), nullable=True),
        sa.Column("dia_vencimento", sa.Integer(), nullable=False),
        sa.Column("ativo", sa.Boolean(), nullable=False, server_default=sa.true()),
    )

    with op.batch_alter_table("titulos_financeiros") as batch_op:
        batch_op.add_column(sa.Column(
            "id_conta_a_pagar_recorrente", sa.Integer(),
            sa.ForeignKey("contas_a_pagar_recorrentes.id_conta_recorrente", name="fk_titulos_financeiros_id_conta_a_pagar_recorrente"),
            nullable=True,
        ))
        batch_op.create_unique_constraint(
            "uq_titulo_conta_a_pagar_recorrente_por_competencia", ["id_conta_a_pagar_recorrente", "competencia"],
        )


def downgrade() -> None:
    with op.batch_alter_table("titulos_financeiros") as batch_op:
        batch_op.drop_constraint("uq_titulo_conta_a_pagar_recorrente_por_competencia", type_="unique")
        batch_op.drop_constraint("fk_titulos_financeiros_id_conta_a_pagar_recorrente", type_="foreignkey")
        batch_op.drop_column("id_conta_a_pagar_recorrente")

    op.drop_table("contas_a_pagar_recorrentes")
    op.drop_table("reembolsos_despesa")
    op.drop_table("aprovacoes_compra")
    op.drop_table("cotacoes_compra")
    op.drop_table("solicitacoes_compra")
    op.drop_table("delegacoes_aprovacao")
    op.drop_table("alcadas_aprovacao")
    op.drop_table("dados_bancarios_fornecedor")

    with op.batch_alter_table("declaracoes_conflito_interesse") as batch_op:
        batch_op.drop_constraint("fk_declaracoes_conflito_interesse_id_fornecedor", type_="foreignkey")
        batch_op.drop_column("id_fornecedor")

    with op.batch_alter_table("fornecedores") as batch_op:
        batch_op.drop_column("data_ultima_validacao_cadastral")
        batch_op.drop_column("situacao_cadastral")
