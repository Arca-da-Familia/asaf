"""v4.3 (FASE 4) - reserva de espaço: fluxo instantâneo x aprovação manual (configurável por
espaço), conflito de horário reaproveitando o motor de agenda (v4.0), tarifa automática por
perfil, recorrência com tratamento individual de exceções, cancelamento com taxa por prazo,
no-show com bloqueio por reincidência, e checklist de devolução com avaria."""
import uuid
from datetime import datetime, timedelta

from tests.test_situacao import _criar_associado
from tests.test_negociacao import _criar_titulo_vencido

_ISO = "%Y-%m-%dT%H:%M:%S"


def _criar_conta(client, auth_headers, tipo):
    r = client.post("/plano-contas/", json={
        "codigo_contabil": f"C{uuid.uuid4().hex[:8]}", "descricao_conta": f"Conta {tipo} teste espacos", "tipo": tipo,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_conta"]


def _criar_espaco(client, auth_headers, **overrides):
    payload = {"nome": f"Espaço Teste {uuid.uuid4().hex[:6]}", "tipo": "SALA"}
    payload.update(overrides)
    r = client.post("/api/espacos/", json=payload, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_espaco"]


def test_criar_espaco_valida_tipo_de_catalogo(client, auth_headers):
    r = client.post("/api/espacos/", json={"nome": "Espaço X", "tipo": "TIPO_INVALIDO"}, headers=auth_headers)
    assert r.status_code == 422


def test_reserva_instantanea_confirma_na_hora_e_conflito_e_recusado(client, auth_headers):
    id_espaco = _criar_espaco(client, auth_headers)
    associado = _criar_associado(client)
    inicio = (datetime.utcnow() + timedelta(days=5)).strftime(_ISO)
    fim = (datetime.utcnow() + timedelta(days=5, hours=2)).strftime(_ISO)

    r = client.post("/api/reservas-espaco/", json={
        "id_espaco": id_espaco, "id_associado_solicitante": associado["id_associado"],
        "data_hora_inicio": inicio, "data_hora_fim": fim, "finalidade": "Reunião de teste",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "CONFIRMADA"

    outro_associado = _criar_associado(client)
    r = client.post("/api/reservas-espaco/", json={
        "id_espaco": id_espaco, "id_associado_solicitante": outro_associado["id_associado"],
        "data_hora_inicio": inicio, "data_hora_fim": fim, "finalidade": "Tentativa de conflito",
    }, headers=auth_headers)
    assert r.status_code == 400
    assert "conflito" in r.json()["detail"].lower()


def test_reserva_com_aprovacao_manual_fica_solicitada_ate_aprovar_ou_recusar(client, auth_headers):
    id_espaco = _criar_espaco(client, auth_headers, exige_aprovacao=True)
    associado = _criar_associado(client)
    inicio = (datetime.utcnow() + timedelta(days=6)).strftime(_ISO)
    fim = (datetime.utcnow() + timedelta(days=6, hours=1)).strftime(_ISO)

    r = client.post("/api/reservas-espaco/", json={
        "id_espaco": id_espaco, "id_associado_solicitante": associado["id_associado"],
        "data_hora_inicio": inicio, "data_hora_fim": fim, "finalidade": "Oficina",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "SOLICITADA"
    id_reserva = r.json()["id_reserva"]

    r = client.post(f"/api/reservas-espaco/{id_reserva}/aprovar", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "CONFIRMADA"


def test_recusar_reserva_libera_o_horario_para_outra(client, auth_headers):
    id_espaco = _criar_espaco(client, auth_headers, exige_aprovacao=True)
    associado_1 = _criar_associado(client)
    associado_2 = _criar_associado(client)
    inicio = (datetime.utcnow() + timedelta(days=7)).strftime(_ISO)
    fim = (datetime.utcnow() + timedelta(days=7, hours=1)).strftime(_ISO)

    r = client.post("/api/reservas-espaco/", json={
        "id_espaco": id_espaco, "id_associado_solicitante": associado_1["id_associado"],
        "data_hora_inicio": inicio, "data_hora_fim": fim, "finalidade": "Primeira solicitação",
    }, headers=auth_headers)
    id_reserva_1 = r.json()["id_reserva"]

    r = client.post(f"/api/reservas-espaco/{id_reserva_1}/recusar", json={"motivo": "Espaço já comprometido com manutenção."}, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "RECUSADA"

    r = client.post("/api/reservas-espaco/", json={
        "id_espaco": id_espaco, "id_associado_solicitante": associado_2["id_associado"],
        "data_hora_inicio": inicio, "data_hora_fim": fim, "finalidade": "Segunda solicitação, mesmo horário",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text


def test_associado_inadimplente_nao_pode_reservar(client, auth_headers):
    id_espaco = _criar_espaco(client, auth_headers)
    conta_receita = _criar_conta(client, auth_headers, "Receita")
    associado = _criar_associado(client)
    _criar_titulo_vencido(client, auth_headers, conta_receita, associado["id_associado"])

    r = client.post("/api/reservas-espaco/", json={
        "id_espaco": id_espaco, "id_associado_solicitante": associado["id_associado"],
        "data_hora_inicio": (datetime.utcnow() + timedelta(days=8)).strftime(_ISO),
        "data_hora_fim": (datetime.utcnow() + timedelta(days=8, hours=1)).strftime(_ISO),
        "finalidade": "Tentativa de inadimplente",
    }, headers=auth_headers)
    assert r.status_code == 403
    assert "inadimplente" in r.json()["detail"].lower()


def test_reserva_onerosa_gera_cobranca_automatica_e_isencao_para_adimplente(client, auth_headers):
    conta_receita = _criar_conta(client, auth_headers, "Receita")
    id_espaco_pago = _criar_espaco(client, auth_headers, valor_reserva=80, isento_para_associado_adimplente=False, id_conta_contabil_receita=conta_receita)
    id_espaco_isento = _criar_espaco(client, auth_headers, valor_reserva=80, isento_para_associado_adimplente=True, id_conta_contabil_receita=conta_receita)
    associado = _criar_associado(client)

    r = client.post("/api/reservas-espaco/", json={
        "id_espaco": id_espaco_pago, "id_associado_solicitante": associado["id_associado"],
        "data_hora_inicio": (datetime.utcnow() + timedelta(days=9)).strftime(_ISO),
        "data_hora_fim": (datetime.utcnow() + timedelta(days=9, hours=1)).strftime(_ISO),
        "finalidade": "Reserva paga",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["id_titulo_cobranca"] is not None

    r = client.post("/api/reservas-espaco/", json={
        "id_espaco": id_espaco_isento, "id_associado_solicitante": associado["id_associado"],
        "data_hora_inicio": (datetime.utcnow() + timedelta(days=9)).strftime(_ISO),
        "data_hora_fim": (datetime.utcnow() + timedelta(days=9, hours=1)).strftime(_ISO),
        "finalidade": "Reserva isenta (adimplente)",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["id_titulo_cobranca"] is None


def test_reserva_recorrente_trata_conflito_individualmente_sem_abortar_a_serie(client, auth_headers):
    id_espaco = _criar_espaco(client, auth_headers)
    associado = _criar_associado(client)
    inicio_base = datetime.utcnow().replace(minute=0, second=0, microsecond=0) + timedelta(days=10)

    # ocupa deliberadamente a 2ª ocorrência da série (uma semana depois do início).
    client.post("/api/reservas-espaco/", json={
        "id_espaco": id_espaco, "id_associado_solicitante": associado["id_associado"],
        "data_hora_inicio": (inicio_base + timedelta(weeks=1)).strftime(_ISO),
        "data_hora_fim": (inicio_base + timedelta(weeks=1, hours=1)).strftime(_ISO),
        "finalidade": "Ocupação prévia para forçar conflito na série",
    }, headers=auth_headers)

    r = client.post("/api/reservas-espaco/recorrente", json={
        "id_espaco": id_espaco, "id_associado_solicitante": associado["id_associado"],
        "data_hora_inicio": inicio_base.strftime(_ISO), "data_hora_fim": (inicio_base + timedelta(hours=1)).strftime(_ISO),
        "finalidade": "Aula semanal", "quantidade_semanas": 3,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    ocorrencias = r.json()["ocorrencias"]
    assert len(ocorrencias) == 3
    assert ocorrencias[0]["sucesso"] is True
    assert ocorrencias[1]["sucesso"] is False
    assert ocorrencias[2]["sucesso"] is True


def test_cancelamento_fora_do_prazo_gera_taxa(client, auth_headers):
    conta_receita = _criar_conta(client, auth_headers, "Receita")
    id_espaco = _criar_espaco(client, auth_headers, prazo_cancelamento_horas=24, taxa_cancelamento_tardio=30, id_conta_contabil_receita=conta_receita)
    associado = _criar_associado(client)

    r = client.post("/api/reservas-espaco/", json={
        "id_espaco": id_espaco, "id_associado_solicitante": associado["id_associado"],
        "data_hora_inicio": (datetime.utcnow() + timedelta(hours=2)).strftime(_ISO),
        "data_hora_fim": (datetime.utcnow() + timedelta(hours=3)).strftime(_ISO),
        "finalidade": "Reserva para cancelar tarde",
    }, headers=auth_headers)
    id_reserva = r.json()["id_reserva"]

    r = client.post(f"/api/reservas-espaco/{id_reserva}/cancelar", json={"motivo": "Desisti em cima da hora."}, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "CANCELADA"

    titulos = client.get("/api/titulos/", headers=auth_headers).json()
    taxa = [t for t in titulos if t["id_associado"] == associado["id_associado"] and "taxa de cancelamento" in t["descricao"].lower()]
    assert len(taxa) == 1
    assert taxa[0]["valor_original"] == 30.0


def test_no_show_bloqueia_por_reincidencia(client, auth_headers):
    id_espaco = _criar_espaco(client, auth_headers, limite_no_show_bloqueio=1)
    associado = _criar_associado(client)

    r = client.post("/api/reservas-espaco/", json={
        "id_espaco": id_espaco, "id_associado_solicitante": associado["id_associado"],
        "data_hora_inicio": (datetime.utcnow() - timedelta(hours=2)).strftime(_ISO),
        "data_hora_fim": (datetime.utcnow() - timedelta(hours=1)).strftime(_ISO),
        "finalidade": "Reserva já no passado, pra marcar no-show",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_reserva = r.json()["id_reserva"]

    r = client.post(f"/api/reservas-espaco/{id_reserva}/nao-compareceu", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "NAO_COMPARECEU"

    r = client.post("/api/reservas-espaco/", json={
        "id_espaco": id_espaco, "id_associado_solicitante": associado["id_associado"],
        "data_hora_inicio": (datetime.utcnow() + timedelta(days=11)).strftime(_ISO),
        "data_hora_fim": (datetime.utcnow() + timedelta(days=11, hours=1)).strftime(_ISO),
        "finalidade": "Nova tentativa após no-show",
    }, headers=auth_headers)
    assert r.status_code == 403
    assert "reincidência" in r.json()["detail"].lower()


def test_checklist_de_devolucao_registra_avaria_e_conclui_reserva(client, auth_headers):
    id_espaco = _criar_espaco(client, auth_headers)
    associado = _criar_associado(client)
    r = client.post("/api/reservas-espaco/", json={
        "id_espaco": id_espaco, "id_associado_solicitante": associado["id_associado"],
        "data_hora_inicio": (datetime.utcnow() + timedelta(days=12)).strftime(_ISO),
        "data_hora_fim": (datetime.utcnow() + timedelta(days=12, hours=1)).strftime(_ISO),
        "finalidade": "Reserva para checklist",
    }, headers=auth_headers)
    id_reserva = r.json()["id_reserva"]

    r = client.post(f"/api/reservas-espaco/{id_reserva}/devolucao", json={"condicao_devolucao": "Ok"}, headers=auth_headers)
    assert r.status_code == 400  # sem retirada registrada ainda

    r = client.post(f"/api/reservas-espaco/{id_reserva}/retirada", json={"condicao_retirada": "Espaço limpo e organizado."}, headers=auth_headers)
    assert r.status_code == 200, r.text

    r = client.post(f"/api/reservas-espaco/{id_reserva}/retirada", json={"condicao_retirada": "Tentativa duplicada."}, headers=auth_headers)
    assert r.status_code == 400

    r = client.post(f"/api/reservas-espaco/{id_reserva}/devolucao", json={
        "condicao_devolucao": "Vidro da janela quebrado.", "houve_avaria": True, "descricao_avaria": "Vidro trincado na janela lateral.",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["houve_avaria"] is True

    checklist = client.get(f"/api/reservas-espaco/{id_reserva}/checklist", headers=auth_headers).json()
    assert checklist["descricao_avaria"] == "Vidro trincado na janela lateral."

    reservas = client.get(f"/api/reservas-espaco/?id_espaco={id_espaco}", headers=auth_headers).json()
    reserva_atual = next(r for r in reservas if r["id_reserva"] == id_reserva)
    assert reserva_atual["status"] == "CONCLUIDA"


def test_disponibilidade_publica_nao_exige_autenticacao_e_nao_expoe_solicitante(client, auth_headers):
    id_espaco = _criar_espaco(client, auth_headers)
    associado = _criar_associado(client)
    inicio = datetime.utcnow() + timedelta(days=13)
    client.post("/api/reservas-espaco/", json={
        "id_espaco": id_espaco, "id_associado_solicitante": associado["id_associado"],
        "data_hora_inicio": inicio.strftime(_ISO), "data_hora_fim": (inicio + timedelta(hours=1)).strftime(_ISO),
        "finalidade": "Reserva sigilosa",
    }, headers=auth_headers)

    r = client.get(f"/api/espacos/{id_espaco}/disponibilidade")
    assert r.status_code == 200, r.text
    disponibilidade = r.json()
    assert len(disponibilidade) == 1
    assert set(disponibilidade[0].keys()) == {"data_hora_inicio", "data_hora_fim"}


def test_bloqueio_de_espaco_reutiliza_motor_de_agenda_e_impede_reserva(client, auth_headers):
    id_espaco = _criar_espaco(client, auth_headers)
    inicio = datetime.utcnow() + timedelta(days=14)
    fim = inicio + timedelta(hours=3)

    r = client.post(f"/api/espacos/{id_espaco}/bloqueios", json={
        "data_hora_inicio": inicio.strftime(_ISO), "data_hora_fim": fim.strftime(_ISO), "motivo": "MANUTENCAO", "descricao": "Pintura",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    associado = _criar_associado(client)
    r = client.post("/api/reservas-espaco/", json={
        "id_espaco": id_espaco, "id_associado_solicitante": associado["id_associado"],
        "data_hora_inicio": (inicio + timedelta(hours=1)).strftime(_ISO), "data_hora_fim": (inicio + timedelta(hours=2)).strftime(_ISO),
        "finalidade": "Tentativa durante manutenção",
    }, headers=auth_headers)
    assert r.status_code == 400
    assert "conflito" in r.json()["detail"].lower()
