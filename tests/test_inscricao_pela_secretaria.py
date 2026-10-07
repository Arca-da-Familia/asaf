"""v5.4h - Inscrição pela secretaria: quem tem a permissão de projetos inscreve um associado num evento. Passa pelo MESMO controle de vagas da
inscrição do próprio associado (o limite nunca estoura por esta via; a rota genérica `/api/inscricoes/` não controla vaga), recusa duplicidade e
deixa quem inscreveu na Auditoria."""
import uuid
from datetime import datetime, timedelta

from tests.apoio_auth import cabecalho_admin
from tests.test_compras import _criar_usuario_com_mandato
from tests.test_eventos_vagas import _criar_associado_com_acesso, _criar_evento_publico

_ROTA = "/api/eventos/{}/inscrever-associado"


def test_a_secretaria_inscreve_e_o_limite_de_vagas_vale(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers, vagas=1)
    _, primeiro = _criar_associado_com_acesso(client, auth_headers)
    _, segundo = _criar_associado_com_acesso(client, auth_headers)

    r1 = client.post(_ROTA.format(id_evento), json={"id_associado": primeiro}, headers=auth_headers)
    assert r1.status_code == 200, r1.text
    assert r1.json()["status"] == "Pré-inscrito"
    r2 = client.post(_ROTA.format(id_evento), json={"id_associado": segundo}, headers=auth_headers)
    assert r2.status_code == 200, r2.text
    assert r2.json()["status"] == "Lista de Espera", "acima do limite vira lista de espera, nunca vaga a mais"

    inscritos = client.get(f"/api/inscricoes/?contexto_tipo=Evento&id_contexto={id_evento}", headers=auth_headers).json()
    assert sorted(i["status"] for i in inscritos) == ["Lista de Espera", "Pré-inscrito"]


def test_inscrever_de_novo_a_mesma_pessoa_e_recusado(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers)
    _, id_associado = _criar_associado_com_acesso(client, auth_headers)
    assert client.post(_ROTA.format(id_evento), json={"id_associado": id_associado}, headers=auth_headers).status_code == 200
    r = client.post(_ROTA.format(id_evento), json={"id_associado": id_associado}, headers=auth_headers)
    assert r.status_code == 400 and "já está inscrita" in r.json()["detail"]


def test_associado_ou_evento_que_nao_existem_dao_404(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers)
    assert client.post(_ROTA.format(id_evento), json={"id_associado": 99999999}, headers=auth_headers).status_code == 404
    _, id_associado = _criar_associado_com_acesso(client, auth_headers)
    assert client.post(_ROTA.format(99999999), json={"id_associado": id_associado}, headers=auth_headers).status_code == 404


def test_so_quem_tem_projetos_inscreve_e_a_auditoria_guarda_quem_foi(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers)
    _, id_associado = _criar_associado_com_acesso(client, auth_headers)
    assert client.post(_ROTA.format(id_evento), json={"id_associado": id_associado}).status_code == 401
    _, sem_projetos = _criar_usuario_com_mandato(client, auth_headers, "SECRETARIO")
    assert client.post(_ROTA.format(id_evento), json={"id_associado": id_associado}, headers=sem_projetos).status_code == 403

    r = client.post(_ROTA.format(id_evento), json={"id_associado": id_associado}, headers=auth_headers)
    assert r.status_code == 200
    trilha = client.get("/api/auditoria/?tabela_afetada=inscricoes&acao=INSCRICAO_PELA_SECRETARIA&por_pagina=50", headers=auth_headers).json()["entradas"]
    assert any(e["id_registro_afetado"] == r.json()["id_inscricao"] for e in trilha)
