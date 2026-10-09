"""v5.5b - o voluntário é uma PESSOA: quem se oferece pelo site, assina o termo de adesão e é escalado não precisa ser associado. O que estes testes travam:
  1. a pessoa sem associado com termo vigente é escalada pela equipe (por `id_pessoa`), aparece na escala com o nome e a marca de não associada, e pode registrar horas;
  2. o termo vigente continua sendo a trava real: sem ele a alocação é recusada, para associado e para não associado;
  3. quem já chamava a rota por `id_associado` continua funcionando, e a alocação ganha a pessoa do associado;
  4. informar os dois (de pessoas diferentes) ou nenhum é recusado em português;
  5. a lista de quem pode ser escalado traz os associados e os não associados com termo, avisa quem tem termo vigente e só quem tem a permissão de projetos a vê;
  6. (a troca de turno e a "minha escala" por pessoa são provadas em tests/test_voluntariado_escala.py)."""
import uuid
from datetime import date, datetime, timedelta

from app.models.projetos import AlocacaoVoluntario
from tests.test_documentos_institucionais import _usuario
from tests.test_pessoas import _cpf_unico
from tests.test_voluntariado_escala import _criar_associado, _criar_projeto

_TURNO = {"turno_data_hora_inicio": "2088-03-02T08:00:00", "turno_data_hora_fim": "2088-03-02T12:00:00", "horas_previstas": 4}


def _projeto(client, headers) -> int:
    return _criar_projeto(client, headers)


def _pessoa_nao_associada(db, nome: str, nascimento: date | None = date(1990, 1, 1)):
    from app.models.pessoas import Pessoa

    pessoa = Pessoa(nome_completo=nome, cpf=_cpf_unico(), data_nascimento=datetime.combine(nascimento, datetime.min.time()) if nascimento else None)
    db.add(pessoa)
    db.commit()
    db.refresh(pessoa)
    return pessoa


def _termo(client, headers, id_pessoa: int, **extra):
    hoje = date.today()
    corpo = {"atividade": "Apoio nas oficinas", "carga_horaria_semanal": 4, "data_inicio": str(hoje), "data_fim_vigencia": str(hoje + timedelta(days=365)), **extra}
    return client.post(f"/api/pessoas/{id_pessoa}/termo-voluntariado", json=corpo, headers=headers)


def _alocar(client, headers, id_projeto: int, **quem):
    return client.post("/projetos/alocar/", json={"id_projeto": id_projeto, "funcao_desempenhada": "Apoio na cozinha", **_TURNO, **quem}, headers=headers)


def _associado(client, headers, nome: str) -> dict:
    id_associado, cpf = _criar_associado(client, headers)
    return {"id_associado": id_associado, "cpf": cpf, "nome": nome}


def test_pessoa_sem_associado_com_termo_e_escalada_aparece_na_escala_e_registra_horas(client, db, auth_headers):
    id_projeto = _projeto(client, auth_headers)
    pessoa = _pessoa_nao_associada(db, f"Voluntária Externa {uuid.uuid4().hex[:6]}")
    # sem termo: a trava real
    sem_termo = _alocar(client, auth_headers, id_projeto, id_pessoa=pessoa.id_pessoa)
    assert sem_termo.status_code == 403 and "termo de adesão vigente" in sem_termo.json()["detail"]
    assert _termo(client, auth_headers, pessoa.id_pessoa).status_code == 200
    ok = _alocar(client, auth_headers, id_projeto, id_pessoa=pessoa.id_pessoa)
    assert ok.status_code == 200, ok.text

    escala = client.get(f"/api/projetos/{id_projeto}/alocacoes", headers=auth_headers).json()
    assert len(escala) == 1
    item = escala[0]
    assert item["id_pessoa"] == pessoa.id_pessoa and item["id_associado"] is None and item["eh_associado"] is False
    assert item["nome_voluntario"] == pessoa.nome_completo and item["nome_associado"] == pessoa.nome_completo
    assert item["status"] == "CONFIRMADA"
    gravada = db.query(AlocacaoVoluntario).filter(AlocacaoVoluntario.id_alocacao == item["id_alocacao"]).one()
    assert gravada.id_pessoa == pessoa.id_pessoa and gravada.id_associado is None

    # as horas da alocação (por pessoa) continuam funcionando
    horas = client.post(
        f"/api/pessoas/{pessoa.id_pessoa}/horas-voluntariado", json={"data": str(date.today()), "horas": 3, "id_alocacao": item["id_alocacao"], "id_projeto": id_projeto}, headers=auth_headers,
    )
    assert horas.status_code == 200 and horas.json()["status"] == "PENDENTE"


def test_a_alocacao_por_associado_continua_e_ganha_a_pessoa(client, db, auth_headers):
    id_projeto = _projeto(client, auth_headers)
    associado = _associado(client, auth_headers, f"Associada Voluntária {uuid.uuid4().hex[:6]}")
    from app.models.associados import Associado

    id_pessoa = db.query(Associado).filter(Associado.id_associado == associado["id_associado"]).one().id_pessoa
    assert _termo(client, auth_headers, id_pessoa).status_code == 200
    assert _alocar(client, auth_headers, id_projeto, id_associado=associado["id_associado"]).status_code == 200
    item = client.get(f"/api/projetos/{id_projeto}/alocacoes", headers=auth_headers).json()[0]
    assert item["id_associado"] == associado["id_associado"] and item["id_pessoa"] == id_pessoa and item["eh_associado"] is True
    # informar os dois da MESMA pessoa também vale
    assert _alocar(client, auth_headers, id_projeto, id_associado=associado["id_associado"], id_pessoa=id_pessoa).status_code == 200


def test_informar_nenhum_ou_dois_de_pessoas_diferentes_e_recusado_em_portugues(client, db, auth_headers):
    id_projeto = _projeto(client, auth_headers)
    associado = _associado(client, auth_headers, f"Associado Qualquer {uuid.uuid4().hex[:6]}")
    outra = _pessoa_nao_associada(db, f"Outra Pessoa {uuid.uuid4().hex[:6]}")
    nenhum = _alocar(client, auth_headers, id_projeto)
    assert nenhum.status_code == 422 and "Escolha o voluntário" in nenhum.json()["detail"]
    diferentes = _alocar(client, auth_headers, id_projeto, id_associado=associado["id_associado"], id_pessoa=outra.id_pessoa)
    assert diferentes.status_code == 422 and "não é a pessoa informada" in diferentes.json()["detail"]
    assert _alocar(client, auth_headers, id_projeto, id_pessoa=99999999).status_code == 404
    assert _alocar(client, auth_headers, id_projeto, id_associado=99999999).status_code == 404


def test_a_lista_de_quem_pode_ser_escalado_traz_associados_e_nao_associados_com_termo(client, db, auth_headers):
    marca = uuid.uuid4().hex[:6]
    associado = _associado(client, auth_headers, f"Lista Associada {marca}")
    com_termo = _pessoa_nao_associada(db, f"Lista Externa Com Termo {marca}")
    sem_termo = _pessoa_nao_associada(db, f"Lista Externa Sem Termo {marca}")
    assert _termo(client, auth_headers, com_termo.id_pessoa).status_code == 200

    r = client.get("/api/projetos/voluntarios-selecao", headers=auth_headers)
    assert r.status_code == 200, r.text
    por_pessoa = {i["id_pessoa"]: i for i in r.json()}
    assert por_pessoa[com_termo.id_pessoa]["eh_associado"] is False and por_pessoa[com_termo.id_pessoa]["tem_termo_vigente"] is True
    assert por_pessoa[com_termo.id_pessoa]["id_associado"] is None
    # quem não é associado e não tem termo não aparece (ninguém se oferece só por existir no cadastro)
    assert sem_termo.id_pessoa not in por_pessoa
    achado = [i for i in r.json() if i["id_associado"] == associado["id_associado"]]
    assert len(achado) == 1 and achado[0]["eh_associado"] is True and achado[0]["tem_termo_vigente"] is False
    nomes = [i["nome_completo"].lower() for i in r.json()]
    assert nomes == sorted(nomes)
    # a rota literal não foi capturada pela de `{id_projeto}`; só quem tem a permissão de projetos a vê
    assert client.get("/api/projetos/voluntarios-selecao").status_code == 401
    assert client.get("/api/projetos/voluntarios-selecao", headers=_usuario(db, "associados")).status_code == 403
    assert client.get("/api/projetos/voluntarios-selecao", headers=_usuario(db, "projetos")).status_code == 200


def test_termo_vencido_tira_a_pessoa_da_vigencia_e_a_alocacao_e_recusada(client, db, auth_headers):
    from app.models.voluntariado import TermoAdesaoVoluntario

    id_projeto = _projeto(client, auth_headers)
    pessoa = _pessoa_nao_associada(db, f"Termo Vencido {uuid.uuid4().hex[:6]}")
    assert _termo(client, auth_headers, pessoa.id_pessoa).status_code == 200
    termo = db.query(TermoAdesaoVoluntario).filter(TermoAdesaoVoluntario.id_pessoa == pessoa.id_pessoa).one()
    termo.data_inicio = datetime.utcnow() - timedelta(days=400)
    termo.data_fim_vigencia = datetime.utcnow() - timedelta(days=5)
    db.commit()
    assert _alocar(client, auth_headers, id_projeto, id_pessoa=pessoa.id_pessoa).status_code == 403
    item = [i for i in client.get("/api/projetos/voluntarios-selecao", headers=auth_headers).json() if i["id_pessoa"] == pessoa.id_pessoa][0]
    assert item["tem_termo_vigente"] is False


def test_voluntario_menor_de_idade_exige_a_autorizacao_no_termo_mesmo_sem_ser_associado(client, db, auth_headers):
    pessoa = _pessoa_nao_associada(db, f"Voluntário Menor {uuid.uuid4().hex[:6]}", nascimento=date.today().replace(year=date.today().year - 16) - timedelta(days=30))
    sem = _termo(client, auth_headers, pessoa.id_pessoa)
    assert sem.status_code == 422 and "autorização de responsável" in sem.json()["detail"]
    com = _termo(client, auth_headers, pessoa.id_pessoa, autorizacao_responsavel_referencia="Autorização assinada pela mãe, pasta 12")
    assert com.status_code == 200


def test_a_lista_de_candidaturas_pendentes_traz_o_nome_de_quem_se_candidatou(client, db, auth_headers):
    from tests.test_voluntariado_escala import _associado_do_token, _conceder_acesso_e_logar, _criar_termo, _criar_vaga

    id_projeto = _projeto(client, auth_headers)
    id_vaga = _criar_vaga(client, auth_headers, id_projeto)
    id_associado, cpf = _criar_associado(client, auth_headers)
    headers = _conceder_acesso_e_logar(client, auth_headers, id_associado, cpf)
    associado = _associado_do_token(db, headers)
    _criar_termo(client, auth_headers, associado.id_pessoa)
    assert client.post(f"/api/voluntariado/vagas/{id_vaga}/candidatar", headers=headers).status_code == 200
    pendentes = client.get(f"/api/projetos/{id_projeto}/candidaturas-pendentes", headers=auth_headers).json()
    assert len(pendentes) == 1
    assert pendentes[0]["id_pessoa"] == associado.id_pessoa and pendentes[0]["nome_voluntario"] == associado.nome_completo and pendentes[0]["eh_associado"] is True
