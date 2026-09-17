"""v3.1 (FASE 3): plano de contas hierarquico (codigo_contabil_pai), CentroDeCusto,
ContaFinanceira, data_competencia/comprovante em LancamentoContabil, id_centro_custo em
PartidaContabil

Revision ID: 5278bf9ee537
Revises: 75fa21fb920d
Create Date: 2026-09-17 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = '5278bf9ee537'
down_revision: Union[str, Sequence[str], None] = '75fa21fb920d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TipoJson = JSONB().with_variant(sa.JSON(), "sqlite")


def upgrade() -> None:
    with op.batch_alter_table("plano_de_contas") as batch_op:
        batch_op.add_column(sa.Column(
            "codigo_contabil_pai", sa.String(),
            sa.ForeignKey("plano_de_contas.codigo_contabil", name="fk_plano_de_contas_codigo_contabil_pai"),
            nullable=True,
        ))

    op.create_table(
        "centros_de_custo",
        sa.Column("id_centro_custo", sa.Integer(), primary_key=True, index=True),
        sa.Column("codigo", sa.String(), nullable=False, unique=True, index=True),
        sa.Column("nome", sa.String(), nullable=False),
        sa.Column("id_projeto", sa.Integer(), sa.ForeignKey("projetos_eventos.id_projeto"), nullable=True),
        sa.Column("ativo", sa.Boolean(), nullable=False, server_default=sa.true()),
    )

    op.create_table(
        "contas_financeiras",
        sa.Column("id_conta_financeira", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_conta", sa.Integer(), sa.ForeignKey("plano_de_contas.id_conta"), nullable=False, unique=True),
        sa.Column("tipo_conta_financeira", sa.String(), nullable=False),
        sa.Column("banco", sa.String(), nullable=True),
        sa.Column("agencia", sa.String(), nullable=True),
        sa.Column("numero_conta", sa.String(), nullable=True),
        sa.Column("ativo", sa.Boolean(), nullable=False, server_default=sa.true()),
    )

    with op.batch_alter_table("partidas_contabeis") as batch_op:
        batch_op.add_column(sa.Column(
            "id_centro_custo", sa.Integer(),
            sa.ForeignKey("centros_de_custo.id_centro_custo", name="fk_partidas_contabeis_id_centro_custo"),
            nullable=True,
        ))

    with op.batch_alter_table("lancamentos_contabeis") as batch_op:
        batch_op.add_column(sa.Column("data_competencia", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("comprovante", sa.String(), nullable=True))

    # v3.1 - backfill: lançamento pré-v3.1 nunca distinguiu competência de caixa - trata como
    # iguais (mesma data de sempre), nunca deixa data_competencia nula num lançamento já gravado.
    op.execute("UPDATE lancamentos_contabeis SET data_competencia = data_lancamento WHERE data_competencia IS NULL")

    # v3.1 - "anexo de comprovante obrigatório por tipo de lançamento (configurável)": liga o
    # flag por padrão na opção DESPESA do catálogo `tipo_conta_contabil` que já existe em
    # produção (o seed em app/database.py só roda pra catálogo novo, nunca reescreve o que já
    # existe) - sem isso a produção ficaria sem a trava até alguém entrar no admin de catálogos
    # e ligar manualmente.
    # v3.1 - lido em Python (não via `WHERE metadados IS NULL`): a coluna JSON grava `None` como
    # o literal JSON "null", não SQL NULL (comportamento padrão do tipo JSON/JSONB do
    # SQLAlchemy sem `none_as_null`) - uma comparação SQL direta contra NULL nunca bateria com o
    # que o seed original gravou.
    opcoes_catalogo = sa.table(
        "opcoes_catalogo",
        sa.column("id_opcao", sa.Integer()),
        sa.column("codigo", sa.String()),
        sa.column("id_catalogo", sa.Integer()),
        sa.column("metadados", _TipoJson),
    )
    catalogos = sa.table("catalogos", sa.column("id_catalogo", sa.Integer()), sa.column("chave", sa.String()))
    conexao = op.get_bind()
    linha_catalogo = conexao.execute(sa.select(catalogos.c.id_catalogo).where(catalogos.c.chave == "tipo_conta_contabil")).first()
    if linha_catalogo:
        linha_despesa = conexao.execute(
            sa.select(opcoes_catalogo.c.id_opcao, opcoes_catalogo.c.metadados)
            .where(opcoes_catalogo.c.id_catalogo == linha_catalogo.id_catalogo)
            .where(opcoes_catalogo.c.codigo == "DESPESA")
        ).first()
        if linha_despesa and not linha_despesa.metadados:
            conexao.execute(
                opcoes_catalogo.update()
                .where(opcoes_catalogo.c.id_opcao == linha_despesa.id_opcao)
                .values(metadados={"exige_comprovante": True})
            )


def downgrade() -> None:
    with op.batch_alter_table("lancamentos_contabeis") as batch_op:
        batch_op.drop_column("comprovante")
        batch_op.drop_column("data_competencia")

    with op.batch_alter_table("partidas_contabeis") as batch_op:
        batch_op.drop_column("id_centro_custo")

    op.drop_table("contas_financeiras")
    op.drop_table("centros_de_custo")

    with op.batch_alter_table("plano_de_contas") as batch_op:
        batch_op.drop_column("codigo_contabil_pai")
