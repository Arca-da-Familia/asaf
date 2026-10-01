"""v4.10 (FASE 4): painel gerencial e avaliação - pesquisa de satisfação pós-evento (nova tabela)
e dois códigos de catálogo novos pro indicador calculado que ela alimenta (a unidade "nota de 0 a
10" e a periodicidade "por evento" não existiam em nenhum catálogo anterior)

Revision ID: 85a120a27eb7
Revises: 5c3d174cb796
Create Date: 2026-09-30 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '85a120a27eb7'
down_revision: Union[str, Sequence[str], None] = '5c3d174cb796'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "respostas_pesquisa_satisfacao",
        sa.Column("id_resposta", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_evento", sa.Integer(), sa.ForeignKey("eventos.id_evento"), nullable=False, index=True),
        sa.Column("id_inscricao", sa.Integer(), sa.ForeignKey("inscricoes.id_inscricao"), nullable=False),
        sa.Column("token", sa.String(), nullable=False),
        sa.Column("nota", sa.Integer(), nullable=True),
        sa.Column("comentario", sa.Text(), nullable=True),
        sa.Column("enviado_em", sa.DateTime(), nullable=True),
        sa.Column("respondido_em", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("id_evento", "id_inscricao", name="uq_pesquisa_satisfacao_evento_inscricao"),
    )
    op.create_index("ix_respostas_pesquisa_satisfacao_token", "respostas_pesquisa_satisfacao", ["token"], unique=True)

    # v4.10 - dois códigos novos em catálogos que já existem em produção desde a v4.0 - o seed em
    # app/database.py só roda pra catálogo NOVO (pula se a chave já existe), então uma opção nova
    # numa lista de catálogo já semeada só chega em produção inserida aqui, na migração (mesmo
    # padrão já usado na migração `5278bf9ee537`, v3.1).
    opcoes_catalogo = sa.table(
        "opcoes_catalogo",
        sa.column("id_opcao", sa.Integer()),
        sa.column("codigo", sa.String()),
        sa.column("id_catalogo", sa.Integer()),
        sa.column("rotulo", sa.String()),
        sa.column("ordem", sa.Integer()),
    )
    catalogos = sa.table("catalogos", sa.column("id_catalogo", sa.Integer()), sa.column("chave", sa.String()))
    conexao = op.get_bind()

    def _adicionar_opcao_se_faltando(chave_catalogo: str, codigo: str, rotulo: str) -> None:
        linha_catalogo = conexao.execute(sa.select(catalogos.c.id_catalogo).where(catalogos.c.chave == chave_catalogo)).first()
        if not linha_catalogo:
            return
        ja_existe = conexao.execute(
            sa.select(opcoes_catalogo.c.id_opcao)
            .where(opcoes_catalogo.c.id_catalogo == linha_catalogo.id_catalogo)
            .where(opcoes_catalogo.c.codigo == codigo)
        ).first()
        if ja_existe:
            return
        maior_ordem = conexao.execute(
            sa.select(sa.func.max(opcoes_catalogo.c.ordem)).where(opcoes_catalogo.c.id_catalogo == linha_catalogo.id_catalogo)
        ).scalar()
        conexao.execute(
            opcoes_catalogo.insert().values(
                id_catalogo=linha_catalogo.id_catalogo, codigo=codigo, rotulo=rotulo, ordem=(maior_ordem or 0) + 1,
            )
        )

    _adicionar_opcao_se_faltando("unidade_medida_indicador", "NOTA_0_A_10", "Nota (0 a 10)")
    _adicionar_opcao_se_faltando("periodicidade_indicador", "POR_EVENTO", "Por evento")


def downgrade() -> None:
    opcoes_catalogo = sa.table("opcoes_catalogo", sa.column("codigo", sa.String()), sa.column("id_catalogo", sa.Integer()))
    catalogos = sa.table("catalogos", sa.column("id_catalogo", sa.Integer()), sa.column("chave", sa.String()))
    conexao = op.get_bind()

    for chave_catalogo, codigo in (("unidade_medida_indicador", "NOTA_0_A_10"), ("periodicidade_indicador", "POR_EVENTO")):
        linha_catalogo = conexao.execute(sa.select(catalogos.c.id_catalogo).where(catalogos.c.chave == chave_catalogo)).first()
        if linha_catalogo:
            conexao.execute(
                opcoes_catalogo.delete()
                .where(opcoes_catalogo.c.id_catalogo == linha_catalogo.id_catalogo)
                .where(opcoes_catalogo.c.codigo == codigo)
            )

    op.drop_index("ix_respostas_pesquisa_satisfacao_token", table_name="respostas_pesquisa_satisfacao")
    op.drop_table("respostas_pesquisa_satisfacao")
