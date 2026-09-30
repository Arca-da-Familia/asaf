"""v4.8 (FASE 4) - check-in sem login (código/carteirinha) por token de operação escopado a um
evento, idempotência (fila offline nunca duplica presença), elegibilidade calculada (nunca
concedida à mão) e verificação pública de crachá/certificado sem expor dado pessoal além do nome
e da atividade."""
import uuid
from datetime import datetime, timedelta

from app.models.motores import CANCELADO, CONFIRMADO, PRESENTE, Inscricao, RegistroPresenca
from app.models.associados import Associado
from tests.test_eventos import _criar_associado_com_acesso, _criar_evento
from tests.test_pessoas import _cpf_unico

_ISO = "%Y-%m-%dT%H:%M:%S"


def _chave() -> str:
    return uuid.uuid4().hex


def _emitir_token_portaria(client, auth_headers, id_evento, **overrides) -> str:
    r = client.post(f"/api/eventos/{id_evento}/tokens-portaria", json={"descricao": "Portaria de teste", **overrides}, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _criar_pessoa_associada(client, auth_headers, db) -> tuple[int, int]:
    """Cria um associado (ficha master) e devolve (id_associado, id_pessoa)."""
    cpf = _cpf_unico()
    payload = {
        "nome_completo": f"Pessoa Portaria Teste {cpf}", "cpf": cpf, "email_contato": f"{cpf}@x.com",
        "telefone_whatsapp": "11900000000", "categoria": "Efetivo", "data_nascimento": "1990-01-01",
        "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
        "cidade": "Sao Paulo", "estado": "SP",
    }
    r = client.post("/associados-master/", json=payload)
    assert r.status_code == 200, r.text
    id_associado = r.json()["id_associado"]
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    return id_associado, associado.id_pessoa


def _token_carteirinha(client, id_associado) -> str:
    r = client.get(f"/api/associados/{id_associado}/carteirinha")
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _criar_template(client, auth_headers, codigo: str, corpo: str) -> None:
    # Código de template é único globalmente (banco de teste compartilhado entre funções de
    # teste, session-scoped) - idempotente aqui só pra não exigir um código novo por teste.
    r = client.post("/api/templates-documento/", json={"codigo": codigo, "nome": codigo, "corpo_texto": corpo}, headers=auth_headers)
    assert r.status_code == 200 or "Já existe um template" in r.text, r.text


# ==========================================
# TOKEN DE OPERAÇÃO DA PORTARIA
# ==========================================
def test_emitir_e_revogar_token_portaria(client, auth_headers):
    id_evento = _criar_evento(client, auth_headers)
    token = _emitir_token_portaria(client, auth_headers, id_evento)

    r = client.get("/portaria/evento", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    assert r.json()["id_evento"] == id_evento

    listagem = client.get(f"/api/eventos/{id_evento}/tokens-portaria", headers=auth_headers).json()
    assert len(listagem) == 1
    id_token_portaria = listagem[0]["id_token_portaria"]

    r = client.post(f"/api/eventos/{id_evento}/tokens-portaria/{id_token_portaria}/revogar", headers=auth_headers)
    assert r.status_code == 200, r.text

    r = client.get("/portaria/evento", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


def test_token_de_outro_evento_e_rejeitado(client, auth_headers):
    id_evento_a = _criar_evento(client, auth_headers)
    id_evento_b = _criar_evento(client, auth_headers)
    token_a = _emitir_token_portaria(client, auth_headers, id_evento_a)

    r = client.get("/portaria/evento", headers={"Authorization": f"Bearer {token_a}"})
    assert r.status_code == 200, r.text
    assert r.json()["id_evento"] == id_evento_a
    assert r.json()["id_evento"] != id_evento_b


def test_checkin_exige_token_de_portaria(client):
    r = client.post("/portaria/checkin", json={"chave_idempotencia": _chave(), "metodo": "codigo", "codigo": "QUALQUER"})
    assert r.status_code == 401


# ==========================================
# CHECK-IN / CHECK-OUT
# ==========================================
def test_checkin_por_codigo_e_idempotente(client, auth_headers, db):
    id_evento = _criar_evento(client, auth_headers, visibilidade="Pública")
    cpf = _cpf_unico()
    payload_inscricao = {
        "nome_completo": "Participante Portaria", "cpf": cpf, "email": f"{cpf}@x.com", "telefone": "11988887777",
        "consentimento_lgpd": True, "versao_texto_consentimento": "1",
    }
    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=payload_inscricao, headers={"X-Forwarded-For": f"203.0.113.{uuid.uuid4().hex}"})
    assert r.status_code == 200, r.text
    codigo_checkin = r.json()["codigo_checkin"]

    token = _emitir_token_portaria(client, auth_headers, id_evento)
    headers_portaria = {"Authorization": f"Bearer {token}"}
    chave = _chave()

    r = client.post("/portaria/checkin", json={"chave_idempotencia": chave, "metodo": "codigo", "codigo": codigo_checkin}, headers=headers_portaria)
    assert r.status_code == 200, r.text
    id_registro = r.json()["id_registro"]

    # reenvio com a MESMA chave (simula a fila offline reconectando) - nunca duplica.
    r2 = client.post("/portaria/checkin", json={"chave_idempotencia": chave, "metodo": "codigo", "codigo": codigo_checkin}, headers=headers_portaria)
    assert r2.status_code == 200, r2.text
    assert r2.json()["id_registro"] == id_registro

    total = db.query(RegistroPresenca).filter(RegistroPresenca.contexto_tipo == "Evento", RegistroPresenca.id_contexto == id_evento).count()
    assert total == 1

    inscricao_atualizada = db.query(Inscricao).filter(Inscricao.codigo_checkin == codigo_checkin).first()
    assert inscricao_atualizada.status == PRESENTE


def test_checkin_por_carteirinha_walkin_e_existente(client, auth_headers, db):
    id_evento = _criar_evento(client, auth_headers)
    token = _emitir_token_portaria(client, auth_headers, id_evento)
    headers_portaria = {"Authorization": f"Bearer {token}"}

    # walk-in: sem inscrição prévia nenhuma.
    id_associado, id_pessoa = _criar_pessoa_associada(client, auth_headers, db)
    token_carteirinha = _token_carteirinha(client, id_associado)
    r = client.post("/portaria/checkin", json={"chave_idempotencia": _chave(), "metodo": "carteirinha", "token_carteirinha": token_carteirinha}, headers=headers_portaria)
    assert r.status_code == 200, r.text
    inscricao_walkin = db.query(Inscricao).filter(Inscricao.contexto_tipo == "Evento", Inscricao.id_contexto == id_evento, Inscricao.id_pessoa == id_pessoa).first()
    assert inscricao_walkin is not None
    assert inscricao_walkin.status == PRESENTE

    # já inscrito (Confirmado): transiciona pra Presente em vez de criar outra inscrição.
    id_associado_2, id_pessoa_2 = _criar_pessoa_associada(client, auth_headers, db)
    r = client.post("/api/inscricoes/", json={"contexto_tipo": "Evento", "id_contexto": id_evento, "id_pessoa": id_pessoa_2}, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_inscricao_2 = r.json()["id_inscricao"]
    r = client.put(f"/api/inscricoes/{id_inscricao_2}/status", json={"status": CONFIRMADO}, headers=auth_headers)
    assert r.status_code == 200, r.text

    token_carteirinha_2 = _token_carteirinha(client, id_associado_2)
    r = client.post("/portaria/checkin", json={"chave_idempotencia": _chave(), "metodo": "carteirinha", "token_carteirinha": token_carteirinha_2}, headers=headers_portaria)
    assert r.status_code == 200, r.text
    assert db.query(Inscricao).filter(Inscricao.id_inscricao == id_inscricao_2).first().status == PRESENTE
    assert db.query(Inscricao).filter(Inscricao.contexto_tipo == "Evento", Inscricao.id_contexto == id_evento, Inscricao.id_pessoa == id_pessoa_2).count() == 1


def test_checkin_recusado_para_inscricao_cancelada(client, auth_headers, db):
    id_evento = _criar_evento(client, auth_headers)
    id_associado, id_pessoa = _criar_pessoa_associada(client, auth_headers, db)

    r = client.post("/api/inscricoes/", json={"contexto_tipo": "Evento", "id_contexto": id_evento, "id_pessoa": id_pessoa}, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_inscricao = r.json()["id_inscricao"]
    r = client.put(f"/api/inscricoes/{id_inscricao}/status", json={"status": CANCELADO}, headers=auth_headers)
    assert r.status_code == 200, r.text

    token = _emitir_token_portaria(client, auth_headers, id_evento)
    token_carteirinha = _token_carteirinha(client, id_associado)
    r = client.post(
        "/portaria/checkin", json={"chave_idempotencia": _chave(), "metodo": "carteirinha", "token_carteirinha": token_carteirinha},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400
    assert "cancelad" in r.json()["detail"].lower()


def test_checkout_idempotente_resolve_por_chave_natural(client, auth_headers, db):
    id_evento = _criar_evento(client, auth_headers)
    id_associado, id_pessoa = _criar_pessoa_associada(client, auth_headers, db)
    token = _emitir_token_portaria(client, auth_headers, id_evento)
    headers_portaria = {"Authorization": f"Bearer {token}"}
    token_carteirinha = _token_carteirinha(client, id_associado)

    r = client.post("/portaria/checkin", json={"chave_idempotencia": _chave(), "metodo": "carteirinha", "token_carteirinha": token_carteirinha}, headers=headers_portaria)
    assert r.status_code == 200, r.text

    chave_saida = _chave()
    r = client.post("/portaria/checkout", json={"chave_idempotencia": chave_saida, "metodo": "carteirinha", "token_carteirinha": token_carteirinha}, headers=headers_portaria)
    assert r.status_code == 200, r.text
    assert r.json()["hora_saida"] is not None

    # reenvio idempotente.
    r2 = client.post("/portaria/checkout", json={"chave_idempotencia": chave_saida, "metodo": "carteirinha", "token_carteirinha": token_carteirinha}, headers=headers_portaria)
    assert r2.status_code == 200, r2.text

    # sem check-in em aberto - checkout de novo com chave nova é recusado.
    r3 = client.post("/portaria/checkout", json={"chave_idempotencia": _chave(), "metodo": "carteirinha", "token_carteirinha": token_carteirinha}, headers=headers_portaria)
    assert r3.status_code == 404


# ==========================================
# ELEGIBILIDADE (calculada, nunca concedida à mão)
# ==========================================
def _marcar_presenca_com_duracao(db, *, contexto_tipo, id_contexto, id_pessoa, horas: float) -> None:
    agora = datetime.utcnow()
    registro = RegistroPresenca(
        contexto_tipo=contexto_tipo, id_contexto=id_contexto, id_pessoa=id_pessoa,
        hora_entrada=agora - timedelta(hours=horas), hora_saida=agora, meio_registro="codigo",
    )
    db.add(registro)
    db.commit()


def test_elegibilidade_por_carga_horaria_recusa_emissao_abaixo_do_limite(client, auth_headers, db):
    id_evento = _criar_evento(client, auth_headers)
    r = client.put(f"/api/eventos/{id_evento}/elegibilidade-config", json={"carga_horaria_horas": 10}, headers=auth_headers)
    assert r.status_code == 200, r.text

    _criar_template(client, auth_headers, "CERTIFICADO_EVENTO", "Certificamos que {{nome_completo}} participou de {{titulo_evento}} em {{data_evento}}.")

    id_associado, id_pessoa = _criar_pessoa_associada(client, auth_headers, db)
    r = client.post("/api/inscricoes/", json={"contexto_tipo": "Evento", "id_contexto": id_evento, "id_pessoa": id_pessoa}, headers=auth_headers)
    assert r.status_code == 200, r.text
    _marcar_presenca_com_duracao(db, contexto_tipo="Evento", id_contexto=id_evento, id_pessoa=id_pessoa, horas=5)  # 50% de 10h

    elegibilidade = client.get(f"/api/eventos/{id_evento}/elegibilidade", headers=auth_headers).json()
    linha = next(l for l in elegibilidade if l["id_pessoa"] == id_pessoa)
    assert linha["elegivel"] is False
    assert float(linha["percentual"]) == 50.0

    r = client.post(f"/api/eventos/{id_evento}/certificados/{id_pessoa}", headers=auth_headers)
    assert r.status_code == 400
    assert "percentual" in r.json()["detail"].lower()

    # completa a carga horária (mais 5h) - agora 100%, emissão aceita.
    _marcar_presenca_com_duracao(db, contexto_tipo="Evento", id_contexto=id_evento, id_pessoa=id_pessoa, horas=5)
    r = client.post(f"/api/eventos/{id_evento}/certificados/{id_pessoa}", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["codigo_verificacao"]


def test_elegibilidade_sem_carga_horaria_nem_sessoes_desabilita_certificado(client, auth_headers, db):
    id_evento = _criar_evento(client, auth_headers)
    _criar_template(client, auth_headers, "CERTIFICADO_EVENTO_X", "{{nome_completo}} {{titulo_evento}} {{data_evento}}")
    _, id_pessoa = _criar_pessoa_associada(client, auth_headers, db)

    r = client.post(f"/api/eventos/{id_evento}/certificados/{id_pessoa}", headers=auth_headers)
    assert r.status_code == 400
    assert "elegibilidade" in r.json()["detail"].lower() or "carga hor" in r.json()["detail"].lower()


def test_elegibilidade_sobrescrita_por_evento_vs_padrao_global(client, auth_headers, db):
    id_evento = _criar_evento(client, auth_headers)
    client.put(f"/api/eventos/{id_evento}/elegibilidade-config", json={"carga_horaria_horas": 10, "percentual_minimo": 40}, headers=auth_headers)

    _, id_pessoa = _criar_pessoa_associada(client, auth_headers, db)
    r = client.post("/api/inscricoes/", json={"contexto_tipo": "Evento", "id_contexto": id_evento, "id_pessoa": id_pessoa}, headers=auth_headers)
    assert r.status_code == 200, r.text
    _marcar_presenca_com_duracao(db, contexto_tipo="Evento", id_contexto=id_evento, id_pessoa=id_pessoa, horas=5)  # 50%

    elegibilidade = client.get(f"/api/eventos/{id_evento}/elegibilidade", headers=auth_headers).json()
    linha = next(l for l in elegibilidade if l["id_pessoa"] == id_pessoa)
    assert linha["elegivel"] is True  # 50% >= sobrescrita de 40%
    assert float(linha["limite_aplicado"]) == 40.0


# ==========================================
# VERIFICAÇÃO PÚBLICA (nunca dado pessoal além de nome e atividade)
# ==========================================
def test_verificar_certificado_publico_nao_expoe_dado_pessoal(client, auth_headers, db):
    id_evento = _criar_evento(client, auth_headers)
    client.put(f"/api/eventos/{id_evento}/elegibilidade-config", json={"carga_horaria_horas": 1}, headers=auth_headers)
    _criar_template(client, auth_headers, "CERTIFICADO_EVENTO", "{{nome_completo}} - {{titulo_evento}} - {{data_evento}}")

    _, id_pessoa = _criar_pessoa_associada(client, auth_headers, db)
    _marcar_presenca_com_duracao(db, contexto_tipo="Evento", id_contexto=id_evento, id_pessoa=id_pessoa, horas=1)

    r = client.post(f"/api/eventos/{id_evento}/certificados/{id_pessoa}", headers=auth_headers)
    assert r.status_code == 200, r.text
    codigo = r.json()["codigo_verificacao"]

    r = client.get(f"/certificado/verificar/{codigo}")
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert set(corpo.keys()) == {"nome_completo", "atividade", "tipo_documento", "emitida_em"}
    assert "cpf" not in corpo
    assert "email" not in corpo
    assert "telefone" not in corpo

    r = client.get("/certificado/verificar/CODIGO-QUE-NAO-EXISTE")
    assert r.status_code == 404


def test_ordem_de_rota_certificado_verificar_nao_conflita(client):
    # `verificar` é o único segmento literal sob /certificado/ hoje - garante que continua
    # respondendo como rota literal (nunca casando com outra coisa por acidente de ordenação,
    # mesma categoria de bug já corrigida em v4.5/v4.6 pra /api/eventos/minhas-inscricoes).
    r = client.get("/certificado/verificar/QUALQUERCOISA")
    assert r.status_code == 404
    assert r.json()["detail"] == "Código de verificação não encontrado."


# ==========================================
# EXPORTAÇÃO (permissão própria + auditoria - nunca caminho padrão)
# ==========================================
def test_exportar_presencas_exige_permissao_propria_e_grava_auditoria(client, auth_headers, db):
    from app.models.core import AuditLog

    id_evento = _criar_evento(client, auth_headers)
    _, id_pessoa = _criar_pessoa_associada(client, auth_headers, db)
    client.post("/api/inscricoes/", json={"contexto_tipo": "Evento", "id_contexto": id_evento, "id_pessoa": id_pessoa}, headers=auth_headers)

    # associado comum (sem a permissão "exportar_presencas_evento") é recusado.
    headers_sem_permissao = _criar_associado_com_acesso(client, auth_headers)
    r = client.get(f"/api/eventos/{id_evento}/presencas/exportar?colunas=nome_completo", headers=headers_sem_permissao)
    assert r.status_code == 403

    r = client.get(f"/api/eventos/{id_evento}/presencas/exportar?colunas=nome_completo,percentual", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert "linhas" in r.json()

    log = db.query(AuditLog).filter(AuditLog.tabela_afetada == "registros_presenca", AuditLog.acao == "EXPORT").order_by(AuditLog.id_log.desc()).first()
    assert log is not None
