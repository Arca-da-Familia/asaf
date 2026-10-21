"""v6.2b (FASE 6) - preferências de contato e o descadastro de verdade.

As promessas que estes testes travam:
  1. o link "não quero mais receber" é assinado: outro tipo, outra pessoa, assinatura mexida ou formato torto dão o mesmo 404; a página pública não mostra dado da pessoa;
  2. pelo link a pessoa para e volta a receber; cada mudança vai para a Auditoria (sem usuário, com o IP, com o tipo, a escolha e a origem), e repetir a mesma escolha não grava de novo;
  3. no Meu Perfil o associado vê e muda as três escolhas; a convocação e a mudança de regra não são opção; quem não tem cadastro de pessoa não tem o que escolher; tipo inválido é recusado;
  4. o próprio link só volta na resposta do painel na homologação (variável de teste E sem e-mail configurado), nunca com e-mail configurado;
  5. o envio respeita: aviso NÃO obrigatório não vai por e-mail a quem desligou (ao publicar e se desligou depois), o obrigatório vai; o lembrete de mensalidade e o aviso de evento
     também respeitam; o e-mail que se pode desligar leva o link e o cabeçalho List-Unsubscribe, e o obrigatório diz que é obrigatório;
  6. a migração b8d4f0a2c357 continua a cadeia."""
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from app.models.associados import Associado
from app.models.comunicacao import NA_FILA, NAO_RECEBE
from app.models.core import AuditLog
from app.models.preferencias_de_comunicacao import AVISOS, EVENTOS, LEMBRETES_DE_MENSALIDADE, PreferenciaDeComunicacao
from app.services import preferencias_de_comunicacao as preferencias
from tests.test_conselho_fiscal import _criar_associado, _headers
from tests.test_envio_de_avisos import _ServidorFalso, _com_email, _entregas, _publicar_por_email, _rodar, _smtp_ligado  # noqa: F401 - _smtp_ligado é fixture
from tests.test_comunicacao import _projeto, _publico_do_projeto


def _pessoa(db, associado) -> int:
    return db.get(Associado, associado.id_associado).id_pessoa


# ------------------------------------------------------------------------------------------------ 1 e 2. o link
def test_o_link_e_assinado_e_nao_serve_para_outro_tipo_nem_outra_pessoa(client, db):
    pessoa, _, _ = _com_email(db, "Link Assinado")
    id_pessoa = _pessoa(db, pessoa)
    token = preferencias.token_de(id_pessoa, AVISOS)
    ok = client.get(f"/api/publico/descadastro?token={token}")
    assert ok.status_code == 200 and ok.json() == {"tipo": AVISOS, "rotulo": preferencias.ROTULOS[AVISOS], "recebe": True}
    assinatura = token.rsplit(".", 1)[1]
    ruins = [
        f"{id_pessoa}.{EVENTOS}.{assinatura}",  # a assinatura de outro tipo
        f"{id_pessoa + 1}.{AVISOS}.{assinatura}",  # a assinatura de outra pessoa
        token[:-1] + ("0" if token[-1] != "0" else "1"),  # mexida
        f"{id_pessoa}.convocacao.{assinatura}",  # tipo que não existe (a convocação não se desliga)
        "qualquer-coisa",
    ]
    for ruim in ruins:
        r = client.get(f"/api/publico/descadastro?token={ruim}")
        assert r.status_code == 404 and r.json()["detail"] == "Link inválido ou incompleto.", ruim
        assert client.post("/api/publico/descadastro", json={"token": ruim, "recebe": False}).status_code == 404


def test_pelo_link_a_pessoa_para_e_volta_a_receber_com_auditoria(client, db):
    pessoa, _, _ = _com_email(db, "Para Pelo Link")
    id_pessoa = _pessoa(db, pessoa)
    token = preferencias.token_de(id_pessoa, LEMBRETES_DE_MENSALIDADE)
    r = client.post("/api/publico/descadastro", json={"token": token, "recebe": False})
    assert r.status_code == 200 and r.json()["recebe"] is False
    assert client.get(f"/api/publico/descadastro?token={token}").json()["recebe"] is False
    assert client.post("/api/publico/descadastro", json={"token": token, "recebe": False}).status_code == 200
    entradas = db.query(AuditLog).filter(AuditLog.acao == "PREFERENCIA_DE_COMUNICACAO_ALTERADA", AuditLog.id_registro_afetado == id_pessoa).all()
    assert len(entradas) == 1, "repetir a mesma escolha não grava de novo"
    assert entradas[0].id_usuario is None and entradas[0].ip_origem and '"origem": "link do e-mail"' in entradas[0].dados_depois
    assert client.post("/api/publico/descadastro", json={"token": token, "recebe": True}).json()["recebe"] is True
    assert db.query(AuditLog).filter(AuditLog.acao == "PREFERENCIA_DE_COMUNICACAO_ALTERADA", AuditLog.id_registro_afetado == id_pessoa).count() == 2
    assert preferencias.recebe(db, id_pessoa, LEMBRETES_DE_MENSALIDADE) is True


# ------------------------------------------------------------------------------------------------ 3 e 4. no painel
def test_no_meu_perfil_o_associado_ve_e_muda_as_tres_escolhas(client, db):
    pessoa, usuario, _ = _com_email(db, "Meu Perfil Prefs")
    h = _headers(usuario)
    minhas = client.get("/api/minhas-preferencias-de-comunicacao/", headers=h).json()
    assert minhas["tem_cadastro"] is True and [t["tipo"] for t in minhas["tipos"]] == [AVISOS, LEMBRETES_DE_MENSALIDADE, EVENTOS]
    assert all(t["recebe"] for t in minhas["tipos"]) and "Convocação" in minhas["obrigatorias"]
    assert all("link_de_teste" not in t for t in minhas["tipos"]), "fora da homologação o link não volta"
    depois = client.put("/api/minhas-preferencias-de-comunicacao/", json={"tipo": EVENTOS, "recebe": False}, headers=h).json()
    assert {t["tipo"]: t["recebe"] for t in depois["tipos"]} == {AVISOS: True, LEMBRETES_DE_MENSALIDADE: True, EVENTOS: False}
    entrada = db.query(AuditLog).filter(AuditLog.acao == "PREFERENCIA_DE_COMUNICACAO_ALTERADA", AuditLog.id_registro_afetado == _pessoa(db, pessoa)).one()
    assert entrada.id_usuario == usuario.id_usuario and '"origem": "painel"' in entrada.dados_depois
    assert client.put("/api/minhas-preferencias-de-comunicacao/", json={"tipo": "convocacao", "recebe": False}, headers=h).status_code == 422
    assert client.get("/api/minhas-preferencias-de-comunicacao/").status_code == 401


def test_quem_nao_tem_cadastro_de_pessoa_nao_tem_o_que_escolher(client, db):
    import uuid

    from app.models.core import NivelAcesso, Usuario
    from app.security import hash_senha

    nivel = db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == "Associado").one()
    usuario = Usuario(email=f"so.equipe.{uuid.uuid4().hex[:6]}@teste.local", senha_hash=hash_senha("SenhaForte123456"), id_nivel=nivel.id_nivel, ativo=True)
    db.add(usuario)
    db.commit()
    h = _headers(usuario)
    minhas = client.get("/api/minhas-preferencias-de-comunicacao/", headers=h).json()
    assert minhas["tem_cadastro"] is False and minhas["tipos"] == []
    assert client.put("/api/minhas-preferencias-de-comunicacao/", json={"tipo": AVISOS, "recebe": False}, headers=h).status_code == 409


def test_o_link_so_volta_no_painel_na_homologacao_sem_e_mail(client, db, monkeypatch):
    _, usuario, _ = _com_email(db, "Link De Teste")
    h = _headers(usuario)
    monkeypatch.setenv("VISITANTE_CODIGO_NA_RESPOSTA", "1")
    com_smtp = client.get("/api/minhas-preferencias-de-comunicacao/", headers=h).json()
    assert all("link_de_teste" not in t for t in com_smtp["tipos"]), "com e-mail configurado (produção), nunca"
    monkeypatch.delenv("SMTP_HOST")
    sem_smtp = client.get("/api/minhas-preferencias-de-comunicacao/", headers=h).json()
    assert all("/descadastrar/?token=" in t["link_de_teste"] for t in sem_smtp["tipos"])


# ------------------------------------------------------------------------------------------------ 5. o envio respeita
def test_aviso_nao_obrigatorio_nao_vai_por_e_mail_a_quem_desligou_e_o_obrigatorio_vai(client, db, auth_headers):
    desligou, _, email_desligou = _com_email(db, "Desligou Avisos")
    recebe, _, email_recebe = _com_email(db, "Recebe Avisos")
    preferencias.alterar(db, id_pessoa=_pessoa(db, desligou), tipo=AVISOS, recebe_=False, origem="painel")
    projeto = _projeto(db, equipe=[desligou, recebe])
    previa = client.post("/api/avisos/conferir-publico", json={"publico": _publico_do_projeto(projeto)}, headers=auth_headers).json()
    assert previa["desligaram_os_avisos"] == 1
    _rodar(db, _ServidorFalso())
    geral, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(projeto), categoria="GERAL")
    convocacao, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(projeto), categoria="CONVOCACAO")
    assert _entregas(db, geral["id_aviso"])[desligou.id_associado].situacao == NAO_RECEBE
    assert _entregas(db, convocacao["id_aviso"])[desligou.id_associado].situacao == NA_FILA, "a convocação chega mesmo assim"
    servidor = _ServidorFalso()
    _rodar(db, servidor)
    assert [a for _, a, _ in servidor.para(email_desligou)] == [f"ASAF: {convocacao['titulo']}"]
    _, _, corpo_obrigatorio = servidor.para(email_desligou)[0]
    assert "aviso obrigatório" in corpo_obrigatorio and "/descadastrar/" not in corpo_obrigatorio
    assert servidor.cabecalhos[email_desligou] == {}
    corpos = {a: c for _, a, c in servidor.para(email_recebe)}
    corpo_geral = corpos[f"ASAF: {geral['titulo']}"]
    assert "/descadastrar/?token=" in corpo_geral
    token = corpo_geral.split("/descadastrar/?token=")[1].split()[0]
    assert preferencias.ler_token(token) == (_pessoa(db, recebe), AVISOS), "o link do e-mail é o da própria pessoa"
    relatorio = client.get(f"/api/avisos/{geral['id_aviso']}", headers=auth_headers).json()
    assert relatorio["email"][NAO_RECEBE] == 1


def test_quem_desliga_depois_de_publicado_nao_recebe(client, db, auth_headers):
    pessoa, _, email = _com_email(db, "Desligou Depois")
    _rodar(db, _ServidorFalso())
    aviso, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[pessoa])), categoria="GERAL")
    preferencias.alterar(db, id_pessoa=_pessoa(db, pessoa), tipo=AVISOS, recebe_=False, origem="link do e-mail")
    servidor = _ServidorFalso()
    _rodar(db, servidor)
    assert servidor.para(email) == [] and _entregas(db, aviso["id_aviso"])[pessoa.id_associado].situacao == NAO_RECEBE


def test_o_lembrete_de_mensalidade_respeita_e_leva_o_link(client, db, auth_headers, monkeypatch):
    from app.services import lembretes
    from tests.test_contribuicoes import _criar_conta
    from tests.test_lembretes import _configurar_pix, _criar_titulo_a_receber
    from tests.test_situacao import _criar_associado as _criar_associado_pela_api

    _configurar_pix(db)
    conta = _criar_conta(client, auth_headers, "3.2.9960", "Receita Lembrete Prefs", tipo="Receita")
    quer, nao_quer = _criar_associado_pela_api(client), _criar_associado_pela_api(client)
    hoje = datetime(2095, 3, 10)
    for associado in (quer, nao_quer):
        _criar_titulo_a_receber(client, auth_headers, conta, associado["id_associado"], 50, hoje)
    id_pessoa_nao_quer = db.get(Associado, nao_quer["id_associado"]).id_pessoa
    preferencias.alterar(db, id_pessoa=id_pessoa_nao_quer, tipo=LEMBRETES_DE_MENSALIDADE, recebe_=False, origem="painel")
    enviados = []
    monkeypatch.setattr(lembretes.notificacoes, "enviar_email", lambda d, assunto, corpo_texto, cabecalhos=None: enviados.append((d, corpo_texto, cabecalhos)))
    lembretes.enviar_lembretes_do_dia(db, hoje=hoje)
    email_quer = db.get(Associado, quer["id_associado"]).email_contato
    email_nao_quer = db.get(Associado, nao_quer["id_associado"]).email_contato
    assert [d for d, _, _ in enviados if d in (email_quer, email_nao_quer)] == [email_quer]
    _, corpo, cabecalhos = next(e for e in enviados if e[0] == email_quer)
    assert "/descadastrar/?token=" in corpo and cabecalhos["List-Unsubscribe"].startswith("<") and "/descadastrar/?token=" in cabecalhos["List-Unsubscribe"]


def test_o_aviso_de_evento_respeita_e_leva_o_link(client, db, auth_headers, monkeypatch):
    import uuid

    from app.models.motores import Inscricao
    from app.models.pessoas import Pessoa
    from tests.test_status_do_evento import _criar_evento_publico, _inscrever, _mudar

    enviados = []
    from app.services import eventos as servico_eventos
    from app.services import status_do_evento as servico_status
    from app.services import vagas as servico_vagas

    for modulo in (servico_status.notificacoes, servico_eventos.notificacoes, servico_vagas.notificacoes):
        monkeypatch.setattr(modulo, "enviar_email", lambda d, assunto, corpo_texto, cabecalhos=None: enviados.append((d, corpo_texto, cabecalhos)))
    id_evento = _criar_evento_publico(client, auth_headers, titulo=f"Evento Prefs {uuid.uuid4().hex[:6]}")
    quer, nao_quer = f"quer.{uuid.uuid4().hex[:6]}@exemplo.org", f"naoquer.{uuid.uuid4().hex[:6]}@exemplo.org"
    assert _inscrever(client, id_evento, email=quer).status_code == 200
    assert _inscrever(client, id_evento, email=nao_quer).status_code == 200
    id_pessoa_nao_quer = db.query(Pessoa.id_pessoa).filter(Pessoa.email_contato == nao_quer).scalar()
    preferencias.alterar(db, id_pessoa=id_pessoa_nao_quer, tipo=EVENTOS, recebe_=False, origem="link do e-mail")
    enviados.clear()
    r = _mudar(client, auth_headers, id_evento, "Cancelado", motivo="O salão ficou indisponível")
    assert r.status_code == 200 and r.json()["avisos"]["enderecos_que_desligaram"] == 1
    assert [d for d, _, _ in enviados] == [quer]
    assert "/descadastrar/?token=" in enviados[0][1] and "List-Unsubscribe" in enviados[0][2]
    assert db.query(Inscricao).filter(Inscricao.id_pessoa == id_pessoa_nao_quer).count() == 1, "desligar o e-mail não mexe na inscrição"


# ------------------------------------------------------------------------------------------------ 6. a migração
def test_a_migracao_continua_a_cadeia_sem_segunda_cabeca():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parent.parent / "alembic"))
    diretorio = ScriptDirectory.from_config(config)
    assert len(diretorio.get_heads()) == 1 and diretorio.get_revision("b8d4f0a2c357").down_revision == "a7c3e9f1b246"


# ------------------------------------------------------------------------------------------------ achados da conferência independente (2026-10-21)
def test_toda_situacao_da_entrega_cabe_na_coluna_do_banco():
    from app.models.comunicacao import SITUACOES_DA_ENTREGA, EntregaDeAviso

    tamanho = EntregaDeAviso.__table__.c.situacao.type.length
    assert all(len(s) <= tamanho for s in SITUACOES_DA_ENTREGA), [s for s in SITUACOES_DA_ENTREGA if len(s) > tamanho]


def test_quem_desligou_e_nao_tem_e_mail_continua_sem_e_mail_no_relatorio(client, db, auth_headers):
    from app.models.comunicacao import SEM_EMAIL
    from tests.test_comunicacao import _associado_sem_acesso, _nome

    sem = _associado_sem_acesso(db, _nome("Desligou Sem Email"))
    preferencias.alterar(db, id_pessoa=_pessoa(db, sem), tipo=AVISOS, recebe_=False, origem="painel")
    publico = _publico_do_projeto(_projeto(db, equipe=[sem]))
    assert client.post("/api/avisos/conferir-publico", json={"publico": publico}, headers=auth_headers).json()["desligaram_os_avisos"] == 0
    aviso, _ = _publicar_por_email(client, auth_headers, publico, categoria="GERAL")
    assert _entregas(db, aviso["id_aviso"])[sem.id_associado].situacao == SEM_EMAIL


def test_no_evento_a_escolha_vale_para_o_endereco_da_familia(client, db, auth_headers, monkeypatch):
    import uuid

    from app.models.pessoas import Pessoa
    from app.services import eventos as servico_eventos
    from app.services import status_do_evento as servico_status
    from app.services import vagas as servico_vagas
    from tests.test_eventos_inscricao_publica import _payload_inscricao
    from tests.test_status_do_evento import _criar_evento_publico, _inscrever, _mudar

    enviados = []
    for modulo in (servico_status.notificacoes, servico_eventos.notificacoes, servico_vagas.notificacoes):
        monkeypatch.setattr(modulo, "enviar_email", lambda d, assunto, corpo_texto, cabecalhos=None: enviados.append(d))
    id_evento = _criar_evento_publico(client, auth_headers, titulo=f"Evento Familia {uuid.uuid4().hex[:6]}")
    familia = f"familia.{uuid.uuid4().hex[:6]}@exemplo.org"
    filho = _payload_inscricao()
    r = _inscrever(client, id_evento, email=familia, participantes_adicionais=[{"nome_completo": "Filho Da Familia", "cpf": filho["cpf"]}])
    assert r.status_code == 200, r.text
    pessoas = [i for (i,) in db.query(Pessoa.id_pessoa).filter(Pessoa.email_contato == familia).all()]
    if len(pessoas) < 2:  # o participante adicional sem e-mail próprio: a família divide o endereço do titular
        filho_id = db.query(Pessoa.id_pessoa).filter(Pessoa.cpf == filho["cpf"]).scalar()
        db.get(Pessoa, filho_id).email_contato = familia
        db.commit()
        pessoas = [i for (i,) in db.query(Pessoa.id_pessoa).filter(Pessoa.email_contato == familia).all()]
    preferencias.alterar(db, id_pessoa=min(pessoas), tipo=EVENTOS, recebe_=False, origem="link do e-mail")
    enviados.clear()
    r = _mudar(client, auth_headers, id_evento, "Cancelado", motivo="O salão ficou indisponível")
    assert familia not in enviados, "quem desligou não recebe pelo link de outra pessoa da família"
    assert r.json()["avisos"]["enderecos_que_desligaram"] == 1


def test_a_anonimizacao_do_desligado_apaga_a_escolha_de_e_mails(client, db):
    from app.services.anonimizacao import anonimizar_associado

    pessoa, _, _ = _com_email(db, "Desligado Anonimizado")
    id_pessoa = _pessoa(db, pessoa)
    preferencias.alterar(db, id_pessoa=id_pessoa, tipo=LEMBRETES_DE_MENSALIDADE, recebe_=False, origem="painel")
    associado = db.get(Associado, pessoa.id_associado)
    associado.status_arrolamento = "Desligado"
    associado.data_desligamento = datetime.utcnow() - timedelta(days=4000)
    db.commit()
    assert anonimizar_associado(db, associado, dias=30) is True
    assert db.query(PreferenciaDeComunicacao).filter(PreferenciaDeComunicacao.id_pessoa == id_pessoa).count() == 0
