"""v7.3a (FASE 7): a permissão `ver_cpf_completo` - o CPF escondido em toda lista e ficha; o completo só por clique registrado na Auditoria

Decisão do Presidente (2026-10-29): o CPF completo só para quem tem tarefa que precisa dele - o Presidente, os Secretários (cadastro e filiação) e os Tesoureiros
(o recibo de doação leva o CPF do doador); quem atende a solicitação do titular vê o CPF daquele pedido (isso é regra do pedido, não desta permissão). Os
Vice-Presidentes e o Conselho Fiscal veem sempre escondido.

NOS BANCOS QUE JÁ EXISTEM esta migração faz o que o semeador não faz (ele nunca mexe nos cargos de um catálogo que já existe):
  1. garante a permissão `ver_cpf_completo` (módulo `associados`);
  2. dá a permissão a todo nível de acesso que tem `gerenciar_acesso` (a Presidência);
  3. no catálogo `titulo_cargo`: aos cargos PRESIDENTE, SECRETARIO, VICE_SECRETARIO, TESOUREIRO e VICE_TESOUREIRO.
Nenhuma outra permissão, nível ou cargo é tocado; nenhuma tabela muda. O `downgrade` retira a permissão de tudo e a apaga.

Revision ID: a73c9f1e5b20
Revises: 12f16313d972
Create Date: 2026-10-30 15:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'a73c9f1e5b20'
down_revision: Union[str, Sequence[str], None] = '12f16313d972'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

_permissoes = sa.table(
    "permissoes_sistema", sa.column("id_permissao", sa.Integer), sa.column("modulo", sa.String), sa.column("codigo_permissao", sa.String), sa.column("descricao", sa.String),
)
_perfil = sa.table("perfil_permissao", sa.column("id_nivel", sa.Integer), sa.column("id_permissao", sa.Integer))
_catalogos = sa.table("catalogos", sa.column("id_catalogo", sa.Integer), sa.column("chave", sa.String))
_opcoes = sa.table("opcoes_catalogo", sa.column("id_opcao", sa.Integer), sa.column("id_catalogo", sa.Integer), sa.column("codigo", sa.String), sa.column("metadados", _JSON))

BASE = "gerenciar_acesso"
CODIGO = "ver_cpf_completo"
DESCRICAO = ("Ver o CPF completo por clique em \"Mostrar o CPF\", registrado na Auditoria (v7.3a - nas listas e fichas o CPF aparece sempre escondido; "
             "decisão do Presidente: Presidente, Secretários e Tesoureiros).")
CARGOS = ("PRESIDENTE", "SECRETARIO", "VICE_SECRETARIO", "TESOUREIRO", "VICE_TESOUREIRO")


def _id_da_permissao(conexao, codigo: str):
    return conexao.execute(sa.select(_permissoes.c.id_permissao).where(_permissoes.c.codigo_permissao == codigo)).scalar()


def _cargos(conexao):
    id_catalogo = conexao.execute(sa.select(_catalogos.c.id_catalogo).where(_catalogos.c.chave == "titulo_cargo")).scalar()
    if id_catalogo is None:
        return []
    achados = conexao.execute(sa.select(_opcoes.c.id_opcao, _opcoes.c.codigo, _opcoes.c.metadados).where(_opcoes.c.id_catalogo == id_catalogo)).all()
    return [a for a in achados if isinstance(a.metadados, dict)]


def _trocar_permissoes_do_cargo(conexao, cargo, novas: list[str]) -> None:
    conexao.execute(sa.update(_opcoes).where(_opcoes.c.id_opcao == cargo.id_opcao).values(metadados={**cargo.metadados, "permissoes": novas}))


def upgrade() -> None:
    conexao = op.get_bind()
    id_base = _id_da_permissao(conexao, BASE)
    niveis = [linha.id_nivel for linha in conexao.execute(sa.select(_perfil.c.id_nivel).where(_perfil.c.id_permissao == id_base)).all()] if id_base is not None else []
    id_nova = _id_da_permissao(conexao, CODIGO)
    if id_nova is None:
        conexao.execute(sa.insert(_permissoes).values(modulo="associados", codigo_permissao=CODIGO, descricao=DESCRICAO))
        id_nova = _id_da_permissao(conexao, CODIGO)
    for id_nivel in niveis:
        ja_tem = conexao.execute(sa.select(_perfil.c.id_nivel).where(_perfil.c.id_nivel == id_nivel, _perfil.c.id_permissao == id_nova)).first()
        if ja_tem is None:
            conexao.execute(sa.insert(_perfil).values(id_nivel=id_nivel, id_permissao=id_nova))
    for cargo in _cargos(conexao):
        atuais = list(cargo.metadados.get("permissoes") or [])
        if cargo.codigo in CARGOS and CODIGO not in atuais:
            _trocar_permissoes_do_cargo(conexao, cargo, [*atuais, CODIGO])


def downgrade() -> None:
    conexao = op.get_bind()
    for cargo in _cargos(conexao):
        atuais = list(cargo.metadados.get("permissoes") or [])
        if CODIGO in atuais:
            _trocar_permissoes_do_cargo(conexao, cargo, [p for p in atuais if p != CODIGO])
    id_nova = _id_da_permissao(conexao, CODIGO)
    if id_nova is not None:
        conexao.execute(sa.delete(_perfil).where(_perfil.c.id_permissao == id_nova))
        conexao.execute(sa.delete(_permissoes).where(_permissoes.c.id_permissao == id_nova))
