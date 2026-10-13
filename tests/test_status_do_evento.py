"""v5.5d - status do evento (Programado / Adiado / Cancelado / Realizado, com motivo). O que o servidor garante:
  1. todo evento nasce Programado e a leitura pública traz a situação e o motivo;
  2. cancelar e adiar exigem motivo (que vai ao site, por isso não pode ter dado pessoal); realizado só depois de começar; as transições inválidas são recusadas;
  3. evento cancelado, adiado ou realizado não recebe inscrição nova (por nenhuma porta);
  4. quem estava inscrito recebe e-mail (um por endereço) e a inscrição NÃO é cancelada pelo sistema; sem e-mail configurado a mudança de status vale do mesmo jeito;
  5. remarcar guarda a data de antes, leva a programação junto e dá prazo novo a quem foi promovido da fila e ainda não confirmou;
  6. evento parado não promove ninguém da fila, não vence prazo de confirmação, não faz check-in nem pesquisa de satisfação;
  7. quem desiste de evento cancelado pela ASAF recebe o valor INTEIRO de volta;
  8. a mudança fica na Auditoria."""
import uuid
from datetime import datetime, timedelta

import pytest

from app.models.eventos import Evento
from app.models.motores import LISTA_DE_ESPERA, PRE_INSCRITO, Inscricao
from app.services import eventos as servico_eventos
from app.services import status_do_evento as servico_status
from app.services import vagas as servico_vagas
from tests.test_eventos import _criar_evento
from tests.test_eventos_inscricao_publica import _criar_evento_publico, _ip_de_teste, _payload_inscricao
from tests.test_portaria import _emitir_token_portaria

_ISO = "%Y-%m-%dT%H:%M:%S"


def _inscrever(client, id_evento, **overrides):
    return client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao(**overrides), headers=_ip_de_teste())


def _mudar(client, auth_headers, id_evento, status, **campos):
    return client.post(f"/api/eventos/{id_evento}/status", json={"status": status, **campos}, headers=auth_headers)


def _emails(monkeypatch):
    enviados = []
    for modulo in (servico_status.notificacoes, servico_eventos.notificacoes, servico_vagas.notificacoes):
        monkeypatch.setattr(modulo, "enviar_email", lambda destino, assunto, corpo_texto: enviados.append((destino, assunto, corpo_texto)))
    return enviados


def _no_banco(db, id_evento) -> Evento:
    db.expire_all()
    return db.query(Evento).filter(Evento.id_evento == id_evento).one()


def test_o_evento_nasce_programado_e_a_leitura_publica_traz_a_situacao(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers)
    publico = client.get(f"/api/publico/eventos/{id_evento}").json()
    assert publico["status"] == "Programado" and publico["motivo_status"] is None and publico["data_hora_inicio_anterior"] is None
    gestao = client.get(f"/api/eventos/{id_evento}", headers=auth_headers).json()
    assert gestao["status"] == "Programado" and gestao["status_alterado_em"] is None
    lista = client.get("/api/publico/eventos").json()
    assert next(e for e in lista if e["id_evento"] == id_evento)["status"] == "Programado"


def test_cancelar_e_adiar_exigem_motivo_e_o_motivo_vai_ao_site(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers)
    for motivo in (None, "", "   ", "xis"):
        r = _mudar(client, auth_headers, id_evento, "Cancelado", motivo=motivo)
        assert r.status_code == 422 and "motivo" in r.json()["detail"].lower(), (motivo, r.text)
    assert _mudar(client, auth_headers, id_evento, "Adiado").status_code == 422
    r = _mudar(client, auth_headers, id_evento, "Cancelado", motivo="Chuva forte prevista para a região")
    assert r.status_code == 200, r.text
    assert r.json()["evento"]["status"] == "Cancelado"
    publico = client.get(f"/api/publico/eventos/{id_evento}").json()
    assert publico["status"] == "Cancelado" and publico["motivo_status"] == "Chuva forte prevista para a região"
    # o evento cancelado continua na lista (quem viu o evento precisa ver que foi cancelado)
    assert next(e for e in client.get("/api/publico/eventos").json() if e["id_evento"] == id_evento)["status"] == "Cancelado"


def test_o_motivo_de_evento_publico_nao_pode_ter_dado_pessoal(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers)
    r = _mudar(client, auth_headers, id_evento, "Cancelado", motivo="Falar com fulano@exemplo.com sobre o assunto")
    assert r.status_code == 422 and "dado pessoal" in r.json()["detail"]
    assert client.get(f"/api/eventos/{id_evento}", headers=auth_headers).json()["status"] == "Programado"
    # evento interno não vai ao site: a conferência não se aplica
    interno = _criar_evento(client, auth_headers)
    assert _mudar(client, auth_headers, interno, "Cancelado", motivo="Falar com fulano@exemplo.com sobre o assunto").status_code == 200


def test_situacao_invalida_e_sem_permissao(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers)
    assert _mudar(client, auth_headers, id_evento, "Suspenso").status_code == 422
    assert client.post(f"/api/eventos/{id_evento}/status", json={"status": "Cancelado", "motivo": "Motivo qualquer"}).status_code == 401
    assert client.post("/api/eventos/99999999/status", json={"status": "Adiado", "motivo": "Motivo qualquer"}, headers=auth_headers).status_code == 404


def test_transicoes_invalidas_sao_recusadas(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers)
    r = _mudar(client, auth_headers, id_evento, "Programado")
    assert r.status_code == 400 and "já está programado" in r.json()["detail"]
    assert _mudar(client, auth_headers, id_evento, "Cancelado", motivo="Motivo de teste do cancelamento").status_code == 200
    r = _mudar(client, auth_headers, id_evento, "Cancelado", motivo="Motivo de teste do cancelamento")
    assert r.status_code == 400 and "já está cancelado" in r.json()["detail"]
    r = _mudar(client, auth_headers, id_evento, "Adiado", motivo="Motivo de teste do adiamento")
    assert r.status_code == 400 and "não pode passar" in r.json()["detail"]
    # cancelado volta a Programado (cancelei por engano): a data ainda é futura, não precisa de data nova
    r = _mudar(client, auth_headers, id_evento, "Programado")
    assert r.status_code == 200 and r.json()["evento"]["status"] == "Programado" and r.json()["evento"]["motivo_status"] is None
    assert r.json()["evento"]["data_hora_inicio_anterior"] is None, "voltar na mesma data não é remarcação"


def test_realizado_so_depois_de_comecar_e_nao_volta_atras(client, auth_headers, db):
    futuro = _criar_evento_publico(client, auth_headers)
    r = _mudar(client, auth_headers, futuro, "Realizado")
    assert r.status_code == 400 and "ainda não começou" in r.json()["detail"]
    passado = _criar_evento_publico(client, auth_headers, data_hora_inicio=(datetime.utcnow() - timedelta(days=2)).strftime(_ISO))
    r = _mudar(client, auth_headers, passado, "Realizado")
    assert r.status_code == 200 and r.json()["evento"]["status"] == "Realizado"
    assert r.json()["avisos"] is None, "marcar como realizado não manda e-mail a ninguém"
    r = _mudar(client, auth_headers, passado, "Programado", nova_data_hora_inicio=(datetime.utcnow() + timedelta(days=9)).strftime(_ISO))
    assert r.status_code == 400 and "não volta atrás" in r.json()["detail"]
    assert _mudar(client, auth_headers, passado, "Cancelado", motivo="Motivo de teste").status_code == 400


@pytest.mark.parametrize("status,motivo,trecho", [
    ("Cancelado", "Motivo de teste do cancelamento", "foi cancelado"),
    ("Adiado", "Motivo de teste do adiamento", "foi adiado"),
])
def test_evento_cancelado_ou_adiado_nao_recebe_inscricao_nova(client, auth_headers, status, motivo, trecho):
    id_evento = _criar_evento_publico(client, auth_headers)
    assert _inscrever(client, id_evento).status_code == 200
    assert _mudar(client, auth_headers, id_evento, status, motivo=motivo).status_code == 200
    r = _inscrever(client, id_evento)
    assert r.status_code == 400 and trecho in r.json()["detail"], r.text


def test_evento_realizado_nao_recebe_inscricao_nova(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers, data_hora_inicio=(datetime.utcnow() - timedelta(hours=3)).strftime(_ISO), data_hora_fim=(datetime.utcnow() + timedelta(hours=3)).strftime(_ISO))
    assert _mudar(client, auth_headers, id_evento, "Realizado").status_code == 200
    r = _inscrever(client, id_evento)
    assert r.status_code == 400 and "já foi realizado" in r.json()["detail"]


def test_a_secretaria_e_o_associado_tambem_nao_inscrevem_em_evento_cancelado(client, auth_headers):
    from tests.test_eventos_vagas import _criar_associado_com_acesso

    id_evento = _criar_evento(client, auth_headers, visibilidade="Interna")
    cabecalho_do_associado, id_associado = _criar_associado_com_acesso(client, auth_headers)
    assert _mudar(client, auth_headers, id_evento, "Cancelado", motivo="Motivo de teste do cancelamento").status_code == 200
    # a secretaria inscrevendo em nome do associado
    r = client.post(f"/api/eventos/{id_evento}/inscrever-associado", json={"id_associado": id_associado}, headers=auth_headers)
    assert r.status_code == 400 and "foi cancelado" in r.json()["detail"], r.text
    # o próprio associado, pelo autoatendimento
    r = client.post(f"/api/eventos/{id_evento}/inscricao", headers=cabecalho_do_associado)
    assert r.status_code == 400 and "foi cancelado" in r.json()["detail"], r.text


def test_quem_estava_inscrito_recebe_um_aviso_por_endereco_e_a_inscricao_continua(client, auth_headers, monkeypatch, db):
    emails = _emails(monkeypatch)
    id_evento = _criar_evento_publico(client, auth_headers, titulo=f"Evento do Aviso {uuid.uuid4().hex[:6]}")
    familia = _inscrever(client, id_evento, email="familia@exemplo.org", participantes_adicionais=[{"nome_completo": "Filha da Familia", "cpf": _payload_inscricao()["cpf"]}])
    assert familia.status_code == 200, familia.text
    assert _inscrever(client, id_evento, email="outra.pessoa@exemplo.org").status_code == 200
    emails.clear()
    r = _mudar(client, auth_headers, id_evento, "Cancelado", motivo="O salão ficou indisponível")
    assert r.status_code == 200, r.text
    avisos = r.json()["avisos"]
    assert avisos["inscricoes_a_avisar"] == 3 and avisos["avisos_enviados"] == 2 and avisos["enderecos"] == 2 and avisos["inscritos_sem_email"] == 0
    assert sorted(e[0] for e in emails) == ["familia@exemplo.org", "outra.pessoa@exemplo.org"]
    assunto, corpo = emails[0][1], emails[0][2]
    assert "cancelado" in assunto.lower() and "CANCELADO" in corpo and "O salão ficou indisponível" in corpo
    assert f"/eventos/{id_evento}/" in corpo
    # o sistema não cancelou nenhuma inscrição por conta própria
    status = {i.status for i in db.query(Inscricao).filter(Inscricao.contexto_tipo == "Evento", Inscricao.id_contexto == id_evento).all()}
    assert status == {PRE_INSCRITO}


def test_sem_e_mail_configurado_o_status_muda_do_mesmo_jeito(client, auth_headers, db):
    # no ambiente de teste não há SMTP: o envio falha e a mudança de status não pode desfazer
    id_evento = _criar_evento_publico(client, auth_headers)
    assert _inscrever(client, id_evento).status_code == 200
    r = _mudar(client, auth_headers, id_evento, "Adiado", motivo="Aguardando a liberação do espaço")
    assert r.status_code == 200, r.text
    assert r.json()["avisos"]["inscricoes_a_avisar"] == 1 and r.json()["avisos"]["avisos_enviados"] == 0
    assert _no_banco(db, id_evento).status == "Adiado"


def test_remarcar_guarda_a_data_de_antes_leva_a_programacao_e_avisa(client, auth_headers, monkeypatch, db):
    emails = _emails(monkeypatch)
    inicio = (datetime.utcnow() + timedelta(days=10)).replace(microsecond=0)
    id_evento = _criar_evento_publico(client, auth_headers, data_hora_inicio=inicio.strftime(_ISO), data_hora_fim=(inicio + timedelta(hours=4)).strftime(_ISO))
    sessao = client.post(f"/api/eventos/{id_evento}/sessoes", json={
        "titulo": "Abertura", "data_hora_inicio": (inicio + timedelta(hours=1)).strftime(_ISO), "data_hora_fim": (inicio + timedelta(hours=2)).strftime(_ISO),
    }, headers=auth_headers)
    assert sessao.status_code == 200, sessao.text
    assert _inscrever(client, id_evento, email="remarca@exemplo.org").status_code == 200
    assert _mudar(client, auth_headers, id_evento, "Adiado", motivo="Aguardando a liberação do espaço").status_code == 200
    emails.clear()

    # adiado só volta com a data nova; data nova no passado ou igual à atual é recusada
    assert _mudar(client, auth_headers, id_evento, "Programado").status_code == 422
    assert _mudar(client, auth_headers, id_evento, "Programado", nova_data_hora_inicio=(datetime.utcnow() - timedelta(days=1)).strftime(_ISO)).status_code == 422
    assert _mudar(client, auth_headers, id_evento, "Programado", nova_data_hora_inicio=inicio.strftime(_ISO)).status_code == 422
    assert _mudar(client, auth_headers, id_evento, "Programado", nova_data_hora_inicio=(inicio + timedelta(days=30)).strftime(_ISO), nova_data_hora_fim=(inicio + timedelta(days=20)).strftime(_ISO)).status_code == 422
    assert _mudar(client, auth_headers, id_evento, "Adiado", nova_data_hora_inicio=(inicio + timedelta(days=30)).strftime(_ISO), motivo="Motivo de teste").status_code == 400

    nova = inicio + timedelta(days=30)
    r = _mudar(client, auth_headers, id_evento, "Programado", nova_data_hora_inicio=nova.strftime(_ISO), motivo="Espaço liberado")
    assert r.status_code == 200, r.text
    evento = _no_banco(db, id_evento)
    assert evento.status == "Programado" and evento.data_hora_inicio == nova and evento.data_hora_inicio_anterior == inicio
    assert evento.data_hora_fim == nova + timedelta(hours=4), "a duração do evento é mantida"
    assert r.json()["sessoes_deslocadas"] == 1
    lista = client.get(f"/api/eventos/{id_evento}/sessoes", headers=auth_headers).json()
    assert lista[0]["data_hora_inicio"].startswith((nova + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M")), "a programação acompanha a data nova"
    publico = client.get(f"/api/publico/eventos/{id_evento}").json()
    assert publico["status"] == "Programado" and publico["motivo_status"] == "Espaço liberado" and publico["data_hora_inicio_anterior"].startswith(inicio.strftime("%Y-%m-%dT%H:%M"))
    assert len(emails) == 1 and emails[0][0] == "remarca@exemplo.org" and "REMARCADO" in emails[0][2]
    assert nova.strftime("%d/%m/%Y") in emails[0][2] and inicio.strftime("%d/%m/%Y") in emails[0][2]


def test_remarcar_um_evento_programado_direto_tambem_vale(client, auth_headers, db):
    inicio = (datetime.utcnow() + timedelta(days=10)).replace(microsecond=0)
    id_evento = _criar_evento_publico(client, auth_headers, data_hora_inicio=inicio.strftime(_ISO))
    nova = inicio + timedelta(days=3)
    r = _mudar(client, auth_headers, id_evento, "Programado", nova_data_hora_inicio=nova.strftime(_ISO))
    assert r.status_code == 200, r.text
    evento = _no_banco(db, id_evento)
    assert evento.data_hora_inicio == nova and evento.data_hora_inicio_anterior == inicio and evento.data_hora_fim is None


def test_cancelado_com_a_data_ja_passada_so_volta_com_data_nova(client, auth_headers, db):
    id_evento = _criar_evento_publico(client, auth_headers)
    assert _mudar(client, auth_headers, id_evento, "Cancelado", motivo="Motivo de teste do cancelamento").status_code == 200
    evento = _no_banco(db, id_evento)
    evento.data_hora_inicio = datetime.utcnow() - timedelta(days=2)
    db.commit()
    r = _mudar(client, auth_headers, id_evento, "Programado")
    assert r.status_code == 422 and "já passou" in r.json()["detail"]


def test_a_fila_de_espera_nao_anda_em_evento_cancelado(client, auth_headers, monkeypatch, db):
    emails = _emails(monkeypatch)
    id_evento = _criar_evento_publico(client, auth_headers, vagas=1)
    primeira = _inscrever(client, id_evento).json()
    segunda = _inscrever(client, id_evento).json()
    assert primeira["status"] == PRE_INSCRITO and segunda["status"] == LISTA_DE_ESPERA
    assert _mudar(client, auth_headers, id_evento, "Cancelado", motivo="Motivo de teste do cancelamento").status_code == 200
    emails.clear()
    # a primeira desiste depois do cancelamento: a vaga não chama a segunda (o evento não vai acontecer)
    assert client.post(f"/api/publico/inscricoes/{primeira['token_cancelamento']}/cancelar", headers=_ip_de_teste()).status_code == 200
    db.expire_all()
    assert db.query(Inscricao).filter(Inscricao.id_inscricao == segunda["id_inscricao"]).one().status == LISTA_DE_ESPERA
    assert not [e for e in emails if "vaga abriu" in e[1].lower()]


def test_o_prazo_de_confirmacao_nao_vence_com_o_evento_parado_e_ganha_prazo_novo_ao_remarcar(client, auth_headers, db):
    id_evento = _criar_evento_publico(client, auth_headers, vagas=1)
    primeira = _inscrever(client, id_evento).json()
    segunda = _inscrever(client, id_evento).json()
    # a primeira desiste e a segunda é promovida, com prazo para confirmar
    assert client.post(f"/api/publico/inscricoes/{primeira['token_cancelamento']}/cancelar", headers=_ip_de_teste()).status_code == 200
    promovida = db.query(Inscricao).filter(Inscricao.id_inscricao == segunda["id_inscricao"]).one()
    db.refresh(promovida)
    assert promovida.status == PRE_INSCRITO and promovida.prazo_confirmacao is not None
    assert _mudar(client, auth_headers, id_evento, "Adiado", motivo="Aguardando a liberação do espaço").status_code == 200
    promovida.prazo_confirmacao = datetime.utcnow() - timedelta(hours=1)  # o prazo venceu enquanto o evento estava adiado
    db.commit()
    assert all(r["id_inscricao"] != segunda["id_inscricao"] for r in servico_vagas.expirar_promocoes_vencidas(db))
    db.expire_all()
    assert db.query(Inscricao).filter(Inscricao.id_inscricao == segunda["id_inscricao"]).one().status == PRE_INSCRITO
    nova = datetime.utcnow() + timedelta(days=40)
    assert _mudar(client, auth_headers, id_evento, "Programado", nova_data_hora_inicio=nova.strftime(_ISO)).status_code == 200
    db.expire_all()
    assert db.query(Inscricao).filter(Inscricao.id_inscricao == segunda["id_inscricao"]).one().prazo_confirmacao > datetime.utcnow(), "prazo novo ao remarcar"


def test_a_portaria_nao_faz_checkin_em_evento_cancelado_ou_adiado(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers)
    inscrita = _inscrever(client, id_evento).json()
    token = _emitir_token_portaria(client, auth_headers, id_evento)
    portaria = {"Authorization": f"Bearer {token}"}
    corpo = {"chave_idempotencia": uuid.uuid4().hex, "metodo": "codigo", "codigo": inscrita["codigo_checkin"]}
    assert _mudar(client, auth_headers, id_evento, "Adiado", motivo="Aguardando a liberação do espaço").status_code == 200
    r = client.post("/portaria/checkin", json=corpo, headers=portaria)
    assert r.status_code == 400 and "adiado" in r.json()["detail"]
    assert client.get("/portaria/evento", headers=portaria).json()["status"] == "Adiado"
    assert _mudar(client, auth_headers, id_evento, "Cancelado", motivo="Motivo de teste do cancelamento").status_code == 200
    r = client.post("/portaria/checkin", json=corpo, headers=portaria)
    assert r.status_code == 400 and "cancelado" in r.json()["detail"]
    # reativado, volta a funcionar
    assert _mudar(client, auth_headers, id_evento, "Programado").status_code == 200
    assert client.post("/portaria/checkin", json={**corpo, "chave_idempotencia": uuid.uuid4().hex}, headers=portaria).status_code == 200


def test_evento_cancelado_nao_gera_convite_de_pesquisa_de_satisfacao(client, auth_headers):
    convidar = lambda id_evento: client.post(f"/api/eventos/{id_evento}/pesquisa-satisfacao/convidar", headers=auth_headers)
    # controle: o evento de pé gera o convite do inscrito
    de_pe = _criar_evento_publico(client, auth_headers)
    assert _inscrever(client, de_pe).status_code == 200
    assert convidar(de_pe).json()["quantidade_convites_novos"] == 1
    # cancelado: ninguém é convidado a dar nota a um evento que não aconteceu
    cancelado = _criar_evento_publico(client, auth_headers)
    assert _inscrever(client, cancelado).status_code == 200
    assert _mudar(client, auth_headers, cancelado, "Cancelado", motivo="Motivo de teste do cancelamento").status_code == 200
    assert convidar(cancelado).json()["quantidade_convites_novos"] == 0


def test_o_resumo_do_link_diz_que_o_evento_foi_cancelado_e_nao_deixa_confirmar(client, auth_headers, db):
    id_evento = _criar_evento_publico(client, auth_headers, vagas=1)
    primeira = _inscrever(client, id_evento).json()
    segunda = _inscrever(client, id_evento).json()
    assert client.post(f"/api/publico/inscricoes/{primeira['token_cancelamento']}/cancelar", headers=_ip_de_teste()).status_code == 200  # a segunda é promovida
    assert _mudar(client, auth_headers, id_evento, "Cancelado", motivo="O salão ficou indisponível").status_code == 200
    resumo = client.get(f"/api/publico/inscricoes/{segunda['token_cancelamento']}").json()
    assert resumo["evento"]["status"] == "Cancelado" and resumo["evento"]["motivo_status"] == "O salão ficou indisponível"
    assert resumo["pode_confirmar"] is False and resumo["pode_cancelar"] is True
    r = client.post(f"/api/publico/inscricoes/{segunda['token_cancelamento']}/confirmar", headers=_ip_de_teste())
    assert r.status_code == 400 and "foi cancelado" in r.json()["detail"]


def test_quem_desiste_de_evento_cancelado_pela_asaf_recebe_tudo_de_volta(client, auth_headers, db, exercicio_financeiro_aberto):
    from tests.test_financeiro import _criar_conta
    from tests.test_financeiro_evento import _configurar_cobranca

    id_conta_receita = _criar_conta(client, auth_headers, f"3.8.{uuid.uuid4().hex[:6]}", "Receita Evento Cancelado Teste", "Receita")
    id_conta_caixa = _criar_conta(client, auth_headers, f"1.8.{uuid.uuid4().hex[:6]}", "Caixa Evento Cancelado Teste", "Ativo")

    def inscrito_que_pagou(cancelar_o_evento: bool):
        # o evento começa daqui a 2 horas: dentro do prazo de 24 h de quem desiste (sem reembolso, pelo padrão), a não ser que a ASAF tenha cancelado
        id_evento = _criar_evento_publico(client, auth_headers, data_hora_inicio=(datetime.utcnow() + timedelta(hours=2)).strftime(_ISO))
        _configurar_cobranca(client, auth_headers, id_evento, valor_base=80, id_conta_receita=id_conta_receita)
        r = _inscrever(client, id_evento)
        assert r.status_code == 200, r.text
        inscricao = db.query(Inscricao).filter(Inscricao.id_inscricao == r.json()["id_inscricao"]).one()
        baixa = client.post("/baixar-titulo/", json={
            "id_titulo": inscricao.id_titulo_cobranca, "valor_pago": 80, "forma_pagamento": "Pix", "id_conta_contabil_contrapartida": id_conta_caixa,
        }, headers=auth_headers)
        assert baixa.status_code == 200, baixa.text
        if cancelar_o_evento:
            resposta = _mudar(client, auth_headers, id_evento, "Cancelado", motivo="O salão ficou indisponível")
            assert resposta.status_code == 200, resposta.text
            assert resposta.json()["inscricoes_com_cobranca"] == 1, "a secretaria é avisada de que há inscrição paga para tratar"
        return client.post(f"/api/publico/inscricoes/{inscricao.token_cancelamento}/cancelar", headers=_ip_de_teste())

    sem_cancelar = inscrito_que_pagou(False)
    assert sem_cancelar.status_code == 200 and sem_cancelar.json()["reembolso"] is None, "quem desiste em cima da hora, com o evento de pé, não recebe nada (padrão)"
    cancelado = inscrito_que_pagou(True)
    assert cancelado.status_code == 200, cancelado.text
    assert cancelado.json()["reembolso"] is not None and float(cancelado.json()["reembolso"]["valor"]) == 80.0


def test_a_mudanca_de_status_fica_na_auditoria(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers)
    assert _mudar(client, auth_headers, id_evento, "Adiado", motivo="Aguardando a liberação do espaço").status_code == 200
    entradas = client.get(f"/api/auditoria/?tabela_afetada=eventos&por_pagina=50", headers=auth_headers).json()["entradas"]
    achada = [e for e in entradas if e.get("acao") == "STATUS_ALTERADO" and e.get("id_registro_afetado") == id_evento]
    assert achada, entradas[:3]
    assert "Adiado" in str(achada[0]) and "Programado" in str(achada[0])
