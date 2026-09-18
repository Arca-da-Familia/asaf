"""v4.4 (FASE 4) - Voluntariado vinculado a projeto: escala com turno/habilidades exigindo termo
de adesão vigente (v1.6) como trava real, autocandidatura + confirmação do coordenador, troca de
turno entre voluntários e aprovação de horas pelo coordenador (lastro pro certificado v4.8/score
v11.1, quando existirem). Visibilidade de "minha escala"/"meu histórico" sempre restrita ao
próprio usuário logado."""
import uuid
from datetime import date, datetime, timedelta

from app.models.associados import Associado
from app.security import decodificar_access_token
from tests.test_pessoas import _cpf_unico

_ISO = "%Y-%m-%dT%H:%M:%S"


def _associado_do_token(db, headers) -> Associado:
    token = headers["Authorization"].split(" ")[1]
    id_usuario = decodificar_access_token(token)["id_usuario"]
    associado = db.query(Associado).filter(Associado.id_usuario == id_usuario).first()
    assert associado is not None
    return associado


def _criar_associado(client, auth_headers) -> tuple[int, str]:
    cpf = _cpf_unico()
    payload = {
        "nome_completo": f"Voluntário Escala Teste {cpf[-8:]}", "cpf": cpf, "email_contato": f"{cpf}@x.com",
        "telefone_whatsapp": "11900000000", "categoria": "Efetivo", "data_nascimento": "1990-01-01",
        "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
        "cidade": "Sao Paulo", "estado": "SP",
    }
    r = client.post("/associados-master/", json=payload)
    assert r.status_code == 200, r.text
    return r.json()["id_associado"], cpf


def _conceder_acesso_e_logar(client, auth_headers, id_associado: int, cpf: str) -> dict:
    senha = "SenhaForte123456"
    r = client.post(
        f"/api/associados/{id_associado}/conceder-acesso",
        json={"email": f"escala{uuid.uuid4().hex[:8]}@acesso.example.com", "senha_provisoria": senha},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    login = client.post("/auth/login", json={"cpf": cpf, "senha": senha})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _criar_termo(client, auth_headers, id_pessoa: int, dias_vigencia: int = 180):
    r = client.post(
        f"/api/pessoas/{id_pessoa}/termo-voluntariado", headers=auth_headers,
        json={
            "atividade": "Apoio em eventos", "carga_horaria_semanal": 4,
            "data_inicio": str(date.today() - timedelta(days=1)),
            "data_fim_vigencia": str(date.today() + timedelta(days=dias_vigencia)),
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def _criar_projeto(client, auth_headers) -> int:
    r = client.post("/projetos/", json={
        "nome_projeto": f"Projeto Escala {uuid.uuid4().hex[:6]}", "tipo_foco": "Assistencial",
        "necessita_alvara_bombeiros": False,
        "data_inicio": datetime.utcnow().strftime(_ISO), "data_fim_prevista": (datetime.utcnow() + timedelta(days=90)).strftime(_ISO),
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_projeto"]


def _criar_vaga(client, auth_headers, id_projeto: int, **overrides) -> int:
    payload = {
        "funcao_desempenhada": "Apoio na cozinha",
        "turno_data_hora_inicio": (datetime.utcnow() + timedelta(days=1)).strftime(_ISO),
        "turno_data_hora_fim": (datetime.utcnow() + timedelta(days=1, hours=4)).strftime(_ISO),
        "vagas_disponiveis": 1,
        "horas_previstas": 4,
        **overrides,
    }
    r = client.post(f"/api/projetos/{id_projeto}/vagas-escala", json=payload, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_vaga"]


def _tornar_coordenador(client, auth_headers, id_projeto: int, id_associado: int):
    r = client.post(f"/api/projetos/{id_projeto}/equipe", json={"id_associado": id_associado, "papel": "COORDENADOR"}, headers=auth_headers)
    assert r.status_code == 200, r.text


def test_candidatura_sem_termo_de_adesao_vigente_e_recusada(client, auth_headers):
    id_projeto = _criar_projeto(client, auth_headers)
    id_vaga = _criar_vaga(client, auth_headers, id_projeto)
    id_associado, cpf = _criar_associado(client, auth_headers)
    headers_voluntario = _conceder_acesso_e_logar(client, auth_headers, id_associado, cpf)

    r = client.post(f"/api/voluntariado/vagas/{id_vaga}/candidatar", headers=headers_voluntario)
    assert r.status_code == 403
    assert "termo de adesão" in r.json()["detail"].lower()


def test_fluxo_completo_candidatura_confirmacao_e_aprovacao_de_horas(client, auth_headers, db):
    id_projeto = _criar_projeto(client, auth_headers)
    id_vaga = _criar_vaga(client, auth_headers, id_projeto)

    id_associado, cpf = _criar_associado(client, auth_headers)
    headers_voluntario = _conceder_acesso_e_logar(client, auth_headers, id_associado, cpf)
    associado_voluntario = _associado_do_token(db, headers_voluntario)
    _criar_termo(client, auth_headers, associado_voluntario.id_pessoa)

    # candidatura autoatendida - nasce PENDENTE, aguardando o coordenador.
    r = client.post(f"/api/voluntariado/vagas/{id_vaga}/candidatar", headers=headers_voluntario)
    assert r.status_code == 200, r.text
    id_alocacao = r.json()["id_alocacao"]

    minha_escala = client.get("/api/voluntariado/minha-escala", headers=headers_voluntario).json()
    assert len(minha_escala) == 1
    assert minha_escala[0]["status"] == "PENDENTE"

    # admin NÃO é coordenador deste projeto ainda - confirmação recusada.
    r = client.post(f"/api/alocacoes/{id_alocacao}/confirmar", headers=auth_headers)
    assert r.status_code == 403

    associado_admin = _associado_do_token(db, auth_headers)
    _tornar_coordenador(client, auth_headers, id_projeto, associado_admin.id_associado)

    r = client.post(f"/api/alocacoes/{id_alocacao}/confirmar", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "CONFIRMADA"

    # o voluntário registra as próprias horas, amarradas à alocação - nasce PENDENTE.
    r = client.post("/api/voluntariado/horas", headers=headers_voluntario, json={
        "data": str(date.today()), "horas": 4, "descricao_atividade": "Apoio no evento", "id_alocacao": id_alocacao,
    })
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "PENDENTE"
    id_registro = r.json()["id_registro"]

    horas = client.get(f"/api/pessoas/{associado_voluntario.id_pessoa}/horas-voluntariado", headers=auth_headers).json()
    assert horas["total_horas"] == 0  # pendente ainda não conta

    # não-coordenador não aprova.
    r = client.post(f"/api/horas-voluntariado/{id_registro}/aprovar", headers=headers_voluntario)
    assert r.status_code == 403

    r = client.post(f"/api/horas-voluntariado/{id_registro}/aprovar", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "APROVADO"

    horas = client.get(f"/api/pessoas/{associado_voluntario.id_pessoa}/horas-voluntariado", headers=auth_headers).json()
    assert horas["total_horas"] == 4

    minha_escala = client.get("/api/voluntariado/minha-escala", headers=headers_voluntario).json()
    assert minha_escala[0]["horas_realizadas"] == 4


def test_troca_de_turno_exige_termo_vigente_do_substituto_e_confirmacao_do_coordenador(client, auth_headers, db):
    id_projeto = _criar_projeto(client, auth_headers)
    id_vaga = _criar_vaga(client, auth_headers, id_projeto)

    id_associado, cpf = _criar_associado(client, auth_headers)
    headers_voluntario = _conceder_acesso_e_logar(client, auth_headers, id_associado, cpf)
    associado_voluntario = _associado_do_token(db, headers_voluntario)
    _criar_termo(client, auth_headers, associado_voluntario.id_pessoa)

    associado_admin = _associado_do_token(db, auth_headers)
    _tornar_coordenador(client, auth_headers, id_projeto, associado_admin.id_associado)

    r = client.post(f"/api/voluntariado/vagas/{id_vaga}/candidatar", headers=headers_voluntario)
    id_alocacao = r.json()["id_alocacao"]
    client.post(f"/api/alocacoes/{id_alocacao}/confirmar", headers=auth_headers)

    id_substituto, cpf_substituto = _criar_associado(client, auth_headers)

    # substituto sem termo vigente - troca recusada.
    r = client.post(f"/api/alocacoes/{id_alocacao}/trocas", headers=headers_voluntario, json={"id_associado_substituto": id_substituto})
    assert r.status_code == 403

    headers_substituto = _conceder_acesso_e_logar(client, auth_headers, id_substituto, cpf_substituto)
    associado_substituto = _associado_do_token(db, headers_substituto)
    _criar_termo(client, auth_headers, associado_substituto.id_pessoa)

    r = client.post(f"/api/alocacoes/{id_alocacao}/trocas", headers=headers_voluntario, json={"id_associado_substituto": id_substituto})
    assert r.status_code == 200, r.text
    id_troca = r.json()["id_troca"]

    # não-coordenador não confirma a troca.
    r = client.post(f"/api/trocas-turno/{id_troca}/confirmar", headers=headers_voluntario)
    assert r.status_code == 403

    r = client.post(f"/api/trocas-turno/{id_troca}/confirmar", headers=auth_headers)
    assert r.status_code == 200, r.text

    escala_substituto = client.get("/api/voluntariado/minha-escala", headers=headers_substituto).json()
    assert len(escala_substituto) == 1
    assert escala_substituto[0]["id_alocacao"] == id_alocacao

    escala_original = client.get("/api/voluntariado/minha-escala", headers=headers_voluntario).json()
    assert escala_original == []


def test_minha_escala_e_restrita_ao_proprio_voluntario(client, auth_headers, db):
    id_projeto = _criar_projeto(client, auth_headers)
    id_vaga = _criar_vaga(client, auth_headers, id_projeto, vagas_disponiveis=2)

    id_a, cpf_a = _criar_associado(client, auth_headers)
    headers_a = _conceder_acesso_e_logar(client, auth_headers, id_a, cpf_a)
    associado_a = _associado_do_token(db, headers_a)
    _criar_termo(client, auth_headers, associado_a.id_pessoa)

    id_b, cpf_b = _criar_associado(client, auth_headers)
    headers_b = _conceder_acesso_e_logar(client, auth_headers, id_b, cpf_b)
    associado_b = _associado_do_token(db, headers_b)
    _criar_termo(client, auth_headers, associado_b.id_pessoa)

    client.post(f"/api/voluntariado/vagas/{id_vaga}/candidatar", headers=headers_a)
    client.post(f"/api/voluntariado/vagas/{id_vaga}/candidatar", headers=headers_b)

    escala_a = client.get("/api/voluntariado/minha-escala", headers=headers_a).json()
    escala_b = client.get("/api/voluntariado/minha-escala", headers=headers_b).json()
    assert len(escala_a) == 1 and len(escala_b) == 1
    assert escala_a[0]["id_alocacao"] != escala_b[0]["id_alocacao"]
    assert all(a["id_associado"] == associado_a.id_associado for a in escala_a)
    assert all(a["id_associado"] == associado_b.id_associado for a in escala_b)


def test_vaga_esgotada_nao_aceita_mais_candidatura(client, auth_headers, db):
    id_projeto = _criar_projeto(client, auth_headers)
    id_vaga = _criar_vaga(client, auth_headers, id_projeto, vagas_disponiveis=1)

    id_a, cpf_a = _criar_associado(client, auth_headers)
    headers_a = _conceder_acesso_e_logar(client, auth_headers, id_a, cpf_a)
    associado_a = _associado_do_token(db, headers_a)
    _criar_termo(client, auth_headers, associado_a.id_pessoa)

    id_b, cpf_b = _criar_associado(client, auth_headers)
    headers_b = _conceder_acesso_e_logar(client, auth_headers, id_b, cpf_b)
    associado_b = _associado_do_token(db, headers_b)
    _criar_termo(client, auth_headers, associado_b.id_pessoa)

    r = client.post(f"/api/voluntariado/vagas/{id_vaga}/candidatar", headers=headers_a)
    assert r.status_code == 200, r.text

    r = client.post(f"/api/voluntariado/vagas/{id_vaga}/candidatar", headers=headers_b)
    assert r.status_code == 400
