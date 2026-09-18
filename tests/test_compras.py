"""v3.3 (FASE 3) - contas a pagar, compras e segregação de funções: solicitação → cotação →
aprovação por alçada → pagamento → conciliação, com "quem solicita nunca aprova a própria
solicitação" e conflito de interesse checados no endpoint. Dados bancários de fornecedor
versionados com segundo aprovador. Reembolso de despesa e contas a pagar recorrentes."""
from datetime import datetime, timedelta

from tests.test_pessoas import _cpf_unico

_PAYLOAD_BASE = {
    "email_contato": "x@x.com", "telefone_whatsapp": "11900000000", "categoria": "Efetivo",
    "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
    "cidade": "Sao Paulo", "estado": "SP",
}


def _criar_usuario_com_mandato(client, auth_headers, cargo_codigo, orgao_codigo="DIRETORIA_EXECUTIVA"):
    """Cria um associado, concede acesso (senha provisória) e dá posse num mandato com o cargo
    pedido - cargo concede permissão 'financeiro' automaticamente (v2.1) quando o catálogo
    já vincula essa permissão ao cargo (TESOUREIRO/VICE_TESOUREIRO/PRESIDENTE, ver seed_catalogos).
    Retorna (id_associado, headers_de_autenticacao_proprios)."""
    cpf = _cpf_unico()
    # Achado real em produção de CI (Ponto de Revisão FASE 4 2/3): nome com só 4 dígitos de
    # sufixo + telefone hardcoded compartilhado por toda chamada deste helper colidia com
    # `detectar_cadastro_duplicado` (v1.8) sob paradoxo do aniversário - mesma categoria de bug já
    # corrigida em `_criar_associado` (v4.3). Aumentado pro CPF inteiro, colisão praticamente nula.
    payload = {**_PAYLOAD_BASE, "nome_completo": f"Pessoa Compras {cpf}", "cpf": cpf, "email_contato": f"{cpf}@x.com"}
    r = client.post("/associados-master/", json=payload)
    assert r.status_code == 200, r.text
    id_associado = r.json()["id_associado"]

    senha = "SenhaForteTeste1"
    r = client.post(f"/api/associados/{id_associado}/conceder-acesso", json={"email": f"{cpf}@acesso.example.com", "senha_provisoria": senha}, headers=auth_headers)
    assert r.status_code == 200, r.text

    login = client.post("/auth/login", json={"cpf": cpf, "senha": senha})
    assert login.status_code == 200, login.text
    headers_proprios = {"Authorization": f"Bearer {login.json()['access_token']}"}

    r = client.post("/api/mandatos/", json={
        "id_associado": id_associado, "orgao_codigo": orgao_codigo, "cargo_codigo": cargo_codigo,
        "data_inicio": datetime.utcnow().date().isoformat(),
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    return id_associado, headers_proprios


def _criar_conta(client, auth_headers, codigo, tipo):
    r = client.post("/plano-contas/", json={"codigo_contabil": codigo, "descricao_conta": f"Conta {tipo} teste compras", "tipo": tipo}, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_conta"]


def _criar_fornecedor(client, auth_headers, cnpj_sufixo):
    r = client.post("/fornecedores/", json={
        "razao_social": "Fornecedor Teste Compras", "cnpj": f"1122334455{cnpj_sufixo}"[:14].ljust(14, "0"),
        "categoria_servico": "Outros", "telefone": "11999999999",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_fornecedor"]


def _criar_alcada(client, auth_headers, cargos, valor_minimo=0, valor_maximo=None, dupla=False):
    r = client.post("/api/alcadas-aprovacao/", json={
        "valor_minimo": valor_minimo, "valor_maximo": valor_maximo, "cargos_autorizados": cargos, "exige_dupla_assinatura": dupla,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_alcada"]


def _criar_solicitacao(client, headers, conta, valor=500, id_fornecedor=None):
    r = client.post("/api/solicitacoes-compra/", json={
        "descricao": "Compra de teste", "valor_estimado": valor, "id_conta_contabil": conta, "id_fornecedor": id_fornecedor,
    }, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id_solicitacao"]


def test_segregacao_solicitante_nao_pode_aprovar_propria_solicitacao(client, auth_headers):
    conta = _criar_conta(client, auth_headers, "4.1.9910", "Despesa")
    _criar_alcada(client, auth_headers, ["PRESIDENTE", "TESOUREIRO"], valor_minimo=100, valor_maximo=180)
    id_solicitacao = _criar_solicitacao(client, auth_headers, conta, valor=150)

    r = client.post(f"/api/solicitacoes-compra/{id_solicitacao}/aprovar", headers=auth_headers)
    assert r.status_code == 403
    assert "segregação" in r.json()["detail"].lower() or "não pode aprová-la" in r.json()["detail"].lower()


def test_aprovacao_exige_cargo_da_alcada(client, auth_headers):
    conta = _criar_conta(client, auth_headers, "4.1.9911", "Despesa")
    _criar_alcada(client, auth_headers, ["TESOUREIRO"], valor_minimo=200, valor_maximo=280)
    id_solicitacao = _criar_solicitacao(client, auth_headers, conta, valor=250)

    # CONSELHO_FISCAL já tem permissão 'financeiro' (passa no Depends do endpoint), mas não é o
    # cargo exigido por ESTA alçada (só TESOUREIRO) - testa a checagem de alçada, não a de
    # permissão genérica do endpoint.
    _, headers_sem_cargo = _criar_usuario_com_mandato(client, auth_headers, "CONSELHO_FISCAL")
    r = client.post(f"/api/solicitacoes-compra/{id_solicitacao}/aprovar", headers=headers_sem_cargo)
    assert r.status_code == 403
    assert "cargo" in r.json()["detail"].lower()

    _, headers_tesoureiro = _criar_usuario_com_mandato(client, auth_headers, "TESOUREIRO")
    r = client.post(f"/api/solicitacoes-compra/{id_solicitacao}/aprovar", headers=headers_tesoureiro)
    assert r.status_code == 200, r.text
    assert r.json()["id_titulo_gerado"] is not None

    titulos = client.get("/api/titulos/", headers=auth_headers).json()
    titulo = next(t for t in titulos if t["id_titulo"] == r.json()["id_titulo_gerado"])
    assert titulo["tipo_titulo"] == "A Pagar"
    assert titulo["valor_original"] == 250.0


def test_dupla_assinatura_exige_duas_aprovacoes_distintas(client, auth_headers):
    conta = _criar_conta(client, auth_headers, "4.1.9912", "Despesa")
    _criar_alcada(client, auth_headers, ["TESOUREIRO", "PRESIDENTE"], valor_minimo=300, valor_maximo=380, dupla=True)
    id_solicitacao = _criar_solicitacao(client, auth_headers, conta, valor=350)

    _, headers_tesoureiro = _criar_usuario_com_mandato(client, auth_headers, "TESOUREIRO")
    _, headers_presidente = _criar_usuario_com_mandato(client, auth_headers, "PRESIDENTE")

    r = client.post(f"/api/solicitacoes-compra/{id_solicitacao}/aprovar", headers=headers_tesoureiro)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "Aguardando Aprovação"
    assert r.json()["aprovacoes"] == 1

    # a mesma pessoa não pode aprovar de novo (conta em dobro pra dupla assinatura).
    r = client.post(f"/api/solicitacoes-compra/{id_solicitacao}/aprovar", headers=headers_tesoureiro)
    assert r.status_code == 400

    r = client.post(f"/api/solicitacoes-compra/{id_solicitacao}/aprovar", headers=headers_presidente)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "Aprovada"
    assert r.json()["id_titulo_gerado"] is not None


def test_cotacao_exigida_acima_do_valor_configurado(client, auth_headers):
    client.put("/api/configuracoes/VALOR_MINIMO_EXIGE_COTACAO", json={"valor": "1000"}, headers=auth_headers)
    conta = _criar_conta(client, auth_headers, "4.1.9913", "Despesa")
    fornecedor1 = _criar_fornecedor(client, auth_headers, "01")
    fornecedor2 = _criar_fornecedor(client, auth_headers, "02")
    _criar_alcada(client, auth_headers, ["TESOUREIRO"], valor_minimo=130001, valor_maximo=140000)
    id_solicitacao = _criar_solicitacao(client, auth_headers, conta, valor=135000)

    _, headers_tesoureiro = _criar_usuario_com_mandato(client, auth_headers, "TESOUREIRO")
    r = client.post(f"/api/solicitacoes-compra/{id_solicitacao}/aprovar", headers=headers_tesoureiro)
    assert r.status_code == 400
    assert "cotaç" in r.json()["detail"].lower()

    client.post(f"/api/solicitacoes-compra/{id_solicitacao}/cotacoes", json={"id_fornecedor": fornecedor1, "valor": 4900}, headers=auth_headers)
    client.post(f"/api/solicitacoes-compra/{id_solicitacao}/cotacoes", json={"id_fornecedor": fornecedor2, "valor": 5100}, headers=auth_headers)

    r = client.post(f"/api/solicitacoes-compra/{id_solicitacao}/aprovar", headers=headers_tesoureiro)
    assert r.status_code == 200, r.text


def test_conflito_interesse_bloqueia_aprovador(client, auth_headers):
    conta = _criar_conta(client, auth_headers, "4.1.9914", "Despesa")
    fornecedor = _criar_fornecedor(client, auth_headers, "03")
    _criar_alcada(client, auth_headers, ["TESOUREIRO"], valor_minimo=400, valor_maximo=480)
    id_solicitacao = _criar_solicitacao(client, auth_headers, conta, valor=450, id_fornecedor=fornecedor)

    id_associado_tesoureiro, headers_tesoureiro = _criar_usuario_com_mandato(client, auth_headers, "TESOUREIRO")
    client.post("/api/mandatos/conflitos-interesse", json={
        "id_associado": id_associado_tesoureiro, "descricao": "Parente é sócio do fornecedor.", "id_fornecedor": fornecedor,
    }, headers=auth_headers)

    r = client.post(f"/api/solicitacoes-compra/{id_solicitacao}/aprovar", headers=headers_tesoureiro)
    assert r.status_code == 403
    assert "conflito" in r.json()["detail"].lower()


def test_delegacao_temporaria_permite_aprovacao_por_outra_pessoa(client, auth_headers):
    conta = _criar_conta(client, auth_headers, "4.1.9915", "Despesa")
    _criar_alcada(client, auth_headers, ["TESOUREIRO"], valor_minimo=500, valor_maximo=580)
    id_solicitacao = _criar_solicitacao(client, auth_headers, conta, valor=550)

    id_associado_tesoureiro, _ = _criar_usuario_com_mandato(client, auth_headers, "TESOUREIRO")
    # CONSELHO_FISCAL tem permissão 'financeiro' (passa no Depends do endpoint) mas não é
    # TESOUREIRO - só a delegação deve permitir aprovar esta alçada.
    id_associado_delegado, headers_delegado = _criar_usuario_com_mandato(client, auth_headers, "CONSELHO_FISCAL")

    hoje = datetime.utcnow()
    r = client.post("/api/delegacoes-aprovacao/", json={
        "id_associado_delegante": id_associado_tesoureiro, "id_associado_delegado": id_associado_delegado,
        "data_fim": (hoje + timedelta(days=10)).isoformat(), "motivo": "Tesoureiro de férias, delega ao diretor social.",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    r = client.post(f"/api/solicitacoes-compra/{id_solicitacao}/aprovar", headers=headers_delegado)
    assert r.status_code == 200, r.text

    aprovacoes = client.get(f"/api/solicitacoes-compra/{id_solicitacao}/aprovacoes", headers=auth_headers).json()
    assert aprovacoes[0]["id_delegacao_usada"] is not None


def test_dados_bancarios_fornecedor_exige_segundo_aprovador(client, auth_headers):
    fornecedor = _criar_fornecedor(client, auth_headers, "04")
    r = client.post("/api/fornecedores/dados-bancarios", json={
        "id_fornecedor": fornecedor, "banco": "Banco Teste", "agencia": "0001", "conta": "12345-6",
        "tipo_conta": "Corrente", "titular": "Fornecedor Teste Compras",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_dados = r.json()["id_dados_bancarios"]

    # quem solicitou não pode aprovar a própria troca (mesmo usuário/token = admin nos dois).
    r = client.post(f"/api/fornecedores/dados-bancarios/{id_dados}/aprovar", headers=auth_headers)
    assert r.status_code == 400
    assert "não pode aprová-la" in r.json()["detail"].lower()

    _, headers_outro = _criar_usuario_com_mandato(client, auth_headers, "TESOUREIRO")
    r = client.post(f"/api/fornecedores/dados-bancarios/{id_dados}/aprovar", headers=headers_outro)
    assert r.status_code == 200, r.text

    historico = client.get(f"/api/fornecedores/{fornecedor}/dados-bancarios", headers=auth_headers).json()
    assert historico[0]["status"] == "Aprovado"


def test_reembolso_despesa_segregacao_e_gera_titulo(client, auth_headers):
    # id_associado é o BENEFICIÁRIO do reembolso (voluntário/dirigente) - não precisa ter acesso
    # ao sistema; quem opera o sistema (id_usuario_solicitante) é sempre um financeiro/tesouraria,
    # e é essa pessoa que a segregação de funções impede de também aprovar o que ela mesma lançou.
    conta = _criar_conta(client, auth_headers, "4.1.9916", "Despesa")
    id_associado_beneficiario, _ = _criar_usuario_com_mandato(client, auth_headers, "DIRETOR_SOCIAL")
    _, headers_tesouraria = _criar_usuario_com_mandato(client, auth_headers, "TESOUREIRO")

    r = client.post("/api/reembolsos-despesa/", json={
        "id_associado": id_associado_beneficiario, "descricao": "Combustível para evento", "valor": 120,
        "comprovante": "/uploads/comprovantes/teste.pdf", "id_conta_contabil": conta,
    }, headers=headers_tesouraria)
    assert r.status_code == 200, r.text
    id_reembolso = r.json()["id_reembolso"]

    # o próprio usuário que lançou o reembolso não pode aprová-lo, mesmo sendo da tesouraria.
    r = client.post(f"/api/reembolsos-despesa/{id_reembolso}/aprovar", headers=headers_tesouraria)
    assert r.status_code == 400

    r = client.post(f"/api/reembolsos-despesa/{id_reembolso}/aprovar", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["id_titulo_gerado"] is not None


def test_gerar_contas_a_pagar_recorrentes_idempotente_por_competencia(client, auth_headers):
    conta = _criar_conta(client, auth_headers, "4.1.9917", "Despesa")
    r = client.post("/api/contas-a-pagar-recorrentes/", json={
        "descricao": "Aluguel da sede", "valor": 2000, "id_conta_contabil": conta, "dia_vencimento": 5,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    competencia = "2099-06"
    r = client.post("/api/contas-a-pagar-recorrentes/gerar/", json={"competencia": competencia, "confirmar": True}, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["total_gerados"] >= 1

    r = client.post("/api/contas-a-pagar-recorrentes/gerar/", json={"competencia": competencia, "confirmar": True}, headers=auth_headers)
    assert r.json()["total_gerados"] == 0
    assert r.json()["total_ja_existentes"] >= 1


def test_validar_situacao_cadastral_nunca_bloqueia_se_api_estiver_fora(client, auth_headers, monkeypatch):
    from app.services import fornecedores

    def _falha(*args, **kwargs):
        raise ConnectionError("simulando API fora do ar")

    monkeypatch.setattr(fornecedores.httpx, "get", _falha)
    fornecedor = _criar_fornecedor(client, auth_headers, "05")

    r = client.post(f"/api/fornecedores/{fornecedor}/validar-situacao-cadastral", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["situacao_cadastral"] == "Não verificado"


def test_validar_situacao_cadastral_usa_resposta_da_api(client, auth_headers, monkeypatch):
    from app.services import fornecedores

    class _RespostaFalsa:
        def raise_for_status(self):
            pass

        def json(self):
            return {"descricao_situacao_cadastral": "ATIVA"}

    monkeypatch.setattr(fornecedores.httpx, "get", lambda *a, **kw: _RespostaFalsa())
    fornecedor = _criar_fornecedor(client, auth_headers, "06")

    r = client.post(f"/api/fornecedores/{fornecedor}/validar-situacao-cadastral", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["situacao_cadastral"] == "ATIVA"
