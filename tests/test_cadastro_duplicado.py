"""v1.8 (FASE 1) - bloqueio de cadastro duplicado NA HORA (não mesclagem depois): decisão do
usuário depois de discutir a mesclagem de dois cadastros de Associado já existentes - "o certo
é o sistema não deixar cadastrar" em vez de arrumar depois. CPF nunca bate por erro de
digitação (por isso ele sozinho não pega o caso); nome + pelo menos outro dado pessoal batendo
(nascimento, telefone ou e-mail) bloqueia o cadastro direto, e só quem tem a permissão
`forcar_cadastro_duplicado` (Presidente, por padrão) pode passar por cima."""
from datetime import date

from tests.test_pessoas import _cpf_unico


def _payload_associado(**overrides):
    cpf = _cpf_unico()
    payload = {
        "nome_completo": "Original Cadastro Duplicado", "cpf": cpf, "email_contato": f"{cpf}@x.com",
        "telefone_whatsapp": "11988887777", "categoria": "Efetivo",
        "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
        "cidade": "Sao Paulo", "estado": "SP",
        **overrides,
    }
    return payload


def test_cadastro_com_nome_e_telefone_iguais_e_bloqueado_mesmo_sem_forcar(client, auth_headers):
    client.post("/associados-master/", json=_payload_associado())

    segundo = client.post("/associados-master/", json=_payload_associado(nome_completo="Original Cadastro Duplicado"))
    assert segundo.status_code == 409


def test_cadastro_anonimo_com_forcar_continua_bloqueado_sem_permissao(client):
    client.post("/associados-master/", json=_payload_associado())

    # Sem token nenhum - `forcar=True` no corpo não tem efeito nenhum sem um usuário com a
    # permissão de verdade por trás.
    segundo = client.post("/associados-master/", json=_payload_associado(nome_completo="Original Cadastro Duplicado", forcar=True))
    assert segundo.status_code == 409


def test_presidente_pode_forcar_cadastro_duplicado(client, auth_headers):
    client.post("/associados-master/", json=_payload_associado())

    forcado = client.post(
        "/associados-master/", headers=auth_headers,
        json=_payload_associado(nome_completo="Original Cadastro Duplicado", forcar=True),
    )
    assert forcado.status_code == 200, forcado.text


def test_nomes_diferentes_ou_sem_outro_sinal_batendo_nao_bloqueia(client):
    client.post("/associados-master/", json=_payload_associado())

    nome_diferente = client.post("/associados-master/", json=_payload_associado(nome_completo="Pessoa Completamente Diferente"))
    assert nome_diferente.status_code == 200

    mesmo_nome_sem_mais_nada = client.post(
        "/associados-master/",
        json=_payload_associado(
            nome_completo="Original Cadastro Duplicado",
            telefone_whatsapp="11900001111",  # diferente do original
        ),
    )
    # Mesmo nome mas nenhum outro dado pessoal batendo (telefone diferente, e-mail sempre
    # único por causa do CPF único) - não bloqueia, porque isso sozinho não é sinal forte o
    # bastante (duas pessoas reais podem ter o mesmo nome comum).
    assert mesmo_nome_sem_mais_nada.status_code == 200


def test_filiacao_aprovar_bloqueia_duplicado_e_presidente_pode_forcar(client, auth_headers):
    client.post("/associados-master/", json=_payload_associado(nome_completo="Filiado Duplicado Teste"))

    proposta = client.post(
        "/api/filiacao/propor",
        json={
            "nome_completo": "Filiado Duplicado Teste", "cpf": _cpf_unico(),
            "email_contato": "outro@x.com", "telefone_whatsapp": "11988887777",  # mesmo telefone do original
        },
    ).json()
    client.post(f"/api/filiacao/propostas/{proposta['id_proposta']}/conferir", headers=auth_headers)

    sem_forcar = client.post(
        f"/api/filiacao/propostas/{proposta['id_proposta']}/aprovar", headers=auth_headers, json={"categoria": "Efetivo"}
    )
    assert sem_forcar.status_code == 409

    com_forcar = client.post(
        f"/api/filiacao/propostas/{proposta['id_proposta']}/aprovar", headers=auth_headers,
        json={"categoria": "Efetivo", "forcar": True},
    )
    assert com_forcar.status_code == 200, com_forcar.text
