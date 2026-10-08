"""v5.4h - Auditoria financeira do Conselho Fiscal: o Conselho aprova, reprova ou ressalva cada título do mês. Maioria aprova e trava;
ressalva/reprovação exige explicação, abre pergunta para a tesouraria e suspende até a resposta; título aprovado só é estornado depois
que um conselheiro reabre; o conselheiro não audita título em que é parte; aprovar em lote vale para um mês de cada vez.

O banco de teste é um só para o arquivo inteiro: cada teste usa nomes únicos e o seu próprio mês de 2088."""
import uuid
from datetime import datetime

from app.models.financeiro import TituloFinanceiro
from tests.test_antifraude import _criar_conta
from tests.test_conselho_fiscal import _criar_associado, _headers

_ISO = "%Y-%m-%dT%H:%M:%S"
_RAIZ = "/api/conselho-fiscal/auditoria-financeira"


def _nome(base):
    return f"{base} {uuid.uuid4().hex[:6]}"


def _conselho(db, quantos=3):
    return [_criar_associado(db, _nome(f"Conselheira Auditoria {i}"), nome_nivel="Conselho Fiscal") for i in range(1, quantos + 1)]


def _titulo(db, descricao, mes, dia=10, tipo="A Pagar", id_conta=None, id_associado=None):
    ano, numero = (int(p) for p in mes.split("-"))
    t = TituloFinanceiro(
        tipo_titulo=tipo, descricao=descricao, valor_original=100, saldo_devedor=100, status="Pendente",
        data_vencimento=datetime(ano, numero, dia), id_conta_contabil=id_conta, id_associado=id_associado,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return t.id_titulo


def _decidir(client, usuario, id_titulo, decisao, observacao=None):
    corpo = {"decisao": decisao}
    if observacao is not None:
        corpo["observacao"] = observacao
    return client.post(f"{_RAIZ}/titulos/{id_titulo}/decisao", json=corpo, headers=_headers(usuario))


def _situacao(client, headers, id_titulo, mes):
    itens = client.get(f"{_RAIZ}/?mes={mes}&por_pagina=200", headers=headers).json()["itens"]
    return next(i for i in itens if i["id_titulo"] == id_titulo)


def test_so_o_conselho_fiscal_decide_e_quem_tem_o_financeiro_le(client, auth_headers, db):
    M = "2088-01"
    (_, c1), *_ = _conselho(db)
    _, diretor = _criar_associado(db, _nome("Diretor Que Le"), nome_nivel="Diretoria")
    _, comum = _criar_associado(db, _nome("Associado Comum Sem Financeiro"))
    id_titulo = _titulo(db, "Título da leitura", M)

    assert client.get(f"{_RAIZ}/?mes={M}").status_code == 401
    assert client.get(f"{_RAIZ}/?mes={M}", headers=_headers(comum)).status_code == 403
    lido = client.get(f"{_RAIZ}/?mes={M}", headers=_headers(diretor)).json()
    assert lido["pode_decidir"] is False and lido["quorum"] == 2
    assert _decidir(client, diretor, id_titulo, "Aprovado").status_code == 403, "quem lança não audita"
    assert client.post(f"{_RAIZ}/aprovar-em-lote", json={"mes": M}, headers=_headers(diretor)).status_code == 403

    assert client.get(f"{_RAIZ}/?mes={M}", headers=_headers(c1)).json()["pode_decidir"] is True
    assert _decidir(client, c1, id_titulo, "Aprovado").status_code == 200
    assert _decidir(client, c1, 999999, "Aprovado").status_code == 404
    assert _decidir(client, c1, id_titulo, "Talvez").status_code == 422


def test_a_maioria_dos_tres_aprova_e_o_titulo_fica_travado(client, auth_headers, db):
    M = "2088-02"
    (_, c1), (_, c2), (_, c3) = _conselho(db)
    id_titulo = _titulo(db, "Título da maioria", M)

    antes = _situacao(client, auth_headers, id_titulo, M)
    assert antes["situacao"] == "Pendente" and antes["aprovacoes"] == 0 and antes["quorum"] == 2

    r = _decidir(client, c1, id_titulo, "Aprovado")
    assert r.status_code == 200 and r.json()["situacao"] == "Pendente" and r.json()["aprovacoes"] == 1
    r = _decidir(client, c1, id_titulo, "Aprovado")
    assert r.status_code == 409 and "já aprovou" in r.json()["detail"]
    assert _situacao(client, _headers(c1), id_titulo, M)["minha_decisao"] == "Aprovado"
    assert _situacao(client, _headers(c2), id_titulo, M)["minha_decisao"] is None

    r = _decidir(client, c2, id_titulo, "Aprovado")
    assert r.json()["situacao"] == "Aprovado" and r.json()["aprovacoes"] == 2

    # o terceiro discorda: o voto e o motivo dele ficam registrados e À VISTA, mas a maioria decide (o título segue Aprovado e travado)
    r = _decidir(client, c3, id_titulo, "Reprovado", "Não concordo com este lançamento.")
    assert r.status_code == 200 and r.json()["situacao"] == "Aprovado" and r.json()["aprovacoes"] == 2
    item = _situacao(client, auth_headers, id_titulo, M)
    assert item["situacao"] == "Aprovado" and item["com_discordancia"] is True and len(item["decisoes"]) == 3
    divergente = next(d for d in item["decisoes"] if d["decisao"] == "Reprovado")
    assert divergente["observacao"] == "Não concordo com este lançamento." and divergente["questionamento"] == "Aberto" and divergente["vigente"]


def test_o_terceiro_que_concorda_tambem_vota_e_fica_tres_de_tres(client, auth_headers, db):
    M = "2087-01"
    (_, c1), (_, c2), (_, c3) = _conselho(db)
    id_titulo = _titulo(db, "Título unânime", M)
    for c in (c1, c2):
        assert _decidir(client, c, id_titulo, "Aprovado").status_code == 200
    r = _decidir(client, c3, id_titulo, "Aprovado")
    assert r.status_code == 200 and r.json()["situacao"] == "Aprovado" and r.json()["aprovacoes"] == 3
    assert _decidir(client, c3, id_titulo, "Aprovado").status_code == 409, "o mesmo voto de aprovação não se repete"
    item = _situacao(client, auth_headers, id_titulo, M)
    assert item["com_discordancia"] is False


def test_ressalva_exige_explicacao_abre_pergunta_suspende_e_a_resposta_libera(client, auth_headers, db):
    M = "2088-03"
    (_, c1), (_, c2), (_, c3) = _conselho(db)
    _, tesoureiro = _criar_associado(db, _nome("Tesoureiro Que Responde"), nome_nivel="Diretoria")
    id_titulo = _titulo(db, "Título com ressalva", M)

    r = _decidir(client, c1, id_titulo, "Com ressalva")
    assert r.status_code == 422 and "exige a explicação" in r.json()["detail"]
    assert _decidir(client, c1, id_titulo, "Reprovado", "curto").status_code == 422

    r = _decidir(client, c1, id_titulo, "Com ressalva", "Falta a nota fiscal anexada a este lançamento.")
    assert r.status_code == 200 and r.json()["situacao"] == "Suspenso" and r.json()["id_questionamento"]
    id_questionamento = r.json()["id_questionamento"]
    perguntas = client.get(f"/api/financeiro/titulos/{id_titulo}/questionamentos", headers=_headers(tesoureiro)).json()
    assert any(p["id_questionamento"] == id_questionamento and "nota fiscal" in p["pergunta"] for p in perguntas)

    # enquanto a maioria não aprovou, a pergunta aberta mantém o título suspenso; com a maioria (2 de 3) a ressalva não segura mais
    assert _decidir(client, c2, id_titulo, "Aprovado").json()["situacao"] == "Suspenso"
    assert _decidir(client, c3, id_titulo, "Aprovado").json()["situacao"] == "Aprovado"
    item = _situacao(client, auth_headers, id_titulo, M)
    assert item["situacao"] == "Aprovado" and item["aprovacoes"] == 2 and item["com_discordancia"] is True
    ressalva = next(d for d in item["decisoes"] if d["decisao"] == "Com ressalva")
    assert ressalva["questionamento"] == "Aberto" and "nota fiscal" in ressalva["observacao"]
    assert ressalva["id_questionamento"] == id_questionamento, "a tela responde a pergunta pelo número dela"

    r = client.post(f"/api/questionamentos/{id_questionamento}/respostas", json={"texto": "Nota fiscal anexada hoje, conferir."}, headers=_headers(tesoureiro))
    assert r.status_code == 200, r.text
    item = _situacao(client, auth_headers, id_titulo, M)
    assert item["situacao"] == "Aprovado", "respondida a pergunta, a maioria que já aprovou vale"
    assert next(d for d in item["decisoes"] if d["decisao"] == "Com ressalva")["questionamento"] == "Respondido"


def test_o_conselheiro_nao_audita_titulo_em_que_e_parte(client, auth_headers, db):
    M = "2088-04"
    (c1_assoc, c1), (_, c2), _ = _conselho(db)
    proprio = _titulo(db, "Reembolso do próprio conselheiro", M, id_associado=c1_assoc.id_associado)
    r = _decidir(client, c1, proprio, "Aprovado")
    assert r.status_code == 403 and "ele mesmo é parte" in r.json()["detail"]
    assert _situacao(client, _headers(c1), proprio, M)["sou_parte"] is True
    assert _decidir(client, c2, proprio, "Aprovado").status_code == 200, "os outros conselheiros auditam normalmente"


def test_a_lista_filtra_por_mes_situacao_e_pagina_com_resumo(client, auth_headers, db):
    M, OUTRO = "2088-05", "2088-06"
    (_, c1), (_, c2), _ = _conselho(db)
    ids = [_titulo(db, f"Maio {n}", M, dia=n) for n in range(1, 6)]
    outro_mes = _titulo(db, "Junho 1", OUTRO)
    for i in ids[:2]:
        _decidir(client, c1, i, "Aprovado")
        _decidir(client, c2, i, "Aprovado")
    _decidir(client, c1, ids[2], "Com ressalva", "Falta o comprovante deste lançamento.")

    lista = client.get(f"{_RAIZ}/?mes={M}&por_pagina=2&pagina=2", headers=auth_headers).json()
    assert lista["total"] == 5 and lista["resumo"] == {"Pendente": 2, "Suspenso": 1, "Aprovado": 2, "total": 5, "com_discordancia": 1}
    assert [i["descricao"] for i in lista["itens"]] == ["Maio 3", "Maio 4"]
    so_suspensos = client.get(f"{_RAIZ}/?mes={M}&situacao=Suspenso", headers=auth_headers).json()
    assert [i["id_titulo"] for i in so_suspensos["itens"]] == [ids[2]] and so_suspensos["resumo"]["total"] == 5
    assert client.get(f"{_RAIZ}/?mes={M}&situacao=Qualquer", headers=auth_headers).status_code == 422
    assert client.get(f"{_RAIZ}/?mes=2088-13", headers=auth_headers).status_code == 400
    assert [i["id_titulo"] for i in client.get(f"{_RAIZ}/?mes={OUTRO}", headers=auth_headers).json()["itens"]] == [outro_mes]


def test_aprovar_em_lote_vale_para_um_mes_e_uma_categoria_e_pula_o_que_nao_deve(client, auth_headers, db):
    M, OUTRO = "2088-07", "2088-08"
    (c1_assoc, c1), (_, c2), _ = _conselho(db)
    conta_a = _criar_conta(client, auth_headers, "Despesa")
    conta_b = _criar_conta(client, auth_headers, "Despesa")
    da_a = [_titulo(db, f"Categoria A {n}", M, dia=n, id_conta=conta_a) for n in (1, 2)]
    da_b = _titulo(db, "Categoria B", M, id_conta=conta_b)
    suspenso = _titulo(db, "Suspenso", M, id_conta=conta_a)
    proprio = _titulo(db, "Próprio", M, id_conta=conta_a, id_associado=c1_assoc.id_associado)
    de_outro_mes = _titulo(db, "Fora do mês", OUTRO, id_conta=conta_a)
    _decidir(client, c2, suspenso, "Reprovado", "Valor acima do orçado para este item.")

    assert client.post(f"{_RAIZ}/aprovar-em-lote", json={}, headers=_headers(c1)).status_code == 422
    assert client.post(f"{_RAIZ}/aprovar-em-lote", json={"mes": "maio"}, headers=_headers(c1)).status_code == 422

    r = client.post(f"{_RAIZ}/aprovar-em-lote", json={"mes": M, "id_conta_contabil": conta_a}, headers=_headers(c1))
    assert r.status_code == 200, r.text
    assert r.json()["aprovados"] == 2
    assert r.json()["ignorados"]["suspensos"] == 1 and r.json()["ignorados"]["seus"] == 1
    for i in da_a:
        assert _situacao(client, _headers(c1), i, M)["minha_decisao"] == "Aprovado"
    assert _situacao(client, _headers(c1), da_b, M)["minha_decisao"] is None, "outra categoria não é tocada"
    assert _situacao(client, _headers(c1), proprio, M)["minha_decisao"] is None
    assert _situacao(client, _headers(c1), de_outro_mes, OUTRO)["minha_decisao"] is None, "outro mês não é tocado"

    # o mês inteiro, de novo: o que já era dele é pulado; o resto entra
    r = client.post(f"{_RAIZ}/aprovar-em-lote", json={"mes": M}, headers=_headers(c1))
    assert r.json()["aprovados"] == 1 and r.json()["ignorados"]["ja_aprovados_por_voce"] == 2
    # com o segundo conselheiro, o lote leva os títulos à maioria e trava
    r = client.post(f"{_RAIZ}/aprovar-em-lote", json={"mes": M}, headers=_headers(c2))
    assert r.status_code == 200
    assert _situacao(client, auth_headers, da_a[0], M)["situacao"] == "Aprovado"
    r = client.post(f"{_RAIZ}/aprovar-em-lote", json={"mes": M}, headers=_headers(c1))
    assert r.json()["ignorados"]["ja_travados"] >= 3


def test_titulo_aprovado_so_e_estornado_depois_que_um_conselheiro_reabre(client, auth_headers, db, exercicio_financeiro_aberto):
    (_, c1), (_, c2), (_, c3) = _conselho(db)
    conta_despesa = _criar_conta(client, auth_headers, "Despesa")
    conta_caixa = _criar_conta(client, auth_headers, "Ativo")
    r = client.post("/titulos/", json={
        "tipo_titulo": "A Pagar", "id_conta_contabil": conta_despesa, "descricao": "Título que será aprovado e travado",
        "valor_original": 80, "data_vencimento": datetime.utcnow().strftime(_ISO),
    }, headers=auth_headers)
    id_titulo = r.json()["id_titulo"]
    comprovante = client.post("/api/comprovantes/", files={"arquivo": ("nota.pdf", b"%PDF-1.4 conteudo", "application/pdf")}, headers=auth_headers).json()["comprovante"]
    r = client.post("/baixar-titulo/", json={
        "id_titulo": id_titulo, "valor_pago": 80, "forma_pagamento": "Pix", "id_conta_contabil_contrapartida": conta_caixa, "comprovante": comprovante,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_lancamento = r.json()["id_lancamento"]

    mes = datetime.utcnow().strftime("%Y-%m")
    assert _decidir(client, c1, id_titulo, "Aprovado").status_code == 200
    assert _decidir(client, c2, id_titulo, "Aprovado").json()["situacao"] == "Aprovado"

    r = client.post(f"/api/lancamentos/{id_lancamento}/estornar", json={"motivo": "Pagamento lançado errado"}, headers=auth_headers)
    assert r.status_code == 409 and "travado" in r.json()["detail"]

    assert _decidir(client, c3, id_titulo, "Reaberto", "curto").status_code == 422
    r = _decidir(client, c3, id_titulo, "Reaberto", "Foi aprovado antes de a nota ser conferida.")
    assert r.status_code == 200 and r.json()["situacao"] == "Pendente" and r.json()["aprovacoes"] == 0
    item = _situacao(client, auth_headers, id_titulo, mes)
    assert [d["decisao"] for d in item["decisoes"]] == ["Aprovado", "Aprovado", "Reaberto"], "o histórico fica inteiro"
    assert not any(d["vigente"] for d in item["decisoes"] if d["decisao"] == "Aprovado"), "depois de reaberto, as aprovações antigas não valem mais"

    r = client.post(f"/api/lancamentos/{id_lancamento}/estornar", json={"motivo": "Pagamento lançado errado"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    # só se reabre o que está aprovado
    assert _decidir(client, c3, id_titulo, "Reaberto", "Reabrir de novo não faz sentido.").status_code == 409


def test_cada_decisao_e_cada_lote_ficam_na_auditoria_do_sistema(client, auth_headers, db):
    M = "2088-09"
    (_, c1), *_ = _conselho(db)
    id_titulo = _titulo(db, "Título da trilha", M)
    _decidir(client, c1, id_titulo, "Com ressalva", "Falta a assinatura de quem recebeu o valor.")
    client.post(f"{_RAIZ}/aprovar-em-lote", json={"mes": M}, headers=_headers(c1))
    trilha = client.get("/api/auditoria/?tabela_afetada=auditorias_de_titulo&por_pagina=50", headers=auth_headers).json()["entradas"]
    acoes = [e["acao"] for e in trilha]
    assert "AUDITORIA_FINANCEIRA_DECISAO" in acoes and "AUDITORIA_FINANCEIRA_LOTE" in acoes
