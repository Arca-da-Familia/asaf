"""v3.7 (FASE 3) - controles antifraude além do mínimo: relatório de exceção mensal de padrões
suspeitos, fechamento mensal com conciliação obrigatória, e trava de DELETE garantida no próprio
banco (nunca só na aplicação) para lançamento contábil e log de auditoria."""
import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from tests.test_compras import (
    _criar_alcada,
    _criar_conta as _criar_conta_compras,
    _criar_fornecedor,
    _criar_solicitacao,
    _criar_usuario_com_mandato,
)

_ISO = "%Y-%m-%dT%H:%M:%S"


def _criar_conta(client, auth_headers, tipo):
    r = client.post("/plano-contas/", json={
        "codigo_contabil": f"C{uuid.uuid4().hex[:8]}", "descricao_conta": f"Conta {tipo} teste antifraude", "tipo": tipo,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_conta"]


def test_padroes_suspeitos_detecta_fracionamento(client, auth_headers):
    # v3.7 - faixa de valor bem alta e fora do padrão usado pelos outros testes de compras
    # (que giram em torno de dezenas/centenas de reais): `alcada_aplicavel` (v3.3) escolhe a
    # alçada de MAIOR `valor_minimo` entre as que casam com o valor - uma alçada residual desta
    # suíte com `valor_minimo` baixo nunca pode "vencer" e ser escolhida no lugar da alçada de um
    # teste completamente diferente (achado real: colidiu com `test_doacoes.py` na primeira
    # versão deste teste).
    conta = _criar_conta_compras(client, auth_headers, f"C{uuid.uuid4().hex[:8]}", "Despesa")
    _criar_alcada(client, auth_headers, ["TESOUREIRO"], valor_minimo=500000, valor_maximo=1000000)
    id_solicitacao = _criar_solicitacao(client, auth_headers, conta, valor=950000)

    competencia = datetime.utcnow().strftime("%Y-%m")
    r = client.get(f"/api/antifraude/padroes-suspeitos?competencia={competencia}", headers=auth_headers)
    assert r.status_code == 200, r.text
    achados = r.json()
    assert any(a["tipo"] == "VALOR_PROXIMO_DO_TETO_DE_ALCADA" and a.get("id_solicitacao") == id_solicitacao for a in achados)


def test_padroes_suspeitos_detecta_fornecedor_novo_com_pagamento_alto(client, auth_headers):
    conta_despesa = _criar_conta(client, auth_headers, "Despesa")
    fornecedor = _criar_fornecedor(client, auth_headers, str(uuid.uuid4().int)[:4])

    r = client.post("/titulos/", json={
        "tipo_titulo": "A Pagar", "id_conta_contabil": conta_despesa, "id_fornecedor": fornecedor,
        "descricao": "Primeira operação com fornecedor novo", "valor_original": 5000,
        "data_vencimento": (datetime.utcnow() + timedelta(days=10)).strftime(_ISO),
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_titulo = r.json()["id_titulo"]

    competencia = datetime.utcnow().strftime("%Y-%m")
    achados = client.get(f"/api/antifraude/padroes-suspeitos?competencia={competencia}", headers=auth_headers).json()
    assert any(a["tipo"] == "FORNECEDOR_NOVO_PAGAMENTO_ALTO" and a.get("id_titulo") == id_titulo for a in achados)


def test_padroes_suspeitos_detecta_pagamento_apos_troca_de_dados_bancarios(client, auth_headers, exercicio_financeiro_aberto):
    conta_despesa = _criar_conta(client, auth_headers, "Despesa")
    conta_caixa = _criar_conta(client, auth_headers, "Ativo")
    fornecedor = _criar_fornecedor(client, auth_headers, str(uuid.uuid4().int)[:4])

    r = client.post("/api/fornecedores/dados-bancarios", json={
        "id_fornecedor": fornecedor, "banco": "Banco Teste", "agencia": "0001", "conta": "12345-6",
        "tipo_conta": "Corrente", "titular": "Fornecedor Teste Antifraude",
    }, headers=auth_headers)
    id_dados = r.json()["id_dados_bancarios"]
    _, headers_outro = _criar_usuario_com_mandato(client, auth_headers, "TESOUREIRO")
    r = client.post(f"/api/fornecedores/dados-bancarios/{id_dados}/aprovar", headers=headers_outro)
    assert r.status_code == 200, r.text

    r = client.post("/titulos/", json={
        "tipo_titulo": "A Pagar", "id_conta_contabil": conta_despesa, "id_fornecedor": fornecedor,
        "descricao": "Pagamento logo após troca de dados bancários", "valor_original": 300,
        "data_vencimento": (datetime.utcnow() + timedelta(days=2)).strftime(_ISO),
    }, headers=auth_headers)
    id_titulo = r.json()["id_titulo"]
    comprovante = client.post(
        "/api/comprovantes/", files={"arquivo": ("nota.pdf", b"%PDF-1.4 conteudo", "application/pdf")}, headers=auth_headers,
    ).json()["comprovante"]
    r = client.post("/baixar-titulo/", json={
        "id_titulo": id_titulo, "valor_pago": 300, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": conta_caixa, "comprovante": comprovante,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    competencia = datetime.utcnow().strftime("%Y-%m")
    achados = client.get(f"/api/antifraude/padroes-suspeitos?competencia={competencia}", headers=auth_headers).json()
    assert any(a["tipo"] == "PAGAMENTO_APOS_TROCA_DE_DADOS_BANCARIOS" and a.get("id_fornecedor") == fornecedor for a in achados)


def test_padroes_suspeitos_detecta_sequencia_de_estornos_do_mesmo_usuario(client, auth_headers, exercicio_financeiro_aberto):
    conta_despesa = _criar_conta(client, auth_headers, "Despesa")
    conta_caixa = _criar_conta(client, auth_headers, "Ativo")

    ids_lancamento = []
    for _ in range(3):
        r = client.post("/titulos/", json={
            "tipo_titulo": "A Pagar", "id_conta_contabil": conta_despesa,
            "descricao": "Título para estornar - teste antifraude", "valor_original": 50,
            "data_vencimento": (datetime.utcnow() + timedelta(days=3)).strftime(_ISO),
        }, headers=auth_headers)
        id_titulo = r.json()["id_titulo"]
        comprovante = client.post(
            "/api/comprovantes/", files={"arquivo": ("nota.pdf", b"%PDF-1.4 conteudo", "application/pdf")}, headers=auth_headers,
        ).json()["comprovante"]
        r = client.post("/baixar-titulo/", json={
            "id_titulo": id_titulo, "valor_pago": 50, "forma_pagamento": "Pix",
            "id_conta_contabil_contrapartida": conta_caixa, "comprovante": comprovante,
        }, headers=auth_headers)
        assert r.status_code == 200, r.text
        ids_lancamento.append(r.json()["id_lancamento"])

    for id_lancamento in ids_lancamento:
        r = client.post(f"/api/lancamentos/{id_lancamento}/estornar", json={"motivo": "Teste de sequência de estornos"}, headers=auth_headers)
        assert r.status_code == 200, r.text

    competencia = datetime.utcnow().strftime("%Y-%m")
    achados = client.get(f"/api/antifraude/padroes-suspeitos?competencia={competencia}", headers=auth_headers).json()
    encontrado = [a for a in achados if a["tipo"] == "SEQUENCIA_DE_ESTORNOS_MESMO_USUARIO"]
    assert encontrado, "esperava encontrar ao menos um alerta de sequência de estornos"
    assert encontrado[0]["quantidade"] >= 3


def test_fechar_mes_bloqueia_com_divergencia_e_fecha_sem_divergencia(client, auth_headers, exercicio_financeiro_aberto):
    conta_receita = _criar_conta(client, auth_headers, "Receita")
    conta_ativo = _criar_conta(client, auth_headers, "Ativo")
    r = client.post("/api/contas-financeiras/", json={"id_conta": conta_ativo, "tipo_conta_financeira": "Caixa"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_conta_financeira = r.json()["id_conta_financeira"]

    r = client.post("/titulos/", json={
        "tipo_titulo": "A Receber", "id_conta_contabil": conta_receita,
        "descricao": "Receita de teste fechamento mensal", "valor_original": 500,
        "data_vencimento": (datetime.utcnow() + timedelta(days=5)).strftime(_ISO),
    }, headers=auth_headers)
    id_titulo = r.json()["id_titulo"]
    r = client.post("/baixar-titulo/", json={
        "id_titulo": id_titulo, "valor_pago": 500, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": conta_ativo,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    competencia = datetime.utcnow().strftime("%Y-%m")
    r = client.post("/api/fechamentos-mensais/", json={
        "competencia": competencia, "id_conta_financeira": id_conta_financeira, "saldo_extrato_bancario": 499,
    }, headers=auth_headers)
    assert r.status_code == 400, r.text
    assert "divergência" in r.json()["detail"].lower()

    r = client.post("/api/fechamentos-mensais/", json={
        "competencia": competencia, "id_conta_financeira": id_conta_financeira, "saldo_extrato_bancario": 500,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["divergencia"] == 0.0

    r = client.post("/api/fechamentos-mensais/", json={
        "competencia": competencia, "id_conta_financeira": id_conta_financeira, "saldo_extrato_bancario": 500,
    }, headers=auth_headers)
    assert r.status_code == 400
    assert "já está fechada" in r.json()["detail"].lower()


def test_banco_recusa_apagar_lancamento_partida_e_log_de_auditoria(client, auth_headers, db, exercicio_financeiro_aberto):
    conta_receita = _criar_conta(client, auth_headers, "Receita")
    conta_ativo = _criar_conta(client, auth_headers, "Ativo")
    r = client.post("/titulos/", json={
        "tipo_titulo": "A Receber", "id_conta_contabil": conta_receita,
        "descricao": "Título de teste da trava de DELETE", "valor_original": 10,
        "data_vencimento": (datetime.utcnow() + timedelta(days=5)).strftime(_ISO),
    }, headers=auth_headers)
    id_titulo = r.json()["id_titulo"]
    r = client.post("/baixar-titulo/", json={
        "id_titulo": id_titulo, "valor_pago": 10, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": conta_ativo,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_lancamento = r.json()["id_lancamento"]

    with pytest.raises(DBAPIError):
        db.execute(text("DELETE FROM lancamentos_contabeis WHERE id_lancamento = :id"), {"id": id_lancamento})
    db.rollback()

    with pytest.raises(DBAPIError):
        db.execute(text("DELETE FROM partidas_contabeis WHERE id_lancamento = :id"), {"id": id_lancamento})
    db.rollback()

    with pytest.raises(DBAPIError):
        db.execute(text("DELETE FROM audit_log"))
    db.rollback()
