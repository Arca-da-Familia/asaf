"""v5.4b (FASE 5): cargos da diretoria alinhados ao Art. 19 (e ao Art. 24) do Estatuto

O catálogo `titulo_cargo` tinha "Vice-Presidente" único, "Diretor de Patrimônio", "Diretor Social" e "Conselho Fiscal" como
cargo. O Estatuto manda: Presidente, 1º e 2º Vice-Presidentes, 1º e 2º Secretários e 1º e 2º Tesoureiros (Art. 19) e o
Conselho Fiscal de três membros (Art. 24). Esta migração só mexe no CATÁLOGO, nunca no código do cargo (o banco, as
alçadas e os mandatos o referenciam e ele não muda):

  - reescreve o RÓTULO e a ORDEM dos cargos que já existem (VICE_PRESIDENTE vira "1º Vice-Presidente",
    SECRETARIO "1º Secretário", VICE_SECRETARIO "2º Secretário", TESOUREIRO "1º Tesoureiro", VICE_TESOUREIRO "2º
    Tesoureiro", CONSELHO_FISCAL "Conselheiro Fiscal");
  - cria VICE_PRESIDENTE_2 ("2º Vice-Presidente") com as MESMAS permissões que o VICE_PRESIDENTE tem hoje (inclusive o que a
    diretoria tenha ajustado);
  - INATIVA DIRETOR_DE_PATRIMONIO e DIRETOR_SOCIAL (não existem no Estatuto): nenhum mandato é apagado nem perde a
    permissão, só não dá para criar mandato novo nesses cargos.

As permissões de cada cargo NÃO mudam. Banco novo recebe o mesmo resultado por `seed_catalogos` (app/database.py).

Revision ID: d3f7a9c2e154
Revises: b5e2d8f1a436
Create Date: 2026-10-04 15:00:00

"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd3f7a9c2e154'
down_revision: Union[str, Sequence[str], None] = 'b5e2d8f1a436'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# codigo -> (rótulo novo, ordem nova, rótulo antigo, ordem antiga)
_CARGOS = {
    "PRESIDENTE": ("Presidente", 0, "Presidente", 0),
    "VICE_PRESIDENTE": ("1º Vice-Presidente", 1, "Vice-Presidente", 1),
    "SECRETARIO": ("1º Secretário", 3, "Secretário", 4),
    "VICE_SECRETARIO": ("2º Secretário", 4, "Vice-Secretário", 5),
    "TESOUREIRO": ("1º Tesoureiro", 5, "Tesoureiro", 2),
    "VICE_TESOUREIRO": ("2º Tesoureiro", 6, "Vice-Tesoureiro", 3),
    "CONSELHO_FISCAL": ("Conselheiro Fiscal", 7, "Conselho Fiscal", 6),
}
_FORA_DO_ESTATUTO = ("DIRETOR_DE_PATRIMONIO", "DIRETOR_SOCIAL")
_NOVO = ("VICE_PRESIDENTE_2", "2º Vice-Presidente", 2)


def _tabelas():
    catalogos = sa.table("catalogos", sa.column("id_catalogo", sa.Integer), sa.column("chave", sa.String))
    opcoes = sa.table(
        "opcoes_catalogo", sa.column("id_opcao", sa.Integer), sa.column("id_catalogo", sa.Integer), sa.column("codigo", sa.String),
        sa.column("rotulo", sa.String), sa.column("ordem", sa.Integer), sa.column("ativo", sa.Boolean), sa.column("metadados", sa.JSON()),
    )
    return catalogos, opcoes


def _id_do_catalogo(bind, catalogos):
    linha = bind.execute(sa.select(catalogos.c.id_catalogo).where(catalogos.c.chave == "titulo_cargo")).first()
    return linha.id_catalogo if linha else None


def _como_dicionario(metadados) -> dict | None:
    if metadados is None:
        return None
    if isinstance(metadados, str):
        metadados = json.loads(metadados)
    return dict(metadados)


def upgrade() -> None:
    bind = op.get_bind()
    catalogos, opcoes = _tabelas()
    id_catalogo = _id_do_catalogo(bind, catalogos)
    if id_catalogo is None:
        return  # banco sem o catálogo: o seed já nasce com os cargos novos

    for codigo, (rotulo, ordem, _antigo, _ordem_antiga) in _CARGOS.items():
        bind.execute(opcoes.update().where(opcoes.c.id_catalogo == id_catalogo, opcoes.c.codigo == codigo).values(rotulo=rotulo, ordem=ordem))

    codigo_novo, rotulo_novo, ordem_nova = _NOVO
    ja_existe = bind.execute(sa.select(opcoes.c.id_opcao).where(opcoes.c.id_catalogo == id_catalogo, opcoes.c.codigo == codigo_novo)).first()
    if not ja_existe:
        primeiro = bind.execute(
            sa.select(opcoes.c.metadados).where(opcoes.c.id_catalogo == id_catalogo, opcoes.c.codigo == "VICE_PRESIDENTE")
        ).first()
        metadados = _como_dicionario(primeiro.metadados) if primeiro else {"permissoes": ["associados", "governanca"]}
        bind.execute(opcoes.insert().values(
            id_catalogo=id_catalogo, codigo=codigo_novo, rotulo=rotulo_novo, ordem=ordem_nova, ativo=True, metadados=metadados,
        ))

    bind.execute(opcoes.update().where(opcoes.c.id_catalogo == id_catalogo, opcoes.c.codigo.in_(_FORA_DO_ESTATUTO)).values(ativo=False))


def downgrade() -> None:
    bind = op.get_bind()
    catalogos, opcoes = _tabelas()
    id_catalogo = _id_do_catalogo(bind, catalogos)
    if id_catalogo is None:
        return
    for codigo, (_rotulo, _ordem, antigo, ordem_antiga) in _CARGOS.items():
        bind.execute(opcoes.update().where(opcoes.c.id_catalogo == id_catalogo, opcoes.c.codigo == codigo).values(rotulo=antigo, ordem=ordem_antiga))
    bind.execute(opcoes.update().where(opcoes.c.id_catalogo == id_catalogo, opcoes.c.codigo.in_(_FORA_DO_ESTATUTO)).values(ativo=True))
    # O 2º Vice-Presidente só some se NINGUÉM o usa: mandato já gravado com esse código não pode ficar sem cargo.
    em_uso = bind.execute(sa.text("SELECT 1 FROM mandatos WHERE cargo_codigo = :c LIMIT 1"), {"c": _NOVO[0]}).first()
    if not em_uso:
        bind.execute(opcoes.delete().where(opcoes.c.id_catalogo == id_catalogo, opcoes.c.codigo == _NOVO[0]))
