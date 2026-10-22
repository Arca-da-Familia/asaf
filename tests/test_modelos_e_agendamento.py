"""v6.2c (FASE 6) - modelos de mensagem versionados, variáveis no texto, pré-visualização, envio de teste e avisos agendados.

As promessas que estes testes travam:
  1. o título não aceita variável; o texto só aceita {primeiro_nome} e {nome}; quem recebe lê o texto com o próprio nome (no painel e no e-mail); o relatório mostra o texto cru;
  2. o modelo é versionado: editar cria a versão nova e desativa a anterior (que fica); arquivar tira da lista; só a versão em uso se edita; o aviso guarda a versão que usou;
  3. a pré-visualização usa a primeira pessoa do grupo e não grava nada; o envio de teste vai só para o e-mail de quem publica, marcado [TESTE], e tem limite; sem servidor de e-mail, recusa;
  4. agendar confere tudo que publicar confere, mais a hora (5 min a 90 dias) e a validade; a rodada publica o que passou da hora (recalculando o grupo), nunca antes;
     cancela com motivo quando o autor perdeu a permissão, a validade passou ou ninguém está no grupo; cancelar à mão exige motivo; tudo vai para a Auditoria;
  5. só quem tem `comunicar` usa tudo isso; a migração continua a cadeia."""
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.models.associados import Associado
from app.models.comunicacao import AGENDADO, AGENDAMENTO_CANCELADO, PUBLICADO, Aviso, AvisoAgendado, ModeloDeAviso
from app.models.core import AuditLog, Usuario
from app.models.projetos import EquipeProjeto
from app.services import avisos_agendados, comunicacao
from tests.test_comunicacao import HOJE, _corpo, _nome, _projeto, _publico_do_projeto
from tests.test_conselho_fiscal import _criar_associado, _headers
from tests.test_envio_de_avisos import _ServidorFalso, _com_email, _rodar, _smtp_ligado  # noqa: F401 - _smtp_ligado é fixture

TEXTO = "Olá, {primeiro_nome}! A reunião é no sábado. ({nome})"


def _modelo(client, auth_headers, **extra):
    corpo = {"nome": _nome("Modelo"), "titulo": "Reunião do mês", "texto": TEXTO, "categoria": "GERAL", **extra}
    r = client.post("/api/modelos-de-aviso/", json=corpo, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()


# ------------------------------------------------------------------------------------------------ 1. variáveis
def test_o_titulo_nao_aceita_variavel_e_o_texto_so_as_que_existem(client, db, auth_headers):
    pessoa, _ = _criar_associado(db, _nome("Variavel"))
    publico = _publico_do_projeto(_projeto(db, equipe=[pessoa]))
    r = client.post("/api/avisos/", json=_corpo(publico, 1, titulo="Oi {primeiro_nome}"), headers=auth_headers)
    assert r.status_code == 422 and "título não aceita variáveis" in r.json()["detail"]
    r = client.post("/api/avisos/", json={**_corpo(publico, 1), "texto": "Oi {apelido}"}, headers=auth_headers)
    assert r.status_code == 422 and "{apelido}" in r.json()["detail"]


def test_quem_recebe_le_o_proprio_nome_e_o_relatorio_mostra_o_texto_cru(client, db, auth_headers):
    pessoa, usuario = _criar_associado(db, "Maria Variavel " + _nome("da Silva").split()[-1])
    publico = _publico_do_projeto(_projeto(db, equipe=[pessoa]))
    previa = client.post("/api/avisos/conferir-publico", json={"publico": publico}, headers=auth_headers).json()
    aviso = client.post("/api/avisos/", json={**_corpo(publico, previa["total"]), "texto": TEXTO}, headers=auth_headers).json()
    aberto = client.get(f"/api/meus-avisos/{aviso['id_aviso']}", headers=_headers(usuario)).json()
    assert aberto["texto"] == f"Olá, Maria! A reunião é no sábado. ({pessoa.nome_completo})"
    assert client.get(f"/api/avisos/{aviso['id_aviso']}", headers=auth_headers).json()["texto"] == TEXTO


def test_o_e_mail_leva_o_nome_de_quem_recebe(client, db, auth_headers):
    pessoa, _, email = _com_email(db, "Joana Email")
    _rodar(db, _ServidorFalso())
    publico = _publico_do_projeto(_projeto(db, equipe=[pessoa]))
    previa = client.post("/api/avisos/conferir-publico", json={"publico": publico}, headers=auth_headers).json()
    r = client.post("/api/avisos/", json={**_corpo(publico, previa["total"], por_email=True), "texto": TEXTO}, headers=auth_headers)
    assert r.status_code == 200, r.text
    servidor = _ServidorFalso()
    _rodar(db, servidor)
    _, _, corpo = servidor.para(email)[0]
    assert "Olá, Joana!" in corpo and "{primeiro_nome}" not in corpo


# ------------------------------------------------------------------------------------------------ 2. modelos
def test_editar_o_modelo_cria_versao_nova_e_a_anterior_fica(client, db, auth_headers):
    v1 = _modelo(client, auth_headers)
    assert (v1["versao"], v1["ativo"]) == (1, True)
    v2 = client.put(f"/api/modelos-de-aviso/{v1['id_modelo']}", json={**v1, "texto": "Texto novo, {nome}."}, headers=auth_headers).json()
    assert (v2["versao"], v2["grupo"], v2["ativo"]) == (2, v1["grupo"], True)
    assert client.put(f"/api/modelos-de-aviso/{v1['id_modelo']}", json={**v1, "texto": "De novo"}, headers=auth_headers).status_code == 409, "só a versão em uso se edita"
    em_uso = [m for m in client.get("/api/modelos-de-aviso/", headers=auth_headers).json() if m["grupo"] == v1["grupo"]]
    assert [m["versao"] for m in em_uso] == [2]
    assert [m["versao"] for m in client.get(f"/api/modelos-de-aviso/{v2['id_modelo']}/versoes", headers=auth_headers).json()] == [2, 1]
    assert db.get(ModeloDeAviso, v1["id_modelo"]).texto == TEXTO, "a versão anterior fica como era"
    assert client.post(f"/api/modelos-de-aviso/{v2['id_modelo']}/arquivar", headers=auth_headers).json() == {"arquivado": True}
    assert not [m for m in client.get("/api/modelos-de-aviso/", headers=auth_headers).json() if m["grupo"] == v1["grupo"]]
    acoes = {a for (a,) in db.query(AuditLog.acao).filter(AuditLog.tabela_afetada == "modelos_de_aviso", AuditLog.id_registro_afetado.in_([v1["id_modelo"], v2["id_modelo"]])).all()}
    assert acoes == {"MODELO_DE_AVISO_CRIADO", "MODELO_DE_AVISO_NOVA_VERSAO", "MODELO_DE_AVISO_ARQUIVADO"}


def test_o_modelo_passa_pelas_mesmas_regras_e_o_aviso_guarda_a_versao(client, db, auth_headers):
    assert client.post("/api/modelos-de-aviso/", json={"nome": "X", "titulo": "Oi {nome}", "texto": "t", "categoria": "GERAL"}, headers=auth_headers).status_code == 422
    assert client.post("/api/modelos-de-aviso/", json={"nome": "X", "titulo": "Oi", "texto": "t", "categoria": "NAO_EXISTE"}, headers=auth_headers).status_code == 422
    modelo = _modelo(client, auth_headers)
    pessoa, _ = _criar_associado(db, _nome("Usa Modelo"))
    publico = _publico_do_projeto(_projeto(db, equipe=[pessoa]))
    aviso = client.post("/api/avisos/", json={**_corpo(publico, 1), "id_modelo": modelo["id_modelo"]}, headers=auth_headers).json()
    assert aviso["modelo"] == {"id_modelo": modelo["id_modelo"], "nome": modelo["nome"], "versao": 1}
    assert client.post("/api/avisos/", json={**_corpo(publico, 1), "id_modelo": 999999}, headers=auth_headers).status_code == 422


# ------------------------------------------------------------------------------------------------ 3. pré-visualização e teste
def test_a_pre_visualizacao_usa_a_primeira_pessoa_do_grupo_e_nao_grava_nada(client, db, auth_headers):
    pessoa, _ = _criar_associado(db, "Aaron Previa " + _nome("x").split()[-1])
    publico = _publico_do_projeto(_projeto(db, equipe=[pessoa]))
    antes = db.query(Aviso).count()
    r = client.post("/api/avisos/pre-visualizar", json={"titulo": "Reunião", "texto": TEXTO, "publico": publico}, headers=auth_headers).json()
    assert r["para"] == pessoa.nome_completo and r["texto"].startswith("Olá, Aaron!")
    assert db.query(Aviso).count() == antes
    sem_grupo = client.post("/api/avisos/pre-visualizar", json={"titulo": "Reunião", "texto": "Oi, {primeiro_nome}"}, headers=auth_headers).json()
    assert sem_grupo["para"] == "você"


def test_o_envio_de_teste_vai_so_para_quem_publica_e_tem_limite(client, db, monkeypatch):
    from app.models.core import NivelAcesso, PermissaoSistema, perfil_permissao
    from app.services import modelos_de_aviso

    publica, usuario, email = _com_email(db, "Publica Teste")
    permissao = db.query(PermissaoSistema).filter(PermissaoSistema.codigo_permissao == "comunicar").one()
    nivel = NivelAcesso(nome_nivel=_nome("Comunica Teste"), descricao="x", exige_mfa=False)
    db.add(nivel)
    db.flush()
    db.execute(perfil_permissao.insert().values(id_nivel=nivel.id_nivel, id_permissao=permissao.id_permissao))
    db.get(Usuario, usuario.id_usuario).id_nivel = nivel.id_nivel
    db.commit()
    enviados = []
    monkeypatch.setattr(modelos_de_aviso.notificacoes, "enviar_email", lambda d, assunto, corpo_texto, cabecalhos=None: enviados.append((d, assunto, corpo_texto)))
    h = _headers(usuario)
    r = client.post("/api/avisos/enviar-teste", json={"titulo": "Reunião", "texto": TEXTO, "exige_confirmacao": True}, headers=h)
    assert r.status_code == 200 and r.json() == {"enviado_para": email}
    assert enviados[0][0] == email and enviados[0][1] == "[TESTE] ASAF: Reunião" and "ainda NÃO foi publicado" in enviados[0][2] and "Olá, Publica!" in enviados[0][2]
    assert db.query(AuditLog).filter(AuditLog.acao == "AVISO_EMAIL_DE_TESTE", AuditLog.id_usuario == usuario.id_usuario).count() == 1
    for _ in range(modelos_de_aviso.TESTES_POR_HORA - 1):
        assert client.post("/api/avisos/enviar-teste", json={"titulo": "R", "texto": "t"}, headers=h).status_code == 200
    assert client.post("/api/avisos/enviar-teste", json={"titulo": "R", "texto": "t"}, headers=h).status_code == 429
    monkeypatch.delenv("SMTP_HOST")
    r = client.post("/api/avisos/enviar-teste", json={"titulo": "R", "texto": "t"}, headers=_headers(_criar_associado(db, _nome("Outro"))[1]))
    assert r.status_code == 403, "sem `comunicar`, nem chega a tentar"


def test_sem_servidor_de_e_mail_o_teste_e_recusado(client, auth_headers, monkeypatch):
    monkeypatch.delenv("SMTP_HOST")
    r = client.post("/api/avisos/enviar-teste", json={"titulo": "R", "texto": "t"}, headers=auth_headers)
    assert r.status_code == 409 and "não tem servidor de e-mail" in r.json()["detail"]


# ------------------------------------------------------------------------------------------------ 4. agendamento
def _agendar(client, auth_headers, publico, publicar_em, **extra):
    previa = client.post("/api/avisos/conferir-publico", json={"publico": publico}, headers=auth_headers).json()
    corpo = {**_corpo(publico, previa["total"], **extra), "publicar_em": publicar_em.replace(tzinfo=timezone.utc).isoformat()}
    return client.post("/api/avisos-agendados/", json=corpo, headers=auth_headers)


def test_agendar_confere_a_hora_a_validade_e_o_grupo(client, db, auth_headers):
    pessoa, _ = _criar_associado(db, _nome("Agenda"))
    publico = _publico_do_projeto(_projeto(db, equipe=[pessoa]))
    agora = datetime.utcnow()
    assert "5 minutos" in _agendar(client, auth_headers, publico, agora + timedelta(minutes=2)).json()["detail"]
    assert "90 dias" in _agendar(client, auth_headers, publico, agora + timedelta(days=100)).json()["detail"]
    r = _agendar(client, auth_headers, publico, agora + timedelta(days=10), valido_ate=(HOJE + timedelta(days=3)).isoformat())
    assert r.status_code == 422 and "antes do dia" in r.json()["detail"]
    vazio = _publico_do_projeto(_projeto(db))
    assert _agendar(client, auth_headers, vazio, agora + timedelta(hours=1)).status_code == 422
    # o total que a tela conferiu tem de bater com o grupo (como no "publicar já")
    corpo_errado = {**_corpo(publico, 7), "publicar_em": (agora + timedelta(hours=2)).replace(tzinfo=timezone.utc).isoformat()}
    r = client.post("/api/avisos-agendados/", json=corpo_errado, headers=auth_headers)
    assert r.status_code == 409 and "Confira de novo" in r.json()["detail"]
    ok = _agendar(client, auth_headers, publico, agora + timedelta(hours=2))
    assert ok.status_code == 200 and ok.json()["situacao"] == AGENDADO and ok.json()["total_conferido"] == 1
    assert db.query(AuditLog).filter(AuditLog.acao == "AVISO_AGENDADO", AuditLog.id_registro_afetado == ok.json()["id_agendado"]).count() == 1


def test_a_rodada_publica_so_depois_da_hora_e_recalcula_o_grupo(client, db, auth_headers):
    primeira, usuario_primeira = _criar_associado(db, _nome("Primeira Agendada"))
    saiu, usuario_saiu = _criar_associado(db, _nome("Saiu Antes Da Hora"))
    projeto = _projeto(db, equipe=[primeira, saiu])
    agora = datetime.utcnow()
    agendado = _agendar(client, auth_headers, _publico_do_projeto(projeto), agora + timedelta(hours=1)).json()
    assert agendado["total_conferido"] == 2
    assert avisos_agendados.publicar_os_que_chegaram_a_hora(db, agora=agora + timedelta(minutes=30))["publicados"] == 0, "nunca antes da hora"
    db.query(EquipeProjeto).filter(EquipeProjeto.id_projeto == projeto.id_projeto, EquipeProjeto.id_associado == saiu.id_associado).update(
        {"data_fim": datetime.utcnow()})
    db.commit()
    resultado = avisos_agendados.publicar_os_que_chegaram_a_hora(db, agora=agora + timedelta(hours=1, minutes=5))
    assert resultado["publicados"] >= 1 and resultado["falhas"] == 0
    db.expire_all()
    linha = db.get(AvisoAgendado, agendado["id_agendado"])
    assert linha.situacao == PUBLICADO and linha.id_aviso is not None
    aviso = db.get(Aviso, linha.id_aviso)
    assert aviso.total_destinatarios == 1, "o grupo da hora da publicação (quem saiu não recebe)"
    assert linha.id_aviso in [a["id_aviso"] for a in client.get("/api/meus-avisos/?mural=true", headers=_headers(usuario_primeira)).json()["avisos"]]
    assert linha.id_aviso not in [a["id_aviso"] for a in client.get("/api/meus-avisos/", headers=_headers(usuario_saiu)).json()["avisos"]]
    assert db.query(AuditLog).filter(AuditLog.acao == "AVISO_AGENDADO_PUBLICADO", AuditLog.id_registro_afetado == linha.id_agendado).count() == 1
    avisos_publicados_antes = db.query(Aviso).count()
    avisos_agendados.publicar_os_que_chegaram_a_hora(db, agora=agora + timedelta(hours=2))
    db.expire_all()
    assert db.get(AvisoAgendado, agendado["id_agendado"]).id_aviso == linha.id_aviso, "rodar de novo não publica o mesmo de novo"
    assert db.query(Aviso).count() - avisos_publicados_antes == db.query(AvisoAgendado).filter(
        AvisoAgendado.situacao == PUBLICADO, AvisoAgendado.id_aviso > linha.id_aviso,
    ).count(), "só os agendados de outros testes podem ter saído"


def test_grupo_que_cresceu_desde_a_conferencia_nao_sai_e_o_autor_fica_sabendo(client, db, auth_headers):
    """Ponto de Revisão FASE 6 (2/2): o agendamento foi conferido para N pessoas; se, na hora, o grupo tem MAIS gente, nada sai (ninguém recebe sem ter
    sido contado na confirmação) e quem agendou é avisado no sino para conferir de novo."""
    from app.models.notificacoes_painel import NotificacaoPainel

    primeira, _ = _criar_associado(db, _nome("Conferida Na Agenda"))
    projeto = _projeto(db, equipe=[primeira])
    agora = datetime.utcnow()
    agendado = _agendar(client, auth_headers, _publico_do_projeto(projeto), agora + timedelta(hours=1)).json()
    nova, usuario_nova = _criar_associado(db, _nome("Entrou Depois Da Agenda"))
    db.add(EquipeProjeto(id_projeto=projeto.id_projeto, id_associado=nova.id_associado, papel="VOLUNTARIO"))
    db.commit()
    avisos_antes = max([a.id_aviso for a in db.query(Aviso.id_aviso).all()] or [0])
    resultado = avisos_agendados.publicar_os_que_chegaram_a_hora(db, agora=agora + timedelta(hours=1, minutes=5))
    assert resultado["falhas"] == 0
    db.expire_all()
    linha = db.get(AvisoAgendado, agendado["id_agendado"])
    assert linha.situacao == AGENDAMENTO_CANCELADO and linha.id_aviso is None
    assert "O grupo cresceu desde a conferência" in linha.motivo and "agora são 2" in linha.motivo
    assert client.get("/api/meus-avisos/", headers=_headers(usuario_nova)).json()["avisos"] == []
    autor = db.query(Usuario).filter(Usuario.id_usuario == linha.id_usuario_autor).one()
    assert db.query(NotificacaoPainel).filter(NotificacaoPainel.id_usuario == autor.id_usuario, NotificacaoPainel.tipo == "aviso_agendado_cancelado").count() >= 1
    assert not db.query(Aviso).filter(Aviso.id_aviso > avisos_antes, Aviso.titulo == linha.titulo).first(), "o aviso não nasceu"


def test_a_rodada_cancela_com_motivo_o_que_nao_pode_mais_sair(client, db, auth_headers):
    from app.models.core import NivelAcesso, PermissaoSistema, perfil_permissao

    pessoa, _ = _criar_associado(db, _nome("Grupo Que Esvazia"))
    projeto = _projeto(db, equipe=[pessoa])
    agora = datetime.utcnow()
    esvaziou = _agendar(client, auth_headers, _publico_do_projeto(projeto), agora + timedelta(hours=1)).json()
    db.query(EquipeProjeto).filter(EquipeProjeto.id_projeto == projeto.id_projeto).update({"data_fim": datetime.utcnow()})
    db.commit()
    # um autor que perde a permissão antes da hora
    _, autor = _criar_associado(db, _nome("Autor Perde Permissao"))
    permissao = db.query(PermissaoSistema).filter(PermissaoSistema.codigo_permissao == "comunicar").one()
    nivel = NivelAcesso(nome_nivel=_nome("Comunica Agenda"), descricao="x", exige_mfa=False)
    db.add(nivel)
    db.flush()
    db.execute(perfil_permissao.insert().values(id_nivel=nivel.id_nivel, id_permissao=permissao.id_permissao))
    db.get(Usuario, autor.id_usuario).id_nivel = nivel.id_nivel
    db.commit()
    outra, _ = _criar_associado(db, _nome("Outro Grupo"))
    perdeu = _agendar(client, _headers(autor), _publico_do_projeto(_projeto(db, equipe=[outra])), agora + timedelta(hours=1)).json()
    db.execute(perfil_permissao.delete().where(perfil_permissao.c.id_nivel == nivel.id_nivel))
    db.commit()
    resultado = avisos_agendados.publicar_os_que_chegaram_a_hora(db, agora=agora + timedelta(hours=1, minutes=1))
    assert resultado["falhas"] == 0
    db.expire_all()
    assert db.get(AvisoAgendado, esvaziou["id_agendado"]).situacao == AGENDAMENTO_CANCELADO
    assert "Ninguém está neste grupo" in db.get(AvisoAgendado, esvaziou["id_agendado"]).motivo
    assert db.get(AvisoAgendado, perdeu["id_agendado"]).situacao == AGENDAMENTO_CANCELADO
    assert "não tem mais a permissão" in db.get(AvisoAgendado, perdeu["id_agendado"]).motivo


def test_cancelar_a_mao_exige_motivo_e_so_vale_para_o_agendado(client, db, auth_headers):
    pessoa, _ = _criar_associado(db, _nome("Cancela Agenda"))
    agendado = _agendar(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[pessoa])), datetime.utcnow() + timedelta(hours=3)).json()
    url = f"/api/avisos-agendados/{agendado['id_agendado']}/cancelar"
    assert client.post(url, json={"motivo": "curto"}, headers=auth_headers).status_code == 422
    r = client.post(url, json={"motivo": "A data da reunião mudou."}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["situacao"] == AGENDAMENTO_CANCELADO
    assert client.post(url, json={"motivo": "Cancelando de novo por engano."}, headers=auth_headers).status_code == 409
    assert agendado["id_agendado"] in [a["id_agendado"] for a in client.get("/api/avisos-agendados/?situacao=Cancelado", headers=auth_headers).json()]
    assert db.query(AuditLog).filter(AuditLog.acao == "AVISO_AGENDADO_CANCELADO", AuditLog.id_registro_afetado == agendado["id_agendado"]).count() == 1


# ------------------------------------------------------------------------------------------------ 5. permissão e migração
def test_quem_nao_tem_comunicar_nao_usa_nada_disso(client, db):
    _, usuario = _criar_associado(db, _nome("Sem Comunicar V62c"))
    h = _headers(usuario)
    assert client.get("/api/modelos-de-aviso/", headers=h).status_code == 403
    assert client.post("/api/modelos-de-aviso/", json={"nome": "x", "titulo": "x", "texto": "x", "categoria": "GERAL"}, headers=h).status_code == 403
    assert client.post("/api/avisos/pre-visualizar", json={"titulo": "x", "texto": "x"}, headers=h).status_code == 403
    assert client.get("/api/avisos-agendados/", headers=h).status_code == 403
    assert client.post("/api/avisos-agendados/1/cancelar", json={"motivo": "qualquer motivo aqui"}, headers=h).status_code == 403


def test_a_migracao_continua_a_cadeia_sem_segunda_cabeca():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parent.parent / "alembic"))
    diretorio = ScriptDirectory.from_config(config)
    assert len(diretorio.get_heads()) == 1 and diretorio.get_revision("c9e5a1b3d468").down_revision == "b8d4f0a2c357"


# ------------------------------------------------------------------------------------------------ achados da conferência independente (2026-10-21)
def test_uma_falha_depois_de_publicar_nao_faz_o_agendado_sair_de_novo(client, db, auth_headers, monkeypatch):
    from app.services import avisos_agendados as servico

    pessoa, _ = _criar_associado(db, _nome("Nao Sai Duas Vezes"))
    agora = datetime.utcnow()
    agendado = _agendar(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[pessoa])), agora + timedelta(hours=1)).json()
    original = servico.registrar_auditoria

    def quebra_no_registro_da_publicacao(db_, usuario, tabela, acao, *a, **k):
        if acao == "AVISO_AGENDADO_PUBLICADO":
            raise RuntimeError("a conexão caiu depois de o aviso nascer")
        return original(db_, usuario, tabela, acao, *a, **k)

    monkeypatch.setattr(servico, "registrar_auditoria", quebra_no_registro_da_publicacao)
    antes = db.query(Aviso).count()
    resultado = servico.publicar_os_que_chegaram_a_hora(db, agora=agora + timedelta(hours=1, minutes=1))
    assert resultado["falhas"] >= 1
    monkeypatch.setattr(servico, "registrar_auditoria", original)
    servico.publicar_os_que_chegaram_a_hora(db, agora=agora + timedelta(hours=1, minutes=20))
    db.expire_all()
    assert db.get(AvisoAgendado, agendado["id_agendado"]).situacao == PUBLICADO
    titulos = [a.titulo for a in db.query(Aviso).order_by(Aviso.id_aviso.desc()).limit(db.query(Aviso).count() - antes).all()]
    assert titulos.count(db.get(AvisoAgendado, agendado["id_agendado"]).titulo) == 1, "o aviso saiu UMA vez"


def test_cancelar_depois_que_a_rotina_pegou_e_recusado(client, db, auth_headers):
    pessoa, _ = _criar_associado(db, _nome("Rotina Pegou"))
    agendado = _agendar(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[pessoa])), datetime.utcnow() + timedelta(hours=1)).json()
    db.get(AvisoAgendado, agendado["id_agendado"]).situacao = PUBLICADO  # a rotina pegou a linha
    db.commit()
    r = client.post(f"/api/avisos-agendados/{agendado['id_agendado']}/cancelar", json={"motivo": "Tarde demais para cancelar."}, headers=auth_headers)
    assert r.status_code == 409 and "Publicado" in r.json()["detail"]


def test_o_cancelamento_pelo_sistema_avisa_quem_agendou_no_sino(client, db, auth_headers):
    from app.models.notificacoes_painel import NotificacaoPainel

    pessoa, _ = _criar_associado(db, _nome("Grupo Some Sino"))
    projeto = _projeto(db, equipe=[pessoa])
    agora = datetime.utcnow()
    agendado = _agendar(client, auth_headers, _publico_do_projeto(projeto), agora + timedelta(hours=1)).json()
    db.query(EquipeProjeto).filter(EquipeProjeto.id_projeto == projeto.id_projeto).update({"data_fim": datetime.utcnow()})
    db.commit()
    avisos_agendados.publicar_os_que_chegaram_a_hora(db, agora=agora + timedelta(hours=1, minutes=1))
    autor = db.get(AvisoAgendado, agendado["id_agendado"]).id_usuario_autor
    sino = db.query(NotificacaoPainel).filter(NotificacaoPainel.id_usuario == autor, NotificacaoPainel.tipo == "aviso_agendado_cancelado").all()
    assert any(n.titulo.endswith(agendado["titulo"]) and "Ninguém está neste grupo" in (n.texto or "") for n in sino)


def test_a_lista_de_publicados_e_cancelados_comeca_pelo_mais_novo(client, db, auth_headers):
    pessoa, _ = _criar_associado(db, _nome("Ordem Da Lista"))
    publico = _publico_do_projeto(_projeto(db, equipe=[pessoa]))
    agora = datetime.utcnow()
    ids = [_agendar(client, auth_headers, publico, agora + timedelta(hours=h)).json()["id_agendado"] for h in (5, 6)]
    for i in ids:
        client.post(f"/api/avisos-agendados/{i}/cancelar", json={"motivo": "Teste da ordem da lista."}, headers=auth_headers)
    cancelados = [a["id_agendado"] for a in client.get("/api/avisos-agendados/?situacao=Cancelado", headers=auth_headers).json()]
    assert cancelados.index(ids[1]) < cancelados.index(ids[0])


def test_a_versao_e_unica_no_modelo(db, client, auth_headers):
    import sqlalchemy as sa

    v1 = _modelo(client, auth_headers)
    db.add(ModeloDeAviso(grupo=v1["grupo"], versao=1, nome="dup", titulo="t", texto="t", categoria="GERAL", ativo=False, id_usuario_autor=1, criado_em=datetime.utcnow()))
    with pytest.raises(sa.exc.IntegrityError):
        db.commit()
    db.rollback()


def test_a_previa_de_quem_nao_tem_cadastro_nao_usa_o_e_mail_como_nome(client, db, auth_headers):
    import uuid

    from app.models.core import NivelAcesso, PermissaoSistema, perfil_permissao
    from app.security import hash_senha

    codigo = f"teste_previa_{uuid.uuid4().hex[:6]}"
    permissao = PermissaoSistema(modulo="x", codigo_permissao=codigo, descricao="x")
    nivel = NivelAcesso(nome_nivel=_nome("So Login Previa"), descricao="x", exige_mfa=False)
    db.add_all([permissao, nivel])
    db.flush()
    db.execute(perfil_permissao.insert().values(id_nivel=nivel.id_nivel, id_permissao=permissao.id_permissao))
    db.add(Usuario(email=f"aaa.{uuid.uuid4().hex[:6]}@teste.local", senha_hash=hash_senha("SenhaForte123456"), id_nivel=nivel.id_nivel, ativo=True))
    db.commit()
    r = client.post("/api/avisos/pre-visualizar", json={"titulo": "T", "texto": "Olá, {primeiro_nome}!", "publico": {"tipo": "permissao", "codigo_permissao": codigo}},
                    headers=auth_headers).json()
    assert r["texto"] == "Olá, associado(a)!" and "sem cadastro de associado" in r["para"]
