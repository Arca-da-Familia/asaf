"""v1.4 - licença, desligamento, readmissão e anonimização de dado pessoal pós-desligamento.
Cobre o que o usuário pediu explicitamente: dado sensível (CPF, contato, etc.) some após o
prazo de retenção configurável, mas nome/matrícula/financeiro nunca são apagados."""
from datetime import date, timedelta

from tests.test_pessoas import _cpf_unico


def _criar_associado(client, **overrides):
    payload = {
        "nome_completo": "Pessoa Situacao Teste", "cpf": _cpf_unico(), "email_contato": "x@x.com",
        "telefone_whatsapp": "11900000000", "categoria": "Efetivo",
        "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
        "cidade": "Sao Paulo", "estado": "SP",
        **overrides,
    }
    return client.post("/associados-master/", json=payload).json()


def test_licenca_muda_categoria_para_licenciado(client, auth_headers):
    associado = _criar_associado(client)
    resposta = client.post(
        f"/api/associados/{associado['id_associado']}/licenca", headers=auth_headers,
        json={"motivo": "SAUDE", "data_inicio": str(date.today()), "data_fim_prevista": str(date.today() + timedelta(days=30))},
    )
    assert resposta.status_code == 200, resposta.text
    assert resposta.json()["status_arrolamento"] == "Licenciado"

    calculada = client.get(f"/api/associados/{associado['id_associado']}/categoria-calculada").json()
    assert calculada["categoria_calculada_agora"] == "Licenciado"


def test_desligar_com_motivo_invalido_e_recusado(client, auth_headers):
    associado = _criar_associado(client)
    resposta = client.post(
        f"/api/associados/{associado['id_associado']}/desligar", headers=auth_headers,
        json={"motivo": "MOTIVO_QUE_NAO_EXISTE", "data_efetiva": str(date.today())},
    )
    assert resposta.status_code == 422


def test_desligar_invalida_papel_e_bloqueia_carteirinha(client, auth_headers):
    associado = _criar_associado(client)
    carteirinha = client.get(f"/api/associados/{associado['id_associado']}/carteirinha").json()
    ainda_valida = client.get(carteirinha["url_verificacao"])
    assert ainda_valida.status_code == 200

    resposta = client.post(
        f"/api/associados/{associado['id_associado']}/desligar", headers=auth_headers,
        json={"motivo": "PEDIDO_VOLUNTARIO", "data_efetiva": str(date.today())},
    )
    assert resposta.status_code == 200, resposta.text

    apos_desligar = client.get(carteirinha["url_verificacao"])
    assert apos_desligar.status_code == 404


def test_desligar_duas_vezes_falha(client, auth_headers):
    associado = _criar_associado(client)
    client.post(
        f"/api/associados/{associado['id_associado']}/desligar", headers=auth_headers,
        json={"motivo": "PEDIDO_VOLUNTARIO", "data_efetiva": str(date.today())},
    )
    segunda = client.post(
        f"/api/associados/{associado['id_associado']}/desligar", headers=auth_headers,
        json={"motivo": "PEDIDO_VOLUNTARIO", "data_efetiva": str(date.today())},
    )
    assert segunda.status_code == 400


def test_readmissao_reativa_papel_e_zera_data_desligamento(client, auth_headers):
    associado = _criar_associado(client)
    client.post(
        f"/api/associados/{associado['id_associado']}/desligar", headers=auth_headers,
        json={"motivo": "PEDIDO_VOLUNTARIO", "data_efetiva": str(date.today())},
    )
    resposta = client.post(f"/api/associados/{associado['id_associado']}/readmitir", headers=auth_headers, json={})
    assert resposta.status_code == 200, resposta.text
    assert resposta.json()["status_arrolamento"] == "Ativo - Em Dia"

    carteirinha = client.get(f"/api/associados/{associado['id_associado']}/carteirinha").json()
    verificacao = client.get(carteirinha["url_verificacao"])
    assert verificacao.status_code == 200


def test_readmitir_associado_nao_desligado_falha(client, auth_headers):
    associado = _criar_associado(client)
    resposta = client.post(f"/api/associados/{associado['id_associado']}/readmitir", headers=auth_headers, json={})
    assert resposta.status_code == 400


def test_anonimizar_antes_do_prazo_e_recusado(client, auth_headers):
    associado = _criar_associado(client)
    client.post(
        f"/api/associados/{associado['id_associado']}/desligar", headers=auth_headers,
        json={"motivo": "PEDIDO_VOLUNTARIO", "data_efetiva": str(date.today())},
    )
    resposta = client.post(f"/api/associados/{associado['id_associado']}/anonimizar", headers=auth_headers)
    assert resposta.status_code == 400
    assert "prazo de retenção" in resposta.json()["detail"]


def test_anonimizar_depois_do_prazo_apaga_dado_sensivel_mas_preserva_nome_e_matricula(client, auth_headers):
    associado = _criar_associado(client)
    client.put(
        f"/api/configuracoes/PRAZO_RETENCAO_DESLIGADO_DIAS", headers=auth_headers, json={"valor": "0"},
    )
    client.post(
        f"/api/associados/{associado['id_associado']}/desligar", headers=auth_headers,
        json={"motivo": "PEDIDO_VOLUNTARIO", "data_efetiva": str(date.today() - timedelta(days=1))},
    )
    resposta = client.post(f"/api/associados/{associado['id_associado']}/anonimizar", headers=auth_headers)
    assert resposta.status_code == 200, resposta.text

    nomes = {a["id_associado"]: a["nome_completo"] for a in client.get("/api/associados/busca-simples").json()}
    assert nomes[associado["id_associado"]] == "Pessoa Situacao Teste"

    perfil = client.get(f"/api/associados/{associado['id_associado']}/completude").json()
    assert "cpf" in perfil["campos_faltando"]
    assert "email_contato" in perfil["campos_faltando"]


def test_anonimizar_em_lote_processa_so_os_vencidos(client, auth_headers):
    client.put(f"/api/configuracoes/PRAZO_RETENCAO_DESLIGADO_DIAS", headers=auth_headers, json={"valor": "0"})

    vencido = _criar_associado(client)
    client.post(
        f"/api/associados/{vencido['id_associado']}/desligar", headers=auth_headers,
        json={"motivo": "PEDIDO_VOLUNTARIO", "data_efetiva": str(date.today() - timedelta(days=1))},
    )
    ainda_ativo = _criar_associado(client)

    resposta = client.post("/api/associados/anonimizar-vencidos", headers=auth_headers)
    assert resposta.status_code == 200
    assert resposta.json()["total"] >= 1

    nomes = {a["id_associado"]: a for a in client.get("/api/associados/busca-simples").json()}
    assert nomes[ainda_ativo["id_associado"]]["cpf_final"] != ""


def test_historico_situacao_registra_eventos(client, auth_headers):
    associado = _criar_associado(client)
    client.post(
        f"/api/associados/{associado['id_associado']}/desligar", headers=auth_headers,
        json={"motivo": "PEDIDO_VOLUNTARIO", "data_efetiva": str(date.today())},
    )
    client.post(f"/api/associados/{associado['id_associado']}/readmitir", headers=auth_headers, json={})

    historico = client.get(f"/api/associados/{associado['id_associado']}/historico-situacao", headers=auth_headers).json()
    tipos = [e["tipo"] for e in historico]
    assert "desligamento" in tipos
    assert "readmissao" in tipos


def test_endpoints_de_situacao_exigem_autenticacao(client):
    associado_qualquer = 1
    assert client.post(f"/api/associados/{associado_qualquer}/desligar", json={"motivo": "x", "data_efetiva": str(date.today())}).status_code == 401
    assert client.post(f"/api/associados/{associado_qualquer}/readmitir", json={}).status_code == 401
    assert client.post("/api/associados/anonimizar-vencidos").status_code == 401
