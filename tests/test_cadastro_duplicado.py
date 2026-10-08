"""v1.8 (FASE 1) - bloqueio de cadastro duplicado NA HORA (não mesclagem depois): decisão do
usuário depois de discutir a mesclagem de dois cadastros de Associado já existentes - "o certo
é o sistema não deixar cadastrar" em vez de arrumar depois. CPF nunca bate por erro de
digitação (por isso ele sozinho não pega o caso); nome + pelo menos outro dado pessoal batendo
(nascimento, telefone ou e-mail) bloqueia o cadastro direto, e só quem tem a permissão
`forcar_cadastro_duplicado` (Presidente, por padrão) pode passar por cima."""
from datetime import date

from tests.test_pessoas import _cpf_unico
from tests.apoio_auth import cabecalho_admin
from tests.apoio_filiacao import propor_pedido, tres_socios_propoem


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
    client.post("/associados-master/", json=_payload_associado(), headers=cabecalho_admin(client))

    segundo = client.post("/associados-master/", json=_payload_associado(nome_completo="Original Cadastro Duplicado"), headers=cabecalho_admin(client))
    assert segundo.status_code == 409


def test_cadastro_direto_sem_login_e_recusado_e_forcar_exige_a_permissao_do_presidente(client, auth_headers, db):
    """Achado AO VIVO (v5.4c, 2026-10-05): o cadastro direto aceitava QUALQUER pessoa na internet, sem login. Agora: sem login é recusado
    (a porta pública é a proposta de filiação); e quem tem a permissão de cadastrar mas NÃO a de forçar continua barrado em duplicado."""
    from datetime import date, timedelta

    from app.models.core import Usuario
    from app.security import criar_access_token
    from tests.test_mandatos import _criar_associado_nivel_associado

    anonimo = client.post("/associados-master/", json=_payload_associado())
    assert anonimo.status_code == 401
    anonimo_forcando = client.post("/associados-master/", json=_payload_associado(forcar=True))
    assert anonimo_forcando.status_code == 401

    client.post("/associados-master/", json=_payload_associado(), headers=cabecalho_admin(client))
    vice = _criar_associado_nivel_associado(db, nome="Vice Secretario Sem Poder De Forcar")
    r = client.post(
        "/api/mandatos/", headers=auth_headers,
        json={"id_associado": vice.id_associado, "orgao_codigo": "DIRETORIA_EXECUTIVA", "cargo_codigo": "VICE_SECRETARIO",
              "data_inicio": str(date.today() - timedelta(days=1)), "data_fim_previsto": str(date.today() + timedelta(days=365))},
    )
    assert r.status_code == 200, r.text
    db.expire_all()
    usuario = db.query(Usuario).filter(Usuario.id_usuario == vice.id_usuario).first()
    como_vice = {"Authorization": f"Bearer {criar_access_token(usuario)}"}
    segundo = client.post(
        "/associados-master/", headers=como_vice,
        json=_payload_associado(nome_completo="Original Cadastro Duplicado", forcar=True),
    )
    assert segundo.status_code == 409, "cadastra (permissão associados), mas só o Presidente força cadastro parecido"


def test_presidente_pode_forcar_cadastro_duplicado(client, auth_headers):
    client.post("/associados-master/", json=_payload_associado(), headers=cabecalho_admin(client))

    forcado = client.post(
        "/associados-master/", headers=auth_headers,
        json=_payload_associado(nome_completo="Original Cadastro Duplicado", forcar=True),
    )
    assert forcado.status_code == 200, forcado.text


def test_nomes_diferentes_ou_sem_outro_sinal_batendo_nao_bloqueia(client):
    client.post("/associados-master/", json=_payload_associado(), headers=cabecalho_admin(client))

    nome_diferente = client.post("/associados-master/", json=_payload_associado(nome_completo="Pessoa Completamente Diferente"), headers=cabecalho_admin(client))
    assert nome_diferente.status_code == 200

    mesmo_nome_sem_mais_nada = client.post(
        "/associados-master/",
        json=_payload_associado(
            nome_completo="Original Cadastro Duplicado",
            telefone_whatsapp="11900001111",  # diferente do original
        ), headers=cabecalho_admin(client),
    )
    # Mesmo nome mas nenhum outro dado pessoal batendo (telefone diferente, e-mail sempre
    # único por causa do CPF único) - não bloqueia, porque isso sozinho não é sinal forte o
    # bastante (duas pessoas reais podem ter o mesmo nome comum).
    assert mesmo_nome_sem_mais_nada.status_code == 200


def test_filiacao_aprovar_bloqueia_duplicado_e_presidente_pode_forcar(client, auth_headers, db):
    client.post("/associados-master/", json=_payload_associado(nome_completo="Filiado Duplicado Teste"), headers=cabecalho_admin(client))

    proposta = propor_pedido(
        client, nome_completo="Filiado Duplicado Teste", cpf=_cpf_unico(),
        email_contato="outro@x.com", telefone_whatsapp="11988887777",  # mesmo telefone do original
    ).json()
    client.post(f"/api/filiacao/propostas/{proposta['id_proposta']}/conferir", headers=auth_headers)
    tres_socios_propoem(db, proposta["id_proposta"])

    sem_forcar = client.post(
        f"/api/filiacao/propostas/{proposta['id_proposta']}/aprovar", headers=auth_headers, json={"categoria": "Efetivo"}
    )
    assert sem_forcar.status_code == 409

    com_forcar = client.post(
        f"/api/filiacao/propostas/{proposta['id_proposta']}/aprovar", headers=auth_headers,
        json={"categoria": "Efetivo", "forcar": True},
    )
    assert com_forcar.status_code == 200, com_forcar.text
