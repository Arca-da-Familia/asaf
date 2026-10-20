"""v5.7g (FASE 5): o atalho "Editar o site" tem permissão própria (`editar_site`)

Até aqui o atalho do painel para o Directus aparecia para quem tinha `gerenciar_acesso` (a Presidência), porque não havia permissão melhor. Agora existe `editar_site`: a secretaria ou a comunicação
pode recebê-la pela tela Níveis e permissões sem ganhar nenhum poder sobre o acesso do sistema. Quem era do atalho continua sendo (nada some).

Esta migração, NOS BANCOS QUE JÁ EXISTEM (o semeador do sistema só acrescenta, nunca concede a níveis que já existem):
  1. garante a permissão `editar_site`;
  2. dá `editar_site` a todo nível de acesso que tem `gerenciar_acesso`;
  3. acrescenta `editar_site` a todo cargo do catálogo `titulo_cargo` cujas permissões incluem `gerenciar_acesso` (o cargo concede permissões enquanto o mandato vale).
Nenhuma outra permissão, nível ou cargo é tocado. O `downgrade` retira `editar_site` de tudo e apaga a permissão.

Revision ID: c4a8e2f6d913
Revises: b9e2c5a7d014
Create Date: 2026-10-19 21:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'c4a8e2f6d913'
down_revision: Union[str, Sequence[str], None] = 'b9e2c5a7d014'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

_permissoes = sa.table(
    "permissoes_sistema", sa.column("id_permissao", sa.Integer), sa.column("modulo", sa.String), sa.column("codigo_permissao", sa.String), sa.column("descricao", sa.String),
)
_perfil = sa.table("perfil_permissao", sa.column("id_nivel", sa.Integer), sa.column("id_permissao", sa.Integer))
_catalogos = sa.table("catalogos", sa.column("id_catalogo", sa.Integer), sa.column("chave", sa.String))
_opcoes = sa.table("opcoes_catalogo", sa.column("id_opcao", sa.Integer), sa.column("id_catalogo", sa.Integer), sa.column("codigo", sa.String), sa.column("metadados", _JSON))

NOVA = "editar_site"
BASE = "gerenciar_acesso"
DESCRICAO = (
    'Abrir o editor do site (Directus) pelo atalho "Editar o site" do painel (v5.7g). É só o atalho: o que cada pessoa pode mudar lá é decidido pelo papel dela no próprio Directus.'
)


def _id_da_permissao(conexao, codigo: str):
    return conexao.execute(sa.select(_permissoes.c.id_permissao).where(_permissoes.c.codigo_permissao == codigo)).scalar()


def _cargos_com(conexao, codigo: str):
    id_catalogo = conexao.execute(sa.select(_catalogos.c.id_catalogo).where(_catalogos.c.chave == "titulo_cargo")).scalar()
    if id_catalogo is None:
        return []
    achados = conexao.execute(sa.select(_opcoes.c.id_opcao, _opcoes.c.metadados).where(_opcoes.c.id_catalogo == id_catalogo)).all()
    return [a for a in achados if isinstance(a.metadados, dict) and codigo in (a.metadados.get("permissoes") or [])]


def _trocar_permissoes_do_cargo(conexao, cargo, novas: list[str]) -> None:
    conexao.execute(sa.update(_opcoes).where(_opcoes.c.id_opcao == cargo.id_opcao).values(metadados={**cargo.metadados, "permissoes": novas}))


def upgrade() -> None:
    conexao = op.get_bind()
    id_nova = _id_da_permissao(conexao, NOVA)
    if id_nova is None:
        conexao.execute(sa.insert(_permissoes).values(modulo="core", codigo_permissao=NOVA, descricao=DESCRICAO))
        id_nova = _id_da_permissao(conexao, NOVA)
    id_base = _id_da_permissao(conexao, BASE)
    if id_base is not None:
        niveis = [linha.id_nivel for linha in conexao.execute(sa.select(_perfil.c.id_nivel).where(_perfil.c.id_permissao == id_base)).all()]
        for id_nivel in niveis:
            ja_tem = conexao.execute(sa.select(_perfil.c.id_nivel).where(_perfil.c.id_nivel == id_nivel, _perfil.c.id_permissao == id_nova)).first()
            if ja_tem is None:
                conexao.execute(sa.insert(_perfil).values(id_nivel=id_nivel, id_permissao=id_nova))
    for cargo in _cargos_com(conexao, BASE):
        atuais = list(cargo.metadados.get("permissoes") or [])
        if NOVA not in atuais:
            _trocar_permissoes_do_cargo(conexao, cargo, [*atuais, NOVA])


def downgrade() -> None:
    conexao = op.get_bind()
    for cargo in _cargos_com(conexao, NOVA):
        _trocar_permissoes_do_cargo(conexao, cargo, [p for p in cargo.metadados.get("permissoes") or [] if p != NOVA])
    id_nova = _id_da_permissao(conexao, NOVA)
    if id_nova is not None:
        conexao.execute(sa.delete(_perfil).where(_perfil.c.id_permissao == id_nova))
        conexao.execute(sa.delete(_permissoes).where(_permissoes.c.id_permissao == id_nova))
