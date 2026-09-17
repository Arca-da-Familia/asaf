"""v3.5 (FASE 3) - orçamento anual (realizado x previsto calculado contra `PartidaContabil`,
nunca guardado em coluna própria), fluxo de caixa projetado (cobranças a receber + contas a
pagar + recorrentes ainda não geradas) e reserva de contingência (conta financeira própria com
regra de uso registrada)."""
import uuid
from datetime import datetime, timedelta

_ISO = "%Y-%m-%dT%H:%M:%S"


def _criar_conta(client, auth_headers, tipo):
    r = client.post("/plano-contas/", json={
        "codigo_contabil": f"C{uuid.uuid4().hex[:8]}", "descricao_conta": f"Conta {tipo} teste orcamento", "tipo": tipo,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_conta"]


def _criar_centro_custo(client, auth_headers):
    r = client.post("/api/centros-custo/", json={"codigo": f"CC{uuid.uuid4().hex[:8]}", "nome": "Centro Teste Orçamento"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_centro_custo"]


def _criar_deliberacao(client, auth_headers, concluir=True) -> int:
    r = client.post(
        "/api/assembleias/", headers=auth_headers,
        json={"tipo": "Ordinária", "pauta": "Aprovação do orçamento anual", "data_hora_convocacao": (datetime.utcnow() + timedelta(days=20)).strftime(_ISO)},
    )
    id_assembleia = r.json()["id_assembleia"]
    client.post(f"/api/assembleias/{id_assembleia}/convocar", headers=auth_headers)
    client.post(f"/api/assembleias/{id_assembleia}/abrir-sessao", headers=auth_headers)
    id_ata = client.post(f"/api/assembleias/{id_assembleia}/ata", headers=auth_headers).json()["id_ata"]

    r = client.post(f"/api/atas/{id_ata}/deliberacoes", headers=auth_headers, json={"tipo": "Genérica", "texto": "Aprovação do orçamento anual."})
    assert r.status_code == 200, r.text
    id_deliberacao = r.json()["id_deliberacao"]
    if concluir:
        r = client.post(f"/api/deliberacoes/{id_deliberacao}/concluir", headers=auth_headers, json={"observacao": "Aprovado por maioria simples."})
        assert r.status_code == 200, r.text
    return id_deliberacao


def test_orcamento_exige_deliberacao_concluida(client, auth_headers):
    conta = _criar_conta(client, auth_headers, "Despesa")
    id_deliberacao_pendente = _criar_deliberacao(client, auth_headers, concluir=False)

    r = client.post("/api/orcamentos/", json={
        "ano": 2077, "id_conta_contabil": conta, "valor_previsto": 1000, "id_deliberacao": id_deliberacao_pendente,
    }, headers=auth_headers)
    assert r.status_code == 400
    assert "concluída" in r.json()["detail"].lower()


def test_orcamento_duplicado_para_mesma_conta_e_ano_e_recusado(client, auth_headers):
    conta = _criar_conta(client, auth_headers, "Despesa")
    id_deliberacao = _criar_deliberacao(client, auth_headers)

    r = client.post("/api/orcamentos/", json={"ano": 2078, "id_conta_contabil": conta, "valor_previsto": 500, "id_deliberacao": id_deliberacao}, headers=auth_headers)
    assert r.status_code == 200, r.text

    r = client.post("/api/orcamentos/", json={"ano": 2078, "id_conta_contabil": conta, "valor_previsto": 999, "id_deliberacao": id_deliberacao}, headers=auth_headers)
    assert r.status_code == 400
    assert "já existe orçamento" in r.json()["detail"].lower()


def test_orcamento_realizado_e_estouro_calculados_contra_lancamento_real(client, auth_headers, exercicio_financeiro_aberto):
    conta_despesa = _criar_conta(client, auth_headers, "Despesa")
    conta_caixa = _criar_conta(client, auth_headers, "Ativo")
    centro_custo = _criar_centro_custo(client, auth_headers)
    id_deliberacao = _criar_deliberacao(client, auth_headers)
    ano_corrente = datetime.utcnow().year

    r = client.post("/api/orcamentos/", json={
        "ano": ano_corrente, "id_conta_contabil": conta_despesa, "id_centro_custo": centro_custo,
        "valor_previsto": 100, "id_deliberacao": id_deliberacao,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_orcamento = r.json()["id_orcamento"]

    orcamentos = client.get("/api/orcamentos/", headers=auth_headers).json()
    orcamento = next(o for o in orcamentos if o["id_orcamento"] == id_orcamento)
    assert orcamento["realizado"] == 0
    assert orcamento["estourado"] is False

    r = client.post("/titulos/", json={
        "tipo_titulo": "A Pagar", "id_conta_contabil": conta_despesa,
        "descricao": "Despesa de teste do orçamento", "valor_original": 150,
        "data_vencimento": (datetime.utcnow() + timedelta(days=5)).strftime(_ISO),
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_titulo = r.json()["id_titulo"]

    r = client.post(
        "/api/comprovantes/", files={"arquivo": ("nota.pdf", b"%PDF-1.4 conteudo de teste", "application/pdf")},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    comprovante = r.json()["comprovante"]

    r = client.post("/baixar-titulo/", json={
        "id_titulo": id_titulo, "valor_pago": 150, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": conta_caixa, "id_centro_custo": centro_custo,
        "comprovante": comprovante,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    orcamentos = client.get("/api/orcamentos/", headers=auth_headers).json()
    orcamento = next(o for o in orcamentos if o["id_orcamento"] == id_orcamento)
    assert orcamento["realizado"] == 150.0
    assert orcamento["estourado"] is True  # gastou 150 de um previsto de 100


def test_fluxo_de_caixa_projetado_soma_receber_pagar_e_recorrentes(client, auth_headers):
    conta_receita = _criar_conta(client, auth_headers, "Receita")
    conta_despesa = _criar_conta(client, auth_headers, "Despesa")
    competencia_atual = datetime.utcnow().strftime("%Y-%m")
    vencimento_no_mes = datetime.utcnow().replace(day=1) + timedelta(days=3)

    # base ANTES de criar qualquer coisa - a suíte inteira compartilha o mesmo banco de teste, e
    # outro arquivo pode já ter títulos/recorrentes pendentes vencendo neste mesmo mês corrente;
    # a asserção certa é o DELTA que este teste introduziu, nunca o total absoluto.
    base = client.get(f"/api/fluxo-de-caixa/?competencia_inicial={competencia_atual}&horizonte_meses=1", headers=auth_headers).json()["meses"][0]

    client.post("/titulos/", json={
        "tipo_titulo": "A Receber", "id_conta_contabil": conta_receita,
        "descricao": "Cobrança de teste fluxo de caixa", "valor_original": 300,
        "data_vencimento": vencimento_no_mes.strftime(_ISO),
    }, headers=auth_headers)
    client.post("/titulos/", json={
        "tipo_titulo": "A Pagar", "id_conta_contabil": conta_despesa,
        "descricao": "Despesa de teste fluxo de caixa", "valor_original": 80,
        "data_vencimento": vencimento_no_mes.strftime(_ISO),
    }, headers=auth_headers)

    fornecedor_r = client.post("/fornecedores/", json={
        "razao_social": "Fornecedor Fluxo de Caixa", "cnpj": f"{uuid.uuid4().int % 10**14:014d}",
        "categoria_servico": "Outros", "telefone": "11999999999",
    }, headers=auth_headers)
    assert fornecedor_r.status_code == 200, fornecedor_r.text

    client.post("/api/contas-a-pagar-recorrentes/", json={
        "descricao": "Aluguel de teste", "valor": 500, "id_conta_contabil": conta_despesa,
        "id_fornecedor": fornecedor_r.json()["id_fornecedor"], "dia_vencimento": 10,
    }, headers=auth_headers)

    r = client.get(f"/api/fluxo-de-caixa/?competencia_inicial={competencia_atual}&horizonte_meses=1", headers=auth_headers)
    assert r.status_code == 200, r.text
    mes = r.json()["meses"][0]
    assert mes["competencia"] == competencia_atual
    assert mes["entradas_previstas"] - base["entradas_previstas"] == 300.0
    # saída = título "A Pagar" já lançado (80) + conta a pagar recorrente ainda não gerada (500)
    assert mes["saidas_previstas"] - base["saidas_previstas"] == 580.0
    assert mes["recorrentes_projetadas"] - base["recorrentes_projetadas"] == 500.0


def test_reserva_contingencia_vinculada_a_conta_financeira_e_impede_duplicidade(client, auth_headers):
    conta_ativo = _criar_conta(client, auth_headers, "Ativo")
    r = client.post("/api/contas-financeiras/", json={"id_conta": conta_ativo, "tipo_conta_financeira": "Poupança"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_conta_financeira = r.json()["id_conta_financeira"]

    r = client.post("/api/reservas-contingencia/", json={
        "id_conta_financeira": id_conta_financeira,
        "regra_uso": "Só pode ser usada mediante aprovação da Assembleia, em caso de emergência que ameace a continuidade da associação.",
        "valor_minimo": 5000,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    reservas = client.get("/api/reservas-contingencia/", headers=auth_headers).json()
    reserva = next(r for r in reservas if r["id_conta_financeira"] == id_conta_financeira)
    assert reserva["saldo_atual"] == 0
    assert reserva["valor_minimo"] == 5000.0

    r = client.post("/api/reservas-contingencia/", json={
        "id_conta_financeira": id_conta_financeira, "regra_uso": "Tentativa de duplicar a mesma conta financeira como reserva.",
    }, headers=auth_headers)
    assert r.status_code == 400
    assert "já é uma reserva" in r.json()["detail"].lower()
