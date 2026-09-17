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

    # v3.1 - Despesa exige comprovante por padrão (catálogo `tipo_conta_contabil`, opção
    # DESPESA) - baixa sem comprovante é recusada.
    r = client.post("/baixar-titulo/", json={
        "id_titulo": id_titulo, "valor_pago": 200, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": conta_caixa,
    }, headers=auth_headers)
    assert r.status_code == 400
    assert "comprovante" in r.json()["detail"].lower()

    r = client.post(
        "/api/comprovantes/", files={"arquivo": ("nota.pdf", b"%PDF-1.4 conteudo de teste", "application/pdf")},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    comprovante = r.json()["comprovante"]
    assert comprovante.startswith("/uploads/comprovantes/")

    r = client.post("/baixar-titulo/", json={
        "id_titulo": id_titulo, "valor_pago": 200, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": conta_caixa, "comprovante": comprovante,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
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

    # v3.0/v3.1 - Ponto de Revisão FASE 3 (1/3): imutabilidade não pode depender só da ausência
    # de rota no código-fonte de hoje - uma rota genérica de CRUD adicionada por engano no futuro
    # não pode voltar a permitir editar/apagar lançamento já gravado. Testa contra o HTTP de
    # verdade, não só "grep não achou @router.put".
    url_lancamento = f"/api/lancamentos/{id_lancamento}"
    for r in (
        client.put(url_lancamento, json={}, headers=auth_headers),
        client.patch(url_lancamento, json={}, headers=auth_headers),
        client.delete(url_lancamento, headers=auth_headers),
    ):
        assert r.status_code in (404, 405), f"lançamento deveria ser imutável, veio {r.status_code}"


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


# ---------------------------------------------------------------------------
# v3.1 - Plano de contas hierárquico, centro de custo, conta financeira, competência x caixa,
# comprovante configurável e transferência entre contas.
# ---------------------------------------------------------------------------
def test_conta_sintetica_nao_recebe_lancamento_direto(client, auth_headers, exercicio_financeiro_aberto):
    pai = _criar_conta(client, auth_headers, "1.1.9100", "Caixa e Bancos (sintética)", tipo="Ativo")
    r = client.post("/plano-contas/", json={
        "codigo_contabil": "1.1.9100.01", "descricao_conta": "Caixa Loja (filha)", "tipo": "Ativo",
        "codigo_contabil_pai": "1.1.9100",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    filha = r.json()["id_conta"]

    conta_receita = _criar_conta(client, auth_headers, "3.1.9100", "Receita Teste Hierarquia", tipo="Receita")
    titulo = client.post("/titulos/", json={
        "tipo_titulo": "A Receber", "id_conta_contabil": conta_receita,
        "descricao": "Recebimento de teste", "valor_original": 30,
        "data_vencimento": (datetime.utcnow() + timedelta(days=5)).strftime(_ISO),
    }, headers=auth_headers).json()

    # a conta PAI (sintética, tem filha) não pode receber lançamento direto.
    r = client.post("/baixar-titulo/", json={
        "id_titulo": titulo["id_titulo"], "valor_pago": 30, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": pai,
    }, headers=auth_headers)
    assert r.status_code == 400
    assert "sintética" in r.json()["detail"].lower()

    # a conta FILHA (analítica, folha) recebe normalmente.
    r = client.post("/baixar-titulo/", json={
        "id_titulo": titulo["id_titulo"], "valor_pago": 30, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": filha,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text


def test_exclusao_de_conta_bloqueada_por_filha_ou_movimento(client, auth_headers, exercicio_financeiro_aberto):
    pai = _criar_conta(client, auth_headers, "1.1.9200", "Conta com filha", tipo="Ativo")
    client.post("/plano-contas/", json={
        "codigo_contabil": "1.1.9200.01", "descricao_conta": "Filha", "tipo": "Ativo",
        "codigo_contabil_pai": "1.1.9200",
    }, headers=auth_headers)

    r = client.delete(f"/api/plano-contas/{pai}", headers=auth_headers)
    assert r.status_code == 400
    assert "filha" in r.json()["detail"].lower()

    conta_receita = _criar_conta(client, auth_headers, "3.1.9200", "Receita com movimento", tipo="Receita")
    conta_caixa = _criar_conta(client, auth_headers, "1.1.9201", "Caixa com movimento", tipo="Ativo")
    titulo = client.post("/titulos/", json={
        "tipo_titulo": "A Receber", "id_conta_contabil": conta_receita,
        "descricao": "Gera movimento", "valor_original": 10,
        "data_vencimento": (datetime.utcnow() + timedelta(days=5)).strftime(_ISO),
    }, headers=auth_headers).json()
    client.post("/baixar-titulo/", json={
        "id_titulo": titulo["id_titulo"], "valor_pago": 10, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": conta_caixa,
    }, headers=auth_headers)

    r = client.delete(f"/api/plano-contas/{conta_receita}", headers=auth_headers)
    assert r.status_code == 400
    assert "movimento" in r.json()["detail"].lower()

    # conta nunca usada pode ser excluída normalmente.
    conta_livre = _criar_conta(client, auth_headers, "1.1.9202", "Conta nunca usada", tipo="Ativo")
    r = client.delete(f"/api/plano-contas/{conta_livre}", headers=auth_headers)
    assert r.status_code == 200, r.text


def test_conta_financeira_saldo_e_calculado_pela_soma_das_partidas(client, auth_headers, exercicio_financeiro_aberto):
    conta_caixa = _criar_conta(client, auth_headers, "1.1.9300", "Caixa Físico Teste", tipo="Ativo")
    r = client.post("/api/contas-financeiras/", json={
        "id_conta": conta_caixa, "tipo_conta_financeira": "Caixa",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    conta_receita = _criar_conta(client, auth_headers, "3.1.9300", "Receita Teste Saldo", tipo="Receita")
    titulo = client.post("/titulos/", json={
        "tipo_titulo": "A Receber", "id_conta_contabil": conta_receita,
        "descricao": "Entrada de caixa", "valor_original": 75,
        "data_vencimento": (datetime.utcnow() + timedelta(days=5)).strftime(_ISO),
    }, headers=auth_headers).json()
    client.post("/baixar-titulo/", json={
        "id_titulo": titulo["id_titulo"], "valor_pago": 75, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": conta_caixa,
    }, headers=auth_headers)

    contas_financeiras = client.get("/api/contas-financeiras/", headers=auth_headers).json()
    cf = next(c for c in contas_financeiras if c["id_conta"] == conta_caixa)
    assert cf["saldo"] == 75.0

    # não é conta do tipo Ativo - recusada como Conta Financeira.
    conta_despesa = _criar_conta(client, auth_headers, "4.1.9300", "Despesa não pode ser financeira", tipo="Despesa")
    r = client.post("/api/contas-financeiras/", json={
        "id_conta": conta_despesa, "tipo_conta_financeira": "Caixa",
    }, headers=auth_headers)
    assert r.status_code == 400


def test_transferencia_entre_contas_financeiras_move_saldo(client, auth_headers, exercicio_financeiro_aberto):
    conta_caixa = _criar_conta(client, auth_headers, "1.1.9400", "Caixa Origem Transferência", tipo="Ativo")
    conta_banco = _criar_conta(client, auth_headers, "1.1.9401", "Banco Destino Transferência", tipo="Ativo")
    caixa_financeira = client.post("/api/contas-financeiras/", json={
        "id_conta": conta_caixa, "tipo_conta_financeira": "Caixa",
    }, headers=auth_headers).json()["id_conta_financeira"]
    banco_financeira = client.post("/api/contas-financeiras/", json={
        "id_conta": conta_banco, "tipo_conta_financeira": "Conta Corrente",
    }, headers=auth_headers).json()["id_conta_financeira"]

    conta_receita = _criar_conta(client, auth_headers, "3.1.9400", "Receita Teste Transferência", tipo="Receita")
    titulo = client.post("/titulos/", json={
        "tipo_titulo": "A Receber", "id_conta_contabil": conta_receita,
        "descricao": "Entrada antes da transferência", "valor_original": 120,
        "data_vencimento": (datetime.utcnow() + timedelta(days=5)).strftime(_ISO),
    }, headers=auth_headers).json()
    client.post("/baixar-titulo/", json={
        "id_titulo": titulo["id_titulo"], "valor_pago": 120, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": conta_caixa,
    }, headers=auth_headers)

    # mesma conta de origem e destino é recusada.
    r = client.post("/api/transferencias/", json={
        "id_conta_financeira_origem": caixa_financeira, "id_conta_financeira_destino": caixa_financeira,
        "valor": 50, "historico": "Transferência inválida",
    }, headers=auth_headers)
    assert r.status_code == 400

    r = client.post("/api/transferencias/", json={
        "id_conta_financeira_origem": caixa_financeira, "id_conta_financeira_destino": banco_financeira,
        "valor": 50, "historico": "Depósito do caixa no banco",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    contas_financeiras = client.get("/api/contas-financeiras/", headers=auth_headers).json()
    caixa = next(c for c in contas_financeiras if c["id_conta_financeira"] == caixa_financeira)
    banco = next(c for c in contas_financeiras if c["id_conta_financeira"] == banco_financeira)
    assert caixa["saldo"] == 70.0
    assert banco["saldo"] == 50.0

    lancamento = client.get("/api/livro-caixa/", headers=auth_headers).json()["lancamentos"][0]
    assert lancamento["tipo_origem"] == "TRANSFERENCIA"
    total_debito = sum(p["valor"] for p in lancamento["partidas"] if p["tipo_partida"] == "Debito")
    total_credito = sum(p["valor"] for p in lancamento["partidas"] if p["tipo_partida"] == "Credito")
    assert total_debito == total_credito == 50.0


def test_centro_de_custo_opcional_e_registrado_na_partida(client, auth_headers, exercicio_financeiro_aberto):
    r = client.post("/api/centros-custo/", json={"codigo": "CC-9500", "nome": "Projeto Teste v3.1"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_centro_custo = r.json()["id_centro_custo"]

    conta_despesa = _criar_conta(client, auth_headers, "4.1.9500", "Despesa Teste Centro de Custo", tipo="Despesa")
    conta_caixa = _criar_conta(client, auth_headers, "1.1.9500", "Caixa Teste Centro de Custo", tipo="Ativo")
    titulo = client.post("/titulos/", json={
        "tipo_titulo": "A Pagar", "id_conta_contabil": conta_despesa,
        "descricao": "Despesa do projeto", "valor_original": 40,
        "data_vencimento": (datetime.utcnow() + timedelta(days=5)).strftime(_ISO),
    }, headers=auth_headers).json()
    comprovante = client.post(
        "/api/comprovantes/", files={"arquivo": ("nota.jpg", b"conteudo", "image/jpeg")}, headers=auth_headers,
    ).json()["comprovante"]

    r = client.post("/baixar-titulo/", json={
        "id_titulo": titulo["id_titulo"], "valor_pago": 40, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": conta_caixa, "id_centro_custo": id_centro_custo,
        "comprovante": comprovante,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_lancamento = r.json()["id_lancamento"]

    livro = client.get("/api/livro-caixa/", headers=auth_headers).json()
    lancamento = next(l for l in livro["lancamentos"] if l["id_lancamento"] == id_lancamento)
    assert lancamento["comprovante"] == comprovante
    assert all(p["id_centro_custo"] == id_centro_custo for p in lancamento["partidas"])


def test_data_competencia_e_separada_da_data_de_caixa(client, auth_headers, exercicio_financeiro_aberto):
    conta_receita = _criar_conta(client, auth_headers, "3.1.9600", "Receita Teste Competência", tipo="Receita")
    conta_caixa = _criar_conta(client, auth_headers, "1.1.9600", "Caixa Teste Competência", tipo="Ativo")
    titulo = client.post("/titulos/", json={
        "tipo_titulo": "A Receber", "id_conta_contabil": conta_receita,
        "descricao": "Recebido hoje, competência do mês passado", "valor_original": 15,
        "data_vencimento": (datetime.utcnow() + timedelta(days=5)).strftime(_ISO),
    }, headers=auth_headers).json()

    data_competencia = (datetime.utcnow() - timedelta(days=40)).strftime(_ISO)
    r = client.post("/baixar-titulo/", json={
        "id_titulo": titulo["id_titulo"], "valor_pago": 15, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": conta_caixa, "data_competencia": data_competencia,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_lancamento = r.json()["id_lancamento"]

    livro = client.get("/api/livro-caixa/", headers=auth_headers).json()
    lancamento = next(l for l in livro["lancamentos"] if l["id_lancamento"] == id_lancamento)
    assert lancamento["data_competencia"] != lancamento["data"]
    assert lancamento["data_competencia"] == data_competencia[:10]
