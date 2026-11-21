"""v9.6a - a cobrança respeita a periodicidade (decisão do Presidente, 21/11/2026): a associação tem os planos MENSAL e SEMESTRAL; cada associado
escolhe o seu (marcado no cadastro); o semestral é cobrado em janeiro (janeiro a junho) e julho (julho a dezembro), igual para todos, com valor
próprio; quem fica de fora da cobrança de janeiro ou julho paga o resto do semestre. Antes, todo plano ativo era cobrado todo mês."""
from app.services import contribuicoes
from tests.test_contribuicoes import _criar_conta
from tests.test_situacao import _criar_associado

ANO = "2094"


def _plano(client, auth_headers, *, categoria, periodicidade, valor, conta_receita, conta_diferida=None, descricao=None, esperado=200):
    corpo = {
        "categoria": categoria, "descricao": descricao or f"Contribuição {periodicidade.lower()} {categoria}", "periodicidade": periodicidade,
        "dia_vencimento": 10, "cobranca_por_nucleo_familiar": False, "id_conta_contabil": conta_receita, "valor_inicial": valor,
    }
    if conta_diferida is not None:
        corpo["id_conta_contabil_receita_diferida"] = conta_diferida
    r = client.post("/api/planos-contribuicao/", json=corpo, headers=auth_headers)
    assert r.status_code == esperado, r.text
    return r.json().get("id_plano") if esperado == 200 else r.json()["detail"]


def _contas(client, auth_headers, sufixo):
    return (
        _criar_conta(client, auth_headers, f"3.2.96{sufixo}", f"Contribuições v9.6a {sufixo}", tipo="Receita"),
        _criar_conta(client, auth_headers, f"2.1.96{sufixo}", f"Contribuição a reconhecer v9.6a {sufixo}", tipo="Passivo"),
    )


def _gerar(client, auth_headers, competencia, confirmar=True):
    r = client.post("/api/contribuicoes/gerar-cobrancas/", json={"competencia": competencia, "confirmar": confirmar}, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()


def _do(resultado, id_associado):
    return [d for d in resultado["detalhes"] if d["id_associado"] == id_associado]


def _titulos(db, id_associado):
    from app.models.financeiro import TituloFinanceiro
    titulos = db.query(TituloFinanceiro).filter(TituloFinanceiro.id_associado == id_associado).order_by(TituloFinanceiro.id_titulo).all()
    db.rollback()
    return titulos


def _escolher(client, auth_headers, id_associado, periodicidade, esperado=200):
    r = client.put(f"/api/associados/{id_associado}/contribuicao", json={"periodicidade": periodicidade}, headers=auth_headers)
    assert r.status_code == esperado, r.text
    return r.json()


def test_periodo_e_quando_cobra():
    assert contribuicoes.periodo_da_competencia("2094-01", 6) == ("2094-01", "2094-06")
    assert contribuicoes.periodo_da_competencia("2094-06", 6) == ("2094-01", "2094-06")
    assert contribuicoes.periodo_da_competencia("2094-07", 6) == ("2094-07", "2094-12")
    assert contribuicoes.periodo_da_competencia("2094-12", 6) == ("2094-07", "2094-12")
    assert contribuicoes.periodo_da_competencia("2094-05", 12) == ("2094-01", "2094-12")
    assert contribuicoes.periodo_da_competencia("2094-05", 1) == ("2094-05", "2094-05")
    assert contribuicoes.quando_cobra(1) == "todo mês"
    assert contribuicoes.quando_cobra(6) == "em janeiro e julho"
    assert contribuicoes.quando_cobra(12) == "em janeiro"
    assert contribuicoes.quando_cobra(3) == "em janeiro, abril, julho e outubro"
    assert contribuicoes.meses_da_periodicidade(" SEMESTRAL ") == 6
    assert contribuicoes.meses_da_periodicidade("Quinzenal") is None


def test_cadastro_do_plano_semestral_exige_a_conta_de_receita_a_reconhecer_e_um_plano_por_forma(client, auth_headers, db):
    receita, passivo = _contas(client, auth_headers, "50")
    categoria = f"CategoriaPeriodo{receita}"
    detalhe = _plano(client, auth_headers, categoria=categoria, periodicidade="Quinzenal", valor=50, conta_receita=receita, esperado=400)
    assert "não é cobrada pelo sistema" in detalhe
    detalhe = _plano(client, auth_headers, categoria=categoria, periodicidade="Semestral", valor=540, conta_receita=receita, esperado=400)
    assert "receita a reconhecer" in detalhe
    # a conta de receita a reconhecer tem de ser de Passivo (não a de Receita)
    _plano(client, auth_headers, categoria=categoria, periodicidade="Semestral", valor=540, conta_receita=receita, conta_diferida=receita, esperado=400)
    id_mensal = _plano(client, auth_headers, categoria=categoria, periodicidade="Mensal", valor=100, conta_receita=receita, conta_diferida=passivo)
    id_semestral = _plano(client, auth_headers, categoria=categoria, periodicidade="Semestral", valor=540, conta_receita=receita, conta_diferida=passivo)

    planos = {p["id_plano"]: p for p in client.get("/api/planos-contribuicao/", headers=auth_headers).json()}
    assert planos[id_mensal]["id_conta_contabil_receita_diferida"] is None  # o mensal não usa
    assert planos[id_mensal]["quando_cobra"] == "todo mês"
    assert planos[id_semestral]["id_conta_contabil_receita_diferida"] == passivo
    assert planos[id_semestral]["quando_cobra"] == "em janeiro e julho"

    # um segundo plano ativo da mesma categoria e forma de pagamento é recusado (a cobrança usa um só)
    detalhe = _plano(client, auth_headers, categoria=categoria, periodicidade="semestral", valor=600, conta_receita=receita, conta_diferida=passivo, esperado=409)
    assert "Já existe o plano ativo" in detalhe and "desative o atual" in detalhe

    # desativar o atual libera o cadastro de outro; reativar o antigo, com o novo ativo, é recusado
    r = client.put(f"/api/planos-contribuicao/{id_semestral}/ativo?ativo=false", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["mensagem"] == "Plano desativado."
    id_novo = _plano(client, auth_headers, categoria=categoria, periodicidade="Semestral", valor=600, conta_receita=receita, conta_diferida=passivo)
    r = client.put(f"/api/planos-contribuicao/{id_semestral}/ativo?ativo=true", headers=auth_headers)
    assert r.status_code == 409, r.text
    r = client.put(f"/api/planos-contribuicao/{id_novo}/ativo?ativo=false", headers=auth_headers)
    assert r.status_code == 200
    r = client.put(f"/api/planos-contribuicao/{id_semestral}/ativo?ativo=true", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["mensagem"] == "Plano ativado."
    assert client.put("/api/planos-contribuicao/999999/ativo?ativo=false", headers=auth_headers).status_code == 404

    from app.models.core import AuditLog
    trocas = db.query(AuditLog).filter(
        AuditLog.tabela_afetada == "planos_contribuicao", AuditLog.id_registro_afetado == id_semestral, AuditLog.acao == "UPDATE",
    ).count()
    db.rollback()
    assert trocas == 2  # desativado e reativado (a reativação recusada não registra)


def test_a_forma_de_pagamento_no_cadastro_do_associado(client, auth_headers, db):
    receita, passivo = _contas(client, auth_headers, "51")
    categoria = f"CategoriaEscolha{receita}"
    _plano(client, auth_headers, categoria=categoria, periodicidade="Semestral", valor=540, conta_receita=receita, conta_diferida=passivo)
    _plano(client, auth_headers, categoria=categoria, periodicidade="Mensal", valor=100, conta_receita=receita)
    associado = _criar_associado(client, categoria=categoria)
    ida = associado["id_associado"]

    r = client.get(f"/api/associados/{ida}/contribuicao", headers=auth_headers)
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["periodicidade"] == "Mensal" and corpo["tem_plano"] is True  # todos começam no mensal
    assert [o["periodicidade"] for o in corpo["opcoes"]] == ["Mensal", "Semestral"]  # do menor período ao maior
    semestral = corpo["opcoes"][1]
    assert semestral["valor"] == 540.0 and semestral["meses"] == 6 and semestral["quando_cobra"] == "em janeiro e julho"

    assert "não tem plano anual ativo" in _escolher(client, auth_headers, ida, "Anual", esperado=400)["detail"]
    assert _escolher(client, auth_headers, ida, "semestral")["periodicidade"] == "Semestral"
    assert client.get(f"/api/associados/{ida}/contribuicao", headers=auth_headers).json()["periodicidade"] == "Semestral"
    assert _escolher(client, auth_headers, ida, "Semestral")["mensagem"].startswith("Nada mudou")
    assert client.put("/api/associados/999999/contribuicao", json={"periodicidade": "Mensal"}, headers=auth_headers).status_code == 404

    from app.models.core import AuditLog
    registros = db.query(AuditLog).filter(
        AuditLog.tabela_afetada == "associados", AuditLog.id_registro_afetado == ida, AuditLog.acao == "CONTRIBUICAO_ALTERADA",
    ).all()
    db.rollback()
    assert len(registros) == 1  # a segunda chamada (nada mudou) não registra


def test_o_semestral_e_cobrado_em_janeiro_e_julho_e_o_mensal_todo_mes(client, auth_headers, db):
    receita, passivo = _contas(client, auth_headers, "52")
    categoria = f"CategoriaSemestre{receita}"
    id_mensal = _plano(client, auth_headers, categoria=categoria, periodicidade="Mensal", valor=100, conta_receita=receita)
    id_semestral = _plano(client, auth_headers, categoria=categoria, periodicidade="Semestral", valor=540, conta_receita=receita, conta_diferida=passivo)
    mensal = _criar_associado(client, categoria=categoria)["id_associado"]
    semestral = _criar_associado(client, categoria=categoria)["id_associado"]
    _escolher(client, auth_headers, semestral, "Semestral")

    janeiro = _gerar(client, auth_headers, f"{ANO}-01")
    [linha_mensal] = _do(janeiro, mensal)
    assert linha_mensal["id_plano"] == id_mensal and linha_mensal["valor"] == 100.0 and linha_mensal["meses"] == 1
    [linha_semestral] = _do(janeiro, semestral)  # um título só, nunca o mensal junto
    assert linha_semestral["id_plano"] == id_semestral and linha_semestral["valor"] == 540.0
    assert linha_semestral["periodo"] == f"01/{ANO} a 06/{ANO}" and linha_semestral["meses"] == 6

    [t] = _titulos(db, semestral)
    assert t.competencia == f"{ANO}-01" and t.competencia_fim == f"{ANO}-06"
    assert t.id_conta_contabil == passivo  # entra na receita a reconhecer; vira receita mês a mês
    assert t.descricao == f"Contribuição semestral {categoria} — semestral de 01/{ANO} a 06/{ANO}"
    assert t.data_vencimento.strftime("%Y-%m-%d") == f"{ANO}-01-10"

    # fevereiro a junho: o mensal é cobrado de novo; o semestral, não (já coberto)
    for mes in ("02", "06"):
        resultado = _gerar(client, auth_headers, f"{ANO}-{mes}")
        assert len(_do(resultado, mensal)) == 1
        assert _do(resultado, semestral) == []
    # repetir janeiro não duplica nada
    repetido = _gerar(client, auth_headers, f"{ANO}-01")
    assert _do(repetido, mensal) == [] and _do(repetido, semestral) == []

    julho = _gerar(client, auth_headers, f"{ANO}-07", confirmar=False)
    [linha] = _do(julho, semestral)
    assert linha["valor"] == 540.0 and linha["periodo"] == f"07/{ANO} a 12/{ANO}"


def test_quem_fica_de_fora_de_janeiro_paga_o_resto_do_semestre(client, auth_headers, db):
    receita, passivo = _contas(client, auth_headers, "53")
    categoria = f"CategoriaResto{receita}"
    _plano(client, auth_headers, categoria=categoria, periodicidade="Mensal", valor=100, conta_receita=receita)
    _plano(client, auth_headers, categoria=categoria, periodicidade="Semestral", valor=540, conta_receita=receita, conta_diferida=passivo)

    # pagou o mensal de janeiro a março e passou para o semestral: abril a junho, 3 de 6 meses
    troca = _criar_associado(client, categoria=categoria)["id_associado"]
    for mes in ("01", "02", "03"):
        assert len(_do(_gerar(client, auth_headers, f"{ANO}-{mes}"), troca)) == 1
    _escolher(client, auth_headers, troca, "Semestral")
    # março já foi cobrado no mensal: rodar março de novo não cobra o semestral por cima
    assert _do(_gerar(client, auth_headers, f"{ANO}-03"), troca) == []
    # entrou em abril (ou estava licenciado até lá): também paga de abril a junho
    novo = _criar_associado(client, categoria=categoria)["id_associado"]
    _escolher(client, auth_headers, novo, "Semestral")

    abril = _gerar(client, auth_headers, f"{ANO}-04")
    for quem in (troca, novo):
        [linha] = _do(abril, quem)
        assert linha["valor"] == 270.0  # 540 x 3/6
        assert linha["periodo"] == f"04/{ANO} a 06/{ANO}" and linha["meses"] == 3
    [t] = _titulos(db, novo)
    assert t.descricao.endswith("(proporcional: 3 de 6 meses)")
    assert t.data_vencimento.strftime("%Y-%m-%d") == f"{ANO}-04-10"  # vence no mês em que foi cobrado
    assert (t.competencia, t.competencia_fim, t.valor_original) == (f"{ANO}-04", f"{ANO}-06", 270)

    # de volta ao mensal no meio do semestre pago: só volta a pagar por mês em julho
    _escolher(client, auth_headers, novo, "Mensal")
    assert _do(_gerar(client, auth_headers, f"{ANO}-05"), novo) == []
    julho = _gerar(client, auth_headers, f"{ANO}-07", confirmar=False)
    [linha] = _do(julho, novo)
    assert linha["valor"] == 100.0 and linha["meses"] == 1


def test_o_que_nao_da_para_cobrar_vira_aviso(client, auth_headers, db):
    from app.models.financeiro import PlanoDeContribuicao, ValorPlanoContribuicao
    from datetime import datetime

    receita, passivo = _contas(client, auth_headers, "54")
    categoria = f"CategoriaAviso{receita}"
    _plano(client, auth_headers, categoria=categoria, periodicidade="Mensal", valor=100, conta_receita=receita)
    id_semestral = _plano(client, auth_headers, categoria=categoria, periodicidade="Semestral", valor=540, conta_receita=receita, conta_diferida=passivo)
    associado = _criar_associado(client, categoria=categoria)
    _escolher(client, auth_headers, associado["id_associado"], "Semestral")
    # o semestral foi desativado depois da escolha: a pessoa não é cobrada, e o aviso diz quem é
    client.put(f"/api/planos-contribuicao/{id_semestral}/ativo?ativo=false", headers=auth_headers)
    resultado = _gerar(client, auth_headers, f"{ANO}-08", confirmar=False)
    assert _do(resultado, associado["id_associado"]) == []
    assert any(f"1 associado(s) da categoria {categoria} pagam semestral" in a for a in resultado["avisos"])
    assert [x["id_associado"] for x in resultado["associados_sem_plano"] if x["categoria"] == categoria] == [associado["id_associado"]]
    # o aviso não leva nome (a rotina do dia 1 grava os avisos no log)
    from app.models.associados import Associado
    nome = db.query(Associado).filter(Associado.id_associado == associado["id_associado"]).first().nome_completo
    db.rollback()
    assert not any(nome in a for a in resultado["avisos"])
    # categoria sem plano nenhum (não contribui): sem cobrança e sem aviso
    sem_plano = _criar_associado(client, categoria=f"CategoriaSemPlano{receita}")["id_associado"]
    resultado = _gerar(client, auth_headers, f"{ANO}-08", confirmar=False)
    assert _do(resultado, sem_plano) == [] and not any(f"CategoriaSemPlano{receita}" in a for a in resultado["avisos"])

    # dados antigos com dois planos mensais ativos na mesma categoria (o cadastro novo já recusa): ninguém dessa categoria é cobrado no mensal
    categoria2 = f"CategoriaDupla{receita}"
    for descricao in ("Mensalidade A", "Mensalidade B"):
        plano = PlanoDeContribuicao(categoria=categoria2, descricao=descricao, periodicidade="Mensal", dia_vencimento=10, id_conta_contabil=receita)
        db.add(plano)
        db.flush()
        db.add(ValorPlanoContribuicao(id_plano=plano.id_plano, valor=100, data_vigencia_inicio=datetime(2020, 1, 1)))
    # um semestral sem a conta de receita a reconhecer (dado antigo): ninguém é cobrado por ele
    plano = PlanoDeContribuicao(categoria=categoria2, descricao="Semestral sem conta", periodicidade="Semestral", dia_vencimento=10, id_conta_contabil=receita)
    db.add(plano)
    db.flush()
    db.add(ValorPlanoContribuicao(id_plano=plano.id_plano, valor=540, data_vigencia_inicio=datetime(2020, 1, 1)))
    db.commit()
    dupla = _criar_associado(client, categoria=categoria2)["id_associado"]
    resultado = _gerar(client, auth_headers, f"{ANO}-08", confirmar=False)
    assert _do(resultado, dupla) == []
    assert any(categoria2 in a and "2 planos mensal ativos" in a for a in resultado["avisos"])
    assert any("Semestral sem conta" in a and "receita a reconhecer" in a for a in resultado["avisos"])


def test_o_semestre_pago_com_atraso_vira_receita_de_cada_mes(client, auth_headers, exercicio_financeiro_aberto, db):
    from app.models.financeiro import ReconhecimentoReceitaDiferida

    receita, passivo = _contas(client, auth_headers, "55")
    caixa = _criar_conta(client, auth_headers, "1.1.9655", "Caixa v9.6a", tipo="Ativo")
    categoria = f"CategoriaAtraso{receita}"
    _plano(client, auth_headers, categoria=categoria, periodicidade="Semestral", valor=540, conta_receita=receita, conta_diferida=passivo)
    associado = _criar_associado(client, categoria=categoria)["id_associado"]
    _escolher(client, auth_headers, associado, "Semestral")

    _gerar(client, auth_headers, "2093-01")  # janeiro: o título do semestre nasce pendente; nada vira receita ainda
    [titulo] = [{"id_titulo": t.id_titulo} for t in _titulos(db, associado)]
    assert all(x["id_titulo"] != titulo["id_titulo"] for x in _gerar(client, auth_headers, "2093-02")["reconhecimentos_receita_diferida"])

    # pagou em março: janeiro, fevereiro e março viram receita, cada um na sua competência
    r = client.post("/baixar-titulo/", json={
        "id_titulo": titulo["id_titulo"], "valor_pago": 540, "forma_pagamento": "Pix", "id_conta_contabil_contrapartida": caixa,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    marco = [x for x in _gerar(client, auth_headers, "2093-03")["reconhecimentos_receita_diferida"] if x["id_titulo"] == titulo["id_titulo"]]
    assert [(x["competencia"], x["valor"]) for x in marco] == [("2093-01", 90.0), ("2093-02", 90.0), ("2093-03", 90.0)]
    assert [x for x in _gerar(client, auth_headers, "2093-03")["reconhecimentos_receita_diferida"] if x["id_titulo"] == titulo["id_titulo"]] == []

    # o semestre de julho pago só em janeiro do ano seguinte (depois de acabar): os seis meses saem da receita a reconhecer
    _gerar(client, auth_headers, "2093-07")
    [julho] = [{"id_titulo": t.id_titulo} for t in _titulos(db, associado) if t.competencia == "2093-07"]
    r = client.post("/baixar-titulo/", json={
        "id_titulo": julho["id_titulo"], "valor_pago": 540, "forma_pagamento": "Pix", "id_conta_contabil_contrapartida": caixa,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    janeiro = [x for x in _gerar(client, auth_headers, "2094-01", confirmar=True)["reconhecimentos_receita_diferida"] if x["id_titulo"] == julho["id_titulo"]]
    assert [x["competencia"] for x in janeiro] == ["2093-07", "2093-08", "2093-09", "2093-10", "2093-11", "2093-12"]

    # na mesma rodada, abril a junho do primeiro semestre (pago em março) também viram receita: os dois somam exatamente o valor do título
    for id_titulo in (titulo["id_titulo"], julho["id_titulo"]):
        total = sum(r.valor for r in db.query(ReconhecimentoReceitaDiferida).filter(ReconhecimentoReceitaDiferida.id_titulo == id_titulo).all())
        db.rollback()
        assert total == 540
