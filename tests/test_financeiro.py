"""v3.0 (FASE 3) - fundamentos contábeis do financeiro: autenticação/auditoria em todo o router
(item 0 da FASE 3, pendência crítica registrada pela v1.1), Exercício contábil com
abertura/fechamento formal, razão contábil em partida dobrada real (cada lançamento é um
cabeçalho com N partidas de débito/crédito, sempre balanceado), Numeric/Decimal para dinheiro, e
imutabilidade do lançamento (correção só por estorno motivado, nunca edição/exclusão)."""
from datetime import datetime, timedelta

_ISO = "%Y-%m-%dT%H:%M:%S"


def _criar_conta(client, auth_headers, codigo, descricao, tipo):
    r = client.post("/plano-contas/", json={"codigo_contabil": codigo, "descricao_conta": descricao, "tipo": tipo}, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_conta"]


def test_endpoints_exigem_autenticacao(client):
    assert client.get("/api/plano-contas/").status_code == 401
    assert client.get("/api/fornecedores/").status_code == 401
    assert client.get("/api/titulos/").status_code == 401
    assert client.get("/api/livro-caixa/").status_code == 401
    assert client.get("/api/exercicios/").status_code == 401
    assert client.post("/plano-contas/", json={"codigo_contabil": "9.9.999", "descricao_conta": "x", "tipo": "Despesa"}).status_code == 401
    assert client.post("/fornecedores/", json={"razao_social": "x", "cnpj": "11111111000111", "categoria_servico": "Outros", "telefone": "11999999999"}).status_code == 401
    assert client.post("/titulos/", json={"tipo_titulo": "A Pagar", "id_conta_contabil": 1, "descricao": "x", "valor_original": 1, "data_vencimento": "2030-01-01T00:00:00"}).status_code == 401
    assert client.post("/baixar-titulo/", json={"id_titulo": 1, "valor_pago": 1, "forma_pagamento": "Pix", "id_conta_contabil_contrapartida": 1}).status_code == 401
    assert client.post("/api/lancamentos/1/estornar", json={"motivo": "teste"}).status_code == 401
    assert client.post("/api/exercicios/", json={"ano": 2999}).status_code == 401


def test_tipo_de_conta_desconhecido_e_recusado(client, auth_headers):
    r = client.post("/plano-contas/", json={"codigo_contabil": "9.9.001", "descricao_conta": "Conta Inválida", "tipo": "Coisa Qualquer"}, headers=auth_headers)
    assert r.status_code == 400
    assert "tipo de conta" in r.json()["detail"].lower()


def test_titulo_exige_conta_do_tipo_compativel(client, auth_headers):
    conta_ativo = _criar_conta(client, auth_headers, "1.1.9099", "Caixa Tipo Errado", tipo="Ativo")
    r = client.post("/titulos/", json={
        "tipo_titulo": "A Pagar", "id_conta_contabil": conta_ativo,
        "descricao": "Despesa com conta do tipo errado", "valor_original": 10,
        "data_vencimento": (datetime.utcnow() + timedelta(days=5)).strftime(_ISO),
    }, headers=auth_headers)
    assert r.status_code == 400
    assert "despesa" in r.json()["detail"].lower()


def test_baixa_gera_lancamento_em_partida_dobrada_real_com_decimal(client, auth_headers, exercicio_financeiro_aberto):
    conta_receita = _criar_conta(client, auth_headers, "3.1.9001", "Doacoes Teste v3.0", tipo="Receita")
    conta_caixa = _criar_conta(client, auth_headers, "1.1.9001", "Caixa Teste v3.0", tipo="Ativo")

    r = client.post("/titulos/", json={
        "tipo_titulo": "A Receber", "id_conta_contabil": conta_receita,
        "descricao": "Doação de teste", "valor_original": 100.10,
        "data_vencimento": (datetime.utcnow() + timedelta(days=5)).strftime(_ISO),
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_titulo = r.json()["id_titulo"]

    # contrapartida precisa ser Ativo (Caixa/Banco) - uma conta de Despesa não pode ser a "outra
    # ponta" de uma baixa.
    conta_despesa_qualquer = _criar_conta(client, auth_headers, "4.1.9099", "Despesa Qualquer", tipo="Despesa")
    r = client.post("/baixar-titulo/", json={
        "id_titulo": id_titulo, "valor_pago": 40.05, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": conta_despesa_qualquer,
    }, headers=auth_headers)
    assert r.status_code == 400

    r = client.post("/baixar-titulo/", json={
        "id_titulo": id_titulo, "valor_pago": 40.05, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": conta_caixa,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_lancamento = r.json()["id_lancamento"]
    assert r.json()["saldo_restante"] == 60.05

    livro = client.get("/api/livro-caixa/", headers=auth_headers).json()
    lancamento = next(l for l in livro["lancamentos"] if l["id_lancamento"] == id_lancamento)
    assert len(lancamento["partidas"]) == 2
    debitos = [p for p in lancamento["partidas"] if p["tipo_partida"] == "Debito"]
    creditos = [p for p in lancamento["partidas"] if p["tipo_partida"] == "Credito"]
    assert len(debitos) == 1 and len(creditos) == 1
    assert debitos[0]["valor"] == creditos[0]["valor"] == 40.05
    assert debitos[0]["conta_contabil"] == "Caixa Teste v3.0"
    assert creditos[0]["conta_contabil"] == "Doacoes Teste v3.0"

    auditoria = client.get("/api/auditoria/?limite=10", headers=auth_headers).json()
    entradas = [e for e in auditoria["entradas"] if e["tabela_afetada"] == "lancamentos_contabeis" and e["acao"] == "BAIXA_TITULO"]
    assert entradas, "esperava AuditLog gravado na baixa do título"


def test_lancamento_desbalanceado_e_sempre_recusado_pelo_servico(db, auth_headers, exercicio_financeiro_aberto):
    """A trava que mais importa num razão contábil: nada chega ao banco se débito != crédito -
    testado direto no serviço, que é o único lugar que monta LancamentoContabil/PartidaContabil."""
    from decimal import Decimal

    from app.models.financeiro import Exercicio, PlanoDeContas
    from app.services import contabilidade
    from fastapi import HTTPException
    import pytest

    exercicio = db.query(Exercicio).filter(Exercicio.status == "Aberto").first()
    conta_a = PlanoDeContas(codigo_contabil="Z.1.001", descricao_conta="Conta A desbalanceio", tipo="Ativo")
    conta_b = PlanoDeContas(codigo_contabil="Z.1.002", descricao_conta="Conta B desbalanceio", tipo="Despesa")
    db.add_all([conta_a, conta_b])
    db.commit()

    with pytest.raises(HTTPException) as exc:
        contabilidade.criar_lancamento(
            db, exercicio=exercicio, historico="Tentativa desbalanceada", tipo_origem="AJUSTE",
            partidas=[
                (conta_a.id_conta, contabilidade.DEBITO, Decimal("100.00")),
                (conta_b.id_conta, contabilidade.CREDITO, Decimal("50.00")),
            ],
        )
    assert exc.value.status_code == 400
    assert "desbalanceado" in exc.value.detail.lower()
    db.rollback()


def test_estorno_reverte_saldo_e_marca_lancamento_original_sem_apagar(client, auth_headers, exercicio_financeiro_aberto):
    conta_despesa = _criar_conta(client, auth_headers, "4.1.9001", "Despesa Teste v3.0", tipo="Despesa")
    conta_caixa = _criar_conta(client, auth_headers, "1.1.9002", "Caixa Teste Estorno", tipo="Ativo")

    r = client.post("/titulos/", json={
        "tipo_titulo": "A Pagar", "id_conta_contabil": conta_despesa,
        "descricao": "Conta a pagar de teste", "valor_original": 200,
        "data_vencimento": (datetime.utcnow() + timedelta(days=5)).strftime(_ISO),
    }, headers=auth_headers)
    id_titulo = r.json()["id_titulo"]

    r = client.post("/baixar-titulo/", json={
        "id_titulo": id_titulo, "valor_pago": 200, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": conta_caixa,
    }, headers=auth_headers)
    id_lancamento = r.json()["id_lancamento"]

    titulos = client.get("/api/titulos/", headers=auth_headers).json()
    titulo = next(t for t in titulos if t["id_titulo"] == id_titulo)
    assert titulo["status"] == "Pago"

    # imutabilidade: não existe endpoint de editar/apagar lançamento - só estorno.
    r = client.post(f"/api/lancamentos/{id_lancamento}/estornar", json={"motivo": "Pagamento em duplicidade"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_estorno = r.json()["id_lancamento_estorno"]

    titulos = client.get("/api/titulos/", headers=auth_headers).json()
    titulo = next(t for t in titulos if t["id_titulo"] == id_titulo)
    assert titulo["status"] == "Pendente"
    assert titulo["saldo_devedor"] == 200.0

    livro = client.get("/api/livro-caixa/", headers=auth_headers).json()
    original = next(l for l in livro["lancamentos"] if l["id_lancamento"] == id_lancamento)
    estorno = next(l for l in livro["lancamentos"] if l["id_lancamento"] == id_estorno)
    assert original["estornado"] is True

    partidas_originais = {(p["id_conta"], p["tipo_partida"]) for p in original["partidas"]}
    partidas_estorno = {(p["id_conta"], p["tipo_partida"]) for p in estorno["partidas"]}
    partidas_originais_invertidas = {
        (id_conta, "Credito" if tipo == "Debito" else "Debito") for id_conta, tipo in partidas_originais
    }
    assert partidas_estorno == partidas_originais_invertidas

    # não pode estornar de novo - lançamento já resolvido, nunca reaberto pra edição livre.
    r = client.post(f"/api/lancamentos/{id_lancamento}/estornar", json={"motivo": "Tentativa dupla"}, headers=auth_headers)
    assert r.status_code == 400


def test_nao_pode_abrir_dois_exercicios_ao_mesmo_tempo(client, auth_headers, exercicio_financeiro_aberto):
    r = client.post("/api/exercicios/", json={"ano": 2100}, headers=auth_headers)
    assert r.status_code == 400


def test_exercicio_fechado_bloqueia_lancamento_novo(client, auth_headers, exercicio_financeiro_aberto):
    exercicios = client.get("/api/exercicios/", headers=auth_headers).json()
    aberto = next(e for e in exercicios if e["status"] == "Aberto")

    conta_despesa = _criar_conta(client, auth_headers, "4.1.9002", "Despesa Teste Exercicio Fechado", tipo="Despesa")
    conta_caixa = _criar_conta(client, auth_headers, "1.1.9003", "Caixa Teste Exercicio Fechado", tipo="Ativo")
    titulo = client.post("/titulos/", json={
        "tipo_titulo": "A Pagar", "id_conta_contabil": conta_despesa,
        "descricao": "Título antes do fechamento", "valor_original": 50,
        "data_vencimento": (datetime.utcnow() + timedelta(days=5)).strftime(_ISO),
    }, headers=auth_headers).json()

    r = client.post(f"/api/exercicios/{aberto['id_exercicio']}/fechar", headers=auth_headers)
    assert r.status_code == 200, r.text

    try:
        r = client.post("/baixar-titulo/", json={
            "id_titulo": titulo["id_titulo"], "valor_pago": 50, "forma_pagamento": "Pix",
            "id_conta_contabil_contrapartida": conta_caixa,
        }, headers=auth_headers)
        assert r.status_code == 400
        assert "exercício" in r.json()["detail"].lower()

        # fechar de novo o mesmo exercício também deve falhar - já está fechado.
        r = client.post(f"/api/exercicios/{aberto['id_exercicio']}/fechar", headers=auth_headers)
        assert r.status_code == 400
    finally:
        # reabre um exercício pra não quebrar outros testes da suíte que dependem de haver um aberto.
        client.post("/api/exercicios/", json={"ano": 2101}, headers=auth_headers)
