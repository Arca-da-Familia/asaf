"""v3.4 (FASE 3) - doações, captação e recibos: doação monetária vira título + lançamento de
verdade, recibo numerado emitido automaticamente, destinação específica (centro de custo
"restrito") bloqueia gasto em outra finalidade sem remanejamento formal."""
import uuid
from datetime import datetime, timedelta

from tests.test_pessoas import _cpf_unico


def _criar_conta(client, auth_headers, tipo):
    r = client.post("/plano-contas/", json={
        "codigo_contabil": f"C{uuid.uuid4().hex[:8]}", "descricao_conta": f"Conta {tipo} teste doacao", "tipo": tipo,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_conta"]


def _criar_centro_custo(client, auth_headers):
    r = client.post("/api/centros-custo/", json={"codigo": f"CC{uuid.uuid4().hex[:8]}", "nome": "Projeto Teste Doação"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_centro_custo"]


def _marcar_restrito(client, auth_headers, id_centro_custo, restrito=True):
    r = client.put(f"/api/centros-custo/{id_centro_custo}/saldo-restrito?saldo_restrito={str(restrito).lower()}", headers=auth_headers)
    assert r.status_code == 200, r.text


def test_doacao_monetaria_gera_titulo_pago_e_recibo_numerado(client, auth_headers, exercicio_financeiro_aberto):
    conta_receita = _criar_conta(client, auth_headers, "Receita")
    conta_caixa = _criar_conta(client, auth_headers, "Ativo")

    r = client.post("/api/doacoes/", json={
        "nome_doador": "Fulano de Tal", "documento_doador": "11111111111", "tipo_doacao": "Monetaria",
        "valor": 250, "id_conta_contabil": conta_receita, "id_conta_contabil_caixa": conta_caixa,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    numero_recibo_1 = r.json()["numero_recibo"]
    assert numero_recibo_1 is not None
    id_doacao = r.json()["id_doacao"]

    doacoes = client.get("/api/doacoes/", headers=auth_headers).json()
    doacao = next(d for d in doacoes if d["id_doacao"] == id_doacao)
    assert doacao["id_titulo"] is not None

    titulos = client.get("/api/titulos/", headers=auth_headers).json()
    titulo = next(t for t in titulos if t["id_titulo"] == doacao["id_titulo"])
    assert titulo["status"] == "Pago"
    assert titulo["valor_original"] == 250.0

    recibo = client.get(f"/api/doacoes/{id_doacao}/recibo", headers=auth_headers).json()
    assert f"Nº {numero_recibo_1}" in recibo["texto"]
    assert "Fulano de Tal" in recibo["texto"]

    # segunda doação recebe o próximo número de recibo.
    r2 = client.post("/api/doacoes/", json={
        "nome_doador": "Beltrano", "tipo_doacao": "Monetaria", "valor": 50,
        "id_conta_contabil": conta_receita, "id_conta_contabil_caixa": conta_caixa,
    }, headers=auth_headers)
    assert r2.json()["numero_recibo"] == numero_recibo_1 + 1


def test_doacao_anonima_nao_expoe_nome_nem_documento(client, auth_headers, exercicio_financeiro_aberto):
    conta_receita = _criar_conta(client, auth_headers, "Receita")
    conta_caixa = _criar_conta(client, auth_headers, "Ativo")

    r = client.post("/api/doacoes/", json={
        "anonima": True, "nome_doador": "Nome que deveria ser ignorado", "tipo_doacao": "Monetaria",
        "valor": 100, "id_conta_contabil": conta_receita, "id_conta_contabil_caixa": conta_caixa,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_doacao = r.json()["id_doacao"]

    doacoes = client.get("/api/doacoes/", headers=auth_headers).json()
    doacao = next(d for d in doacoes if d["id_doacao"] == id_doacao)
    assert doacao["nome_doador"] is None
    assert doacao["documento_doador"] is None

    recibo = client.get(f"/api/doacoes/{id_doacao}/recibo", headers=auth_headers).json()
    assert "anônimo" in recibo["texto"].lower()
    assert "Nome que deveria ser ignorado" not in recibo["texto"]


def test_doacao_em_bens_nao_gera_titulo(client, auth_headers):
    conta_receita = _criar_conta(client, auth_headers, "Receita")

    r = client.post("/api/doacoes/", json={
        "nome_doador": "Doador de Bens", "tipo_doacao": "Bens", "valor": 500,
        "descricao_bem": "Computador usado", "id_conta_contabil": conta_receita,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_doacao = r.json()["id_doacao"]

    doacoes = client.get("/api/doacoes/", headers=auth_headers).json()
    doacao = next(d for d in doacoes if d["id_doacao"] == id_doacao)
    assert doacao["id_titulo"] is None
    assert doacao["descricao_bem"] == "Computador usado"


def test_destinacao_especifica_bloqueia_gasto_em_outra_finalidade(client, auth_headers, exercicio_financeiro_aberto):
    conta_receita = _criar_conta(client, auth_headers, "Receita")
    conta_caixa = _criar_conta(client, auth_headers, "Ativo")
    conta_despesa = _criar_conta(client, auth_headers, "Despesa")
    centro_custo = _criar_centro_custo(client, auth_headers)
    _marcar_restrito(client, auth_headers, centro_custo, True)

    # doa 100 com destinação específica.
    client.post("/api/doacoes/", json={
        "nome_doador": "Doador Destinado", "tipo_doacao": "Monetaria", "valor": 100,
        "id_conta_contabil": conta_receita, "id_conta_contabil_caixa": conta_caixa,
        "id_centro_custo_destinacao": centro_custo,
    }, headers=auth_headers)

    saldo = client.get(f"/api/centros-custo/{centro_custo}/saldo-restrito", headers=auth_headers).json()
    assert saldo["saldo_disponivel"] == 100.0

    _criar_alcada = lambda: client.post("/api/alcadas-aprovacao/", json={
        "valor_minimo": 0, "valor_maximo": None, "cargos_autorizados": ["PRESIDENTE"], "exige_dupla_assinatura": False,
    }, headers=auth_headers)
    _criar_alcada()

    # tenta gastar 150 (mais que o saldo restrito de 100) contra esse centro de custo.
    r = client.post("/api/solicitacoes-compra/", json={
        "descricao": "Compra fora do saldo restrito", "valor_estimado": 150,
        "id_conta_contabil": conta_despesa, "id_centro_custo": centro_custo,
    }, headers=auth_headers)
    id_solicitacao = r.json()["id_solicitacao"]

    cpf = _cpf_unico()
    payload = {
        "nome_completo": f"Presidente Teste {cpf[-8:]}", "cpf": cpf, "email_contato": f"{cpf}@x.com",
        "telefone_whatsapp": "11900000000", "categoria": "Efetivo",
        "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
        "cidade": "Sao Paulo", "estado": "SP",
    }
    id_associado = client.post("/associados-master/", json=payload).json()["id_associado"]
    senha = "SenhaForteTeste1"
    client.post(f"/api/associados/{id_associado}/conceder-acesso", json={"email": f"{cpf}@acesso.example.com", "senha_provisoria": senha}, headers=auth_headers)
    login = client.post("/auth/login", json={"cpf": cpf, "senha": senha})
    headers_presidente = {"Authorization": f"Bearer {login.json()['access_token']}"}
    client.post("/api/mandatos/", json={
        "id_associado": id_associado, "orgao_codigo": "DIRETORIA_EXECUTIVA", "cargo_codigo": "PRESIDENTE",
        "data_inicio": datetime.utcnow().date().isoformat(),
    }, headers=auth_headers)

    r = client.post(f"/api/solicitacoes-compra/{id_solicitacao}/aprovar", headers=headers_presidente)
    assert r.status_code == 400
    assert "saldo insuficiente" in r.json()["detail"].lower() or "remanejamento" in r.json()["detail"].lower()

    # a aprovação recusada NÃO deixou o aprovador travado (nenhuma AprovacaoCompra "gasta").
    aprovacoes = client.get(f"/api/solicitacoes-compra/{id_solicitacao}/aprovacoes", headers=auth_headers).json()
    assert aprovacoes == []

    # com remanejamento formal trazendo mais 50 de outro centro de custo, a aprovação passa.
    outro_centro = _criar_centro_custo(client, auth_headers)
    _marcar_restrito(client, auth_headers, outro_centro, True)
    client.post("/api/doacoes/", json={
        "nome_doador": "Outro Doador", "tipo_doacao": "Monetaria", "valor": 100,
        "id_conta_contabil": conta_receita, "id_conta_contabil_caixa": conta_caixa,
        "id_centro_custo_destinacao": outro_centro,
    }, headers=auth_headers)

    r = client.post("/api/remanejamentos-destinacao/", json={
        "id_centro_custo_origem": outro_centro, "id_centro_custo_destino": centro_custo,
        "valor": 60, "motivo": "Remanejamento formal aprovado pela diretoria para cobrir a compra.",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    saldo_depois = client.get(f"/api/centros-custo/{centro_custo}/saldo-restrito", headers=auth_headers).json()
    assert saldo_depois["saldo_disponivel"] == 160.0

    r = client.post(f"/api/solicitacoes-compra/{id_solicitacao}/aprovar", headers=headers_presidente)
    assert r.status_code == 200, r.text
    assert r.json()["id_titulo_gerado"] is not None


def test_remanejamento_recusa_valor_maior_que_saldo_disponivel(client, auth_headers, exercicio_financeiro_aberto):
    conta_receita = _criar_conta(client, auth_headers, "Receita")
    conta_caixa = _criar_conta(client, auth_headers, "Ativo")
    origem = _criar_centro_custo(client, auth_headers)
    destino = _criar_centro_custo(client, auth_headers)
    _marcar_restrito(client, auth_headers, origem, True)

    client.post("/api/doacoes/", json={
        "nome_doador": "Doador Pequeno", "tipo_doacao": "Monetaria", "valor": 30,
        "id_conta_contabil": conta_receita, "id_conta_contabil_caixa": conta_caixa,
        "id_centro_custo_destinacao": origem,
    }, headers=auth_headers)

    r = client.post("/api/remanejamentos-destinacao/", json={
        "id_centro_custo_origem": origem, "id_centro_custo_destino": destino,
        "valor": 999, "motivo": "Tentativa de remanejar mais do que existe disponível.",
    }, headers=auth_headers)
    assert r.status_code == 400
    assert "insuficiente" in r.json()["detail"].lower()


def test_campanha_arrecadacao_soma_doacoes_vinculadas(client, auth_headers):
    conta_receita = _criar_conta(client, auth_headers, "Receita")
    conta_caixa = _criar_conta(client, auth_headers, "Ativo")

    r = client.post("/api/campanhas-arrecadacao/", json={
        "titulo": "Campanha de Teste", "meta_valor": 1000,
        "prazo": (datetime.utcnow() + timedelta(days=30)).isoformat(),
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_campanha = r.json()["id_campanha"]

    for valor in (100, 250):
        client.post("/api/doacoes/", json={
            "nome_doador": "Doador Campanha", "tipo_doacao": "Monetaria", "valor": valor,
            "id_conta_contabil": conta_receita, "id_conta_contabil_caixa": conta_caixa, "id_campanha": id_campanha,
        }, headers=auth_headers)

    campanhas = client.get("/api/campanhas-arrecadacao/", headers=auth_headers).json()
    campanha = next(c for c in campanhas if c["id_campanha"] == id_campanha)
    assert campanha["valor_arrecadado"] == 350.0
    assert campanha["meta_valor"] == 1000.0
