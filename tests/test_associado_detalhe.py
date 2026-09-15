"""v2.5.1 (FASE 2.5 - Painel) - back-end da tela de detalhe/edição de associado: GET de um só
associado (não existia), edição, cargos e família, todos agora exigindo autenticação (achado
2026-09-15: estavam todos sem nenhuma, mesma classe de pendência já corrigida no financeiro)."""
from datetime import datetime, timedelta

from tests.test_pessoas import _cpf_unico

_PAYLOAD_BASE = {
    "email_contato": "x@x.com", "telefone_whatsapp": "11900000000", "categoria": "Efetivo",
    "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
    "cidade": "Sao Paulo", "estado": "SP",
}


def _criar_ficha(client, **overrides):
    cpf = _cpf_unico()
    payload = {**_PAYLOAD_BASE, "nome_completo": f"Pessoa Teste Detalhe {cpf[-4:]}", "cpf": cpf, "email_contato": f"{cpf}@x.com", **overrides}
    resposta = client.post("/associados-master/", json=payload)
    assert resposta.status_code == 200, resposta.text
    return resposta.json()["id_associado"]


def test_detalhe_e_edicao_exigem_permissao(client):
    id_associado = _criar_ficha(client)
    assert client.get(f"/api/associados/{id_associado}").status_code == 401
    assert client.put(f"/api/associados/{id_associado}", json={**_PAYLOAD_BASE, "nome_completo": "x"}).status_code == 401
    assert client.get(f"/api/associados/{id_associado}/cargos").status_code == 401
    assert client.post(f"/api/associados/{id_associado}/cargos", json={"titulo_cargo": "x", "data_posse": "2026-01-01"}).status_code == 401


def test_detalhe_traz_dados_e_endereco(client, auth_headers):
    id_associado = _criar_ficha(client)
    r = client.get(f"/api/associados/{id_associado}", headers=auth_headers)
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["id_associado"] == id_associado
    assert corpo["endereco"]["cidade"] == "Sao Paulo"


def test_editar_associado_atualiza_dados_e_grava_auditoria(client, auth_headers):
    id_associado = _criar_ficha(client)
    novo = {**_PAYLOAD_BASE, "nome_completo": "Nome Editado Teste", "email_contato": "editado@x.com"}
    r = client.put(f"/api/associados/{id_associado}", json=novo, headers=auth_headers)
    assert r.status_code == 200, r.text

    detalhe = client.get(f"/api/associados/{id_associado}", headers=auth_headers).json()
    assert detalhe["nome_completo"] == "Nome Editado Teste"
    assert detalhe["email_contato"] == "editado@x.com"

    auditoria = client.get("/api/auditoria/?limite=10", headers=auth_headers).json()
    entradas = [e for e in auditoria["entradas"] if e["tabela_afetada"] == "associados" and e["acao"] == "UPDATE"]
    assert entradas


def test_ciclo_completo_de_cargo(client, auth_headers):
    id_associado = _criar_ficha(client)
    r = client.post(
        f"/api/associados/{id_associado}/cargos",
        json={"titulo_cargo": "Tesoureiro", "data_posse": "2026-01-01"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    id_historico = r.json()["id_historico"]

    cargos = client.get(f"/api/associados/{id_associado}/cargos", headers=auth_headers).json()
    assert any(c["id_historico"] == id_historico and c["data_saida"] is None for c in cargos)

    r = client.put(f"/api/cargos/{id_historico}/encerrar", json={"data_saida": "2026-06-01"}, headers=auth_headers)
    assert r.status_code == 200, r.text

    cargos = client.get(f"/api/associados/{id_associado}/cargos", headers=auth_headers).json()
    cargo = next(c for c in cargos if c["id_historico"] == id_historico)
    assert cargo["data_saida"] == "2026-06-01"

    r = client.delete(f"/api/cargos/{id_historico}", headers=auth_headers)
    assert r.status_code == 200, r.text
    cargos = client.get(f"/api/associados/{id_associado}/cargos", headers=auth_headers).json()
    assert not any(c["id_historico"] == id_historico for c in cargos)


def test_ciclo_completo_de_dependente_v1_7(client, auth_headers):
    id_associado = _criar_ficha(client)
    detalhe = client.get(f"/api/associados/{id_associado}", headers=auth_headers).json()
    id_pessoa_titular = detalhe["id_pessoa"]

    r = client.post(
        f"/api/pessoas/{id_pessoa_titular}/dependentes",
        json={"nome_completo": "Filho Teste", "grau_parentesco": "FILHO_A", "data_nascimento": "2015-01-01"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    id_dependente = r.json()["id_dependente"]

    deps = client.get(f"/api/pessoas/{id_pessoa_titular}/dependentes", headers=auth_headers).json()
    assert any(d["id_dependente"] == id_dependente and d["nome_completo"] == "Filho Teste" for d in deps)

    r = client.put(f"/api/dependentes/{id_dependente}", json={"grau_parentesco": "OUTRO"}, headers=auth_headers)
    assert r.status_code == 200, r.text

    r = client.delete(f"/api/dependentes/{id_dependente}", headers=auth_headers)
    assert r.status_code == 200, r.text
    deps = client.get(f"/api/pessoas/{id_pessoa_titular}/dependentes", headers=auth_headers).json()
    assert not any(d["id_dependente"] == id_dependente for d in deps)
