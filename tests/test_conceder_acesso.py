"""v3.0.1 (achado 2026-09-15) - cadastrar ficha nunca deu login pro associado; este é o teste
do endpoint que fecha esse buraco (`POST /api/associados/{id}/conceder-acesso`), a senha
provisória forçando troca no primeiro login, e o novo mínimo de senha (8 caracteres, reduzido
de 10)."""
from tests.test_pessoas import _cpf_unico

_PAYLOAD_BASE = {
    "email_contato": "x@x.com", "telefone_whatsapp": "11900000000", "categoria": "Efetivo",
    "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
    "cidade": "Sao Paulo", "estado": "SP",
}


def _criar_ficha(client, **overrides):
    cpf = _cpf_unico()
    payload = {**_PAYLOAD_BASE, "nome_completo": f"Pessoa Teste Acesso {cpf[-8:]}", "cpf": cpf, "email_contato": f"{cpf}@x.com", **overrides}
    resposta = client.post("/associados-master/", json=payload)
    assert resposta.status_code == 200, resposta.text
    return resposta.json()["id_associado"], cpf


def test_listar_associados_exige_permissao_e_mostra_tem_acesso(client, auth_headers):
    assert client.get("/api/associados/").status_code == 401

    id_associado, cpf = _criar_ficha(client)
    listagem = client.get("/api/associados/", headers=auth_headers).json()
    item = next(a for a in listagem if a["id_associado"] == id_associado)
    assert item["tem_acesso"] is False

    client.post(
        f"/api/associados/{id_associado}/conceder-acesso",
        json={"email": f"{cpf}@lista.example.com", "senha_provisoria": "Provisoria1"},
        headers=auth_headers,
    )
    listagem = client.get("/api/associados/", headers=auth_headers).json()
    item = next(a for a in listagem if a["id_associado"] == id_associado)
    assert item["tem_acesso"] is True


def test_conceder_acesso_exige_permissao(client):
    id_associado, _ = _criar_ficha(client)
    r = client.post(f"/api/associados/{id_associado}/conceder-acesso", json={"email": "a@a.com", "senha_provisoria": "SenhaOk123"})
    assert r.status_code == 401


def test_senha_com_8_caracteres_agora_e_aceita(client, auth_headers):
    id_associado, cpf = _criar_ficha(client)
    r = client.post(
        f"/api/associados/{id_associado}/conceder-acesso",
        json={"email": f"{cpf}@acesso.example.com", "senha_provisoria": "Oito123"[:8]},
        headers=auth_headers,
    )
    # "Oito123"[:8] tem 7 caracteres de propósito, pra confirmar que 7 ainda é recusado.
    assert r.status_code == 400
    assert "8 caracteres" in r.json()["detail"]

    r = client.post(
        f"/api/associados/{id_associado}/conceder-acesso",
        json={"email": f"{cpf}@acesso.example.com", "senha_provisoria": "Oitocar1"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text


def test_fluxo_completo_concede_acesso_login_forca_troca_de_senha(client, auth_headers):
    id_associado, cpf = _criar_ficha(client)

    r = client.post(
        f"/api/associados/{id_associado}/conceder-acesso",
        json={"email": f"{cpf}@acesso.example.com", "senha_provisoria": "Provisoria1"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    # não pode conceder de novo pro mesmo associado.
    r = client.post(
        f"/api/associados/{id_associado}/conceder-acesso",
        json={"email": f"{cpf}@acesso2.example.com", "senha_provisoria": "Provisoria1"},
        headers=auth_headers,
    )
    assert r.status_code == 400

    login = client.post("/auth/login", json={"cpf": cpf, "senha": "Provisoria1"})
    assert login.status_code == 200, login.text
    corpo = login.json()
    assert corpo["senha_provisoria"] is True
    token_provisorio = corpo["access_token"]

    r = client.post(
        "/auth/senha/alterar",
        json={"senha_atual": "Provisoria1", "senha_nova": "SenhaDefinitivaOk1"},
        headers={"Authorization": f"Bearer {token_provisorio}"},
    )
    assert r.status_code == 200, r.text

    login_depois = client.post("/auth/login", json={"cpf": cpf, "senha": "SenhaDefinitivaOk1"})
    assert login_depois.status_code == 200, login_depois.text
    assert login_depois.json()["senha_provisoria"] is False
