"""v3.2.2 (FASE 3) - negociação/parcelamento de débito em atraso: título original vira
"Renegociado" (nunca editado/apagado, excluído do cálculo de inadimplência), parcelas novas
nascem como título "A Receber" normal, rastreáveis até a origem. Termo em texto - assinatura
eletrônica fica pra FASE 20."""
import uuid
from datetime import datetime, timedelta

from tests.test_situacao import _criar_associado


def _criar_conta(client, auth_headers, tipo):
    return client.post(
        "/plano-contas/",
        json={"codigo_contabil": f"C{uuid.uuid4().hex[:8]}", "descricao_conta": f"Conta {tipo} teste negociacao", "tipo": tipo},
        headers=auth_headers,
    ).json()["id_conta"]


def _criar_titulo_vencido(client, auth_headers, conta_receita, id_associado, valor=300):
    r = client.post("/titulos/", json={
        "tipo_titulo": "A Receber", "id_conta_contabil": conta_receita, "id_associado": id_associado,
        "descricao": "Mensalidade atrasada", "valor_original": valor,
        "data_vencimento": "2020-01-01T00:00:00",  # bem no passado - vencido além de qualquer tolerância
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_titulo"]


def test_negociar_divida_cria_parcelas_e_marca_original_renegociado(client, auth_headers):
    conta_receita = _criar_conta(client, auth_headers, "Receita")
    associado = _criar_associado(client)
    id_titulo = _criar_titulo_vencido(client, auth_headers, conta_receita, associado["id_associado"], valor=100)

    calculada = client.get(f"/api/associados/{associado['id_associado']}/categoria-calculada", headers=auth_headers).json()
    assert calculada["status_arrolamento_materializado"] == "Ativo - Inadimplente"

    r = client.post("/api/negociacoes-divida/", json={
        "id_associado": associado["id_associado"], "ids_titulos_originais": [id_titulo],
        "quantidade_parcelas": 3, "termo": "Associado compareceu à tesouraria e propôs parcelamento em 3x.",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    resultado = r.json()
    assert resultado["valor_total"] == 100.0
    assert resultado["quantidade_parcelas"] == 3

    titulos = client.get("/api/titulos/", headers=auth_headers).json()
    original = next(t for t in titulos if t["id_titulo"] == id_titulo)
    assert original["status"] == "Renegociado"

    parcelas = [t for t in titulos if t["id_negociacao_parcela"] == resultado["id_negociacao"]]
    assert len(parcelas) == 3
    assert sum(p["valor_original"] for p in parcelas) == 100.0  # soma bate exatamente (arredondamento na última)
    assert all(p["status"] == "Pendente" for p in parcelas)
    assert all(p["id_associado"] == associado["id_associado"] for p in parcelas)

    # negociar reabilita automaticamente - as parcelas novas vencem no futuro, não estão em atraso.
    calculada = client.get(f"/api/associados/{associado['id_associado']}/categoria-calculada", headers=auth_headers).json()
    assert calculada["status_arrolamento_materializado"] == "Ativo - Em Dia"


def test_negociar_divida_recusa_titulo_ja_pago(client, auth_headers, exercicio_financeiro_aberto):
    conta_receita = _criar_conta(client, auth_headers, "Receita")
    conta_caixa = _criar_conta(client, auth_headers, "Ativo")
    associado = _criar_associado(client)
    id_titulo = _criar_titulo_vencido(client, auth_headers, conta_receita, associado["id_associado"], valor=50)

    r = client.post("/baixar-titulo/", json={
        "id_titulo": id_titulo, "valor_pago": 50, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": conta_caixa,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    r = client.post("/api/negociacoes-divida/", json={
        "id_associado": associado["id_associado"], "ids_titulos_originais": [id_titulo],
        "quantidade_parcelas": 2, "termo": "Tentativa de renegociar título já pago.",
    }, headers=auth_headers)
    assert r.status_code == 400
    assert "pendente" in r.json()["detail"].lower()


def test_negociar_divida_recusa_titulo_de_outro_associado(client, auth_headers):
    conta_receita = _criar_conta(client, auth_headers, "Receita")
    associado1 = _criar_associado(client)
    associado2 = _criar_associado(client)
    id_titulo = _criar_titulo_vencido(client, auth_headers, conta_receita, associado1["id_associado"], valor=80)

    r = client.post("/api/negociacoes-divida/", json={
        "id_associado": associado2["id_associado"], "ids_titulos_originais": [id_titulo],
        "quantidade_parcelas": 2, "termo": "Título não pertence a este associado.",
    }, headers=auth_headers)
    assert r.status_code == 400
    assert "não pertence" in r.json()["detail"].lower()


def test_negociar_divida_ja_renegociada_nao_pode_renegociar_de_novo(client, auth_headers):
    conta_receita = _criar_conta(client, auth_headers, "Receita")
    associado = _criar_associado(client)
    id_titulo = _criar_titulo_vencido(client, auth_headers, conta_receita, associado["id_associado"], valor=60)

    r = client.post("/api/negociacoes-divida/", json={
        "id_associado": associado["id_associado"], "ids_titulos_originais": [id_titulo],
        "quantidade_parcelas": 2, "termo": "Primeira negociação deste título em atraso.",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    r = client.post("/api/negociacoes-divida/", json={
        "id_associado": associado["id_associado"], "ids_titulos_originais": [id_titulo],
        "quantidade_parcelas": 3, "termo": "Segunda tentativa sobre o mesmo título já renegociado.",
    }, headers=auth_headers)
    assert r.status_code == 400
    assert "não está pendente" in r.json()["detail"].lower()


def test_negociar_divida_lista_por_associado(client, auth_headers):
    conta_receita = _criar_conta(client, auth_headers, "Receita")
    associado = _criar_associado(client)
    id_titulo = _criar_titulo_vencido(client, auth_headers, conta_receita, associado["id_associado"], valor=90)

    client.post("/api/negociacoes-divida/", json={
        "id_associado": associado["id_associado"], "ids_titulos_originais": [id_titulo],
        "quantidade_parcelas": 3, "termo": "Negociação pra listagem por associado.",
    }, headers=auth_headers)

    r = client.get(f"/api/negociacoes-divida/?id_associado={associado['id_associado']}", headers=auth_headers)
    assert r.status_code == 200, r.text
    negociacoes = r.json()
    assert len(negociacoes) == 1
    assert negociacoes[0]["valor_total"] == 90.0
