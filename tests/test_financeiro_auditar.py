"""v5.7e - o Conselho Fiscal AUDITA, não opera (decisão do Presidente, 2026-10-19): `financeiro_auditar` é a permissão SECUNDÁRIA do módulo Financeiro.

As promessas que estes testes travam:
  1. por padrão o nível "Conselho Fiscal" e o cargo "Conselheiro Fiscal" têm `financeiro_auditar` e `auditoria`, e NÃO têm `financeiro` (a que opera);
  2. quem tem só `financeiro_auditar` LÊ o que a auditoria precisa (títulos e caixa do Conselho, a lista da auditoria, o plano de contas, os relatórios e as prestações de contas) e é recusado (403) em
     tudo o que opera: cadastrar conta, confirmar doação, registrar doação, gerar a prestação de contas, listar e mexer em títulos, responder questionamento (que é da tesouraria);
  3. quem tem `financeiro` continua lendo as mesmas rotas (nada se perde para a tesouraria) e anônimo é barrado;
  4. a permissão nova não abre nenhuma outra coisa (nem associados, nem governança)."""
import uuid
from datetime import date

import pytest

from app.models.core import NivelAcesso, OpcaoCatalogo, Catalogo, PermissaoSistema, perfil_permissao
from tests.test_documentos_institucionais import _usuario

_HOJE = date.today().isoformat()

# rotas que a auditoria usa: quem audita LÊ
LEITURAS_DA_AUDITORIA = [
    "/api/conselho-fiscal/financeiro/titulos",
    "/api/conselho-fiscal/financeiro/caixa",
    "/api/conselho-fiscal/auditoria-financeira/",
    "/api/plano-contas/",
    f"/api/relatorios/balancete?data_inicio={_HOJE}&data_fim={_HOJE}",
    f"/api/relatorios/receitas-despesas?data_inicio={_HOJE}&data_fim={_HOJE}",
    "/api/prestacoes-de-contas/",
]

# rotas que OPERAM: quem só audita é recusado
OPERACOES_QUE_O_AUDITOR_NAO_FAZ = [
    ("get", "/api/titulos/", None),
    ("get", "/api/titulos/resumo", None),
    ("post", "/plano-contas/", {"codigo_contabil": "X1", "descricao_conta": "x", "tipo": "Receita"}),
    ("post", "/api/intencoes-doacao/1/confirmar", {"valor_recebido": 10, "id_conta_contabil": 1, "id_conta_contabil_caixa": 2}),
    ("get", "/api/intencoes-doacao/", None),
    ("post", "/api/prestacoes-de-contas/", {"ano_exercicio": 2026}),
    ("post", "/api/questionamentos/1/respostas", {"texto": "resposta qualquer da tesouraria"}),
]


def _permissoes_do_nivel(db, nome_nivel: str) -> set[str]:
    nivel = db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == nome_nivel).one()
    linhas = (
        db.query(PermissaoSistema.codigo_permissao)
        .join(perfil_permissao, perfil_permissao.c.id_permissao == PermissaoSistema.id_permissao)
        .filter(perfil_permissao.c.id_nivel == nivel.id_nivel)
        .all()
    )
    return {codigo for (codigo,) in linhas}


def test_o_conselho_fiscal_nasce_com_a_auditoria_e_sem_a_permissao_que_opera(db):
    permissoes = _permissoes_do_nivel(db, "Conselho Fiscal")
    assert permissoes == {"financeiro_auditar", "auditoria"}
    assert "financeiro" not in permissoes
    # o cargo "Conselheiro Fiscal" (concede enquanto o mandato vale) também
    cargo = (
        db.query(OpcaoCatalogo)
        .join(Catalogo, Catalogo.id_catalogo == OpcaoCatalogo.id_catalogo)
        .filter(Catalogo.chave == "titulo_cargo", OpcaoCatalogo.codigo == "CONSELHO_FISCAL")
        .one()
    )
    assert set(cargo.metadados["permissoes"]) == {"financeiro_auditar", "auditoria"}


def test_a_permissao_secundaria_existe_no_modulo_financeiro(db):
    permissao = db.query(PermissaoSistema).filter(PermissaoSistema.codigo_permissao == "financeiro_auditar").one()
    assert permissao.modulo == "financeiro" and "sem operar" in permissao.descricao


def test_ninguem_alem_do_conselho_ganhou_a_permissao_nova_por_padrao(db):
    for nome in ("Presidente", "Diretoria", "Associado", "Voluntário Externo"):
        assert "financeiro_auditar" not in _permissoes_do_nivel(db, nome), nome


@pytest.mark.parametrize("rota", LEITURAS_DA_AUDITORIA)
def test_quem_so_audita_le_o_que_a_auditoria_usa(client, db, rota):
    r = client.get(rota, headers=_usuario(db, "financeiro_auditar"))
    assert r.status_code == 200, (rota, r.status_code, r.text[:200])


@pytest.mark.parametrize("rota", LEITURAS_DA_AUDITORIA)
def test_quem_opera_continua_lendo_as_mesmas_rotas(client, db, rota):
    r = client.get(rota, headers=_usuario(db, "financeiro"))
    assert r.status_code == 200, (rota, r.status_code, r.text[:200])


@pytest.mark.parametrize("metodo,rota,corpo", OPERACOES_QUE_O_AUDITOR_NAO_FAZ)
def test_quem_so_audita_e_recusado_em_tudo_o_que_opera(client, db, metodo, rota, corpo):
    headers = _usuario(db, "financeiro_auditar")
    r = getattr(client, metodo)(rota, headers=headers, **({"json": corpo} if corpo is not None else {}))
    assert r.status_code == 403, (metodo, rota, r.status_code, r.text[:200])
    assert "financeiro" in r.json()["detail"]


@pytest.mark.parametrize("rota", LEITURAS_DA_AUDITORIA)
def test_sem_nenhuma_das_duas_permissoes_e_sem_login_a_leitura_e_barrada(client, db, rota):
    assert client.get(rota).status_code == 401
    assert client.get(rota, headers=_usuario(db, "associados", "governanca")).status_code == 403


def test_a_permissao_nova_nao_abre_outros_modulos(client, db):
    headers = _usuario(db, "financeiro_auditar")
    assert client.get("/api/atendimentos/", headers=headers).status_code == 403
    assert client.get("/api/associados/", headers=headers).status_code == 403
    assert client.get("/api/intencoes-doacao/resumo", headers=headers).status_code == 403


def test_o_auditor_ve_o_modulo_no_me_e_o_operador_tambem(client, db):
    """O painel decide o menu pelo que `/auth/me` devolve: o auditor traz `financeiro_auditar`, não `financeiro`."""
    r = client.get("/auth/me", headers=_usuario(db, "financeiro_auditar", "auditoria"))
    assert r.status_code == 200, r.text
    permissoes = set(r.json()["permissoes"])
    assert permissoes == {"financeiro_auditar", "auditoria"}


def test_a_decisao_de_titulo_segue_so_de_quem_e_do_conselho_fiscal(client, db):
    """Ter `financeiro_auditar` não faz ninguém conselheiro: quem decide é membro do Conselho Fiscal (nível ou mandato), como antes."""
    headers = _usuario(db, "financeiro_auditar")
    r = client.post(f"/api/conselho-fiscal/auditoria-financeira/titulos/{uuid.uuid4().int % 10**6 + 10**6}/decisao", headers=headers, json={"decisao": "APROVADO"})
    assert r.status_code == 403 and "Conselho Fiscal" in r.json()["detail"]
