"""v9.6a: a cobrança respeita a periodicidade (mensal e semestral)

Decisão do Presidente (21/11/2026): a associação tem os planos MENSAL e SEMESTRAL; cada associado escolhe o seu; o semestral é cobrado em
janeiro e julho, com valor próprio. Esta migração:
- acrescenta `associados.periodicidade_contribuicao` (a escolha de cada um; todos começam em "Mensal", que é o que já se cobrava);
- acrescenta `planos_contribuicao.id_conta_contabil_receita_diferida` (a conta de Passivo onde o título do semestre entra antes de virar
  receita mês a mês; obrigatória só para plano que não é mensal);
- acrescenta a opção "Semestral" ao catálogo `periodicidade_contribuicao`, se ele existir e ainda não a tiver.
Nenhum valor, plano ou título existente muda.

Revision ID: a9c3e5f7b1d2
Revises: e7b3d1a9c5f2
Create Date: 2026-11-21 14:30:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a9c3e5f7b1d2'
down_revision: Union[str, Sequence[str], None] = 'e7b3d1a9c5f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_catalogos = sa.table("catalogos", sa.column("id_catalogo", sa.Integer), sa.column("chave", sa.String))
_opcoes = sa.table(
    "opcoes_catalogo",
    sa.column("id_opcao", sa.Integer), sa.column("id_catalogo", sa.Integer), sa.column("codigo", sa.String),
    sa.column("rotulo", sa.String), sa.column("ordem", sa.Integer), sa.column("ativo", sa.Boolean),
)


def upgrade() -> None:
    with op.batch_alter_table("associados") as tabela:
        tabela.add_column(sa.Column("periodicidade_contribuicao", sa.String(), nullable=False, server_default="Mensal"))
    with op.batch_alter_table("planos_contribuicao") as tabela:
        tabela.add_column(sa.Column("id_conta_contabil_receita_diferida", sa.Integer(), nullable=True))
        tabela.create_foreign_key(
            "fk_planos_contribuicao_conta_receita_diferida", "plano_de_contas",
            ["id_conta_contabil_receita_diferida"], ["id_conta"],
        )

    conexao = op.get_bind()
    id_catalogo = conexao.execute(
        sa.select(_catalogos.c.id_catalogo).where(_catalogos.c.chave == "periodicidade_contribuicao")
    ).scalar()
    if id_catalogo is None:
        return  # banco sem o catálogo: o seed (app/database.py) já o cria com "Semestral"
    ja_tem = conexao.execute(
        sa.select(_opcoes.c.id_opcao).where(_opcoes.c.id_catalogo == id_catalogo, _opcoes.c.codigo == "SEMESTRAL")
    ).scalar()
    if ja_tem is not None:
        return
    maior_ordem = conexao.execute(
        sa.select(sa.func.max(_opcoes.c.ordem)).where(_opcoes.c.id_catalogo == id_catalogo)
    ).scalar()
    conexao.execute(_opcoes.insert().values(
        id_catalogo=id_catalogo, codigo="SEMESTRAL", rotulo="Semestral", ordem=(maior_ordem or 0) + 1, ativo=True,
    ))


def downgrade() -> None:
    conexao = op.get_bind()
    id_catalogo = conexao.execute(
        sa.select(_catalogos.c.id_catalogo).where(_catalogos.c.chave == "periodicidade_contribuicao")
    ).scalar()
    if id_catalogo is not None:
        conexao.execute(_opcoes.delete().where(_opcoes.c.id_catalogo == id_catalogo, _opcoes.c.codigo == "SEMESTRAL"))
    with op.batch_alter_table("planos_contribuicao") as tabela:
        tabela.drop_constraint("fk_planos_contribuicao_conta_receita_diferida", type_="foreignkey")
        tabela.drop_column("id_conta_contabil_receita_diferida")
    with op.batch_alter_table("associados") as tabela:
        tabela.drop_column("periodicidade_contribuicao")
