"""v4.5 (FASE 4) - Evento como entidade única e pontual: um só registro consumido pelo painel
(gestão) e pelo site institucional (leitura pública, sem autenticação); sessões (programação);
edições recorrentes ligadas entre si (`id_edicao_anterior`); inscrição reaproveitando o motor
genérico da v4.0 (nenhum mecanismo próprio)."""
import uuid
from datetime import datetime, timedelta

from tests.test_pessoas import _cpf_unico
from tests.apoio_auth import cabecalho_admin

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
    r = client.post("/associados-master/", json=payload, headers=cabecalho_admin(client))
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


# ==========================================
# GESTÃO DE INSCRITOS (v4.10) - busca/filtro/exportação sobre o motor genérico da v4.0, que até
# aqui só dava pra listar tudo sem filtro nenhum.
# ==========================================
def _criar_pessoa_associada(client, db, nome=None) -> int:
    from app.models.associados import Associado

    cpf = _cpf_unico()
    payload = {
        "nome_completo": nome or f"Pessoa Evento Teste {cpf}", "cpf": cpf, "email_contato": f"{cpf}@x.com",
        "telefone_whatsapp": "11900000000", "categoria": "Efetivo", "data_nascimento": "1990-01-01",
        "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
        "cidade": "Sao Paulo", "estado": "SP",
    }
    r = client.post("/associados-master/", json=payload, headers=cabecalho_admin(client))
    assert r.status_code == 200, r.text
    associado = db.query(Associado).filter(Associado.id_associado == r.json()["id_associado"]).first()
    return associado.id_pessoa


def test_listar_inscricoes_filtra_por_busca_e_status(client, auth_headers, db):
    id_evento = _criar_evento(client, auth_headers)
    id_pessoa_ana = _criar_pessoa_associada(client, db, nome=f"Ana Inscrita {uuid.uuid4().hex[:6]}")
    id_pessoa_bia = _criar_pessoa_associada(client, db, nome=f"Bia Inscrita {uuid.uuid4().hex[:6]}")

    client.post("/api/inscricoes/", json={"contexto_tipo": "Evento", "id_contexto": id_evento, "id_pessoa": id_pessoa_ana}, headers=auth_headers)
    r = client.post("/api/inscricoes/", json={"contexto_tipo": "Evento", "id_contexto": id_evento, "id_pessoa": id_pessoa_bia}, headers=auth_headers)
    id_inscricao_bia = r.json()["id_inscricao"]
    client.put(f"/api/inscricoes/{id_inscricao_bia}/status", json={"status": "Confirmado"}, headers=auth_headers)

    r = client.get(f"/api/inscricoes/?contexto_tipo=Evento&id_contexto={id_evento}&busca=Ana", headers=auth_headers)
    assert r.status_code == 200, r.text
    nomes = [i["nome_pessoa"] for i in r.json()]
    assert len(nomes) == 1 and "Ana" in nomes[0]

    r = client.get(f"/api/inscricoes/?contexto_tipo=Evento&id_contexto={id_evento}&status=Confirmado", headers=auth_headers)
    assert len(r.json()) == 1
    assert r.json()[0]["id_pessoa"] == id_pessoa_bia

    r = client.get(f"/api/inscricoes/?contexto_tipo=Evento&id_contexto={id_evento}", headers=auth_headers)
    assert len(r.json()) == 2


def test_exportar_inscricoes_exige_permissao_propria_e_grava_auditoria(client, auth_headers, db):
    from app.models.core import AuditLog

    id_evento = _criar_evento(client, auth_headers)
    id_pessoa = _criar_pessoa_associada(client, db)
    client.post("/api/inscricoes/", json={"contexto_tipo": "Evento", "id_contexto": id_evento, "id_pessoa": id_pessoa}, headers=auth_headers)

    headers_sem_permissao = _criar_associado_com_acesso(client, auth_headers)
    r = client.get(f"/api/inscricoes/exportar?contexto_tipo=Evento&id_contexto={id_evento}", headers=headers_sem_permissao)
    assert r.status_code == 403

    r = client.get(f"/api/inscricoes/exportar?contexto_tipo=Evento&id_contexto={id_evento}", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert len(r.json()) == 1
    assert "id_inscricao" in r.json()[0] and "nome_pessoa" in r.json()[0]

    entrada = db.query(AuditLog).filter(AuditLog.tabela_afetada == "inscricoes", AuditLog.acao == "EXPORTAR").first()
    assert entrada is not None


def test_comparacao_edicoes_combina_inscritos_presentes_financeiro_e_satisfacao(client, auth_headers, db):
    id_v1 = _criar_evento(client, auth_headers, titulo="Retiro Anual 2024", data_hora_inicio=(datetime.utcnow() + timedelta(days=10)).strftime(_ISO))
    r = client.post(f"/api/eventos/{id_v1}/nova-edicao", json={
        "data_hora_inicio": (datetime.utcnow() + timedelta(days=400)).strftime(_ISO), "titulo": "Retiro Anual 2025",
    }, headers=auth_headers)
    id_v2 = r.json()["id_evento"]

    id_pessoa = _criar_pessoa_associada(client, db)
    client.post("/api/inscricoes/", json={"contexto_tipo": "Evento", "id_contexto": id_v1, "id_pessoa": id_pessoa}, headers=auth_headers)

    r = client.get(f"/api/eventos/{id_v1}/comparacao-edicoes", headers=auth_headers)
    assert r.status_code == 200, r.text
    linhas = {l["id_evento"]: l for l in r.json()}
    assert set(linhas.keys()) == {id_v1, id_v2}
    assert linhas[id_v1]["total_inscritos"] == 1
    assert linhas[id_v2]["total_inscritos"] == 0
    assert linhas[id_v1]["total_arrecadado"] is None  # nenhum fechamento gerado ainda
    assert linhas[id_v1]["nota_media_satisfacao"] is None  # nenhuma resposta ainda

    r = client.get(f"/api/eventos/{id_v2}/comparacao-edicoes", headers=auth_headers)
    assert {l["id_evento"] for l in r.json()} == {id_v1, id_v2}


def test_sessao_precisa_comecar_dentro_do_periodo_do_evento_com_hora_com_ou_sem_fuso(client, auth_headers):
    from datetime import datetime, timedelta

    iso = "%Y-%m-%dT%H:%M:%S"
    inicio = (datetime.utcnow() + timedelta(days=20)).replace(hour=12, minute=0, second=0, microsecond=0)
    r = client.post("/api/eventos/", json={
        "titulo": "Evento com programação dentro do período", "categoria": "PALESTRA", "visibilidade": "Interna",
        "data_hora_inicio": inicio.strftime(iso), "data_hora_fim": (inicio + timedelta(hours=8)).strftime(iso),
    }, headers=auth_headers)
    id_evento = r.json()["id_evento"]

    def sessao(quando, sufixo=""):
        return client.post(f"/api/eventos/{id_evento}/sessoes", json={"titulo": "Palestra do dia", "data_hora_inicio": quando.strftime(iso) + sufixo}, headers=auth_headers)

    assert sessao(inicio - timedelta(days=2)).status_code == 422
    assert sessao(inicio + timedelta(hours=9)).status_code == 422
    assert sessao(inicio + timedelta(hours=1)).status_code == 200
    # o painel manda a hora com fuso ("Z"): antes isso derrubava a comparação com erro 500
    assert sessao(inicio + timedelta(hours=2), "Z").status_code == 200
    assert sessao(inicio - timedelta(days=2), "Z").status_code == 422
