"""v4.0 (FASE 4) - motores compartilhados: presença/check-in, inscrição, documento gerado,
indicadores e agenda/conflito. Construídos pra serem consumidos por projeto/evento (esta fase) e
aula (FASE 14) - testados aqui como mecanismo genérico, sem nenhum consumidor real ainda."""
import os
import uuid
from datetime import datetime, timedelta

from app.models.pessoas import Pessoa

_ISO = "%Y-%m-%dT%H:%M:%S"


def _criar_pessoa(db, nome=None) -> int:
    pessoa = Pessoa(nome_completo=nome or f"Pessoa Teste Motores {uuid.uuid4().hex[:6]}")
    db.add(pessoa)
    db.commit()
    db.refresh(pessoa)
    return pessoa.id_pessoa


# ==========================================
# MOTOR DE PRESENÇA/CHECK-IN
# ==========================================
def test_presenca_registra_entrada_e_saida_e_recusa_entrada_duplicada_em_aberto(client, auth_headers, db):
    id_pessoa = _criar_pessoa(db)
    id_contexto = 4242

    r = client.post("/api/presencas/entrada", json={
        "contexto_tipo": "Evento", "id_contexto": id_contexto, "id_pessoa": id_pessoa, "meio_registro": "Manual",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_registro = r.json()["id_registro"]

    r = client.post("/api/presencas/entrada", json={
        "contexto_tipo": "Evento", "id_contexto": id_contexto, "id_pessoa": id_pessoa, "meio_registro": "Manual",
    }, headers=auth_headers)
    assert r.status_code == 400
    assert "em aberto" in r.json()["detail"].lower()

    r = client.post(f"/api/presencas/{id_registro}/saida", headers=auth_headers)
    assert r.status_code == 200, r.text

    presencas = client.get(f"/api/presencas/?contexto_tipo=Evento&id_contexto={id_contexto}", headers=auth_headers).json()
    assert len(presencas) == 1
    assert presencas[0]["hora_saida"] is not None

    # depois de fechada, uma nova entrada é permitida (segunda passagem pelo mesmo evento).
    r = client.post("/api/presencas/entrada", json={
        "contexto_tipo": "Evento", "id_contexto": id_contexto, "id_pessoa": id_pessoa, "meio_registro": "QR Code",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text


# ==========================================
# MOTOR DE INSCRIÇÃO
# ==========================================
def test_inscricao_recusa_duplicidade_permite_transicoes_validas_e_recusa_invalidas(client, auth_headers, db):
    id_pessoa = _criar_pessoa(db)
    id_contexto = 5151

    r = client.post("/api/inscricoes/", json={
        "contexto_tipo": "Projeto", "id_contexto": id_contexto, "id_pessoa": id_pessoa,
        "respostas_formulario": {"camiseta": "M"},
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_inscricao = r.json()["id_inscricao"]
    assert r.json()["status"] == "Pré-inscrito"

    r = client.post("/api/inscricoes/", json={
        "contexto_tipo": "Projeto", "id_contexto": id_contexto, "id_pessoa": id_pessoa,
    }, headers=auth_headers)
    assert r.status_code == 400
    assert "já está inscrita" in r.json()["detail"].lower()

    r = client.put(f"/api/inscricoes/{id_inscricao}/status", json={"status": "Presente"}, headers=auth_headers)
    assert r.status_code == 400  # não pode pular direto de Pré-inscrito pra Presente

    r = client.put(f"/api/inscricoes/{id_inscricao}/status", json={"status": "Confirmado"}, headers=auth_headers)
    assert r.status_code == 200, r.text

    r = client.put(f"/api/inscricoes/{id_inscricao}/cobranca", json={"id_titulo": 999}, headers=auth_headers)
    assert r.status_code == 200, r.text

    inscricoes = client.get(f"/api/inscricoes/?contexto_tipo=Projeto&id_contexto={id_contexto}", headers=auth_headers).json()
    assert inscricoes[0]["status"] == "Confirmado"
    assert inscricoes[0]["id_titulo_cobranca"] == 999


def test_inscricao_cancelada_permite_reinscrever(client, auth_headers, db):
    id_pessoa = _criar_pessoa(db)
    id_contexto = 5152

    r = client.post("/api/inscricoes/", json={"contexto_tipo": "Projeto", "id_contexto": id_contexto, "id_pessoa": id_pessoa}, headers=auth_headers)
    id_inscricao = r.json()["id_inscricao"]
    r = client.put(f"/api/inscricoes/{id_inscricao}/status", json={"status": "Cancelado"}, headers=auth_headers)
    assert r.status_code == 200, r.text

    r = client.post("/api/inscricoes/", json={"contexto_tipo": "Projeto", "id_contexto": id_contexto, "id_pessoa": id_pessoa}, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "Pré-inscrito"
    assert r.json()["id_inscricao"] == id_inscricao


# ==========================================
# MOTOR DE DOCUMENTO GERADO
# ==========================================
def test_documento_emitido_numera_sequencial_gera_pdf_real_e_exige_variavel(client, auth_headers, db):
    codigo = f"TESTE_{uuid.uuid4().hex[:8]}".upper()
    r = client.post("/api/templates-documento/", json={
        "codigo": codigo, "nome": "Certificado de Teste",
        "corpo_texto": "Certificamos que {{nome}} participou do evento em {{data}}.",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    r = client.post("/api/documentos-emitidos/", json={
        "codigo_template": codigo, "variaveis": {"nome": "Fulano de Tal"},
    }, headers=auth_headers)
    assert r.status_code == 400  # falta a variável "data"
    assert "data" in r.json()["detail"].lower()

    id_pessoa = _criar_pessoa(db)
    r = client.post("/api/documentos-emitidos/", json={
        "codigo_template": codigo, "variaveis": {"nome": "Fulano de Tal", "data": "17/09/2026"},
        "contexto_tipo": "Evento", "id_contexto": 777, "id_pessoa": id_pessoa,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    numero_1 = r.json()["numero_sequencial"]
    caminho = r.json()["caminho_arquivo"]
    assert os.path.isfile(caminho.lstrip("/"))
    assert os.path.getsize(caminho.lstrip("/")) > 0

    r = client.post("/api/documentos-emitidos/", json={
        "codigo_template": codigo, "variaveis": {"nome": "Segunda Pessoa", "data": "18/09/2026"},
    }, headers=auth_headers)
    assert r.json()["numero_sequencial"] == numero_1 + 1

    emitidos = client.get(f"/api/documentos-emitidos/?contexto_tipo=Evento&id_contexto=777", headers=auth_headers).json()
    assert len(emitidos) == 1
    assert emitidos[0]["numero_sequencial"] == numero_1


def test_template_com_codigo_duplicado_e_recusado(client, auth_headers):
    codigo = f"DUP_{uuid.uuid4().hex[:8]}".upper()
    r = client.post("/api/templates-documento/", json={"codigo": codigo, "nome": "A", "corpo_texto": "texto"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    r = client.post("/api/templates-documento/", json={"codigo": codigo, "nome": "B", "corpo_texto": "outro texto"}, headers=auth_headers)
    assert r.status_code == 400


# ==========================================
# MOTOR DE INDICADORES
# ==========================================
def test_indicador_valida_catalogo_e_recusa_medicao_duplicada_no_periodo(client, auth_headers):
    r = client.post("/api/indicadores/", json={
        "nome": "Beneficiários atendidos", "unidade": "CODIGO_INVALIDO", "periodicidade": "MENSAL",
    }, headers=auth_headers)
    assert r.status_code == 422

    r = client.post("/api/indicadores/", json={
        "nome": "Beneficiários atendidos", "unidade": "PESSOA", "periodicidade": "MENSAL", "meta": 100,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_indicador = r.json()["id_indicador"]

    r = client.post(f"/api/indicadores/{id_indicador}/medicoes", json={"valor": 42, "periodo": "2026-09", "fonte": "Planilha de presença"}, headers=auth_headers)
    assert r.status_code == 200, r.text

    r = client.post(f"/api/indicadores/{id_indicador}/medicoes", json={"valor": 50, "periodo": "2026-09"}, headers=auth_headers)
    assert r.status_code == 400
    assert "já existe medição" in r.json()["detail"].lower()

    medicoes = client.get(f"/api/indicadores/{id_indicador}/medicoes", headers=auth_headers).json()
    assert len(medicoes) == 1
    assert medicoes[0]["valor"] == 42.0


# ==========================================
# MOTOR DE AGENDA/CONFLITO
# ==========================================
def test_agenda_recusa_compromisso_sobreposto_e_permite_horario_livre(client, auth_headers):
    id_recurso = 9090
    inicio = datetime.utcnow().replace(minute=0, second=0, microsecond=0) + timedelta(days=10)
    fim = inicio + timedelta(hours=2)

    r = client.post("/api/agenda/compromissos", json={
        "recurso_tipo": "Espaco", "id_recurso": id_recurso, "contexto_tipo": "ReservaEspaco", "id_contexto": 1,
        "data_hora_inicio": inicio.strftime(_ISO), "data_hora_fim": fim.strftime(_ISO),
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    sobreposto_inicio = inicio + timedelta(hours=1)
    r = client.post("/api/agenda/verificar-conflito", json={
        "recurso_tipo": "Espaco", "id_recurso": id_recurso,
        "data_hora_inicio": sobreposto_inicio.strftime(_ISO), "data_hora_fim": (sobreposto_inicio + timedelta(hours=2)).strftime(_ISO),
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["tem_conflito"] is True

    r = client.post("/api/agenda/compromissos", json={
        "recurso_tipo": "Espaco", "id_recurso": id_recurso, "contexto_tipo": "ReservaEspaco", "id_contexto": 2,
        "data_hora_inicio": sobreposto_inicio.strftime(_ISO), "data_hora_fim": (sobreposto_inicio + timedelta(hours=2)).strftime(_ISO),
    }, headers=auth_headers)
    assert r.status_code == 400
    assert "conflito de agenda" in r.json()["detail"].lower()

    horario_livre_inicio = fim + timedelta(hours=1)
    r = client.post("/api/agenda/compromissos", json={
        "recurso_tipo": "Espaco", "id_recurso": id_recurso, "contexto_tipo": "ReservaEspaco", "id_contexto": 3,
        "data_hora_inicio": horario_livre_inicio.strftime(_ISO), "data_hora_fim": (horario_livre_inicio + timedelta(hours=1)).strftime(_ISO),
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    compromissos = client.get(f"/api/agenda/compromissos?recurso_tipo=Espaco&id_recurso={id_recurso}", headers=auth_headers).json()
    assert len(compromissos) == 2
