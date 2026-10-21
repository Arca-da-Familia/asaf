"""A hora que o sistema guarda é UTC; o que as pessoas leem (e-mail, certificado) é a hora de Belém (UTC-3). Achado da conferência independente da v5.5d: o site mostrava a hora crua como se fosse
local (todo evento criado pelo painel aparecia 3 horas depois do digitado) e os e-mails da v5.5d escreviam a hora UTC sem dizer. Aqui se trava o lado do servidor."""
from datetime import datetime, timedelta, timezone

from app.services import eventos as servico_eventos
from app.services import status_do_evento as servico_status
from app.services import vagas as servico_vagas
from app.services.fuso import dia_e_hora_em_belem, dia_em_belem, para_belem
from tests.test_eventos_inscricao_publica import _criar_evento_publico, _ip_de_teste, _payload_inscricao

_ISO = "%Y-%m-%dT%H:%M:%S"


def test_a_hora_guardada_em_utc_vira_a_hora_de_belem():
    assert dia_e_hora_em_belem(datetime(2026, 10, 15, 22, 0)) == "15/10/2026 às 19:00"
    # passa da meia-noite UTC: em Belém ainda é o dia anterior
    assert dia_e_hora_em_belem(datetime(2026, 10, 20, 2, 30)) == "19/10/2026 às 23:30"
    assert dia_em_belem(datetime(2026, 10, 20, 2, 30)) == "19/10/2026"
    # o que já tem fuso só é convertido
    assert para_belem(datetime(2026, 10, 15, 22, 0, tzinfo=timezone.utc)).hour == 19
    assert para_belem(datetime(2026, 10, 15, 19, 0, tzinfo=timezone(timedelta(hours=-3)))).hour == 19


def _capturar_emails(monkeypatch):
    enviados = []
    for modulo in (servico_status.notificacoes, servico_eventos.notificacoes, servico_vagas.notificacoes):
        monkeypatch.setattr(modulo, "enviar_email", lambda destino, assunto, corpo_texto, cabecalhos=None: enviados.append((destino, assunto, corpo_texto)))
    return enviados


def test_o_e_mail_de_remarcacao_mostra_a_hora_de_belem_e_diz_qual_e(client, auth_headers, monkeypatch):
    emails = _capturar_emails(monkeypatch)
    inicio = datetime(2027, 3, 12, 2, 30)  # 23:30 do dia 11 em Belém
    id_evento = _criar_evento_publico(client, auth_headers, data_hora_inicio=inicio.strftime(_ISO))
    r = client.post(
        f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao(email="remarca.belem@exemplo.org"), headers=_ip_de_teste(),
    )
    assert r.status_code == 200, r.text
    emails.clear()
    nova = datetime(2027, 4, 2, 22, 0)  # 19:00 do dia 2 em Belém
    r = client.post(f"/api/eventos/{id_evento}/status", json={"status": "Programado", "nova_data_hora_inicio": nova.strftime(_ISO)}, headers=auth_headers)
    assert r.status_code == 200, r.text
    corpo = emails[0][2]
    assert "02/04/2027 às 19:00 (horário de Belém)" in corpo
    assert "11/03/2027 às 23:30 (horário de Belém)" in corpo, "a data anterior também sai em Belém (o dia 11, não o 12 de UTC)"
    assert "UTC" not in corpo


def test_o_e_mail_da_vaga_que_abriu_mostra_o_prazo_em_horario_de_belem(client, auth_headers, monkeypatch):
    emails = _capturar_emails(monkeypatch)
    id_evento = _criar_evento_publico(client, auth_headers, vagas=1)
    primeira = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao(), headers=_ip_de_teste()).json()
    client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao(email="espera.belem@exemplo.org"), headers=_ip_de_teste())
    emails.clear()
    assert client.post(f"/api/publico/inscricoes/{primeira['token_cancelamento']}/cancelar", headers=_ip_de_teste()).status_code == 200
    aviso = next(e for e in emails if e[0] == "espera.belem@exemplo.org")
    assert "(horário de Belém)" in aviso[2] and "(UTC)" not in aviso[2]


def test_o_e_mail_de_cancelamento_de_evento_pago_diz_como_pedir_a_devolucao(db):
    from decimal import Decimal

    from app.models.eventos import Evento
    from app.services.status_do_evento import _texto_do_aviso

    pago = Evento(id_evento=1, titulo="Jantar", visibilidade="Interna", valor_base=Decimal("50"), data_hora_inicio=datetime(2027, 1, 1, 22, 0))
    gratis = Evento(id_evento=2, titulo="Oficina", visibilidade="Interna", valor_base=None, data_hora_inicio=datetime(2027, 1, 1, 22, 0))
    _, com_valor = _texto_do_aviso(db, pago, situacao_nova="Cancelado", motivo="Salão indisponível", inicio_anterior=None)
    _, sem_valor = _texto_do_aviso(db, gratis, situacao_nova="Cancelado", motivo="Salão indisponível", inicio_anterior=None)
    assert "cancele-a pelo link do e-mail de confirmação" in com_valor and "valor inteiro" in com_valor
    assert "devolução" not in sem_valor
