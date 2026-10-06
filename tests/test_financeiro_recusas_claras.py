"""v5.4e - recusas que, na conferência ao vivo da homologação, saíam como erro do servidor (500) ou nem eram recusadas: laço no plano de
contas, mudança de código/tipo de conta que já tem filhas/movimento, centro de custo ou fornecedor que não existe, competência com mês
inválido na prévia. Todas viram 400/404 em português, nunca erro de chave do banco."""
from datetime import datetime, timedelta

_ISO = "%Y-%m-%dT%H:%M:%S"


def _conta(client, auth_headers, codigo, descricao, tipo, pai=None):
    corpo = {"codigo_contabil": codigo, "descricao_conta": descricao, "tipo": tipo}
    if pai:
        corpo["codigo_contabil_pai"] = pai
    r = client.post("/plano-contas/", json=corpo, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_conta"]


def _editar(client, auth_headers, id_conta, codigo, descricao, tipo, pai=None):
    corpo = {"codigo_contabil": codigo, "descricao_conta": descricao, "tipo": tipo, "codigo_contabil_pai": pai}
    return client.put(f"/api/plano-contas/{id_conta}", json=corpo, headers=auth_headers)


def test_conta_nao_pode_ter_como_pai_uma_descendente_dela(client, auth_headers):
    avo = _conta(client, auth_headers, "7.1.9001", "Avó do laço", "Despesa")
    _conta(client, auth_headers, "7.1.9001.1", "Filha do laço", "Despesa", pai="7.1.9001")
    _conta(client, auth_headers, "7.1.9001.1.1", "Neta do laço", "Despesa", pai="7.1.9001.1")
    r = _editar(client, auth_headers, avo, "7.1.9001", "Avó do laço", "Despesa", pai="7.1.9001.1.1")
    assert r.status_code == 400
    assert "descendente" in r.json()["detail"]
    # e a conta continua sem pai
    contas = {c["codigo_contabil"]: c for c in client.get("/api/plano-contas/", headers=auth_headers).json()}
    assert contas["7.1.9001"]["codigo_contabil_pai"] is None


def test_mudar_o_codigo_de_conta_com_filhas_e_recusado(client, auth_headers):
    pai = _conta(client, auth_headers, "7.1.9002", "Pai com filha", "Despesa")
    _conta(client, auth_headers, "7.1.9002.1", "Filha que depende do código", "Despesa", pai="7.1.9002")
    r = _editar(client, auth_headers, pai, "7.1.9003", "Pai com filha", "Despesa")
    assert r.status_code == 400
    assert "filhas" in r.json()["detail"]
    # código que já é de outra conta: a recusa certa é a de código repetido, mesmo a conta tendo filhas
    r = _editar(client, auth_headers, pai, "7.1.9002.1", "Pai com filha", "Despesa")
    assert r.status_code == 400
    assert "Já existe uma conta com esse código" in r.json()["detail"]
    # a descrição, sem mudar o código, continua editável
    assert _editar(client, auth_headers, pai, "7.1.9002", "Pai com filha (renomeado)", "Despesa").status_code == 200


def test_mudar_o_tipo_de_conta_com_movimento_e_recusado(client, auth_headers, exercicio_financeiro_aberto):
    despesa = _conta(client, auth_headers, "7.1.9004", "Despesa com movimento", "Despesa")
    caixa = _conta(client, auth_headers, "1.1.9904", "Caixa do movimento", "Ativo")
    titulo = client.post("/titulos/", json={
        "tipo_titulo": "A Pagar", "id_conta_contabil": despesa, "descricao": "Despesa que vai ter movimento", "valor_original": 12.34,
        "data_vencimento": (datetime.utcnow() + timedelta(days=5)).strftime(_ISO),
    }, headers=auth_headers).json()["id_titulo"]
    baixa = client.post("/baixar-titulo/", json={
        "id_titulo": titulo, "valor_pago": 12.34, "forma_pagamento": "Pix", "id_conta_contabil_contrapartida": caixa,
        "comprovante": "/uploads/comprovantes/teste.jpg",
    }, headers=auth_headers)
    assert baixa.status_code == 200, baixa.text
    r = _editar(client, auth_headers, despesa, "7.1.9004", "Despesa com movimento", "Receita")
    assert r.status_code == 400
    assert "movimento" in r.json()["detail"]


def test_excluir_conta_usada_por_conta_recorrente_e_recusado_em_portugues(client, auth_headers):
    conta = _conta(client, auth_headers, "7.1.9005", "Despesa recorrente", "Despesa")
    r = client.post("/api/contas-a-pagar-recorrentes/", json={"descricao": "Aluguel de teste", "valor": 100, "id_conta_contabil": conta, "dia_vencimento": 10}, headers=auth_headers)
    assert r.status_code == 200, r.text
    r = client.delete(f"/api/plano-contas/{conta}", headers=auth_headers)
    assert r.status_code == 400
    assert "não pode ser excluída" in r.json()["detail"]


def test_conta_recorrente_recusa_conta_ou_fornecedor_que_nao_existe(client, auth_headers):
    despesa = _conta(client, auth_headers, "7.1.9006", "Despesa recorrente 2", "Despesa")
    ativo = _conta(client, auth_headers, "1.1.9906", "Caixa recorrente", "Ativo")
    base = {"descricao": "Recorrente de teste", "valor": 50, "dia_vencimento": 5}
    assert client.post("/api/contas-a-pagar-recorrentes/", json={**base, "id_conta_contabil": 99999999}, headers=auth_headers).status_code == 404
    r = client.post("/api/contas-a-pagar-recorrentes/", json={**base, "id_conta_contabil": ativo}, headers=auth_headers)
    assert r.status_code == 400
    assert "despesa" in r.json()["detail"].lower()
    r = client.post("/api/contas-a-pagar-recorrentes/", json={**base, "id_conta_contabil": despesa, "id_fornecedor": 0}, headers=auth_headers)
    assert r.status_code == 404
    assert "Fornecedor" in r.json()["detail"]


def test_baixa_com_centro_de_custo_inexistente_e_404(client, auth_headers, exercicio_financeiro_aberto):
    despesa = _conta(client, auth_headers, "7.1.9007", "Despesa do centro", "Despesa")
    caixa = _conta(client, auth_headers, "1.1.9907", "Caixa do centro", "Ativo")
    titulo = client.post("/titulos/", json={
        "tipo_titulo": "A Pagar", "id_conta_contabil": despesa, "descricao": "Despesa com centro inexistente", "valor_original": 20,
        "data_vencimento": (datetime.utcnow() + timedelta(days=5)).strftime(_ISO),
    }, headers=auth_headers).json()["id_titulo"]
    r = client.post("/baixar-titulo/", json={
        "id_titulo": titulo, "valor_pago": 20, "forma_pagamento": "Pix", "id_conta_contabil_contrapartida": caixa,
        "id_centro_custo": 99999999, "comprovante": "/uploads/comprovantes/teste.jpg",
    }, headers=auth_headers)
    assert r.status_code == 404
    assert "Centro de custo" in r.json()["detail"]


def test_previa_de_contas_a_pagar_recusa_mes_invalido(client, auth_headers):
    for competencia in ("2099-13", "2099-00"):
        r = client.post("/api/contas-a-pagar-recorrentes/gerar/", json={"competencia": competencia, "confirmar": False}, headers=auth_headers)
        assert r.status_code in (400, 422), (competencia, r.text)


def test_relatorio_antifraude_recusa_competencia_invalida_em_400(client, auth_headers):
    for competencia in ("2099-13", "2099-00", "abc", ""):
        r = client.get(f"/api/antifraude/padroes-suspeitos?competencia={competencia}", headers=auth_headers)
        assert r.status_code in (400, 422), (competencia, r.status_code, r.text)


def test_baixa_de_titulo_renegociado_e_recusada(client, auth_headers, exercicio_financeiro_aberto, db):
    from app.models.financeiro import TituloFinanceiro

    despesa = _conta(client, auth_headers, "7.1.9008", "Despesa renegociada", "Despesa")
    caixa = _conta(client, auth_headers, "1.1.9908", "Caixa renegociada", "Ativo")
    titulo = client.post("/titulos/", json={
        "tipo_titulo": "A Pagar", "id_conta_contabil": despesa, "descricao": "Título que será renegociado", "valor_original": 30,
        "data_vencimento": (datetime.utcnow() + timedelta(days=5)).strftime(_ISO),
    }, headers=auth_headers).json()["id_titulo"]
    db.query(TituloFinanceiro).filter(TituloFinanceiro.id_titulo == titulo).update({"status": "Renegociado"})
    db.commit()
    r = client.post("/baixar-titulo/", json={
        "id_titulo": titulo, "valor_pago": 30, "forma_pagamento": "Pix", "id_conta_contabil_contrapartida": caixa,
        "comprovante": "/uploads/comprovantes/teste.jpg",
    }, headers=auth_headers)
    assert r.status_code == 400
    assert "renegociado" in r.json()["detail"]


def test_fechamento_recusa_mes_13_em_vez_de_erro_do_servidor(client, auth_headers):
    r = client.post("/api/fechamentos-mensais/", json={"competencia": "2026-13", "id_conta_financeira": 1, "saldo_extrato_bancario": 0}, headers=auth_headers)
    assert r.status_code == 422
    assert "mês de 01 a 12" in str(r.json()["detail"])


def test_seletor_de_associado_serve_ao_financeiro_mas_a_ficha_completa_nao(client, auth_headers):
    from tests.test_compras import _criar_usuario_com_mandato

    _, headers_tesoureiro = _criar_usuario_com_mandato(client, auth_headers, "TESOUREIRO")
    r = client.get("/api/associados/busca-simples", headers=headers_tesoureiro)
    assert r.status_code == 200 and r.json() and set(r.json()[0]) == {"id_associado", "nome_completo", "cpf_final"}
    assert client.get("/api/associados/", headers=headers_tesoureiro).status_code == 403


def test_recibo_de_doacao_usa_virgula_nos_centavos(client, auth_headers):
    from app.services.formato import reais

    assert reais(87.65) == "R$ 87,65"
    assert reais(1234567.8) == "R$ 1.234.567,80"
    assert reais(0) == "R$ 0,00"
    assert reais(-5) == "-R$ 5,00"


def test_configuracoes_do_evento_recusam_valores_impossiveis(client, auth_headers):
    from datetime import datetime, timedelta

    r = client.post("/api/eventos/", json={
        "titulo": "Evento de configuração impossível", "categoria": "PALESTRA", "visibilidade": "Interna",
        "data_hora_inicio": (datetime.utcnow() + timedelta(days=9)).strftime(_ISO),
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_evento = r.json()["id_evento"]

    # reembolso: percentual de 0 a 100 e prazo de 0 a um ano
    for corpo in ({"prazo_cancelamento_horas": 24, "percentual_reembolso_cancelamento": 150}, {"prazo_cancelamento_horas": -5, "percentual_reembolso_cancelamento": 50}):
        assert client.put(f"/api/eventos/{id_evento}/reembolso-config", json=corpo, headers=auth_headers).status_code == 422
    assert client.put(f"/api/eventos/{id_evento}/reembolso-config", json={"prazo_cancelamento_horas": 48, "percentual_reembolso_cancelamento": 50}, headers=auth_headers).status_code == 200
    # elegibilidade: percentual de 0 a 100 e carga horária positiva
    for corpo in ({"percentual_minimo": 150}, {"carga_horaria_horas": -3}):
        assert client.put(f"/api/eventos/{id_evento}/elegibilidade-config", json=corpo, headers=auth_headers).status_code == 422
    assert client.put(f"/api/eventos/{id_evento}/elegibilidade-config", json={"percentual_minimo": 0, "carga_horaria_horas": 0.5}, headers=auth_headers).status_code == 200
    # cobrança: sem valor que estoura a coluna do banco
    r = client.put(f"/api/eventos/{id_evento}/cobranca-config", json={"valor_base": 99999999999}, headers=auth_headers)
    assert r.status_code == 422
    # vagas negativas na criação
    r = client.post("/api/eventos/", json={
        "titulo": "Evento com vagas negativas", "categoria": "PALESTRA", "visibilidade": "Interna", "vagas": -3,
        "data_hora_inicio": (datetime.utcnow() + timedelta(days=9)).strftime(_ISO),
    }, headers=auth_headers)
    assert r.status_code == 422


def test_criar_projeto_com_termino_antes_do_inicio_e_recusado(client, auth_headers):
    from datetime import datetime, timedelta

    r = client.post("/projetos/", json={
        "nome_projeto": "Projeto com datas trocadas", "tipo_foco": "Social", "necessita_alvara_bombeiros": False,
        "data_inicio": (datetime.utcnow() + timedelta(days=30)).strftime(_ISO),
        "data_fim_prevista": (datetime.utcnow() + timedelta(days=10)).strftime(_ISO),
    }, headers=auth_headers)
    assert r.status_code == 422, r.text
    assert "depois do início" in r.json()["detail"]
