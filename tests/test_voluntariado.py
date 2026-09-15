"""v1.6 (FASE 1) - voluntário (Lei 9.608/1998) e funcionário (cadastro mínimo). Cobre
especificamente o que a v1.0 desenhou pra permitir e que só agora tem um consumidor real: uma
Pessoa pode ser voluntária (ou funcionária) SEM nunca ter sido Associada - por isso os testes
criam a Pessoa direto via sessão de banco (`db` fixture), não via `/associados-master/`."""
from datetime import date, timedelta

from app.models.pessoas import Papel, Pessoa


def _criar_pessoa(db, nome="Voluntário Teste", data_nascimento=None) -> int:
    pessoa = Pessoa(nome_completo=nome, data_nascimento=data_nascimento)
    db.add(pessoa)
    db.commit()
    db.refresh(pessoa)
    return pessoa.id_pessoa


def test_termo_voluntariado_exige_autenticacao(client):
    r = client.post("/api/pessoas/1/termo-voluntariado", json={
        "atividade": "Recepção", "carga_horaria_semanal": 4,
        "data_inicio": str(date.today()), "data_fim_vigencia": str(date.today() + timedelta(days=90)),
    })
    assert r.status_code == 401


def test_registrar_termo_cria_papel_voluntario_e_aparece_como_vigente(client, auth_headers, db):
    id_pessoa = _criar_pessoa(db, data_nascimento=date(1990, 1, 1))

    r = client.post(
        f"/api/pessoas/{id_pessoa}/termo-voluntariado", headers=auth_headers,
        json={
            "atividade": "Recepção de eventos", "carga_horaria_semanal": 4, "local": "Sede",
            "data_inicio": str(date.today()), "data_fim_vigencia": str(date.today() + timedelta(days=90)),
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["versao"] == 1

    vigente = client.get(f"/api/pessoas/{id_pessoa}/termo-voluntariado/vigente", headers=auth_headers).json()
    assert vigente["vigente"] is True
    assert vigente["atividade"] == "Recepção de eventos"

    papel = db.query(Papel).filter(Papel.id_pessoa == id_pessoa, Papel.tipo_papel == "voluntario").first()
    assert papel is not None
    assert papel.ativo is True


def test_renovar_termo_encerra_o_anterior_e_incrementa_versao(client, auth_headers, db):
    id_pessoa = _criar_pessoa(db, data_nascimento=date(1990, 1, 1))
    client.post(
        f"/api/pessoas/{id_pessoa}/termo-voluntariado", headers=auth_headers,
        json={
            "atividade": "Recepção", "carga_horaria_semanal": 4,
            "data_inicio": str(date.today() - timedelta(days=200)), "data_fim_vigencia": str(date.today() - timedelta(days=1)),
        },
    )
    # O termo acima já venceu (data_fim_vigencia no passado) - renovar cria versão 2.
    renovacao = client.post(
        f"/api/pessoas/{id_pessoa}/termo-voluntariado", headers=auth_headers,
        json={
            "atividade": "Recepção", "carga_horaria_semanal": 6,
            "data_inicio": str(date.today()), "data_fim_vigencia": str(date.today() + timedelta(days=90)),
        },
    ).json()
    assert renovacao["versao"] == 2

    vigente = client.get(f"/api/pessoas/{id_pessoa}/termo-voluntariado/vigente", headers=auth_headers).json()
    assert vigente["versao"] == 2
    assert vigente["carga_horaria_semanal"] == 6


def test_termo_vencido_nao_conta_como_vigente(client, auth_headers, db):
    id_pessoa = _criar_pessoa(db, data_nascimento=date(1990, 1, 1))
    client.post(
        f"/api/pessoas/{id_pessoa}/termo-voluntariado", headers=auth_headers,
        json={
            "atividade": "Recepção", "carga_horaria_semanal": 4,
            "data_inicio": str(date.today() - timedelta(days=200)), "data_fim_vigencia": str(date.today() - timedelta(days=1)),
        },
    )
    vigente = client.get(f"/api/pessoas/{id_pessoa}/termo-voluntariado/vigente", headers=auth_headers).json()
    assert vigente["vigente"] is False


def test_voluntario_menor_de_idade_exige_autorizacao_de_responsavel(client, auth_headers, db):
    hoje = date.today()
    nascimento_menor = date(hoje.year - 15, hoje.month, hoje.day)
    id_pessoa = _criar_pessoa(db, nome="Voluntário Menor", data_nascimento=nascimento_menor)

    sem_autorizacao = client.post(
        f"/api/pessoas/{id_pessoa}/termo-voluntariado", headers=auth_headers,
        json={
            "atividade": "Apoio em oficina", "carga_horaria_semanal": 2,
            "data_inicio": str(hoje), "data_fim_vigencia": str(hoje + timedelta(days=90)),
        },
    )
    assert sem_autorizacao.status_code == 422

    com_autorizacao = client.post(
        f"/api/pessoas/{id_pessoa}/termo-voluntariado", headers=auth_headers,
        json={
            "atividade": "Apoio em oficina", "carga_horaria_semanal": 2,
            "data_inicio": str(hoje), "data_fim_vigencia": str(hoje + timedelta(days=90)),
            "autorizacao_responsavel_referencia": "uploads/autorizacoes/1.pdf",
        },
    )
    assert com_autorizacao.status_code == 200, com_autorizacao.text


def test_horas_de_voluntariado_exigem_termo_vigente(client, auth_headers, db):
    id_pessoa = _criar_pessoa(db, data_nascimento=date(1990, 1, 1))

    sem_termo = client.post(
        f"/api/pessoas/{id_pessoa}/horas-voluntariado", headers=auth_headers,
        json={"data": str(date.today()), "horas": 3},
    )
    assert sem_termo.status_code == 400

    client.post(
        f"/api/pessoas/{id_pessoa}/termo-voluntariado", headers=auth_headers,
        json={
            "atividade": "Recepção", "carga_horaria_semanal": 4,
            "data_inicio": str(date.today()), "data_fim_vigencia": str(date.today() + timedelta(days=90)),
        },
    )
    r = client.post(
        f"/api/pessoas/{id_pessoa}/horas-voluntariado", headers=auth_headers,
        json={"data": str(date.today()), "horas": 3, "descricao_atividade": "Plantão de recepção"},
    )
    assert r.status_code == 200, r.text

    listagem = client.get(f"/api/pessoas/{id_pessoa}/horas-voluntariado", headers=auth_headers).json()
    assert listagem["total_horas"] == 3
    assert len(listagem["registros"]) == 1


def test_alocar_voluntario_sem_termo_vigente_e_recusado(client, auth_headers):
    from tests.test_pessoas import _cpf_unico

    associado = client.post(
        "/associados-master/",
        json={
            "nome_completo": "Associado Sem Termo", "cpf": _cpf_unico(), "email_contato": "x@x.com",
            "telefone_whatsapp": "11900000000", "categoria": "Efetivo",
            "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
            "cidade": "Sao Paulo", "estado": "SP",
        },
    ).json()
    projeto = client.post(
        "/projetos/",
        json={
            "nome_projeto": "Mutirão", "tipo_foco": "Social", "necessita_alvara_bombeiros": False,
            "data_inicio": "2026-01-01T00:00:00", "data_fim_prevista": "2026-01-02T00:00:00",
        },
    ).json()

    r = client.post("/projetos/alocar/", json={
        "id_projeto": projeto["id_projeto"], "id_associado": associado["id_associado"],
        "funcao_desempenhada": "Logística",
    })
    assert r.status_code == 403


def test_cadastrar_funcionario_cria_papel_e_recusa_duplicata(client, auth_headers, db):
    id_pessoa = _criar_pessoa(db, nome="Funcionária Teste")

    r = client.post(
        f"/api/pessoas/{id_pessoa}/funcionario", headers=auth_headers,
        json={"cargo": "Secretária", "data_admissao": str(date.today())},
    )
    assert r.status_code == 200, r.text

    papel = db.query(Papel).filter(Papel.id_pessoa == id_pessoa, Papel.tipo_papel == "funcionario").first()
    assert papel is not None

    duplicata = client.post(
        f"/api/pessoas/{id_pessoa}/funcionario", headers=auth_headers,
        json={"cargo": "Secretária", "data_admissao": str(date.today())},
    )
    assert duplicata.status_code == 400

    listagem = client.get("/api/funcionarios/", headers=auth_headers).json()
    assert any(f["id_pessoa"] == id_pessoa for f in listagem)
