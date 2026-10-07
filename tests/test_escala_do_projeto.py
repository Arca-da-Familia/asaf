"""v5.4h - Escala do projeto: o painel precisa VER quem está alocado (a rota de leitura que faltava para a tela "alocar voluntário direto num
turno"). A alocação direta já existia; a lista mostra confirmadas, pendentes e canceladas, por turno, com o nome de quem é."""
from datetime import date, timedelta

from app.models.associados import Associado
from tests.apoio_auth import cabecalho_admin
from tests.test_pessoas import _cpf_unico


def _associado_com_termo(client, auth_headers, db, nome):
    associado = client.post(
        "/associados-master/",
        json={
            "nome_completo": nome, "cpf": _cpf_unico(), "email_contato": "x@x.com", "telefone_whatsapp": "11900000000", "categoria": "Efetivo",
            "data_nascimento": "1990-01-01", "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro", "cidade": "Sao Paulo", "estado": "SP",
        }, headers=cabecalho_admin(client),
    ).json()
    id_pessoa = db.query(Associado).filter(Associado.id_associado == associado["id_associado"]).first().id_pessoa
    r = client.post(
        f"/api/pessoas/{id_pessoa}/termo-voluntariado", headers=auth_headers,
        json={"atividade": "Apoio", "carga_horaria_semanal": 4, "data_inicio": str(date.today()), "data_fim_vigencia": str(date.today() + timedelta(days=90))},
    )
    assert r.status_code == 200, r.text
    return associado["id_associado"]


def _projeto(client, auth_headers):
    return client.post("/projetos/", headers=auth_headers, json={
        "nome_projeto": "Mutirão da escala", "tipo_foco": "Social", "necessita_alvara_bombeiros": False,
        "data_inicio": "2026-01-01T00:00:00", "data_fim_prevista": "2026-12-31T00:00:00",
    }).json()["id_projeto"]


def test_a_escala_mostra_quem_foi_alocado_por_turno_com_o_nome(client, auth_headers, db):
    id_projeto = _projeto(client, auth_headers)
    ana = _associado_com_termo(client, auth_headers, db, "Ana da Escala")
    bia = _associado_com_termo(client, auth_headers, db, "Bia da Escala")
    assert client.get(f"/api/projetos/{id_projeto}/alocacoes", headers=auth_headers).json() == []

    # a segunda (mais tarde) é alocada primeiro; a lista vem por turno, e quem não tem turno marcado vem no fim
    for quem, funcao, inicio in ((bia, "Cozinha", "2026-11-02T13:00:00"), (ana, "Recepção", "2026-11-02T08:00:00"), (ana, "Sem turno marcado", None)):
        corpo = {"id_projeto": id_projeto, "id_associado": quem, "funcao_desempenhada": funcao, "horas_previstas": 4}
        if inicio:
            corpo.update({"turno_data_hora_inicio": inicio, "turno_data_hora_fim": inicio.replace("T08", "T12").replace("T13", "T17")})
        assert client.post("/projetos/alocar/", headers=auth_headers, json=corpo).status_code == 200

    escala = client.get(f"/api/projetos/{id_projeto}/alocacoes", headers=auth_headers).json()
    assert [(a["nome_associado"], a["funcao_desempenhada"], a["status"]) for a in escala] == [
        ("Ana da Escala", "Recepção", "CONFIRMADA"), ("Bia da Escala", "Cozinha", "CONFIRMADA"), ("Ana da Escala", "Sem turno marcado", "CONFIRMADA"),
    ]
    assert escala[0]["horas_previstas"] == 4 and escala[0]["turno_data_hora_inicio"].startswith("2026-11-02T08:00")


def test_a_escala_exige_login_e_projeto_existente(client, auth_headers):
    assert client.get("/api/projetos/1/alocacoes").status_code == 401
    assert client.get("/api/projetos/999999/alocacoes", headers=auth_headers).status_code == 404
