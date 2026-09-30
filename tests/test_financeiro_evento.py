"""v4.9 (FASE 4) - financeiro de projeto/evento: cobrança de inscrição (faixa de preço por
categoria/data, cupom, isenção justificada), reembolso por cancelamento (evento e reserva de
espaço) e fechamento financeiro automático."""
import uuid
from datetime import datetime, timedelta

from app.models.core import AuditLog
from tests.test_eventos import _criar_associado_com_acesso, _criar_evento
from tests.test_financeiro import _criar_conta
from tests.test_pessoas import _cpf_unico

_ISO = "%Y-%m-%dT%H:%M:%S"


def _ip_teste() -> dict:
    return {"X-Forwarded-For": f"203.0.113.{uuid.uuid4().hex}"}


def _payload_inscricao_publica(**overrides) -> dict:
    cpf = _cpf_unico()
    payload = {
        "nome_completo": "Participante Financeiro Teste", "cpf": cpf, "email": f"{cpf}@x.com",
        "telefone": "11988887777", "consentimento_lgpd": True, "versao_texto_consentimento": "1",
        **overrides,
    }
    return payload


def _configurar_cobranca(client, auth_headers, id_evento, *, valor_base, id_conta_receita, exercicio_financeiro_aberto=None):
    r = client.put(
        f"/api/eventos/{id_evento}/cobranca-config",
        json={"valor_base": str(valor_base), "id_conta_contabil_receita": id_conta_receita},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text


def test_evento_gratuito_nao_gera_titulo(client, auth_headers):
    id_evento = _criar_evento(client, auth_headers, visibilidade="Pública")
    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao_publica(), headers=_ip_teste())
    assert r.status_code == 200, r.text
    assert r.json()["valor_cobrado"] is None


def test_faixa_de_preco_por_categoria_cobra_associado_e_gera_titulo(client, auth_headers, exercicio_financeiro_aberto):
    id_conta_receita = _criar_conta(client, auth_headers, f"3.9.{uuid.uuid4().hex[:6]}", "Receita Evento Teste", "Receita")
    id_evento = _criar_evento(client, auth_headers)
    _configurar_cobranca(client, auth_headers, id_evento, valor_base=100, id_conta_receita=id_conta_receita)

    r = client.post(
        f"/api/eventos/{id_evento}/faixas-preco",
        json={"categoria": "ASSOCIADO", "valor": "50.00"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    headers_associado = _criar_associado_com_acesso(client, auth_headers)
    r = client.post(f"/api/eventos/{id_evento}/inscricao", headers=headers_associado)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "Pré-inscrito"

    inscritos = client.get(f"/api/eventos/{id_evento}/elegibilidade", headers=auth_headers)
    # elegibilidade é da v4.8 (certificado) - aqui só confirmamos o título via título vinculado:
    titulos = client.get("/api/titulos/", headers=auth_headers)
    assert titulos.status_code == 200, titulos.text
    titulo_evento = next((t for t in titulos.json() if t["descricao"].startswith("Inscrição de")), None)
    assert titulo_evento is not None, "esperava um título A Receber gerado pela inscrição"
    assert float(titulo_evento["valor_original"]) == 50.0


def test_cupom_aplica_desconto_e_respeita_limite_de_uso(client, auth_headers, exercicio_financeiro_aberto):
    id_conta_receita = _criar_conta(client, auth_headers, f"3.9.{uuid.uuid4().hex[:6]}", "Receita Evento Teste", "Receita")
    id_evento = _criar_evento(client, auth_headers, visibilidade="Pública")
    _configurar_cobranca(client, auth_headers, id_evento, valor_base=200, id_conta_receita=id_conta_receita)

    r = client.post(
        f"/api/eventos/{id_evento}/cupons",
        json={"codigo": "desconto10", "tipo_desconto": "percentual", "valor_desconto": "50", "limite_uso": 1},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    r1 = client.post(
        f"/api/publico/eventos/{id_evento}/inscrever-se",
        json=_payload_inscricao_publica(codigo_cupom="DESCONTO10"), headers=_ip_teste(),
    )
    assert r1.status_code == 200, r1.text
    assert float(r1.json()["valor_cobrado"]) == 100.0  # 200 - 50% = 100

    r2 = client.post(
        f"/api/publico/eventos/{id_evento}/inscrever-se",
        json=_payload_inscricao_publica(codigo_cupom="DESCONTO10"), headers=_ip_teste(),
    )
    assert r2.status_code == 400
    assert "limite" in r2.json()["detail"].lower()


def test_isencao_justificada_zera_valor_da_inscricao(client, auth_headers, db, exercicio_financeiro_aberto):
    from app.models.pessoas import Pessoa

    id_conta_receita = _criar_conta(client, auth_headers, f"3.9.{uuid.uuid4().hex[:6]}", "Receita Evento Teste", "Receita")
    id_evento = _criar_evento(client, auth_headers, visibilidade="Pública")
    _configurar_cobranca(client, auth_headers, id_evento, valor_base=150, id_conta_receita=id_conta_receita)

    cpf = _cpf_unico()
    payload = _payload_inscricao_publica(cpf=cpf)
    pessoa = db.query(Pessoa).filter(Pessoa.cpf == cpf).first()
    assert pessoa is None  # ainda não existe - será criada na inscrição

    # primeiro, descobrir o id_pessoa que a dedup vai gerar: registra sem isenção, confirma cobrança cheia.
    r1 = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=payload, headers=_ip_teste())
    assert r1.status_code == 200, r1.text
    assert float(r1.json()["valor_cobrado"]) == 150.0

    pessoa = db.query(Pessoa).filter(Pessoa.cpf == cpf).first()
    assert pessoa is not None

    r = client.post(
        f"/api/eventos/{id_evento}/isencoes",
        json={"id_pessoa": pessoa.id_pessoa, "motivo": "OUTRO", "percentual_isencao": "100"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    id_evento_2 = _criar_evento(client, auth_headers, visibilidade="Pública")
    _configurar_cobranca(client, auth_headers, id_evento_2, valor_base=150, id_conta_receita=id_conta_receita)
    r = client.post(
        f"/api/eventos/{id_evento_2}/isencoes",
        json={"id_pessoa": pessoa.id_pessoa, "motivo": "OUTRO", "percentual_isencao": "100"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    r2 = client.post(f"/api/publico/eventos/{id_evento_2}/inscrever-se", json=payload, headers=_ip_teste())
    assert r2.status_code == 200, r2.text
    assert r2.json()["valor_cobrado"] is None or float(r2.json()["valor_cobrado"]) == 0.0


def test_cancelamento_dentro_do_prazo_reembolsa_cem_por_cento(client, auth_headers, db, exercicio_financeiro_aberto):
    id_conta_receita = _criar_conta(client, auth_headers, f"3.9.{uuid.uuid4().hex[:6]}", "Receita Evento Teste", "Receita")
    id_conta_caixa = _criar_conta(client, auth_headers, f"1.9.{uuid.uuid4().hex[:6]}", "Caixa Teste", "Ativo")
    id_evento = _criar_evento(client, auth_headers, visibilidade="Pública", data_hora_inicio=(datetime.utcnow() + timedelta(days=30)).strftime(_ISO))
    _configurar_cobranca(client, auth_headers, id_evento, valor_base=80, id_conta_receita=id_conta_receita)

    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao_publica(), headers=_ip_teste())
    assert r.status_code == 200, r.text
    token_cancelamento = r.json()["participantes"][0].get("codigo_checkin") and None  # placeholder, token vem por e-mail

    # o token de cancelamento não volta na resposta pública (só por e-mail) - buscar direto no banco.
    from app.models.motores import Inscricao

    inscricao_db = db.query(Inscricao).filter(Inscricao.id_inscricao == r.json()["id_inscricao"]).first()
    assert inscricao_db.id_titulo_cobranca is not None
    token_cancelamento = inscricao_db.token_cancelamento

    # baixa o título (simula pagamento) antes de cancelar - reembolso só existe pra título PAGO.
    baixa = client.post("/baixar-titulo/", json={
        "id_titulo": inscricao_db.id_titulo_cobranca, "valor_pago": 80, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": id_conta_caixa,
    }, headers=auth_headers)
    assert baixa.status_code == 200, baixa.text

    r_cancel = client.post(f"/api/publico/inscricoes/{token_cancelamento}/cancelar", headers=_ip_teste())
    assert r_cancel.status_code == 200, r_cancel.text
    assert r_cancel.json()["reembolso"] is not None
    assert float(r_cancel.json()["reembolso"]["valor"]) == 80.0

    titulos = client.get("/api/titulos/", headers=auth_headers).json()
    titulo_reembolso = next((t for t in titulos if t["id_titulo"] == r_cancel.json()["reembolso"]["id_titulo"]), None)
    assert titulo_reembolso is not None
    assert titulo_reembolso["tipo_titulo"] == "A Pagar"


def test_reserva_de_espaco_paga_cancelada_dentro_do_prazo_tambem_reembolsa(client, auth_headers, exercicio_financeiro_aberto):
    """Fecha o gap real pré-existente da v4.3: até a v4.9, cancelar reserva paga nunca devolvia
    a cobrança original."""
    id_conta_receita = _criar_conta(client, auth_headers, f"3.9.{uuid.uuid4().hex[:6]}", "Receita Espaco Teste", "Receita")
    id_conta_caixa = _criar_conta(client, auth_headers, f"1.9.{uuid.uuid4().hex[:6]}", "Caixa Teste", "Ativo")

    r = client.post("/api/espacos/", json={
        "nome": f"Espaço Teste {uuid.uuid4().hex[:6]}", "tipo": "SALAO", "valor_reserva": "60.00",
        "isento_para_associado_adimplente": False, "id_conta_contabil_receita": id_conta_receita,
        "prazo_cancelamento_horas": 24, "percentual_reembolso_cancelamento": "100",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_espaco = r.json()["id_espaco"]

    headers_associado = _criar_associado_com_acesso(client, auth_headers)
    me = client.get("/auth/me", headers=headers_associado)
    assert me.status_code == 200, me.text
    id_associado = me.json()["id_associado"]

    inicio = (datetime.utcnow() + timedelta(days=10)).strftime(_ISO)
    fim = (datetime.utcnow() + timedelta(days=10, hours=2)).strftime(_ISO)
    r = client.post("/api/reservas-espaco/", json={
        "id_espaco": id_espaco, "id_associado_solicitante": id_associado, "data_hora_inicio": inicio,
        "data_hora_fim": fim, "finalidade": "Teste de reembolso de reserva",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_reserva = r.json()["id_reserva"]
    id_titulo = r.json()["id_titulo_cobranca"]
    assert id_titulo is not None

    baixa = client.post("/baixar-titulo/", json={
        "id_titulo": id_titulo, "valor_pago": 60, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": id_conta_caixa,
    }, headers=auth_headers)
    assert baixa.status_code == 200, baixa.text

    r = client.post(f"/api/reservas-espaco/{id_reserva}/cancelar", json={"motivo": "Teste de cancelamento com reembolso"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["reembolso"] is not None
    assert float(r.json()["reembolso"]["valor"]) == 60.0


def test_fechamento_evento_agrega_inscritos_presentes_e_resultado(client, auth_headers, exercicio_financeiro_aberto):
    id_conta_receita = _criar_conta(client, auth_headers, f"3.9.{uuid.uuid4().hex[:6]}", "Receita Evento Teste", "Receita")
    id_conta_caixa = _criar_conta(client, auth_headers, f"1.9.{uuid.uuid4().hex[:6]}", "Caixa Teste", "Ativo")
    id_evento = _criar_evento(client, auth_headers, visibilidade="Pública")

    r = client.post("/api/centros-custo/", json={"codigo": f"EVT-{uuid.uuid4().hex[:6]}", "nome": "Centro de custo do evento", "id_evento": id_evento}, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_centro_custo = r.json()["id_centro_custo"]

    _configurar_cobranca(client, auth_headers, id_evento, valor_base=40, id_conta_receita=id_conta_receita)
    r = client.put(f"/api/eventos/{id_evento}/cobranca-config", json={
        "valor_base": "40.00", "id_conta_contabil_receita": id_conta_receita, "id_centro_custo": id_centro_custo,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao_publica(), headers=_ip_teste())
    assert r.status_code == 200, r.text
    id_titulo = None
    titulos = client.get("/api/titulos/", headers=auth_headers).json()
    id_titulo = next(t["id_titulo"] for t in titulos if t["descricao"].startswith("Inscrição de"))
    baixa = client.post("/baixar-titulo/", json={
        "id_titulo": id_titulo, "valor_pago": 40, "forma_pagamento": "Pix", "id_centro_custo": id_centro_custo,
        "id_conta_contabil_contrapartida": id_conta_caixa,
    }, headers=auth_headers)
    assert baixa.status_code == 200, baixa.text

    r = client.post(f"/api/eventos/{id_evento}/fechamento", headers=auth_headers)
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["total_inscritos"] == 1
    assert float(corpo["total_arrecadado"]) == 40.0
    assert float(corpo["resultado"]) == 40.0

    historico = client.get(f"/api/eventos/{id_evento}/fechamento", headers=auth_headers)
    assert historico.status_code == 200, historico.text
    assert len(historico.json()) == 1


def test_exportar_e_listar_faixas_cupons_isencoes_exigem_permissao(client, auth_headers):
    id_evento = _criar_evento(client, auth_headers)
    headers_sem_permissao = _criar_associado_com_acesso(client, auth_headers)
    assert client.get(f"/api/eventos/{id_evento}/faixas-preco", headers=headers_sem_permissao).status_code == 403
    assert client.get(f"/api/eventos/{id_evento}/cupons", headers=headers_sem_permissao).status_code == 403
    assert client.get(f"/api/eventos/{id_evento}/isencoes", headers=headers_sem_permissao).status_code == 403
