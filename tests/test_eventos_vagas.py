"""v4.7 (FASE 4) - vagas com trava real sob concorrência (controle transacional no banco, não
contagem otimista na aplicação), cotas por categoria, lista de espera com promoção automática
(prazo pra confirmar antes de passar ao próximo) e inscrição em grupo."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta

from app.database import SessaoLocal
from app.models.motores import Inscricao
from tests.test_pessoas import _cpf_unico

_ISO = "%Y-%m-%dT%H:%M:%S"


def _ip_de_teste() -> dict:
    # Achado real (Ponto de Revisão FASE 4 2/3): só 2 dígitos hex (256 valores) colidia entre
    # testes deste arquivo E de test_eventos_inscricao_publica.py - mesma "rota" de rate limit
    # (`inscrever-se-evento`), banco de teste compartilhado sem rollback por transação, suíte com
    # centenas de chamadas. Mesma categoria de flakiness por paradoxo do aniversário já corrigida
    # em `_criar_associado` (v4.3, CPF) - aumentado pro hex inteiro, colisão astronomicamente
    # improvável.
    return {"X-Forwarded-For": f"203.0.113.{uuid.uuid4().hex}"}


def _criar_evento_publico(client, auth_headers, **overrides) -> int:
    payload = {
        "titulo": f"Evento Vagas Teste {uuid.uuid4().hex[:6]}",
        "categoria": "PALESTRA",
        "data_hora_inicio": (datetime.utcnow() + timedelta(days=10)).strftime(_ISO),
        "visibilidade": "Pública",
        **overrides,
    }
    r = client.post("/api/eventos/", json=payload, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_evento"]


def _payload_inscricao(**overrides) -> dict:
    cpf = _cpf_unico()
    payload = {
        "nome_completo": "Participante Vagas Teste",
        "cpf": cpf,
        "email": f"{cpf}@x.com",
        "telefone": "11988887777",
        "consentimento_lgpd": True,
        "versao_texto_consentimento": "1",
        **overrides,
    }
    return payload


def _criar_associado_com_acesso(client, auth_headers) -> tuple[dict, int]:
    cpf = _cpf_unico()
    payload = {
        "nome_completo": f"Associado Vagas Teste {cpf[-8:]}", "cpf": cpf, "email_contato": f"{cpf}@x.com",
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
        json={"email": f"vagas{uuid.uuid4().hex[:8]}@acesso.example.com", "senha_provisoria": senha},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    login = client.post("/auth/login", json={"cpf": cpf, "senha": senha})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}, id_associado


def test_acima_do_limite_de_vagas_vira_lista_de_espera(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers, vagas=1)

    r1 = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao(), headers=_ip_de_teste())
    assert r1.status_code == 200, r1.text
    assert r1.json()["status"] == "Pré-inscrito"

    r2 = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao(), headers=_ip_de_teste())
    assert r2.status_code == 200, r2.text
    assert r2.json()["status"] == "Lista de Espera"


def test_duas_inscricoes_simultaneas_na_ultima_vaga_so_uma_passa(client, auth_headers):
    """Ponto de Revisão FASE 4 (2/3): "duas inscrições simultâneas na última vaga não podem
    ambas passar" - teste de carga real (threads concorrentes), não só lógico."""
    id_evento = _criar_evento_publico(client, auth_headers, vagas=1)
    payloads = [_payload_inscricao() for _ in range(4)]

    def _inscrever(payload):
        return client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=payload, headers=_ip_de_teste())

    with ThreadPoolExecutor(max_workers=4) as executor:
        respostas = list(executor.map(_inscrever, payloads))

    assert all(r.status_code == 200 for r in respostas), [r.text for r in respostas]
    status_recebidos = [r.json()["status"] for r in respostas]
    assert status_recebidos.count("Pré-inscrito") == 1
    assert status_recebidos.count("Lista de Espera") == 3

    db = SessaoLocal()
    try:
        confirmadas = db.query(Inscricao).filter(Inscricao.contexto_tipo == "Evento", Inscricao.id_contexto == id_evento, Inscricao.status == "Pré-inscrito").count()
        assert confirmadas == 1
    finally:
        db.close()


def test_cota_por_categoria_e_independente_entre_associado_e_comunidade_externa(client, auth_headers, db):
    id_evento = _criar_evento_publico(client, auth_headers)
    r = client.post(f"/api/eventos/{id_evento}/cotas", json={"categoria": "ASSOCIADO", "vagas_limite": 1}, headers=auth_headers)
    assert r.status_code == 200, r.text
    r = client.post(f"/api/eventos/{id_evento}/cotas", json={"categoria": "COMUNIDADE_EXTERNA", "vagas_limite": 1}, headers=auth_headers)
    assert r.status_code == 200, r.text

    headers_associado_1, _ = _criar_associado_com_acesso(client, auth_headers)
    headers_associado_2, _ = _criar_associado_com_acesso(client, auth_headers)

    r = client.post(f"/api/eventos/{id_evento}/inscricao", headers=headers_associado_1)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "Pré-inscrito"

    # segundo associado - cota de ASSOCIADO já esgotada, vai pra lista de espera MESMO que a
    # cota de COMUNIDADE_EXTERNA ainda tenha vaga livre (cotas não se misturam).
    r = client.post(f"/api/eventos/{id_evento}/inscricao", headers=headers_associado_2)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "Lista de Espera"

    # participante externo (comunidade externa) ainda cabe na própria cota.
    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao(), headers=_ip_de_teste())
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "Pré-inscrito"


def test_cancelamento_promove_automaticamente_o_proximo_da_lista_de_espera(client, auth_headers, db):
    id_evento = _criar_evento_publico(client, auth_headers, vagas=1)

    payload_a = _payload_inscricao()
    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=payload_a, headers=_ip_de_teste())
    id_inscricao_a = r.json()["participantes"][0]["id_inscricao"]
    inscricao_a = db.query(Inscricao).filter(Inscricao.id_inscricao == id_inscricao_a).first()
    token_cancelamento_a = inscricao_a.token_cancelamento

    payload_b = _payload_inscricao()
    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=payload_b, headers=_ip_de_teste())
    assert r.json()["status"] == "Lista de Espera"
    id_inscricao_b = r.json()["id_inscricao"]

    r = client.post(f"/api/publico/inscricoes/{token_cancelamento_a}/cancelar", headers=_ip_de_teste())
    assert r.status_code == 200, r.text

    db.expire_all()
    inscricao_b = db.query(Inscricao).filter(Inscricao.id_inscricao == id_inscricao_b).first()
    assert inscricao_b.status == "Pré-inscrito"
    assert inscricao_b.prazo_confirmacao is not None


def test_confirmar_inscricao_promovida_por_token(client, auth_headers, db):
    id_evento = _criar_evento_publico(client, auth_headers, vagas=1)

    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao(), headers=_ip_de_teste())
    id_inscricao_a = r.json()["id_inscricao"]
    token_a = db.query(Inscricao).filter(Inscricao.id_inscricao == id_inscricao_a).first().token_cancelamento

    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao(), headers=_ip_de_teste())
    id_inscricao_b = r.json()["id_inscricao"]

    client.post(f"/api/publico/inscricoes/{token_a}/cancelar", headers=_ip_de_teste())

    db.expire_all()
    token_b = db.query(Inscricao).filter(Inscricao.id_inscricao == id_inscricao_b).first().token_cancelamento
    r = client.post(f"/api/publico/inscricoes/{token_b}/confirmar", headers=_ip_de_teste())
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "Confirmado"

    db.expire_all()
    inscricao_b = db.query(Inscricao).filter(Inscricao.id_inscricao == id_inscricao_b).first()
    assert inscricao_b.prazo_confirmacao is None


def test_expiracao_de_promocao_vencida_libera_vaga_pro_proximo(client, auth_headers, db):
    from app.services.vagas import expirar_promocoes_vencidas

    id_evento = _criar_evento_publico(client, auth_headers, vagas=1)

    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao(), headers=_ip_de_teste())
    id_inscricao_a = r.json()["id_inscricao"]
    token_a = db.query(Inscricao).filter(Inscricao.id_inscricao == id_inscricao_a).first().token_cancelamento

    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao(), headers=_ip_de_teste())
    id_inscricao_b = r.json()["id_inscricao"]

    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao(), headers=_ip_de_teste())
    id_inscricao_c = r.json()["id_inscricao"]

    client.post(f"/api/publico/inscricoes/{token_a}/cancelar", headers=_ip_de_teste())

    db.expire_all()
    inscricao_b = db.query(Inscricao).filter(Inscricao.id_inscricao == id_inscricao_b).first()
    assert inscricao_b.status == "Pré-inscrito"
    inscricao_b.prazo_confirmacao = datetime.utcnow() - timedelta(hours=1)  # simula prazo vencido
    db.commit()

    resultado = expirar_promocoes_vencidas(db)
    assert any(item["id_inscricao"] == id_inscricao_b for item in resultado)

    db.expire_all()
    inscricao_b = db.query(Inscricao).filter(Inscricao.id_inscricao == id_inscricao_b).first()
    inscricao_c = db.query(Inscricao).filter(Inscricao.id_inscricao == id_inscricao_c).first()
    assert inscricao_b.status == "Cancelado"
    assert inscricao_c.status == "Pré-inscrito"
    assert inscricao_c.prazo_confirmacao is not None


def test_inscricao_em_grupo_cada_participante_e_uma_inscricao_propria(client, auth_headers, db):
    id_evento = _criar_evento_publico(client, auth_headers, vagas=2)
    payload = _payload_inscricao(participantes_adicionais=[
        {"nome_completo": "Filho Um", "cpf": _cpf_unico()},
        {"nome_completo": "Filho Dois", "cpf": _cpf_unico()},
    ])

    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=payload, headers=_ip_de_teste())
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["identificador_grupo"] is not None
    assert len(corpo["participantes"]) == 3

    codigos = {p["codigo_checkin"] for p in corpo["participantes"]}
    assert len(codigos) == 3  # cada um com o próprio código de check-in

    status_recebidos = [p["status"] for p in corpo["participantes"]]
    assert status_recebidos.count("Pré-inscrito") == 2  # só 2 vagas
    assert status_recebidos.count("Lista de Espera") == 1  # o 3º fica na fila, tratamento individual

    grupo = db.query(Inscricao).filter(Inscricao.identificador_grupo == corpo["identificador_grupo"]).all()
    assert len(grupo) == 3
