"""v5.4a (FASE 5): biblioteca de documentos institucionais + permissões dos cargos (Presidente e Secretário aprovam)

Cria `documentos_institucionais` (original privado + versão pública + classificação + situação de publicação) e
ACRESCENTA, no metadado `permissoes` dos cargos que já existem em produção, os códigos novos
(`documentos`, `documentos_originais`, `aprovar_publicacao`, `parcerias`). `seed_catalogos` só semeia catálogo que
ainda não existe, então banco novo (seed) e banco existente (esta migração) têm que chegar no MESMO resultado.

Só acrescenta: nunca remove permissão que a diretoria já tenha ajustado.

Revision ID: a7c1e9d3f0b2
Revises: c3f8a1d07b94
Create Date: 2026-10-04 00:00:00

"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a7c1e9d3f0b2'
down_revision: Union[str, Sequence[str], None] = 'c3f8a1d07b94'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Mesmos valores de seed_catalogos (app/database.py): PRESIDENTE e SECRETARIO aprovam publicação.
_ACRESCENTAR_POR_CARGO = {
    "PRESIDENTE": ["documentos", "documentos_originais", "aprovar_publicacao", "parcerias"],
    "SECRETARIO": ["documentos", "documentos_originais", "aprovar_publicacao"],
    "VICE_SECRETARIO": ["documentos"],
    "TESOUREIRO": ["parcerias"],
    "VICE_TESOUREIRO": ["parcerias"],
}


def _como_dicionario(metadados) -> dict:
    if metadados is None:
        return {}
    if isinstance(metadados, str):
        metadados = json.loads(metadados)
    return dict(metadados)


def upgrade() -> None:
    op.create_table(
        "documentos_institucionais",
        sa.Column("id_documento", sa.Integer(), primary_key=True),
        sa.Column("tipo", sa.String(length=30), nullable=False),
        sa.Column("titulo", sa.String(length=200), nullable=False),
        sa.Column("descricao", sa.Text(), nullable=True),
        sa.Column("data_documento", sa.Date(), nullable=True),
        sa.Column("ano", sa.Integer(), nullable=True),
        sa.Column("validade", sa.Date(), nullable=True),
        sa.Column("classificacao", sa.String(length=10), nullable=False),
        sa.Column("publicar_no_site", sa.Boolean(), nullable=False),
        sa.Column("vinculo_tipo", sa.String(length=20), nullable=True),
        sa.Column("vinculo_id", sa.Integer(), nullable=True),
        sa.Column("grupo_versao", sa.String(length=32), nullable=False),
        sa.Column("versao", sa.Integer(), nullable=False),
        sa.Column("vigente", sa.Boolean(), nullable=False),
        sa.Column("original_nome", sa.String(length=150), nullable=True),
        sa.Column("original_nome_arquivo", sa.String(length=200), nullable=True),
        sa.Column("original_sha256", sa.String(length=64), nullable=True),
        sa.Column("original_tamanho", sa.Integer(), nullable=True),
        sa.Column("publico_nome", sa.String(length=150), nullable=True),
        sa.Column("publico_sha256", sa.String(length=64), nullable=True),
        sa.Column("publico_tamanho", sa.Integer(), nullable=True),
        sa.Column("publico_paginas", sa.Integer(), nullable=True),
        sa.Column("publico_texto", sa.Text(), nullable=True),
        sa.Column("verificacao_ok", sa.Boolean(), nullable=True),
        sa.Column("verificacao_json", sa.Text(), nullable=True),
        sa.Column("verificacao_em", sa.DateTime(), nullable=True),
        sa.Column("situacao", sa.String(length=15), nullable=False),
        sa.Column("id_usuario_envio_revisao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("enviado_revisao_em", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_aprovacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("aprovado_em", sa.DateTime(), nullable=True),
        sa.Column("motivo_recusa", sa.Text(), nullable=True),
        sa.Column("id_usuario_recusa", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("recusado_em", sa.DateTime(), nullable=True),
        sa.Column("motivo_retirada", sa.Text(), nullable=True),
        sa.Column("id_usuario_retirada", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("retirado_em", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
        sa.Column("atualizado_em", sa.DateTime(), nullable=True),
    )
    for coluna in ("id_documento", "tipo", "ano", "classificacao", "vinculo_tipo", "vinculo_id", "grupo_versao", "vigente", "situacao"):
        op.create_index(f"ix_documentos_institucionais_{coluna}", "documentos_institucionais", [coluna])

    bind = op.get_bind()
    catalogos = sa.table("catalogos", sa.column("id_catalogo", sa.Integer), sa.column("chave", sa.String))
    opcoes = sa.table(
        "opcoes_catalogo", sa.column("id_opcao", sa.Integer), sa.column("id_catalogo", sa.Integer),
        sa.column("codigo", sa.String), sa.column("metadados", sa.JSON()),
    )
    catalogo = bind.execute(sa.select(catalogos.c.id_catalogo).where(catalogos.c.chave == "titulo_cargo")).first()
    if not catalogo:
        return
    for codigo, acrescentar in _ACRESCENTAR_POR_CARGO.items():
        linha = bind.execute(
            sa.select(opcoes.c.id_opcao, opcoes.c.metadados).where(opcoes.c.id_catalogo == catalogo.id_catalogo, opcoes.c.codigo == codigo)
        ).first()
        if linha is None:
            continue
        metadados = _como_dicionario(linha.metadados)
        atuais = list(metadados.get("permissoes", []))
        novas = atuais + [p for p in acrescentar if p not in atuais]
        if novas != atuais:
            metadados["permissoes"] = novas
            bind.execute(opcoes.update().where(opcoes.c.id_opcao == linha.id_opcao).values(metadados=metadados))


def downgrade() -> None:
    # As permissões acrescentadas aos cargos ficam (acrescentar é seguro; remover poderia tirar acesso que a
    # diretoria ajustou depois). Só a tabela sai.
    for coluna in ("situacao", "vigente", "grupo_versao", "vinculo_id", "vinculo_tipo", "classificacao", "ano", "tipo", "id_documento"):
        op.drop_index(f"ix_documentos_institucionais_{coluna}", table_name="documentos_institucionais")
    op.drop_table("documentos_institucionais")
