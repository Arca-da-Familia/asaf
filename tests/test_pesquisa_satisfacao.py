"""v4.10 (FASE 4) - pesquisa de satisfação pós-evento: convite por link único, resposta pública
sem login, resultado agregado sempre anônimo (nunca `id_inscricao`) e indicador de qualidade
calculado automaticamente a partir da nota média."""
import uuid
from datetime import datetime, timedelta

from app.models.associados import Associado
from app.models.motores import Indicador, MedicaoIndicador
from app.models.pesquisa_satisfacao import RespostaPesquisaSatisfacao
from tests.test_eventos import _criar_evento, _criar_associado_com_acesso
from tests.test_pessoas import _cpf_unico
from tests.apoio_auth import cabecalho_admin

_ISO = "%Y-%m-%dT%H:%M:%S"


def _criar_pessoa_associada(client, db) -> int:
    cpf = _cpf_unico()
    payload = {
        "nome_completo": f"Pessoa Pesquisa Satisfação {cpf}", "cpf": cpf, "email_contato": f"{cpf}@x.com",
        "telefone_whatsapp": "11900000000", "categoria": "Efetivo", "data_nascimento": "1990-01-01",
        "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
        "cidade": "Sao Paulo", "estado": "SP",
    }
    r = client.post("/associados-master/", json=payload, headers=cabecalho_admin(client))
    assert r.status_code == 200, r.text
    associado = db.query(Associado).filter(Associado.id_associado == r.json()["id_associado"]).first()
    return associado.id_pessoa


def _inscrever(client, auth_headers, id_evento, id_pessoa) -> int:
    r = client.post("/api/inscricoes/", json={"contexto_tipo": "Evento", "id_contexto": id_evento, "id_pessoa": id_pessoa}, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_inscricao"]


def test_convidar_gera_um_convite_por_inscrito_nao_cancelado_e_nunca_duplica(client, auth_headers, db):
    id_evento = _criar_evento(client, auth_headers)
    id_pessoa_1 = _criar_pessoa_associada(client, db)
    id_pessoa_2 = _criar_pessoa_associada(client, db)
    id_inscricao_1 = _inscrever(client, auth_headers, id_evento, id_pessoa_1)
    id_inscricao_2 = _inscrever(client, auth_headers, id_evento, id_pessoa_2)
    # cancelada - não deve ganhar convite.
    client.put(f"/api/inscricoes/{id_inscricao_2}/status", json={"status": "Cancelado"}, headers=auth_headers)

    r = client.post(f"/api/eventos/{id_evento}/pesquisa-satisfacao/convidar", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["quantidade_convites_novos"] == 1

    convites = db.query(RespostaPesquisaSatisfacao).filter(RespostaPesquisaSatisfacao.id_evento == id_evento).all()
    assert len(convites) == 1
    assert convites[0].id_inscricao == id_inscricao_1

    # rodar de novo não duplica convite de quem já foi convidado.
    r = client.post(f"/api/eventos/{id_evento}/pesquisa-satisfacao/convidar", headers=auth_headers)
    assert r.json()["quantidade_convites_novos"] == 0
    assert db.query(RespostaPesquisaSatisfacao).filter(RespostaPesquisaSatisfacao.id_evento == id_evento).count() == 1


def test_responder_por_token_e_resposta_duplicada_e_recusada(client, auth_headers, db):
    id_evento = _criar_evento(client, auth_headers)
    id_pessoa = _criar_pessoa_associada(client, db)
    _inscrever(client, auth_headers, id_evento, id_pessoa)
    client.post(f"/api/eventos/{id_evento}/pesquisa-satisfacao/convidar", headers=auth_headers)
    convite = db.query(RespostaPesquisaSatisfacao).filter(RespostaPesquisaSatisfacao.id_evento == id_evento).first()

    r = client.get(f"/pesquisa-satisfacao/{convite.token}")
    assert r.status_code == 200, r.text
    assert r.json()["ja_respondido"] is False

    r = client.post(f"/pesquisa-satisfacao/{convite.token}/responder", json={"nota": 9, "comentario": "Muito bom!"})
    assert r.status_code == 200, r.text

    r = client.get(f"/pesquisa-satisfacao/{convite.token}")
    assert r.json()["ja_respondido"] is True

    r = client.post(f"/pesquisa-satisfacao/{convite.token}/responder", json={"nota": 5})
    assert r.status_code == 400
    assert "já foi respondida" in r.json()["detail"]

    r = client.get(f"/pesquisa-satisfacao/token-que-nao-existe")
    assert r.status_code == 404

    r = client.post(f"/pesquisa-satisfacao/{convite.token}/responder", json={"nota": 11})
    assert r.status_code == 422  # fora de 0-10


def test_resultado_agregado_e_sempre_anonimo_e_alimenta_indicador_calculado(client, auth_headers, db):
    id_evento = _criar_evento(client, auth_headers)
    id_pessoa_1 = _criar_pessoa_associada(client, db)
    id_pessoa_2 = _criar_pessoa_associada(client, db)
    _inscrever(client, auth_headers, id_evento, id_pessoa_1)
    _inscrever(client, auth_headers, id_evento, id_pessoa_2)
    client.post(f"/api/eventos/{id_evento}/pesquisa-satisfacao/convidar", headers=auth_headers)
    convites = db.query(RespostaPesquisaSatisfacao).filter(RespostaPesquisaSatisfacao.id_evento == id_evento).all()

    client.post(f"/pesquisa-satisfacao/{convites[0].token}/responder", json={"nota": 10, "comentario": "Ótimo"})

    r = client.get(f"/api/eventos/{id_evento}/pesquisa-satisfacao/resultado", headers=auth_headers)
    assert r.status_code == 200, r.text
    resultado = r.json()
    assert resultado["total_convidados"] == 2
    assert resultado["total_respondidos"] == 1
    assert resultado["nota_media"] == 10.0
    assert resultado["comentarios"] == ["Ótimo"]
    assert "id_inscricao" not in resultado

    indicador = db.query(Indicador).filter(Indicador.contexto_tipo == "Evento", Indicador.id_contexto == id_evento).first()
    assert indicador is not None
    assert indicador.nome == "Satisfação pós-evento"
    medicao = db.query(MedicaoIndicador).filter(MedicaoIndicador.id_indicador == indicador.id_indicador, MedicaoIndicador.periodo == str(id_evento)).first()
    assert medicao is not None
    assert float(medicao.valor) == 10.0

    # segunda resposta recalcula (atualiza, não duplica) a mesma medição do evento.
    client.post(f"/pesquisa-satisfacao/{convites[1].token}/responder", json={"nota": 6})
    r = client.get(f"/api/eventos/{id_evento}/pesquisa-satisfacao/resultado", headers=auth_headers)
    assert r.json()["total_respondidos"] == 2
    assert r.json()["nota_media"] == 8.0
    assert db.query(MedicaoIndicador).filter(MedicaoIndicador.id_indicador == indicador.id_indicador).count() == 1


def test_endpoints_de_gestao_exigem_permissao_projetos(client, auth_headers):
    id_evento = _criar_evento(client, auth_headers)
    headers_sem_permissao = _criar_associado_com_acesso(client, auth_headers)

    r = client.post(f"/api/eventos/{id_evento}/pesquisa-satisfacao/convidar", headers=headers_sem_permissao)
    assert r.status_code == 403

    r = client.get(f"/api/eventos/{id_evento}/pesquisa-satisfacao/resultado", headers=headers_sem_permissao)
    assert r.status_code == 403
