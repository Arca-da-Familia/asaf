"""v4.5 (FASE 4) - Evento como entidade única e pontual: um só registro consumido pelo painel
(gestão) e pelo site institucional (leitura pública, sem autenticação); sessões (programação);
edições recorrentes ligadas entre si (`id_edicao_anterior`); inscrição reaproveitando o motor
genérico da v4.0 (nenhum mecanismo próprio)."""
import uuid
from datetime import datetime, timedelta

from tests.test_pessoas import _cpf_unico

_ISO = "%Y-%m-%dT%H:%M:%S"


def _criar_evento(client, auth_headers, **overrides) -> int:
    payload = {
        "titulo": f"Evento Teste {uuid.uuid4().hex[:6]}",
        "categoria": "PALESTRA",
        "data_hora_inicio": (datetime.utcnow() + timedelta(days=10)).strftime(_ISO),
        "visibilidade": "Interna",
        **overrides,
    }
    r = client.post("/api/eventos/", json=payload, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_evento"]


def _criar_associado_com_acesso(client, auth_headers) -> dict:
    cpf = _cpf_unico()
    payload = {
        "nome_completo": f"Pessoa Evento Teste {cpf[-8:]}", "cpf": cpf, "email_contato": f"{cpf}@x.com",
        "telefone_whatsapp": "11900000000", "categoria": "Efetivo", "data_nascimento": "1990-01-01",
        "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
        "cidade": "Sao Paulo", "estado": "SP",
    }
    r = client.post("/associados-master/", json=payload)
    assert r.status_code == 200, r.text
    id_associado = r.json()["id_associado"]

    senha = "SenhaForte123456"
    r = client.post(
        f"/api/associados/{id_associado}/conceder-acesso",
        json={"email": f"evento{uuid.uuid4().hex[:8]}@acesso.example.com", "senha_provisoria": senha},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    login = client.post("/auth/login", json={"cpf": cpf, "senha": senha})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_criar_evento_valida_categoria_do_catalogo(client, auth_headers):
    r = client.post("/api/eventos/", json={
        "titulo": "Evento Categoria Inválida", "categoria": "CATEGORIA_QUE_NAO_EXISTE",
        "data_hora_inicio": (datetime.utcnow() + timedelta(days=5)).strftime(_ISO),
    }, headers=auth_headers)
    assert r.status_code == 422


def test_evento_publico_so_lista_visibilidade_publica(client, auth_headers):
    id_publico = _criar_evento(client, auth_headers, visibilidade="Pública")
    id_interno = _criar_evento(client, auth_headers, visibilidade="Interna")

    publicos = client.get("/api/publico/eventos").json()
    ids_publicos = {e["id_evento"] for e in publicos}
    assert id_publico in ids_publicos
    assert id_interno not in ids_publicos

    r = client.get(f"/api/publico/eventos/{id_interno}")
    assert r.status_code == 404

    r = client.get(f"/api/publico/eventos/{id_publico}")
    assert r.status_code == 200, r.text
    assert "sessoes" in r.json()
    assert "id_usuario_criacao" not in r.json()


def test_sessoes_do_evento_programacao(client, auth_headers):
    id_evento = _criar_evento(client, auth_headers)
    r = client.post(f"/api/eventos/{id_evento}/sessoes", json={
        "titulo": "Abertura", "data_hora_inicio": (datetime.utcnow() + timedelta(days=10)).strftime(_ISO),
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    sessoes = client.get(f"/api/eventos/{id_evento}/sessoes", headers=auth_headers).json()
    assert len(sessoes) == 1
    assert sessoes[0]["titulo"] == "Abertura"


def test_nova_edicao_liga_a_cadeia_de_edicoes(client, auth_headers):
    id_v1 = _criar_evento(client, auth_headers, titulo="Congresso 2024")
    r = client.post(f"/api/eventos/{id_v1}/nova-edicao", json={
        "data_hora_inicio": (datetime.utcnow() + timedelta(days=400)).strftime(_ISO), "titulo": "Congresso 2025",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_v2 = r.json()["id_evento"]

    r = client.post(f"/api/eventos/{id_v2}/nova-edicao", json={
        "data_hora_inicio": (datetime.utcnow() + timedelta(days=760)).strftime(_ISO), "titulo": "Congresso 2026",
    }, headers=auth_headers)
    id_v3 = r.json()["id_evento"]

    # a cadeia é a mesma independentemente de qual edição eu peço a partir de.
    cadeia_da_v1 = [e["id_evento"] for e in client.get(f"/api/eventos/{id_v1}/edicoes", headers=auth_headers).json()]
    cadeia_da_v3 = [e["id_evento"] for e in client.get(f"/api/eventos/{id_v3}/edicoes", headers=auth_headers).json()]
    assert cadeia_da_v1 == [id_v1, id_v2, id_v3]
    assert cadeia_da_v3 == [id_v1, id_v2, id_v3]


def test_inscricao_autoatendida_no_evento_e_restrita_ao_proprio(client, auth_headers, db):
    id_evento = _criar_evento(client, auth_headers, visibilidade="Pública")
    headers_a = _criar_associado_com_acesso(client, auth_headers)
    headers_b = _criar_associado_com_acesso(client, auth_headers)

    r = client.post(f"/api/eventos/{id_evento}/inscricao", headers=headers_a)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "Pré-inscrito"

    # Ponto de Revisão FASE 4 (2/3): achado real - autoatendimento não gravava AuditLog, ao
    # contrário do mesmo padrão já usado pela candidatura de voluntário (v4.4).
    from app.models.core import AuditLog
    entrada = db.query(AuditLog).filter(
        AuditLog.tabela_afetada == "inscricoes", AuditLog.acao == "INSCRICAO", AuditLog.id_registro_afetado == r.json()["id_inscricao"],
    ).first()
    assert entrada is not None
    assert entrada.id_usuario is not None

    # inscrição duplicada é recusada (motor genérico, v4.0).
    r = client.post(f"/api/eventos/{id_evento}/inscricao", headers=headers_a)
    assert r.status_code == 400

    minhas_a = client.get("/api/eventos/minhas-inscricoes", headers=headers_a).json()
    minhas_b = client.get("/api/eventos/minhas-inscricoes", headers=headers_b).json()
    assert len(minhas_a) == 1 and minhas_a[0]["id_contexto"] == id_evento
    assert minhas_b == []


def test_inscricao_autoatendida_por_sessao(client, auth_headers):
    id_evento = _criar_evento(client, auth_headers)
    id_sessao = client.post(f"/api/eventos/{id_evento}/sessoes", json={
        "titulo": "Workshop", "data_hora_inicio": (datetime.utcnow() + timedelta(days=10)).strftime(_ISO),
    }, headers=auth_headers).json()["id_sessao"]

    headers_voluntario = _criar_associado_com_acesso(client, auth_headers)
    r = client.post(f"/api/eventos/sessoes/{id_sessao}/inscricao", headers=headers_voluntario)
    assert r.status_code == 200, r.text

    minhas = client.get("/api/eventos/minhas-inscricoes", headers=headers_voluntario).json()
    assert minhas[0]["contexto_tipo"] == "SessaoEvento"
    assert minhas[0]["id_contexto"] == id_sessao


def test_endpoints_de_evento_exigem_autenticacao(client):
    assert client.post("/api/eventos/", json={}).status_code == 401
    assert client.get("/api/eventos/").status_code == 401
    assert client.get("/api/publico/eventos").status_code == 200
