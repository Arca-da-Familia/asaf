"""v5.5c - a inscrição em evento pelo SITE: o que o servidor passou a garantir para as páginas do site (inscrever, cancelar, confirmar).
  1. a resposta da inscrição traz o código de cancelamento de cada participante (a tela mostra o link; o e-mail pode não chegar);
  2. os e-mails levam à página certa do site: o de confirmação ao `/cancelar-inscricao/`, o da vaga aberta na lista de espera ao `/confirmar-inscricao/` (e ao de cancelar); o site
     vem da configuração, depois da variável de ambiente, depois do site de produção;
  3. evento que já aconteceu não aceita mais inscrição por fora;
  4. quem tem o link vê o evento e o que dá para fazer, sem dado de mais ninguém; código inventado é 404;
  5. quem está na lista de espera NÃO se confirma sozinho (furaria a fila e estouraria o limite de vagas): só depois de ser promovido."""
import uuid
from datetime import datetime, timedelta

from app.services import eventos as servico_eventos
from app.services import vagas as servico_vagas
from tests.test_eventos_inscricao_publica import _criar_evento_publico, _ip_de_teste, _payload_inscricao


def _inscrever(client, id_evento, **overrides):
    return client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao(**overrides), headers=_ip_de_teste())


def _capturar_emails(monkeypatch):
    enviados = []
    for modulo in (servico_eventos.notificacoes, servico_vagas.notificacoes):
        monkeypatch.setattr(modulo, "enviar_email", lambda destino, assunto, corpo_texto: enviados.append((destino, assunto, corpo_texto)))
    return enviados


def test_a_inscricao_devolve_o_codigo_de_cancelamento_de_cada_participante(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers)
    adicional = {"nome_completo": "Filho Participante", "cpf": _payload_inscricao()["cpf"]}
    r = _inscrever(client, id_evento, participantes_adicionais=[adicional])
    assert r.status_code == 200, r.text
    corpo = r.json()
    tokens = [p["token_cancelamento"] for p in corpo["participantes"]]
    assert len(tokens) == 2 and all(tokens) and len(set(tokens)) == 2
    assert corpo["token_cancelamento"] == tokens[0]


def test_o_e_mail_de_confirmacao_leva_a_pagina_de_cancelar_do_site(client, auth_headers, monkeypatch):
    enviados = _capturar_emails(monkeypatch)
    id_evento = _criar_evento_publico(client, auth_headers)
    corpo = _inscrever(client, id_evento).json()
    texto = enviados[0][2]
    assert f"https://asaf.org.br/cancelar-inscricao/?token={corpo['token_cancelamento']}" in texto


def test_o_site_do_e_mail_vem_da_configuracao_depois_do_ambiente_depois_da_producao(client, auth_headers, db, monkeypatch):
    from app.config_cache import invalidar_cache_configuracao
    from app.models.core import ConfiguracaoInstitucional
    from app.services.site_publico import url_base_do_site

    config = db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao == "URL_BASE_SITE_PUBLICO").one()
    original = config.valor_configuracao
    try:
        config.valor_configuracao = ""
        db.commit()
        invalidar_cache_configuracao("URL_BASE_SITE_PUBLICO")
        monkeypatch.delenv("URL_BASE_SITE_PUBLICO", raising=False)
        assert url_base_do_site(db) == "https://asaf.org.br"
        monkeypatch.setenv("URL_BASE_SITE_PUBLICO", "https://hml-site.asaf.org.br/")
        assert url_base_do_site(db) == "https://hml-site.asaf.org.br"
        config.valor_configuracao = "https://configurado.example.org/"
        db.commit()
        invalidar_cache_configuracao("URL_BASE_SITE_PUBLICO")
        assert url_base_do_site(db) == "https://configurado.example.org"
    finally:
        config.valor_configuracao = original
        db.commit()
        invalidar_cache_configuracao("URL_BASE_SITE_PUBLICO")


def test_evento_que_ja_aconteceu_nao_aceita_inscricao_pelo_site(client, auth_headers, db):
    from app.models.eventos import Evento

    id_evento = _criar_evento_publico(client, auth_headers)
    evento = db.query(Evento).filter(Evento.id_evento == id_evento).one()
    evento.data_hora_inicio = datetime.utcnow() - timedelta(days=5)
    evento.data_hora_fim = None
    db.commit()
    r = _inscrever(client, id_evento)
    assert r.status_code == 400 and "já foram encerradas" in r.json()["detail"]
    # com fim no futuro, vale (um evento de vários dias que já começou ainda aceita)
    evento.data_hora_fim = datetime.utcnow() + timedelta(days=1)
    db.commit()
    assert _inscrever(client, id_evento).status_code == 200


def test_quem_tem_o_link_ve_o_evento_e_o_que_da_para_fazer_e_so_isso(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers, titulo=f"Evento do Link {uuid.uuid4().hex[:6]}")
    inscrita = _inscrever(client, id_evento, nome_completo="Maria Aparecida da Silva").json()
    r = client.get(f"/api/publico/inscricoes/{inscrita['token_cancelamento']}")
    assert r.status_code == 200, r.text
    resumo = r.json()
    assert resumo["primeiro_nome"] == "Maria" and resumo["status"] == "Pré-inscrito"
    assert resumo["evento"]["titulo"].startswith("Evento do Link") and resumo["codigo_checkin"] == inscrita["codigo_checkin"]
    assert resumo["pode_cancelar"] is True and resumo["pode_confirmar"] is True and resumo["evento_encerrado"] is False
    # nada de CPF, e-mail, telefone, sobrenome ou id de pessoa
    texto = r.text
    assert "Aparecida" not in texto and "cpf" not in texto.lower() and "@" not in texto and "id_pessoa" not in texto
    # código inventado
    assert client.get("/api/publico/inscricoes/codigo-que-nao-existe").status_code == 404


def test_depois_de_cancelar_o_resumo_diz_que_nao_da_mais_para_cancelar(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers)
    token = _inscrever(client, id_evento).json()["token_cancelamento"]
    assert client.post(f"/api/publico/inscricoes/{token}/cancelar").status_code == 200
    resumo = client.get(f"/api/publico/inscricoes/{token}").json()
    assert resumo["status"] == "Cancelado" and resumo["pode_cancelar"] is False and resumo["pode_confirmar"] is False
    assert resumo["codigo_checkin"] is None


def test_confirmar_pelo_link_funciona_para_quem_tem_vaga(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers)
    token = _inscrever(client, id_evento).json()["token_cancelamento"]
    r = client.post(f"/api/publico/inscricoes/{token}/confirmar")
    assert r.status_code == 200 and r.json()["status"] == "Confirmado"
    resumo = client.get(f"/api/publico/inscricoes/{token}").json()
    assert resumo["status"] == "Confirmado" and resumo["pode_confirmar"] is False and resumo["pode_cancelar"] is True


def test_quem_esta_na_lista_de_espera_nao_se_confirma_sozinho_e_so_confirma_depois_de_promovido(client, auth_headers, monkeypatch):
    enviados = _capturar_emails(monkeypatch)
    id_evento = _criar_evento_publico(client, auth_headers, vagas=1)
    primeiro = _inscrever(client, id_evento, nome_completo="Primeiro Inscrito").json()
    segundo = _inscrever(client, id_evento, nome_completo="Segundo Na Fila").json()
    assert primeiro["status"] == "Pré-inscrito" and segundo["status"] == "Lista de Espera"
    vagas_livres_antes = client.get(f"/api/publico/eventos/{id_evento}").json()["vagas_livres"]

    # furar a fila pelo link: recusado, e o limite de vagas não estoura
    furou = client.post(f"/api/publico/inscricoes/{segundo['token_cancelamento']}/confirmar")
    assert furou.status_code == 400 and "lista de espera" in furou.json()["detail"]
    resumo = client.get(f"/api/publico/inscricoes/{segundo['token_cancelamento']}").json()
    assert resumo["status"] == "Lista de Espera" and resumo["pode_confirmar"] is False and resumo["pode_cancelar"] is True and resumo["codigo_checkin"] is None
    assert client.get(f"/api/publico/eventos/{id_evento}").json()["vagas_livres"] == vagas_livres_antes

    # o primeiro cancela: o segundo é promovido e recebe o e-mail com os DOIS links
    assert client.post(f"/api/publico/inscricoes/{primeiro['token_cancelamento']}/cancelar").status_code == 200
    promovido = client.get(f"/api/publico/inscricoes/{segundo['token_cancelamento']}").json()
    assert promovido["status"] == "Pré-inscrito" and promovido["pode_confirmar"] is True and promovido["prazo_confirmacao"] is not None
    aviso = [e for e in enviados if e[1] == "Uma vaga abriu para você!"]
    assert len(aviso) == 1
    assert f"https://asaf.org.br/confirmar-inscricao/?token={segundo['token_cancelamento']}" in aviso[0][2]
    assert f"https://asaf.org.br/cancelar-inscricao/?token={segundo['token_cancelamento']}" in aviso[0][2]
    confirmou = client.post(f"/api/publico/inscricoes/{segundo['token_cancelamento']}/confirmar")
    assert confirmou.status_code == 200 and confirmou.json()["status"] == "Confirmado"


def test_a_consulta_do_link_tem_limite_por_ip_e_a_auditoria_guarda_cancelar_e_confirmar(client, auth_headers, db):
    from app.models.core import AuditLog

    id_evento = _criar_evento_publico(client, auth_headers)
    token = _inscrever(client, id_evento).json()["token_cancelamento"]
    ip = _ip_de_teste()
    for _ in range(30):
        assert client.get(f"/api/publico/inscricoes/{token}", headers=ip).status_code == 200
    assert client.get(f"/api/publico/inscricoes/{token}", headers=ip).status_code == 429
    assert client.post(f"/api/publico/inscricoes/{token}/confirmar", headers=_ip_de_teste()).status_code == 200
    assert client.post(f"/api/publico/inscricoes/{token}/cancelar", headers=_ip_de_teste()).status_code == 200
    acoes = {a.acao for a in db.query(AuditLog).filter(AuditLog.tabela_afetada == "inscricoes")}
    assert {"INSCRICAO_PUBLICA", "CONFIRMACAO_PUBLICA", "CANCELAMENTO_PUBLICO"} <= acoes
