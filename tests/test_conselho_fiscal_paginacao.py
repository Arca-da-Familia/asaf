"""v5.7g - as duas leituras do Conselho Fiscal (títulos e razão) são PAGINADAS e aceitam busca pelo texto: a lista inteira deixava a tela alta e pesada demais.

As promessas que estes testes travam:
  1. 25 por página por padrão, o total vem do servidor, a página seguinte traz outros itens e nada se repete ou se perde (a leitura continua IRRESTRITA: é só ir de página em página);
  2. a busca acha pelo texto (descrição do título, histórico do lançamento), sem ligar para maiúsculas; o filtro de situação do título continua valendo e combina com a busca;
  3. página e tamanho inválidos são recusados; o tamanho tem teto;
  4. CADA consulta, de cada página, fica na Auditoria (quem leu, quantos itens, o total, a página), e o texto buscado NÃO vai para ela;
  5. quem só audita (`financeiro_auditar`) lê as duas, e quem não tem permissão é barrado."""
import json
import uuid
from datetime import datetime, timedelta

from app.models.core import AuditLog
from app.models.financeiro import Exercicio, LancamentoContabil, TituloFinanceiro
from tests.test_documentos_institucionais import _usuario
from tests.test_parcerias import Razao  # noqa: F401  (o livro-caixa de teste)

URL_TITULOS = "/api/conselho-fiscal/financeiro/titulos"
URL_CAIXA = "/api/conselho-fiscal/financeiro/caixa"


def _titulos(db, quantidade: int, marca: str) -> list[int]:
    base = datetime.utcnow() + timedelta(days=3000)
    ids = []
    for n in range(quantidade):
        t = TituloFinanceiro(
            tipo_titulo="A Pagar", descricao=f"{marca} título {n:02d}", valor_original=10 + n, saldo_devedor=10 + n,
            status="Pago" if n % 3 == 0 else "Pendente", data_vencimento=base - timedelta(days=n),
        )
        db.add(t)
        db.flush()
        ids.append(t.id_titulo)
    db.commit()
    return ids


def _lancamentos(db, quantidade: int, marca: str) -> None:
    from tests.test_parcerias import Razao as RazaoDeTeste

    exercicio = db.query(Exercicio).filter(Exercicio.status == "Aberto").first()
    assert exercicio is not None
    razao = RazaoDeTeste(db, exercicio)
    for n in range(quantidade):
        razao.receber(None, 5 + n, historico=f"{marca} lançamento {n:02d}")


def _marca() -> str:
    return f"CFPAG{uuid.uuid4().hex[:8]}"


def test_titulos_25_por_pagina_com_o_total_do_servidor_sem_repetir_nem_perder(client, auth_headers, db):
    marca = _marca()
    ids = _titulos(db, 30, marca)
    p1 = client.get(URL_TITULOS, params={"busca": marca}, headers=auth_headers).json()
    assert set(p1) == {"total", "pagina", "por_pagina", "itens"}
    assert (p1["total"], p1["pagina"], p1["por_pagina"], len(p1["itens"])) == (30, 1, 25, 25)
    p2 = client.get(URL_TITULOS, params={"busca": marca, "pagina": 2}, headers=auth_headers).json()
    assert (p2["total"], p2["pagina"], len(p2["itens"])) == (30, 2, 5)
    lidos = [t["id_titulo"] for t in p1["itens"] + p2["itens"]]
    assert len(lidos) == len(set(lidos)) == 30 and set(lidos) == set(ids), "nada se repete e nada se perde"
    # a ordem: o vencimento mais distante primeiro (o título 00 vence por último)
    assert [t["descricao"] for t in p1["itens"]][:2] == [f"{marca} título 00", f"{marca} título 01"]
    vazia = client.get(URL_TITULOS, params={"busca": marca, "pagina": 3}, headers=auth_headers).json()
    assert vazia["itens"] == [] and vazia["total"] == 30


def test_a_busca_acha_pelo_texto_e_combina_com_a_situacao(client, auth_headers, db):
    marca = _marca()
    _titulos(db, 12, marca)
    todos = client.get(URL_TITULOS, params={"busca": marca.lower()}, headers=auth_headers).json()
    assert todos["total"] == 12, "a busca não liga para maiúsculas"
    uma = client.get(URL_TITULOS, params={"busca": f"{marca} título 07"}, headers=auth_headers).json()
    assert uma["total"] == 1 and uma["itens"][0]["descricao"] == f"{marca} título 07"
    pagos = client.get(URL_TITULOS, params={"busca": marca, "status": "Pago"}, headers=auth_headers).json()
    assert pagos["total"] == 4 and all(t["status"] == "Pago" for t in pagos["itens"]), "n % 3 == 0 entre 0 e 11 são 4 títulos"
    assert client.get(URL_TITULOS, params={"busca": "texto-que-nao-existe-" + marca}, headers=auth_headers).json()["total"] == 0


def test_pagina_e_tamanho_invalidos_sao_recusados_e_o_tamanho_tem_teto(client, auth_headers):
    for rota in (URL_TITULOS, URL_CAIXA):
        assert client.get(rota, params={"pagina": 0}, headers=auth_headers).status_code == 422
        assert client.get(rota, params={"por_pagina": 0}, headers=auth_headers).status_code == 422
        assert client.get(rota, params={"por_pagina": 201}, headers=auth_headers).status_code == 422
        assert client.get(rota, params={"por_pagina": 200}, headers=auth_headers).status_code == 200


def test_cada_pagina_lida_fica_na_auditoria_e_o_texto_buscado_nao(client, auth_headers, db):
    marca = _marca()
    _titulos(db, 30, marca)
    antes = db.query(AuditLog).filter(AuditLog.acao == "CONSULTA_CONSELHO_FISCAL", AuditLog.tabela_afetada == "titulos_financeiros").count()
    client.get(URL_TITULOS, params={"busca": marca}, headers=auth_headers)
    client.get(URL_TITULOS, params={"busca": marca, "pagina": 2}, headers=auth_headers)
    db.expire_all()
    novas = (
        db.query(AuditLog).filter(AuditLog.acao == "CONSULTA_CONSELHO_FISCAL", AuditLog.tabela_afetada == "titulos_financeiros")
        .order_by(AuditLog.id_log.desc()).limit(2).all()
    )
    assert db.query(AuditLog).filter(AuditLog.acao == "CONSULTA_CONSELHO_FISCAL", AuditLog.tabela_afetada == "titulos_financeiros").count() == antes + 2
    pagina2, pagina1 = novas
    d1, d2 = json.loads(pagina1.dados_depois), json.loads(pagina2.dados_depois)
    assert d1["pagina"] == 1 and d1["qtd_resultados"] == 25 and d1["total"] == 30
    assert d2["pagina"] == 2 and d2["qtd_resultados"] == 5
    assert d1["com_busca"] is True and pagina1.id_usuario is not None
    assert marca not in pagina1.dados_depois + pagina2.dados_depois, "o texto buscado não vai para a Auditoria"


def test_o_razao_tambem_e_paginado_com_busca_e_auditoria(client, auth_headers, db, exercicio_financeiro_aberto):
    marca = _marca()
    _lancamentos(db, 30, marca)
    p1 = client.get(URL_CAIXA, params={"busca": marca}, headers=auth_headers).json()
    assert set(p1) == {"total", "pagina", "por_pagina", "itens"}
    assert (p1["total"], len(p1["itens"])) == (30, 25)
    p2 = client.get(URL_CAIXA, params={"busca": marca, "pagina": 2}, headers=auth_headers).json()
    assert len(p2["itens"]) == 5
    numeros = [i["numero_sequencial"] for i in p1["itens"] + p2["itens"]]
    assert len(set(numeros)) == 30, "nenhum lançamento repetido"
    assert numeros == sorted(numeros, reverse=True), "o mais novo primeiro"
    assert all("partidas" in i and len(i["partidas"]) == 2 for i in p1["itens"])
    um = client.get(URL_CAIXA, params={"busca": f"{marca.lower()} lançamento 05"}, headers=auth_headers).json()
    assert um["total"] == 1
    db.expire_all()
    ultima = db.query(AuditLog).filter(AuditLog.acao == "CONSULTA_CONSELHO_FISCAL", AuditLog.tabela_afetada == "lancamentos_contabeis").order_by(AuditLog.id_log.desc()).first()
    dados = json.loads(ultima.dados_depois)
    assert dados["total"] == 1 and dados["com_busca"] is True and marca not in ultima.dados_depois
    assert db.query(LancamentoContabil).filter(LancamentoContabil.historico.like(f"{marca}%")).count() == 30


def test_quem_so_audita_le_as_duas_e_quem_nao_tem_permissao_e_barrado(client, db):
    auditor = _usuario(db, "financeiro_auditar")
    sem_permissao = _usuario(db, "projetos")
    for rota in (URL_TITULOS, URL_CAIXA):
        assert client.get(rota, headers=auditor).status_code == 200
        assert client.get(rota, headers=sem_permissao).status_code == 403
        assert client.get(rota).status_code == 401
