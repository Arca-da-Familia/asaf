"""v5.7e (FASE 5): o Conselho Fiscal audita, não opera (permissão secundária `financeiro_auditar`)

Decisão do Presidente (2026-10-19): o Conselho Fiscal não opera o financeiro (confirmar doação, registrar saída, pagar título...): ele AUDITA. Cada módulo passa a ter a permissão geral e as secundárias; a
primeira secundária é `financeiro_auditar` (ler o que a auditoria precisa e dar o parecer).

Esta migração, NOS BANCOS QUE JÁ EXISTEM (o semeador do sistema só acrescenta, nunca retira):
  1. garante a permissão `financeiro_auditar`;
  2. no nível de acesso "Conselho Fiscal": acrescenta `financeiro_auditar` e RETIRA `financeiro`;
  3. no cargo "Conselheiro Fiscal" (catálogo `titulo_cargo`, que concede permissões enquanto o mandato vale): troca `financeiro` por `financeiro_auditar` em `metadados.permissoes`.
Nenhuma outra permissão, nível ou cargo é tocado. O `downgrade` devolve o `financeiro` ao Conselho Fiscal.

Revision ID: f7c4d0e3a915
Revises: e6b3c9d2f8a4
Create Date: 2026-10-19 10:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'f7c4d0e3a915'
down_revision: Union[str, Sequence[str], None] = 'e6b3c9d2f8a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

_permissoes = sa.table(
    "permissoes_sistema", sa.column("id_permissao", sa.Integer), sa.column("modulo", sa.String), sa.column("codigo_permissao", sa.String), sa.column("descricao", sa.String),
)
_niveis = sa.table("niveis_acesso", sa.column("id_nivel", sa.Integer), sa.column("nome_nivel", sa.String))
_perfil = sa.table("perfil_permissao", sa.column("id_nivel", sa.Integer), sa.column("id_permissao", sa.Integer))
_catalogos = sa.table("catalogos", sa.column("id_catalogo", sa.Integer), sa.column("chave", sa.String))
_opcoes = sa.table("opcoes_catalogo", sa.column("id_opcao", sa.Integer), sa.column("id_catalogo", sa.Integer), sa.column("codigo", sa.String), sa.column("metadados", _JSON))

AUDITAR = "financeiro_auditar"
OPERAR = "financeiro"
NIVEL = "Conselho Fiscal"


def _id(conexao, tabela, coluna_id, coluna, valor):
    return conexao.execute(sa.select(tabela.c[coluna_id]).where(tabela.c[coluna] == valor)).scalar()


def _trocar_no_cargo(conexao, tirar: str, por: str) -> None:
    id_catalogo = _id(conexao, _catalogos, "id_catalogo", "chave", "titulo_cargo")
    if id_catalogo is None:
        return
    linha = conexao.execute(
        sa.select(_opcoes.c.id_opcao, _opcoes.c.metadados).where(_opcoes.c.id_catalogo == id_catalogo, _opcoes.c.codigo == "CONSELHO_FISCAL")
    ).first()
    if linha is None or not isinstance(linha.metadados, dict):
        return
    atuais = list(linha.metadados.get("permissoes") or [])
    novas = [p for p in atuais if p != tirar]
    if por not in novas:
        novas.append(por)
    if novas != atuais:
        conexao.execute(sa.update(_opcoes).where(_opcoes.c.id_opcao == linha.id_opcao).values(metadados={**linha.metadados, "permissoes": novas}))


def _dar_ao_nivel(conexao, id_nivel: int, id_permissao: int) -> None:
    ja_tem = conexao.execute(sa.select(_perfil.c.id_nivel).where(_perfil.c.id_nivel == id_nivel, _perfil.c.id_permissao == id_permissao)).first()
    if ja_tem is None:
        conexao.execute(sa.insert(_perfil).values(id_nivel=id_nivel, id_permissao=id_permissao))


def upgrade() -> None:
    conexao = op.get_bind()
    id_auditar = _id(conexao, _permissoes, "id_permissao", "codigo_permissao", AUDITAR)
    if id_auditar is None:
        conexao.execute(sa.insert(_permissoes).values(
            modulo="financeiro", codigo_permissao=AUDITAR, descricao="Auditar o financeiro (só leitura e parecer, sem operar).",
        ))
        id_auditar = _id(conexao, _permissoes, "id_permissao", "codigo_permissao", AUDITAR)
    id_operar = _id(conexao, _permissoes, "id_permissao", "codigo_permissao", OPERAR)
    id_nivel = _id(conexao, _niveis, "id_nivel", "nome_nivel", NIVEL)
    if id_nivel is not None:
        _dar_ao_nivel(conexao, id_nivel, id_auditar)
        if id_operar is not None:
            conexao.execute(sa.delete(_perfil).where(_perfil.c.id_nivel == id_nivel, _perfil.c.id_permissao == id_operar))
    _trocar_no_cargo(conexao, OPERAR, AUDITAR)


def downgrade() -> None:
    conexao = op.get_bind()
    id_auditar = _id(conexao, _permissoes, "id_permissao", "codigo_permissao", AUDITAR)
    id_operar = _id(conexao, _permissoes, "id_permissao", "codigo_permissao", OPERAR)
    id_nivel = _id(conexao, _niveis, "id_nivel", "nome_nivel", NIVEL)
    if id_nivel is not None:
        if id_operar is not None:
            _dar_ao_nivel(conexao, id_nivel, id_operar)
        if id_auditar is not None:
            conexao.execute(sa.delete(_perfil).where(_perfil.c.id_nivel == id_nivel, _perfil.c.id_permissao == id_auditar))
    _trocar_no_cargo(conexao, AUDITAR, OPERAR)
    if id_auditar is not None:
        ainda_usada = conexao.execute(sa.select(_perfil.c.id_nivel).where(_perfil.c.id_permissao == id_auditar)).first()
        if ainda_usada is None:
            conexao.execute(sa.delete(_permissoes).where(_permissoes.c.id_permissao == id_auditar))
