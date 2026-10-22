"""v6.2a (FASE 6) - o aviso do mural também por e-mail, com o registro de entrega por pessoa.

As promessas que estes testes travam:
  1. publicar "também por e-mail" põe na fila quem tem e-mail e marca "sem e-mail no cadastro" quem não tem; sem a caixa, nenhuma entrega; Convocação e Mudança de regra vêm marcadas obrigatórias;
  2. o envio é por rodada (nunca no clique), lê o endereço do cadastro NA HORA, leva o link do painel a quem tem acesso e nunca a regra do grupo;
  3. falha passageira volta para a fila (até 3 tentativas, com espera); recusa definitiva não tenta de novo; endereço inexistente vai para a fila de higienização; o motivo não guarda o endereço;
  4. o limite diário do Google para a rodada; o teto diário e o teto por rodada do sistema valem; sem servidor de e-mail nada muda; sem conseguir conectar, nada muda e a rotina avisa;
  5. retirar cancela o que estava na fila (o enviado fica); reenviar devolve as falhas para a fila, vai para a Auditoria e só vale com o aviso no mural e para quem tem `comunicar`;
  6. incluir quem entrou depois também põe o e-mail dessas pessoas na fila; o relatório e a lista mostram a situação do e-mail; o prazo de guarda apaga as entregas com a lista;
  7. a migração a7c3e9f1b246 acrescenta a coluna e a tabela, marca as duas categorias obrigatórias e o downgrade desfaz."""
import importlib.util
import smtplib
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.config_cache import invalidar_cache_configuracao
from app.database import Base
from app.models.associados import Associado
from app.models.comunicacao import CANCELADO, ENVIADO, ENVIANDO, FALHOU, NA_FILA, SEM_EMAIL, Aviso, AvisoDestinatario, EntregaDeAviso
from app.models.core import Usuario
from app.models.core import AuditLog, Catalogo, ConfiguracaoInstitucional, OpcaoCatalogo
from app.models.projetos import EquipeProjeto
from app.models.qualidade_cadastro import FilaRevisaoCadastro
from app.services import envio_de_avisos, retencao
from tests.test_comunicacao import _associado_sem_acesso, _corpo, _nome, _projeto, _publico_do_projeto
from tests.test_conselho_fiscal import _criar_associado, _headers


@pytest.fixture(autouse=True)
def _smtp_ligado(monkeypatch):
    for chave, valor in {"SMTP_HOST": "smtp.teste.invalid", "SMTP_USUARIO": "asaf@teste.invalid", "SMTP_SENHA": "senha-de-teste"}.items():
        monkeypatch.setenv(chave, valor)


class _ServidorFalso:
    """Faz o papel do servidor de e-mail: guarda o que "saiu" e recusa com o erro escolhido por endereço."""

    def __init__(self, recusas=None):
        self.enviados, self.recusas, self.conexoes, self.cabecalhos = [], dict(recusas or {}), 0, {}

    def __call__(self):
        self.conexoes += 1
        return self

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return None

    def enviar(self, para, assunto, corpo, cabecalhos=None):
        erro = self.recusas.get(para)
        if erro is not None:
            raise erro
        self.enviados.append((para, assunto, corpo))
        self.cabecalhos[para] = cabecalhos or {}

    def para(self, email):
        return [e for e in self.enviados if e[0] == email]


def _config(db, chave, valor):
    config = db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao == chave).one()
    antigo, config.valor_configuracao = config.valor_configuracao, valor
    db.commit()
    invalidar_cache_configuracao()
    return antigo


def _rodar(db, servidor, agora=None, lote="100000", limite="100000"):
    antigos = {c: _config(db, c, v) for c, v in (("EMAIL_LOTE_POR_RODADA", lote), ("EMAIL_LIMITE_DIARIO", limite))}
    try:
        return envio_de_avisos.enviar_pendentes(db, agora=agora, conexao=servidor)
    finally:
        for chave, valor in antigos.items():
            _config(db, chave, valor)


def _com_email(db, prefixo):
    associado, usuario = _criar_associado(db, _nome(prefixo))
    email = f"{prefixo.lower().replace(' ', '.')}.{uuid.uuid4().hex[:8]}@exemplo.org"
    db.get(Associado, associado.id_associado).pessoa.email_contato = email
    db.commit()
    return associado, usuario, email


def _publicar_por_email(client, auth_headers, publico, **extra):
    previa = client.post("/api/avisos/conferir-publico", json={"publico": publico}, headers=auth_headers).json()
    r = client.post("/api/avisos/", json=_corpo(publico, previa["total"], por_email=True, **extra), headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json(), previa


def _entregas(db, id_aviso):
    db.expire_all()
    return {
        linha.id_associado: entrega
        for entrega, linha in db.query(EntregaDeAviso, AvisoDestinatario).join(AvisoDestinatario, AvisoDestinatario.id_destinatario == EntregaDeAviso.id_destinatario)
        .filter(AvisoDestinatario.id_aviso == id_aviso).all()
    }


# ------------------------------------------------------------------------------------------------ 1. publicar por e-mail
def test_publicar_por_email_poe_na_fila_quem_tem_e_mail_e_marca_quem_nao_tem(client, db, auth_headers):
    com, _, _ = _com_email(db, "Com Email")
    sem = _associado_sem_acesso(db, _nome("Sem Email"))
    aviso, previa = _publicar_por_email(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[com, sem])))
    assert previa["com_email"] == 1 and {p["tem_email"] for p in previa["pessoas"]} == {True, False}
    assert aviso["por_email"] is True and aviso["email"][NA_FILA] == 1 and aviso["email"][SEM_EMAIL] == 1
    entregas = _entregas(db, aviso["id_aviso"])
    assert entregas[com.id_associado].situacao == NA_FILA and entregas[sem.id_associado].situacao == SEM_EMAIL
    auditoria = db.query(AuditLog).filter(AuditLog.acao == "AVISO_PUBLICADO", AuditLog.id_registro_afetado == aviso["id_aviso"]).one()
    assert '"por_email": true' in auditoria.dados_depois and '"com_email": 1' in auditoria.dados_depois


def test_sem_a_caixa_nenhuma_entrega_e_as_obrigatorias_vem_marcadas(client, db, auth_headers):
    com, _, _ = _com_email(db, "Sem Caixa")
    previa = client.post("/api/avisos/conferir-publico", json={"publico": _publico_do_projeto(_projeto(db, equipe=[com]))}, headers=auth_headers).json()
    r = client.post("/api/avisos/", json=_corpo(_publico_do_projeto(_projeto(db, equipe=[com])), previa["total"]), headers=auth_headers).json()
    assert r["por_email"] is False and r["email"] is None and _entregas(db, r["id_aviso"]) == {}
    categorias = {c["codigo"]: c["obrigatoria"] for c in client.get("/api/avisos/opcoes-de-publico", headers=auth_headers).json()["categorias_de_aviso"]}
    assert {c for c, obrigatoria in categorias.items() if obrigatoria} == {"CONVOCACAO", "MUDANCA_DE_REGRA"}


def test_as_obrigatorias_sao_fixas_e_nao_mudam_pelo_catalogo(client, db, auth_headers):
    """Ponto de Revisão FASE 6 (2/2): quem tem `comunicar` edita o catálogo de categorias, mas não pode tornar obrigatória uma categoria qualquer
    (contra a escolha de quem desligou) nem tirar a obrigatoriedade da Convocação (decisão do Presidente: só Convocação e Mudança de regra)."""
    from app.models.core import Catalogo, OpcaoCatalogo
    from app.services import comunicacao

    catalogo = db.query(Catalogo).filter(Catalogo.chave == "categoria_aviso").one()
    opcoes = {o.codigo: o for o in db.query(OpcaoCatalogo).filter(OpcaoCatalogo.id_catalogo == catalogo.id_catalogo).all()}
    geral, convocacao = opcoes["GERAL"], opcoes["CONVOCACAO"]
    antes = (geral.metadados, convocacao.metadados)
    try:
        geral.metadados, convocacao.metadados = {"obrigatoria": True}, {}
        db.commit()
        assert comunicacao.categorias_obrigatorias(db) == {"CONVOCACAO", "MUDANCA_DE_REGRA"}
        categorias = {c["codigo"]: c["obrigatoria"] for c in client.get("/api/avisos/opcoes-de-publico", headers=auth_headers).json()["categorias_de_aviso"]}
        assert categorias["GERAL"] is False and categorias["CONVOCACAO"] is True
    finally:
        geral.metadados, convocacao.metadados = antes
        db.commit()


# ------------------------------------------------------------------------------------------------ 2. a rodada
def test_a_rodada_envia_com_o_endereco_de_agora_e_o_link_so_para_quem_tem_acesso(client, db, auth_headers):
    com_acesso, _, email = _com_email(db, "Leitor Do Email")
    sem_acesso = _associado_sem_acesso(db, _nome("Sem Painel"))
    sem_acesso_email = f"sem.painel.{uuid.uuid4().hex[:8]}@exemplo.org"
    db.get(Associado, sem_acesso.id_associado).pessoa.email_contato = sem_acesso_email
    db.commit()
    projeto = _projeto(db, equipe=[com_acesso, sem_acesso])
    aviso, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(projeto, situacoes=["Ativo - Em Dia"]), exige_confirmacao=True)
    assert _entregas(db, aviso["id_aviso"])[com_acesso.id_associado].situacao == NA_FILA, "publicar não envia: só põe na fila"
    novo = f"trocou.{uuid.uuid4().hex[:8]}@exemplo.org"
    db.get(Associado, com_acesso.id_associado).pessoa.email_contato = novo  # trocou o e-mail depois de publicar
    db.commit()
    servidor = _ServidorFalso()
    resultado = _rodar(db, servidor)
    assert resultado["enviados"] >= 2 and servidor.conexoes == 1, "uma conexão por rodada"
    assert servidor.para(email) == [] and len(servidor.para(novo)) == 1, "vai para o endereço de agora"
    _, assunto, corpo = servidor.para(novo)[0]
    assert assunto == f"ASAF: {aviso['titulo']}" and "Reunião da equipe no sábado às 9h." in corpo
    assert f"/meus-avisos/{aviso['id_aviso']}" in corpo and "confirmar que leu" in corpo
    assert "Ativo - Em Dia" not in corpo and "situação" not in corpo, "o e-mail nunca diz a regra do grupo"
    _, _, corpo_sem = servidor.para(sem_acesso_email)[0]
    assert "/meus-avisos/" not in corpo_sem and "quando tiver acesso ao painel" in corpo_sem
    entregas = _entregas(db, aviso["id_aviso"])
    assert entregas[com_acesso.id_associado].situacao == ENVIADO and entregas[com_acesso.id_associado].enviado_em is not None
    assert db.query(AuditLog).filter(AuditLog.acao == "EMAILS_DE_AVISOS_ENVIADOS").count() >= 1


def test_quem_ficou_sem_e_mail_antes_de_sair_vira_sem_e_mail(client, db, auth_headers):
    com, _, _ = _com_email(db, "Apagou Email")
    db.get(Associado, com.id_associado).id_usuario = None  # nem o e-mail do login sobra
    db.commit()
    aviso, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[com])))
    db.get(Associado, com.id_associado).pessoa.email_contato = None
    db.commit()
    _rodar(db, _ServidorFalso())
    assert _entregas(db, aviso["id_aviso"])[com.id_associado].situacao == SEM_EMAIL


# ------------------------------------------------------------------------------------------------ 3. falhas
def test_falha_passageira_volta_para_a_fila_e_depois_de_3_tentativas_falha(client, db, auth_headers):
    pessoa, _, email = _com_email(db, "Servidor Ocupado")
    aviso, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[pessoa])))
    servidor = _ServidorFalso({email: smtplib.SMTPRecipientsRefused({email: (451, b"4.3.0 Try again later")})})
    agora = datetime.utcnow()
    _rodar(db, servidor, agora=agora)
    entrega = _entregas(db, aviso["id_aviso"])[pessoa.id_associado]
    assert (entrega.situacao, entrega.tentativas) == (NA_FILA, 1) and entrega.proxima_tentativa_em > agora
    assert email not in (entrega.ultimo_erro or "") and entrega.ultimo_erro == "O servidor pediu para tentar mais tarde (451 4.3.0)", "o motivo em português, sem o endereço"
    _rodar(db, servidor, agora=agora + timedelta(minutes=5))
    assert _entregas(db, aviso["id_aviso"])[pessoa.id_associado].tentativas == 1, "antes da espera, não tenta"
    _rodar(db, servidor, agora=agora + timedelta(hours=1))
    _rodar(db, servidor, agora=agora + timedelta(hours=3))
    entrega = _entregas(db, aviso["id_aviso"])[pessoa.id_associado]
    assert (entrega.situacao, entrega.tentativas) == (FALHOU, 3)


def test_endereco_inexistente_falha_de_vez_e_vai_para_a_higienizacao(client, db, auth_headers):
    pessoa, _, email = _com_email(db, "Caixa Inexistente")
    aviso, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[pessoa])))
    servidor = _ServidorFalso({email: smtplib.SMTPRecipientsRefused({email: (550, b"5.1.1 The email account that you tried to reach does not exist")})})
    _rodar(db, servidor)
    entrega = _entregas(db, aviso["id_aviso"])[pessoa.id_associado]
    assert (entrega.situacao, entrega.tentativas) == (FALHOU, 1)
    fila = db.query(FilaRevisaoCadastro).filter(FilaRevisaoCadastro.id_pessoa_a == pessoa.id_pessoa).all()
    assert len(fila) == 1 and "inexistente" in fila[0].detalhe
    assert db.get(Associado, pessoa.id_associado).pessoa.contato_suspeito is True


def test_recusa_definitiva_que_nao_e_endereco_falha_sem_ir_para_a_higienizacao(client, db, auth_headers):
    pessoa, _, email = _com_email(db, "Bloqueio De Politica")
    aviso, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[pessoa])))
    _rodar(db, _ServidorFalso({email: smtplib.SMTPDataError(552, b"5.7.0 Message rejected by policy")}))
    assert _entregas(db, aviso["id_aviso"])[pessoa.id_associado].situacao == FALHOU
    assert db.query(FilaRevisaoCadastro).filter(FilaRevisaoCadastro.id_pessoa_a == pessoa.id_pessoa).count() == 0


# ------------------------------------------------------------------------------------------------ 4. tetos e ambiente
def test_o_limite_do_google_para_a_rodada_e_deixa_o_resto_na_fila(client, db, auth_headers):
    primeira, _, email1 = _com_email(db, "Antes Do Limite")
    segunda, _, email2 = _com_email(db, "Depois Do Limite")
    _rodar(db, _ServidorFalso())  # esvazia a fila de outros testes
    aviso, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[primeira, segunda])))
    ordem = sorted(_entregas(db, aviso["id_aviso"]).items(), key=lambda par: par[1].id_entrega)
    email_da_primeira = email1 if ordem[0][0] == primeira.id_associado else email2
    servidor = _ServidorFalso({email_da_primeira: smtplib.SMTPDataError(550, b"5.4.5 Daily user sending limit exceeded")})
    resultado = _rodar(db, servidor)
    assert "limite do dia" in resultado["motivo"] and servidor.enviados == []
    entregas = _entregas(db, aviso["id_aviso"])
    assert {e.situacao for e in entregas.values()} == {NA_FILA} and {e.tentativas for e in entregas.values()} == {0}


def test_o_teto_por_rodada_e_o_teto_diario_do_sistema_valem(client, db, auth_headers):
    pessoas = [_com_email(db, f"Teto {i}")[0] for i in range(3)]
    _rodar(db, _ServidorFalso())  # esvazia a fila de outros testes
    aviso, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=pessoas)))
    assert _rodar(db, _ServidorFalso(), lote="1")["enviados"] == 1
    enviados_24h = db.query(EntregaDeAviso).filter(EntregaDeAviso.situacao == ENVIADO, EntregaDeAviso.enviado_em >= datetime.utcnow() - timedelta(hours=24)).count()
    resultado = _rodar(db, _ServidorFalso(), limite=str(enviados_24h))
    assert resultado["enviados"] == 0 and "teto diário" in resultado["motivo"]
    assert _rodar(db, _ServidorFalso(), limite=str(enviados_24h + 1))["enviados"] == 1
    assert sum(1 for e in _entregas(db, aviso["id_aviso"]).values() if e.situacao == NA_FILA) == 1


def test_sem_servidor_de_e_mail_nada_muda(client, db, auth_headers, monkeypatch):
    pessoa, _, _ = _com_email(db, "Ambiente De Teste")
    aviso, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[pessoa])))
    monkeypatch.delenv("SMTP_HOST")
    resultado = _rodar(db, _ServidorFalso())
    assert resultado["enviados"] == 0 and "não está configurado" in resultado["motivo"]
    assert _entregas(db, aviso["id_aviso"])[pessoa.id_associado].situacao == NA_FILA


def test_sem_conseguir_conectar_nada_muda_e_a_rotina_avisa(client, db, auth_headers):
    pessoa, _, _ = _com_email(db, "Sem Conexao")
    aviso, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[pessoa])))

    def recusa_a_senha():
        raise smtplib.SMTPAuthenticationError(535, b"5.7.8 Username and Password not accepted")

    resultado = _rodar(db, recusa_a_senha)
    assert resultado.get("erro_de_conexao") is True and resultado["enviados"] == 0
    assert _entregas(db, aviso["id_aviso"])[pessoa.id_associado].situacao == NA_FILA


# ------------------------------------------------------------------------------------------------ 5. retirar e reenviar
def test_retirar_cancela_o_que_estava_na_fila_e_o_enviado_fica(client, db, auth_headers):
    enviada, _, _ = _com_email(db, "Ja Recebeu")
    projeto = _projeto(db, equipe=[enviada])
    aviso, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(projeto))
    _rodar(db, _ServidorFalso())
    na_fila, _, _ = _com_email(db, "Ainda Na Fila")
    db.add(EquipeProjeto(id_projeto=projeto.id_projeto, id_associado=na_fila.id_associado, papel="VOLUNTARIO"))
    db.commit()
    assert client.get(f"/api/avisos/{aviso['id_aviso']}/novos", headers=auth_headers).json() == {"novos": 1, "com_email": 1}
    incluidos = client.post(f"/api/avisos/{aviso['id_aviso']}/incluir-novos", json={"total_confirmado": 1}, headers=auth_headers).json()
    assert incluidos["incluidos"] == 1 and incluidos["aviso"]["email"][NA_FILA] == 1, "incluir também põe o e-mail na fila"
    client.post(f"/api/avisos/{aviso['id_aviso']}/retirar", json={"motivo": "Assunto resolvido, aviso retirado."}, headers=auth_headers)
    entregas = _entregas(db, aviso["id_aviso"])
    assert entregas[enviada.id_associado].situacao == ENVIADO and entregas[na_fila.id_associado].situacao == CANCELADO
    servidor = _ServidorFalso()
    _rodar(db, servidor)
    assert all(aviso["titulo"] not in assunto for _, assunto, _ in servidor.enviados)


def test_reenviar_devolve_as_falhas_para_a_fila(client, db, auth_headers):
    pessoa, _, email = _com_email(db, "Reenviar")
    aviso, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[pessoa])))
    _rodar(db, _ServidorFalso({email: smtplib.SMTPDataError(552, b"5.7.0 rejected")}))
    url = f"/api/avisos/{aviso['id_aviso']}/reenviar-emails"
    _, so_associado = _criar_associado(db, _nome("Sem Comunicar Reenvio"))
    assert client.post(url, headers=_headers(so_associado)).status_code == 403
    r = client.post(url, headers=auth_headers).json()
    assert r["voltaram_para_a_fila"] == 1 and r["aviso"]["email"][NA_FILA] == 1
    entrega = _entregas(db, aviso["id_aviso"])[pessoa.id_associado]
    assert (entrega.situacao, entrega.tentativas, entrega.ultimo_erro) == (NA_FILA, 0, None)
    assert db.query(AuditLog).filter(AuditLog.acao == "AVISO_EMAILS_REENVIADOS", AuditLog.id_registro_afetado == aviso["id_aviso"]).count() == 1
    assert client.post(url, headers=auth_headers).json()["voltaram_para_a_fila"] == 0
    db.get(Aviso, aviso["id_aviso"]).valido_ate = date.today() - timedelta(days=2)
    db.commit()
    assert client.post(url, headers=auth_headers).status_code == 409


# ------------------------------------------------------------------------------------------------ 6. relatório, lista e prazo de guarda
def test_o_relatorio_e_a_lista_mostram_o_e_mail(client, db, auth_headers):
    pessoa, _, _ = _com_email(db, "Relatorio Email")
    sem = _associado_sem_acesso(db, _nome("Relatorio Sem Email"))
    aviso, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[pessoa, sem])))
    _rodar(db, _ServidorFalso())
    relatorio = client.get(f"/api/avisos/{aviso['id_aviso']}", headers=auth_headers).json()
    por_nome = {d["nome"]: d["email"] for d in relatorio["destinatarios"]}
    assert por_nome[pessoa.nome_completo]["situacao"] == ENVIADO and por_nome[pessoa.nome_completo]["enviado_em"]
    assert por_nome[sem.nome_completo]["situacao"] == SEM_EMAIL
    assert relatorio["email"][ENVIADO] == 1 and relatorio["email"][SEM_EMAIL] == 1
    lista = client.get(f"/api/avisos/?busca={aviso['titulo']}", headers=auth_headers).json()["itens"][0]
    assert lista["por_email"] is True and lista["email"][ENVIADO] == 1


def test_o_prazo_de_guarda_apaga_as_entregas_com_a_lista(client, db, auth_headers):
    pessoa, _, _ = _com_email(db, "Guarda Email")
    aviso, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[pessoa])))
    _rodar(db, _ServidorFalso())
    db.get(Aviso, aviso["id_aviso"]).valido_ate = date.today() - timedelta(days=1830)
    db.commit()
    assert retencao.aplicar_todas(db)["falhas"] == []
    assert _entregas(db, aviso["id_aviso"]) == {}


# ------------------------------------------------------------------------------------------------ 7. a migração
_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "a7c3e9f1b246_v6_2a_aviso_por_email.py"


def test_a_migracao_acrescenta_coluna_tabela_e_marca_as_obrigatorias():
    especificacao = importlib.util.spec_from_file_location("migracao_v62a", _CAMINHO)
    migracao = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(migracao)
    motor = sa.create_engine("sqlite://")
    tabelas = ("usuarios", "niveis_acesso", "pessoas", "associados", "catalogos", "opcoes_catalogo")
    Base.metadata.create_all(motor, tables=[Base.metadata.tables[t] for t in tabelas])
    with motor.begin() as c:
        c.execute(sa.text(
            "CREATE TABLE avisos (id_aviso INTEGER PRIMARY KEY, titulo VARCHAR(150))"
        ))
        c.execute(sa.text("CREATE TABLE avisos_destinatarios (id_destinatario INTEGER PRIMARY KEY, id_aviso INTEGER)"))
        c.execute(sa.text("INSERT INTO avisos (id_aviso, titulo) VALUES (1, 'antigo')"))
        c.execute(sa.insert(Catalogo), {"chave": "categoria_aviso", "nome_exibido": "Categoria de aviso"})
        id_catalogo = c.execute(sa.select(Catalogo.id_catalogo)).scalar()
        for codigo in ("GERAL", "CONVOCACAO", "MUDANCA_DE_REGRA"):
            c.execute(sa.insert(OpcaoCatalogo), {"id_catalogo": id_catalogo, "codigo": codigo, "rotulo": codigo, "metadados": {}})

    def rodar(funcao):
        with motor.begin() as conexao:
            with Operations.context(MigrationContext.configure(conexao)):
                funcao()

    def marcadas():
        with motor.connect() as c:
            return {codigo for codigo, meta in c.execute(sa.select(OpcaoCatalogo.codigo, OpcaoCatalogo.metadados)).all() if (meta or {}).get("obrigatoria")}

    rodar(migracao.upgrade)
    assert marcadas() == {"CONVOCACAO", "MUDANCA_DE_REGRA"}
    with motor.connect() as c:
        assert c.execute(sa.text("SELECT por_email FROM avisos WHERE id_aviso = 1")).scalar() in (0, False), "o aviso antigo não vai por e-mail de repente"
    assert "entregas_de_aviso" in sa.inspect(motor).get_table_names()
    rodar(migracao.downgrade)
    assert marcadas() == set() and "entregas_de_aviso" not in sa.inspect(motor).get_table_names()
    assert "por_email" not in {c["name"] for c in sa.inspect(motor).get_columns("avisos")}


def test_a_migracao_continua_a_cadeia_sem_segunda_cabeca():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parent.parent / "alembic"))
    diretorio = ScriptDirectory.from_config(config)
    assert len(diretorio.get_heads()) == 1 and diretorio.get_revision("a7c3e9f1b246").down_revision == "e5b1d7a3c820"


# ------------------------------------------------------------------------------------------------ achados da conferência independente (2026-10-20)
def test_a_recusa_de_um_destinatario_nao_para_a_rodada(client, db, auth_headers):
    primeira, _, email1 = _com_email(db, "Recusada Primeiro")
    segunda, _, email2 = _com_email(db, "Sai Mesmo Assim")
    _rodar(db, _ServidorFalso())
    aviso, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[primeira, segunda])))
    recusa = smtplib.SMTPRecipientsRefused({"x": (550, b"5.1.1 The email account that you tried to reach does not exist")})
    servidor = _ServidorFalso({email1: recusa, email2: smtplib.SMTPRecipientsRefused({"x": (451, b"4.3.0 Try again")})})
    _rodar(db, servidor)
    entregas = _entregas(db, aviso["id_aviso"])
    assert entregas[primeira.id_associado].situacao == FALHOU and entregas[segunda.id_associado].tentativas == 1, "as duas foram tentadas na mesma rodada"
    terceira, _, email3 = _com_email(db, "Depois Da Passageira")
    db.add(EquipeProjeto(id_projeto=db.query(EquipeProjeto).filter(EquipeProjeto.id_associado == primeira.id_associado).first().id_projeto,
                         id_associado=terceira.id_associado, papel="VOLUNTARIO"))
    db.commit()
    client.post(f"/api/avisos/{aviso['id_aviso']}/incluir-novos", json={"total_confirmado": 1}, headers=auth_headers)
    servidor = _ServidorFalso({email2: smtplib.SMTPRecipientsRefused({"x": (451, b"4.3.0 Try again")})})
    _rodar(db, servidor, agora=datetime.utcnow() + timedelta(hours=2))
    assert len(servidor.para(email3)) == 1, "a falha passageira de uma pessoa não segura a próxima"


def test_uma_rodada_so_pega_cada_entrega_e_a_retirada_no_meio_vale(client, db, auth_headers):
    primeira, _, email1 = _com_email(db, "Pega Um")
    segunda, _, email2 = _com_email(db, "Retirada No Meio")
    _rodar(db, _ServidorFalso())
    aviso, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[primeira, segunda])))
    entregas = _entregas(db, aviso["id_aviso"])
    ordem = sorted(entregas.values(), key=lambda e: e.id_entrega)

    class _RetiraNoMeio(_ServidorFalso):
        def enviar(self, para, assunto, corpo, cabecalhos=None):
            super().enviar(para, assunto, corpo, cabecalhos)
            # enquanto a rodada envia a 1ª, alguém retira o aviso (a 2ª, já lida da fila, não pode sair)
            client.post(f"/api/avisos/{aviso['id_aviso']}/retirar", json={"motivo": "Retirado durante a rodada de envio."}, headers=auth_headers)

    servidor = _RetiraNoMeio()
    _rodar(db, servidor)
    assert len(servidor.enviados) == 1
    situacoes = sorted(e.situacao for e in _entregas(db, aviso["id_aviso"]).values())
    assert situacoes == sorted([ENVIADO, CANCELADO])
    assert ordem[0].id_entrega != ordem[1].id_entrega


def test_entrega_ja_pega_por_outra_rodada_nao_sai_de_novo_e_a_presa_vira_falha(client, db, auth_headers):
    pessoa, _, email = _com_email(db, "Outra Rodada")
    _rodar(db, _ServidorFalso())
    aviso, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[pessoa])))
    entrega = _entregas(db, aviso["id_aviso"])[pessoa.id_associado]
    entrega.situacao, entrega.pego_em = ENVIANDO, datetime.utcnow()  # outra rodada pegou agora
    db.commit()
    servidor = _ServidorFalso()
    _rodar(db, servidor)
    assert servidor.para(email) == [] and _entregas(db, aviso["id_aviso"])[pessoa.id_associado].situacao == ENVIANDO
    _rodar(db, servidor, agora=datetime.utcnow() + timedelta(hours=2))  # a outra rodada caiu no meio
    presa = _entregas(db, aviso["id_aviso"])[pessoa.id_associado]
    assert presa.situacao == FALHOU and "pode ter saído ou não" in presa.ultimo_erro and servidor.para(email) == []


def test_recusa_do_remetente_para_a_rodada_sem_culpar_a_pessoa(client, db, auth_headers):
    pessoa, _, email = _com_email(db, "Remetente Recusado")
    _rodar(db, _ServidorFalso())
    aviso, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[pessoa])))
    servidor = _ServidorFalso({email: smtplib.SMTPSenderRefused(553, b"5.1.8 Sender address rejected", "asaf@teste.invalid")})
    resultado = _rodar(db, servidor)
    assert resultado.get("erro_de_conexao") is True and "REMETENTE" in resultado["motivo"]
    entrega = _entregas(db, aviso["id_aviso"])[pessoa.id_associado]
    assert (entrega.situacao, entrega.tentativas) == (NA_FILA, 0)
    assert db.query(FilaRevisaoCadastro).filter(FilaRevisaoCadastro.id_pessoa_a == pessoa.id_pessoa).count() == 0


def test_o_421_para_a_rodada_depois_de_registrar_a_entrega(client, db, auth_headers):
    primeira, _, email1 = _com_email(db, "Fechou A Conexao")
    segunda, _, email2 = _com_email(db, "Fica Para Depois")
    _rodar(db, _ServidorFalso())
    aviso, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[primeira, segunda])))
    ordem = sorted(_entregas(db, aviso["id_aviso"]).items(), key=lambda par: par[1].id_entrega)
    email_da_primeira = email1 if ordem[0][0] == primeira.id_associado else email2
    servidor = _ServidorFalso({email_da_primeira: smtplib.SMTPDataError(421, b"4.7.0 Try again later, closing connection")})
    _rodar(db, servidor)
    depois = _entregas(db, aviso["id_aviso"])
    assert depois[ordem[0][0]].tentativas == 1 and depois[ordem[0][0]].situacao == NA_FILA
    assert depois[ordem[1][0]].tentativas == 0 and servidor.enviados == [], "a próxima pessoa não ganha uma tentativa que não foi dela"


def test_endereco_com_acento_conta_como_sem_e_mail(client, db, auth_headers):
    pessoa = _associado_sem_acesso(db, _nome("Joao Com Acento"))
    db.get(Associado, pessoa.id_associado).pessoa.email_contato = "joão@exemplo.org"
    db.commit()
    previa = client.post("/api/avisos/conferir-publico", json={"publico": _publico_do_projeto(_projeto(db, equipe=[pessoa]))}, headers=auth_headers).json()
    assert previa["com_email"] == 0


def test_o_e_mail_do_login_vale_e_a_recusa_dele_nao_marca_o_contato(client, db, auth_headers):
    pessoa, usuario = _criar_associado(db, _nome("So Login"))
    login = db.get(Usuario, usuario.id_usuario).email
    _rodar(db, _ServidorFalso())
    publico = _publico_do_projeto(_projeto(db, equipe=[pessoa]))
    previa = client.post("/api/avisos/conferir-publico", json={"publico": publico}, headers=auth_headers).json()
    assert previa["com_email"] == 1, "sem e-mail de contato, vale o do login (a mesma regra do envio)"
    aviso, _ = _publicar_por_email(client, auth_headers, publico)
    _rodar(db, _ServidorFalso({login: smtplib.SMTPRecipientsRefused({"x": (550, b"5.1.1 does not exist")})}))
    assert _entregas(db, aviso["id_aviso"])[pessoa.id_associado].situacao == FALHOU
    assert db.query(FilaRevisaoCadastro).filter(FilaRevisaoCadastro.id_pessoa_a == pessoa.id_pessoa).count() == 0, "o contato não é o culpado"


def test_aviso_que_venceu_cancela_o_que_estava_na_fila(client, db, auth_headers):
    pessoa, _, email = _com_email(db, "Venceu Na Fila")
    aviso, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[pessoa])))
    db.get(Aviso, aviso["id_aviso"]).valido_ate = date.today() - timedelta(days=2)
    db.commit()
    servidor = _ServidorFalso()
    _rodar(db, servidor)
    entrega = _entregas(db, aviso["id_aviso"])[pessoa.id_associado]
    assert entrega.situacao == CANCELADO and "saiu do mural" in entrega.ultimo_erro and servidor.para(email) == []


def test_as_obrigatorias_saem_primeiro(client, db, auth_headers):
    pessoa, _, email = _com_email(db, "Prioridade")
    _rodar(db, _ServidorFalso())
    comum, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[pessoa])), categoria="GERAL")
    convocacao, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[pessoa])), categoria="CONVOCACAO")
    servidor = _ServidorFalso()
    _rodar(db, servidor, lote="1")
    assert [assunto for _, assunto, _ in servidor.para(email)] == [f"ASAF: {convocacao['titulo']}"]
    assert _entregas(db, comum["id_aviso"])[pessoa.id_associado].situacao == NA_FILA


def test_o_servidor_pedindo_para_esperar_no_remetente_para_a_rodada_sem_alarme(client, db, auth_headers):
    pessoa, _, email = _com_email(db, "Pausa Do Servidor")
    _rodar(db, _ServidorFalso())
    aviso, _ = _publicar_por_email(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[pessoa])))
    resultado = _rodar(db, _ServidorFalso({email: smtplib.SMTPSenderRefused(451, b"4.3.0 Mail server temporarily rejected message", "asaf@teste.invalid")}))
    assert "pediu para esperar" in resultado["motivo"] and not resultado.get("erro_de_conexao")
    entrega = _entregas(db, aviso["id_aviso"])[pessoa.id_associado]
    assert (entrega.situacao, entrega.tentativas) == (NA_FILA, 0)
