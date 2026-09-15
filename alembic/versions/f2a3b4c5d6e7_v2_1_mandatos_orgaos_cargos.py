"""v2.1 (FASE 2): mandatos, declaracoes_conflito_interesse, metadados de cargo/categoria

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-09-15 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'f2a3b4c5d6e7'
down_revision: Union[str, Sequence[str], None] = 'e1f2a3b4c5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# metadados["permissoes"] por código de titulo_cargo (mesmos valores de seed_catalogos) e
# metadados["vantagens"] por código de categoria_associado - aplicado aqui via UPDATE porque os
# dois catálogos já existem em produção (seed_catalogos só semeia catálogo que ainda não existe).
_PERMISSOES_POR_CARGO = {
    "PRESIDENTE": ["gerenciar_acesso", "associados", "financeiro", "governanca", "projetos", "auditoria"],
    "VICE_PRESIDENTE": ["associados", "governanca"],
    "TESOUREIRO": ["financeiro"],
    "VICE_TESOUREIRO": ["financeiro"],
    "SECRETARIO": ["associados", "governanca"],
    "VICE_SECRETARIO": ["associados"],
    "CONSELHO_FISCAL": ["financeiro", "auditoria"],
    "DIRETOR_SOCIAL": ["projetos"],
}
_VANTAGENS_POR_CATEGORIA = {
    "EFETIVO": "Direito a voto e a ser votado; acesso pleno aos benefícios e projetos da ASAF.",
    "CONTRIBUINTE": "Apoia financeiramente sem os direitos políticos de associado efetivo (ajustável pela diretoria).",
    "FUNDADOR": "Mesmos direitos do associado efetivo, com reconhecimento histórico de fundador da ASAF.",
}


def upgrade() -> None:
    op.create_table(
        "mandatos",
        sa.Column("id_mandato", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_associado", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False, index=True),
        sa.Column("orgao_codigo", sa.String(length=50), nullable=False, index=True),
        sa.Column("cargo_codigo", sa.String(length=50), nullable=False, index=True),
        sa.Column("data_inicio", sa.DateTime(), nullable=False),
        sa.Column("data_fim_previsto", sa.DateTime(), nullable=False),
        sa.Column("data_fim_efetivo", sa.DateTime(), nullable=True),
        sa.Column("motivo_encerramento", sa.String(length=50), nullable=True),
        sa.Column("ato_origem", sa.String(), nullable=True),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "declaracoes_conflito_interesse",
        sa.Column("id_declaracao", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_associado", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False, index=True),
        sa.Column("descricao", sa.String(), nullable=False),
        sa.Column("ativa", sa.Boolean(), server_default=sa.true()),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )

    bind = op.get_bind()
    catalogos = sa.table("catalogos", sa.column("id_catalogo", sa.Integer), sa.column("chave", sa.String))
    opcoes = sa.table(
        "opcoes_catalogo", sa.column("id_opcao", sa.Integer), sa.column("id_catalogo", sa.Integer),
        sa.column("codigo", sa.String), sa.column("metadados", sa.JSON()),
    )

    catalogo_cargo = bind.execute(sa.select(catalogos.c.id_catalogo).where(catalogos.c.chave == "titulo_cargo")).first()
    if catalogo_cargo:
        for codigo, permissoes in _PERMISSOES_POR_CARGO.items():
            bind.execute(
                opcoes.update()
                .where(opcoes.c.id_catalogo == catalogo_cargo.id_catalogo, opcoes.c.codigo == codigo)
                .values(metadados={"permissoes": permissoes})
            )

    catalogo_categoria = bind.execute(sa.select(catalogos.c.id_catalogo).where(catalogos.c.chave == "categoria_associado")).first()
    if catalogo_categoria:
        for codigo, vantagens in _VANTAGENS_POR_CATEGORIA.items():
            bind.execute(
                opcoes.update()
                .where(opcoes.c.id_catalogo == catalogo_categoria.id_catalogo, opcoes.c.codigo == codigo)
                .values(metadados={"vantagens": vantagens})
            )


def downgrade() -> None:
    op.drop_table("declaracoes_conflito_interesse")
    op.drop_table("mandatos")
