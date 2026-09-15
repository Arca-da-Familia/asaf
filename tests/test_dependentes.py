"""v1.7 (FASE 1) - dependentes/família por Pessoa, não mais só entre Associados. Cobre o caso
que a versão existe pra resolver (dependente sem cadastro nenhum ainda, criado na hora) e
confirma que o caminho legado (associado-associado) continua funcionando sem mudança de
contrato."""
from datetime import date

from app.models.associados import Associado
from app.models.pessoas import Pessoa
from tests.test_pessoas import _cpf_unico


def _criar_associado(client, **overrides):
    payload = {
        "nome_completo": "Titular Dependentes", "cpf": _cpf_unico(), "email_contato": "x@x.com",
        "telefone_whatsapp": "11900000000", "categoria": "Efetivo",
        "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
        "cidade": "Sao Paulo", "estado": "SP",
        **overrides,
    }
    return client.post("/associados-master/", json=payload).json()


def test_dependente_pessoa_exige_autenticacao(client):
    r = client.post("/api/pessoas/1/dependentes", json={"grau_parentesco": "FILHO_A", "nome_completo": "X"})
    assert r.status_code == 401


def test_criar_dependente_com_pessoa_nova_sem_cadastro_nenhum(client, auth_headers, db):
    titular = _criar_associado(client)
    associado_titular = db.query(Associado).filter(Associado.id_associado == titular["id_associado"]).first()
    id_pessoa_titular = associado_titular.id_pessoa

    r = client.post(
        f"/api/pessoas/{id_pessoa_titular}/dependentes", headers=auth_headers,
        json={"nome_completo": "Filho Sem Cadastro", "data_nascimento": "2015-05-10", "grau_parentesco": "FILHO_A"},
    )
    assert r.status_code == 200, r.text
    id_pessoa_vinculada = r.json()["id_pessoa_vinculada"]

    nova_pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa_vinculada).first()
    assert nova_pessoa is not None
    assert nova_pessoa.nome_completo == "Filho Sem Cadastro"

    listagem = client.get(f"/api/pessoas/{id_pessoa_titular}/dependentes", headers=auth_headers).json()
    assert len(listagem) == 1
    assert listagem[0]["nome_completo"] == "Filho Sem Cadastro"
    assert listagem[0]["e_associado"] is False


def test_criar_dependente_vinculando_pessoa_existente(client, auth_headers, db):

    titular = _criar_associado(client)
    vinculado = _criar_associado(client, nome_completo="Cônjuge Já Associado")
    id_pessoa_titular = db.query(Associado).filter(Associado.id_associado == titular["id_associado"]).first().id_pessoa
    id_pessoa_vinculada = db.query(Associado).filter(Associado.id_associado == vinculado["id_associado"]).first().id_pessoa

    r = client.post(
        f"/api/pessoas/{id_pessoa_titular}/dependentes", headers=auth_headers,
        json={"id_pessoa_vinculada": id_pessoa_vinculada, "grau_parentesco": "CONJUGE"},
    )
    assert r.status_code == 200, r.text

    listagem = client.get(f"/api/pessoas/{id_pessoa_titular}/dependentes", headers=auth_headers).json()
    assert listagem[0]["e_associado"] is True


def test_dependente_sem_pessoa_nem_referencia_e_rejeitado_pelo_schema(client, auth_headers, db):

    titular = _criar_associado(client)
    id_pessoa_titular = db.query(Associado).filter(Associado.id_associado == titular["id_associado"]).first().id_pessoa

    r = client.post(
        f"/api/pessoas/{id_pessoa_titular}/dependentes", headers=auth_headers,
        json={"grau_parentesco": "FILHO_A"},
    )
    assert r.status_code == 422


def test_grau_de_parentesco_invalido_e_recusado(client, auth_headers, db):

    titular = _criar_associado(client)
    id_pessoa_titular = db.query(Associado).filter(Associado.id_associado == titular["id_associado"]).first().id_pessoa

    r = client.post(
        f"/api/pessoas/{id_pessoa_titular}/dependentes", headers=auth_headers,
        json={"nome_completo": "Alguém", "grau_parentesco": "PARENTESCO_QUE_NAO_EXISTE"},
    )
    assert r.status_code == 422


def test_dependente_duplicado_e_recusado(client, auth_headers, db):

    titular = _criar_associado(client)
    id_pessoa_titular = db.query(Associado).filter(Associado.id_associado == titular["id_associado"]).first().id_pessoa

    dados = {"nome_completo": "Filho Duplicata", "data_nascimento": "2010-01-01", "grau_parentesco": "FILHO_A"}
    primeira = client.post(f"/api/pessoas/{id_pessoa_titular}/dependentes", headers=auth_headers, json=dados).json()
    segunda = client.post(
        f"/api/pessoas/{id_pessoa_titular}/dependentes", headers=auth_headers,
        json={"id_pessoa_vinculada": primeira["id_pessoa_vinculada"], "grau_parentesco": "FILHO_A"},
    )
    assert segunda.status_code == 400


def test_rota_legada_associado_associado_continua_funcionando(client, auth_headers):
    titular = _criar_associado(client)
    vinculado = _criar_associado(client, nome_completo="Familiar Legado")

    r = client.post(
        f"/api/associados/{titular['id_associado']}/dependentes",
        json={"id_associado_vinculado": vinculado["id_associado"], "grau_parentesco": "IRMAO_A"},
    )
    assert r.status_code == 200, r.text

    listagem = client.get(f"/api/associados/{titular['id_associado']}/dependentes").json()
    assert len(listagem) == 1
    assert listagem[0]["id_associado_vinculado"] == vinculado["id_associado"]
    assert listagem[0]["nome_completo"] == "Familiar Legado"
