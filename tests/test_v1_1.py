"""v1.1 - validação real de cadastro (CPF/telefone/nascimento), categoria calculada a partir do
financeiro (materializada + auditada, nunca sobrescreve Suspenso/Desligado), completude do
cadastro, consulta de CEP e carteirinha digital (QR assinado, verificação pública sem CPF)."""
import random
import uuid

from tests.test_pessoas import _cpf_unico

_PAYLOAD_BASE = {
    "email_contato": "x@x.com", "telefone_whatsapp": "11900000000", "categoria": "Efetivo",
    "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
    "cidade": "Sao Paulo", "estado": "SP",
}


def _criar_associado(client, **overrides):
    cpf = _cpf_unico()
    # v1.8 - nome único por padrão (o bloqueio de cadastro duplicado trataria duas chamadas com
    # nome+telefone iguais como a mesma pessoa, de propósito).
    payload = {**_PAYLOAD_BASE, "nome_completo": f"Pessoa Teste v1.1 {cpf[-4:]}", "cpf": cpf, "email_contato": f"{cpf}@x.com", **overrides}
    return client.post("/associados-master/", json=payload)


def test_cpf_com_digito_verificador_invalido_e_recusado(client, auth_headers):
    resposta = _criar_associado(client, cpf="11111111111")
    assert resposta.status_code == 422


def test_telefone_invalido_e_recusado(client, auth_headers):
    resposta = _criar_associado(client, telefone_whatsapp="123")
    assert resposta.status_code == 422


def test_data_nascimento_futura_e_recusada(client, auth_headers):
    resposta = _criar_associado(client, data_nascimento="2099-01-01")
    assert resposta.status_code == 422


def test_status_arrolamento_nao_e_mais_editavel_no_schema(client, auth_headers):
    criado = _criar_associado(client).json()
    resposta = client.put(
        f"/api/associados/{criado['id_associado']}", headers=auth_headers,
        json={
            "nome_completo": "Pessoa Teste v1.1", "email_contato": "x@x.com",
            "telefone_whatsapp": "11900000000", "categoria": "Efetivo",
            "status_arrolamento": "Desligado",  # campo extra, ignorado pelo schema
        },
    )
    assert resposta.status_code == 200
    calculada = client.get(f"/api/associados/{criado['id_associado']}/categoria-calculada").json()
    assert calculada["status_arrolamento_materializado"] == "Ativo - Em Dia"


def test_categoria_calculada_fica_inadimplente_apos_titulo_vencido_e_volta_ao_pagar(client, auth_headers):
    associado = _criar_associado(client).json()
    id_associado = associado["id_associado"]

    conta = client.post(
        "/plano-contas/",
        json={"codigo_contabil": f"C{uuid.uuid4().hex[:8]}", "descricao_conta": "Mensalidade", "tipo": "Receita"},
    ).json()

    titulo = client.post(
        "/titulos/",
        json={
            "tipo_titulo": "A Receber", "id_conta_contabil": conta["id_conta"], "id_associado": id_associado,
            "descricao": "Mensalidade atrasada", "valor_original": 100.0,
            "data_vencimento": "2020-01-01T00:00:00",  # bem no passado - vencido além de qualquer tolerância
        },
    ).json()

    calculada = client.get(f"/api/associados/{id_associado}/categoria-calculada").json()
    assert calculada["status_arrolamento_materializado"] == "Ativo - Inadimplente"

    client.post("/baixar-titulo/", json={"id_titulo": titulo["id_titulo"], "valor_pago": 100.0, "forma_pagamento": "Pix"})

    calculada_depois = client.get(f"/api/associados/{id_associado}/categoria-calculada").json()
    assert calculada_depois["status_arrolamento_materializado"] == "Ativo - Em Dia"


def test_completude_do_cadastro(client, auth_headers):
    associado = _criar_associado(client, estado_civil=None, profissao=None, naturalidade=None).json()
    resposta = client.get(f"/api/associados/{associado['id_associado']}/completude")
    assert resposta.status_code == 200
    corpo = resposta.json()
    assert 0 < corpo["percentual"] < 100
    assert "foto" in corpo["campos_faltando"]


def test_consultar_cep_valido(client):
    resposta = client.get("/api/cep/01310100")
    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["cidade"] == "São Paulo"


def test_consultar_cep_formato_invalido(client):
    resposta = client.get("/api/cep/123")
    assert resposta.status_code == 422


def test_carteirinha_gera_e_verifica_sem_expor_cpf(client, auth_headers):
    associado = _criar_associado(client).json()
    carteirinha = client.get(f"/api/associados/{associado['id_associado']}/carteirinha").json()

    verificacao = client.get(carteirinha["url_verificacao"])
    assert verificacao.status_code == 200
    corpo = verificacao.json()
    assert corpo["nome_completo"].startswith("Pessoa Teste v1.1")
    assert corpo["valido"] is True
    assert "cpf" not in corpo
    assert "telefone_whatsapp" not in corpo
    assert "endereco" not in corpo


def test_carteirinha_com_token_adulterado_falha(client):
    resposta = client.get("/carteirinha/verificar/token-invalido-adulterado")
    assert resposta.status_code == 400
