"""v5.7f - a identidade de quem pede dado pessoal é validada antes de a equipe responder (decisão do Presidente, 2026-10-19).

As promessas que estes testes travam:
  1. a solicitação do titular exige e-mail (a resposta é lida na área Minha conta, que pede o e-mail e um código enviado a ele); os outros pedidos seguem aceitando só telefone;
  2. o pedido nasce com a identidade validada SÓ quando o e-mail digitado é o do cadastro de ASSOCIADO daquele CPF; e-mail diferente, ou e-mail de quem é só participante de evento, não valida
     (o e-mail do cadastro de quem se inscreveu pode ser o de outra pessoa que digitou o CPF dele);
  3. o servidor recusa responder a solicitação do titular com a identidade por validar; a equipe valida à mão, escrevendo o que conferiu (uma vez, só em pedido aberto, só com a permissão da
     fila), e a Auditoria guarda quem e como; os outros tipos de pedido não mudam;
  4. a resposta com dado pessoal NUNCA vai por e-mail: o e-mail só avisa que há resposta e onde lê-la; os outros tipos seguem recebendo a resposta por e-mail;
  5. a resposta aparece na área Minha conta, e só para quem entrou com o e-mail do pedido (código de uso único); antes de responder a área mostra o pedido sem resposta;
  6. o pedido aberto de dentro da Minha conta nasce validado (o e-mail já foi provado por código); a rotina de retenção apaga o que a equipe anotou ao validar."""
import re
import uuid
from datetime import datetime, timedelta

import pytest

from app.models.associados import Associado
from app.models.atendimento import (
    ENCERRADO, IDENTIDADE_AUTOMATICA_CADASTRO, IDENTIDADE_CODIGO_NO_EMAIL, IDENTIDADE_MANUAL, RESPONDIDO, Atendimento,
)
from app.models.core import AuditLog
from app.models.motores import Inscricao
from app.models.pessoas import Pessoa
from app.services import atendimento as servico
from app.services import retencao
from tests.test_atendimento import _corpo, _cpf_valido, _enviar, _ip
from tests.test_conta_de_visitante import _cabecalho, _codigo_enviado, _entrar, _inscrever_com_cpf, _pedir
from tests.test_doacao_online import emails  # noqa: F401  (a fixture `emails`)
from tests.test_documentos_institucionais import _usuario

TEXTO_DA_RESPOSTA = "Sim, a associação trata o seu nome e o seu telefone. Tudo foi conferido pela equipe."


def _email() -> str:
    return f"titular.{uuid.uuid4().hex[:12]}@example.com"


def _associado(db, cpf: str, email: str) -> Pessoa:
    pessoa = Pessoa(nome_completo="Sócia Cadastrada", cpf=cpf, email_contato=email)
    db.add(pessoa)
    db.flush()
    db.add(Associado(id_pessoa=pessoa.id_pessoa))
    db.commit()
    return pessoa


def _participante(db, cpf: str, email: str) -> Pessoa:
    """Quem só se inscreveu em evento: tem Pessoa e e-mail, mas não é associada."""
    pessoa = Pessoa(nome_completo="Participante de Evento", cpf=cpf, email_contato=email)
    db.add(pessoa)
    db.commit()
    return pessoa


def _pedido(client, db, **sobrescritas) -> Atendimento:
    r = _enviar(client, "TITULAR_LGPD", **sobrescritas)
    assert r.status_code == 200, r.text
    return db.query(Atendimento).filter(Atendimento.protocolo == r.json()["protocolo"]).one()


def _url(a: Atendimento) -> str:
    return f"/api/atendimentos/{a.id_atendimento}"


def _abrir(client, headers, a: Atendimento) -> dict:
    r = client.get(_url(a), headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


# ------------------------------------------------------------------------------------------------ 1. o e-mail é obrigatório
def test_a_solicitacao_do_titular_exige_e_mail_e_os_outros_pedidos_seguem_aceitando_so_telefone(client):
    sem_email = _enviar(client, "TITULAR_LGPD", email_contato=None, telefone_whatsapp="91988887777")
    assert sem_email.status_code == 422 and "e-mail" in sem_email.text and "Minha conta" in sem_email.text
    assert _enviar(client, "CONTATO", email_contato=None, telefone_whatsapp="91988887777").status_code == 200
    assert _enviar(client, "PEDIDO_INFORMACAO", email_contato=None, telefone_whatsapp="91988887777").status_code == 200


# ------------------------------------------------------------------------------------------------ 2. a validação automática
def test_o_pedido_de_associado_com_o_e_mail_do_cadastro_nasce_validado_e_a_auditoria_diz(client, db, auth_headers):
    cpf, email = _cpf_valido(), _email()
    _associado(db, cpf, email)
    a = _pedido(client, db, cpf=cpf, email_contato=email.upper())  # maiúsculas não importam
    assert a.identidade_validacao == IDENTIDADE_AUTOMATICA_CADASTRO and a.identidade_validada_em is not None
    assert a.id_usuario_validacao is None and a.identidade_nota is None
    aberto = _abrir(client, auth_headers, a)
    assert aberto["identidade_validada"] is True and aberto["exige_identidade_validada"] is True
    assert aberto["identidade_validacao"] == IDENTIDADE_AUTOMATICA_CADASTRO and "cadastro de associado" in aberto["identidade_validacao_rotulo"]
    acoes = [x.acao for x in db.query(AuditLog).filter(AuditLog.tabela_afetada == "atendimentos", AuditLog.id_registro_afetado == a.id_atendimento).order_by(AuditLog.id_log)]
    assert acoes == ["ATENDIMENTO_PUBLICO", "ATENDIMENTO_IDENTIDADE_VALIDADA_AUTOMATICAMENTE"]


def test_quem_so_sabe_o_cpf_de_um_associado_nao_nasce_validado(client, db, auth_headers):
    cpf, email_do_cadastro = _cpf_valido(), _email()
    _associado(db, cpf, email_do_cadastro)
    a = _pedido(client, db, cpf=cpf, email_contato=_email())  # o e-mail de quem pediu é outro
    assert a.identidade_validada_em is None and a.identidade_validacao is None
    aberto = _abrir(client, auth_headers, a)
    assert aberto["identidade_validada"] is False and aberto["exige_identidade_validada"] is True


def test_o_e_mail_de_quem_e_so_participante_de_evento_nao_valida_sozinho(client, db):
    cpf, email = _cpf_valido(), _email()
    _participante(db, cpf, email)
    a = _pedido(client, db, cpf=cpf, email_contato=email)
    assert a.identidade_validada_em is None, "o e-mail do cadastro de participante pode ser de quem digitou o CPF dele numa inscrição"


def test_cpf_que_nao_esta_no_cadastro_nao_nasce_validado(client, db):
    assert _pedido(client, db).identidade_validada_em is None


def test_os_outros_tipos_de_pedido_nao_tem_validacao_de_identidade(client, db, auth_headers):
    protocolo = _enviar(client, "CONTATO").json()["protocolo"]
    a = db.query(Atendimento).filter(Atendimento.protocolo == protocolo).one()
    aberto = _abrir(client, auth_headers, a)
    assert aberto["exige_identidade_validada"] is False and aberto["identidade_validada"] is False
    r = client.post(f"{_url(a)}/validar-identidade", json={"nota": "Conferido o documento com foto."}, headers=auth_headers)
    assert r.status_code == 400 and "titular" in r.text


# ------------------------------------------------------------------------------------------------ 3. responder só com a identidade validada
def test_o_servidor_recusa_responder_a_solicitacao_do_titular_sem_a_identidade_validada(client, db, auth_headers, emails):
    a = _pedido(client, db)
    r = client.post(f"{_url(a)}/responder", json={"resposta": TEXTO_DA_RESPOSTA, "resultado": "ATENDIDO"}, headers=auth_headers)
    assert r.status_code == 400 and "valide a identidade" in r.json()["detail"]
    db.refresh(a)
    assert a.status != RESPONDIDO and a.resposta is None
    assert [x for x in emails if "resposta" in x[1].lower()] == [], "nada sai por e-mail enquanto a identidade não estiver validada"


def test_a_equipe_valida_a_mao_com_o_que_conferiu_e_so_depois_responde(client, db, auth_headers):
    a = _pedido(client, db)
    url = f"{_url(a)}/validar-identidade"
    curta = client.post(url, json={"nota": "ok"}, headers=auth_headers)
    assert curta.status_code == 400 and "conferiu" in curta.json()["detail"]
    comprida = client.post(url, json={"nota": "x" * 501}, headers=auth_headers)
    assert comprida.status_code == 400
    db.refresh(a)
    assert a.identidade_validada_em is None, "recusa não grava nada"

    r = client.post(url, json={"nota": "  Conferi o documento com foto na secretaria,   dia 19. "}, headers=auth_headers)
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["identidade_validada"] is True and corpo["identidade_validacao"] == IDENTIDADE_MANUAL
    assert corpo["identidade_nota"] == "Conferi o documento com foto na secretaria, dia 19.", "espaços repetidos viram um só"
    assert corpo["identidade_validada_por"] and "@" in corpo["identidade_validada_por"] and corpo["id_usuario_validacao"] is not None
    # só uma vez
    de_novo = client.post(url, json={"nota": "Conferi mais uma vez o documento."}, headers=auth_headers)
    assert de_novo.status_code == 400 and "já está validada" in de_novo.json()["detail"]
    # agora a resposta é aceita
    resposta = client.post(f"{_url(a)}/responder", json={"resposta": TEXTO_DA_RESPOSTA, "resultado": "ATENDIDO"}, headers=auth_headers)
    assert resposta.status_code == 200, resposta.text
    # e depois de respondido não se valida mais
    tarde = client.post(url, json={"nota": "Conferi o documento depois da hora."}, headers=auth_headers)
    assert tarde.status_code == 400 and "respondido" in tarde.json()["detail"].lower()
    acoes = [x.acao for x in db.query(AuditLog).filter(AuditLog.tabela_afetada == "atendimentos", AuditLog.id_registro_afetado == a.id_atendimento).order_by(AuditLog.id_log)]
    assert acoes == ["ATENDIMENTO_PUBLICO", "ATENDIMENTO_IDENTIDADE_VALIDADA", "ATENDIMENTO_RESPONDIDO"]
    registro = db.query(AuditLog).filter(AuditLog.acao == "ATENDIMENTO_IDENTIDADE_VALIDADA", AuditLog.id_registro_afetado == a.id_atendimento).one()
    assert registro.id_usuario is not None, "a Auditoria guarda quem validou"
    assert "Conferi" not in (str(registro.dados_depois) + str(registro.dados_antes)), "o que foi conferido fica só no pedido, não na Auditoria"


def test_pedido_encerrado_nao_pode_ser_validado(client, db, auth_headers):
    a = _pedido(client, db)
    assert client.post(f"{_url(a)}/encerrar", json={"motivo": "Não foi possível validar a identidade."}, headers=auth_headers).status_code == 200
    r = client.post(f"{_url(a)}/validar-identidade", json={"nota": "Conferi o documento com foto."}, headers=auth_headers)
    assert r.status_code == 400 and "encerrado" in r.json()["detail"].lower()
    db.refresh(a)
    assert a.status == ENCERRADO and a.identidade_validada_em is None


def test_validar_a_identidade_exige_a_permissao_da_fila(client, db, auth_headers):
    a = _pedido(client, db)
    url = f"{_url(a)}/validar-identidade"
    assert client.post(url, json={"nota": "Conferi o documento com foto."}).status_code == 401
    sem_permissao = _usuario(db, "projetos")
    assert client.post(url, json={"nota": "Conferi o documento com foto."}, headers=sem_permissao).status_code == 403
    com_permissao = _usuario(db, "atendimento")
    assert client.post(url, json={"nota": "Conferi o documento com foto."}, headers=com_permissao).status_code == 200


def test_pedido_antigo_sem_e_mail_nao_pode_receber_resposta_com_dado_pessoal(client, db, auth_headers):
    """Pedidos feitos antes da v5.7f podem ter só telefone: a resposta só é entregue pela Minha conta, que pede e-mail."""
    a = _pedido(client, db)
    a.email_contato = None
    a.telefone_whatsapp = "91988887777"
    db.commit()
    assert client.post(f"{_url(a)}/validar-identidade", json={"nota": "Conferi o documento com foto."}, headers=auth_headers).status_code == 200
    r = client.post(f"{_url(a)}/responder", json={"resposta": TEXTO_DA_RESPOSTA, "resultado": "ATENDIDO"}, headers=auth_headers)
    assert r.status_code == 400 and "Minha conta" in r.json()["detail"]
    assert client.post(f"{_url(a)}/encerrar", json={"motivo": "Pedido sem e-mail: a pessoa deve refazer."}, headers=auth_headers).status_code == 200


# ------------------------------------------------------------------------------------------------ 4. a resposta não vai por e-mail
def test_o_e_mail_do_titular_so_avisa_e_nao_leva_a_resposta(client, db, auth_headers, emails):
    cpf, email = _cpf_valido(), _email()
    _associado(db, cpf, email)
    a = _pedido(client, db, cpf=cpf, email_contato=email)
    emails.clear()  # descarta o e-mail de recebimento (outro teste confere o texto dele)
    r = client.post(f"{_url(a)}/responder", json={"resposta": TEXTO_DA_RESPOSTA, "resultado": "ATENDIDO"}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["resposta_enviada_por_email"] is True
    assert len(emails) == 1 and emails[0][0] == email
    _destino, assunto, corpo = emails[0]
    assert a.protocolo in assunto and a.protocolo in corpo
    assert "/minha-conta/" in corpo and "código" in corpo
    assert TEXTO_DA_RESPOSTA not in corpo and "trata o seu nome" not in corpo, "a resposta com dado pessoal nunca vai no e-mail"


def test_o_recebimento_do_titular_promete_a_minha_conta_e_nao_o_e_mail(client, db, emails):
    cpf, email = _cpf_valido(), _email()
    a = _pedido(client, db, cpf=cpf, email_contato=email)
    recebimento = [x for x in emails if x[0] == email]
    assert len(recebimento) == 1
    corpo = recebimento[0][2]
    assert a.protocolo in corpo and "Minha conta" in corpo and "não vai por e-mail" in corpo


def test_os_outros_tipos_continuam_recebendo_a_resposta_por_e_mail(client, db, auth_headers, emails):
    email = _email()
    protocolo = _enviar(client, "CONTATO", email_contato=email).json()["protocolo"]
    a = db.query(Atendimento).filter(Atendimento.protocolo == protocolo).one()
    emails.clear()
    assert client.post(f"{_url(a)}/responder", json={"resposta": "Funcionamos de segunda a sexta, das 8h às 17h."}, headers=auth_headers).status_code == 200
    assert len(emails) == 1 and "Funcionamos de segunda a sexta" in emails[0][2]


# ------------------------------------------------------------------------------------------------ 5. a resposta é lida na Minha conta
def _entrar_na_conta(client, emails, email: str) -> str:
    emails.clear()
    pedido = _pedir(client, email)
    assert pedido.status_code == 200
    r = _entrar(client, email, _codigo_enviado(emails))
    assert r.status_code == 200, r.text
    return r.json()["token"]


def test_a_resposta_aparece_na_minha_conta_so_para_o_e_mail_do_pedido(client, db, auth_headers, emails):
    cpf, email = _cpf_valido(), _email()
    _associado(db, cpf, email)
    a = _pedido(client, db, cpf=cpf, email_contato=email, subtipo="ACESSO")

    # o pedido abre a conta (sem inscrição nem doação): antes de responder, aparece sem resposta
    token = _entrar_na_conta(client, emails, email)
    antes = client.get("/api/visitante/minha-conta", headers=_cabecalho(token)).json()["pedidos_do_titular"]
    assert len(antes) == 1
    assert antes[0]["protocolo"] == a.protocolo and antes[0]["situacao"] != RESPONDIDO and antes[0]["resposta"] is None and antes[0]["respondido_em"] is None
    assert antes[0]["o_que_pediu"] and "Acessar os dados" in antes[0]["o_que_pediu"]
    assert set(antes[0]) == {
        "protocolo", "o_que_pediu", "situacao", "pedido_em", "prazo_em", "respondido_em", "resposta", "encerrado_em", "motivo_do_encerramento",
        "resultado", "fundamento",  # v7.2a
    }, "nunca o CPF nem o texto do pedido"
    assert antes[0]["encerrado_em"] is None and antes[0]["motivo_do_encerramento"] is None

    assert client.post(f"{_url(a)}/responder", json={"resposta": TEXTO_DA_RESPOSTA, "resultado": "ATENDIDO"}, headers=auth_headers).status_code == 200
    depois = client.get("/api/visitante/minha-conta", headers=_cabecalho(token)).json()["pedidos_do_titular"]
    assert depois[0]["resposta"] == TEXTO_DA_RESPOSTA and depois[0]["situacao"] == RESPONDIDO and depois[0]["respondido_em"] is not None

    # quem entrou com outro e-mail (mesmo com vínculo) não vê a resposta de outra pessoa, e quem não tem vínculo nem recebe código
    outro = _email()
    _pedido(client, db, email_contato=outro)  # um pedido DELE, que abre a conta dele
    token_outro = _entrar_na_conta(client, emails, outro)
    dele = client.get("/api/visitante/minha-conta", headers=_cabecalho(token_outro)).json()["pedidos_do_titular"]
    assert [p["protocolo"] for p in dele] != [a.protocolo] and a.protocolo not in str(dele) and TEXTO_DA_RESPOSTA not in str(dele)
    emails.clear()
    assert _pedir(client, _email()).status_code == 200 and emails == [], "sem vínculo, nenhum e-mail sai e a resposta é a mesma"


def test_o_pedido_do_titular_abre_a_conta_com_a_mesma_resposta_de_sempre(client, db, emails):
    com_pedido, sem_pedido = _email(), _email()
    _pedido(client, db, email_contato=com_pedido)
    emails.clear()
    r1, r2 = _pedir(client, com_pedido), _pedir(client, sem_pedido)
    assert r1.json() == r2.json(), "quem está de fora não descobre se há pedido ligado ao e-mail"
    assert [destino for destino, _a, _c in emails] == [com_pedido]


def test_a_resposta_nao_aparece_na_minha_conta_se_a_identidade_nao_estava_validada(client, db, emails):
    """Segunda trava: mesmo que um pedido chegue a 'Respondido' sem validação (dado antigo ou mexida no banco), o texto não é entregue."""
    email = _email()
    a = _pedido(client, db, email_contato=email)
    a.status = RESPONDIDO
    a.resposta = TEXTO_DA_RESPOSTA
    a.respondido_em = datetime.utcnow()
    db.commit()
    token = _entrar_na_conta(client, emails, email)
    itens = client.get("/api/visitante/minha-conta", headers=_cabecalho(token)).json()["pedidos_do_titular"]
    assert len(itens) == 1 and itens[0]["resposta"] is None and itens[0]["respondido_em"] is None


# ------------------------------------------------------------------------------------------------ 6. o que nasce dentro da Minha conta e a retenção
def test_o_pedido_aberto_dentro_da_minha_conta_nasce_validado_pelo_codigo(client, db, auth_headers, emails):
    email = _email()
    _pedido(client, db, email_contato=email)  # o que abre a conta
    token = _entrar_na_conta(client, emails, email)
    r = client.post("/api/visitante/pedir-apagamento", headers=_cabecalho(token))
    assert r.status_code == 200, r.text
    a = db.query(Atendimento).filter(Atendimento.protocolo == r.json()["protocolo"]).one()
    assert a.subtipo == "ELIMINACAO" and a.identidade_validacao == IDENTIDADE_CODIGO_NO_EMAIL and a.identidade_validada_em is not None
    # a equipe pode responder direto, e a resposta aparece na conta
    assert client.post(f"{_url(a)}/responder", json={"resposta": "Eliminamos o que a lei permite e guardamos os recibos.", "resultado": "ATENDIDO_EM_PARTE",
                                                    "fundamento": "ESCRITURACAO_FINANCEIRA"}, headers=auth_headers).status_code == 200
    itens = client.get("/api/visitante/minha-conta", headers=_cabecalho(token)).json()["pedidos_do_titular"]
    assert any(i["protocolo"] == a.protocolo and i["resposta"] for i in itens)
    registro = db.query(AuditLog).filter(AuditLog.acao == "VISITANTE_PEDIU_APAGAMENTO", AuditLog.id_registro_afetado == a.id_atendimento).one()
    assert IDENTIDADE_CODIGO_NO_EMAIL in str(registro.dados_depois)


def test_a_rotina_de_retencao_apaga_o_que_a_equipe_anotou_ao_validar(client, db, auth_headers):
    a = _pedido(client, db)
    assert client.post(f"{_url(a)}/validar-identidade", json={"nota": "Conferi o RG número 1234567 na secretaria."}, headers=auth_headers).status_code == 200
    assert client.post(f"{_url(a)}/responder", json={"resposta": TEXTO_DA_RESPOSTA, "resultado": "ATENDIDO"}, headers=auth_headers).status_code == 200
    db.refresh(a)
    a.respondido_em = datetime.utcnow() - timedelta(days=5 * 365 + 40)
    db.commit()
    retencao.aplicar_todas(db, agora=datetime.utcnow())
    db.refresh(a)
    assert a.identidade_nota is None and a.email_contato is None and a.cpf is None
    assert a.identidade_validacao == IDENTIDADE_MANUAL and a.identidade_validada_em is not None, "o fato de ter sido validada fica; o que foi conferido, não"


# ------------------------------------------------------------------------------------------------ 7. encerrar sem responder (por exemplo, identidade que não deu para validar)
def test_encerrar_a_solicitacao_do_titular_avisa_por_e_mail_sem_o_motivo_e_o_motivo_so_aparece_na_minha_conta(client, db, auth_headers, emails):
    email = _email()
    a = _pedido(client, db, email_contato=email)
    emails.clear()
    motivo = "Não conseguimos conferir a identidade de quem fez o pedido."
    r = client.post(f"{_url(a)}/encerrar", json={"motivo": motivo}, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert len(emails) == 1 and emails[0][0] == email
    _destino, assunto, corpo = emails[0]
    assert a.protocolo in assunto and a.protocolo in corpo and "/minha-conta/" in corpo
    assert motivo not in corpo, "o motivo é lido na Minha conta, como a resposta"
    token = _entrar_na_conta(client, emails, email)
    itens = client.get("/api/visitante/minha-conta", headers=_cabecalho(token)).json()["pedidos_do_titular"]
    assert len(itens) == 1
    assert itens[0]["situacao"] == "Encerrado" and itens[0]["motivo_do_encerramento"] == motivo and itens[0]["encerrado_em"] is not None
    assert itens[0]["resposta"] is None and itens[0]["respondido_em"] is None


def test_encerrar_os_outros_tipos_nao_manda_e_mail(client, db, auth_headers, emails):
    protocolo = _enviar(client, "CONTATO").json()["protocolo"]
    a = db.query(Atendimento).filter(Atendimento.protocolo == protocolo).one()
    emails.clear()
    assert client.post(f"{_url(a)}/encerrar", json={"motivo": "Assunto resolvido por telefone."}, headers=auth_headers).status_code == 200
    assert emails == []


# ------------------------------------------------------------------------------------------------ 8. o achado da conferência independente: o e-mail do cadastro de associado não pode vir de uma inscrição pública
def test_a_inscricao_publica_nao_escreve_o_e_mail_no_cadastro_de_associado_e_o_ataque_nao_valida(client, auth_headers, db):
    """Associado sem e-mail no cadastro (importação em lote, readmissão): quem digitava o CPF dele numa inscrição pública plantava o próprio e-mail no cadastro, e a solicitação do titular com esse
    e-mail nascia 'validada'. Agora a inscrição não escreve contato em quem é associado; e quem não é associado continua recebendo o contato que faltava."""
    cpf, atacante = _cpf_valido(), _email()
    pessoa = Pessoa(nome_completo="Associado Sem Email", cpf=cpf, email_contato=None)
    db.add(pessoa)
    db.flush()
    db.add(Associado(id_pessoa=pessoa.id_pessoa))
    db.commit()
    _inscrever_com_cpf(client, auth_headers, atacante, cpf, titulo=f"Evento do Atacante {uuid.uuid4().hex[:6]}")
    db.expire_all()
    assert db.query(Pessoa).filter(Pessoa.id_pessoa == pessoa.id_pessoa).one().email_contato is None, "a inscrição pública não escreve e-mail no cadastro de associado"
    a = _pedido(client, db, cpf=cpf, email_contato=atacante)
    assert a.identidade_validada_em is None, "o atacante só sabia o CPF: não nasce validado"

    # quem não é associado continua recebendo o contato que faltava (comportamento da v4.6, que a conta do visitante não usa como chave)
    cpf2, email2 = _cpf_valido(), _email()
    participante = Pessoa(nome_completo="Participante Sem Email", cpf=cpf2, email_contato=None)
    db.add(participante)
    db.commit()
    _inscrever_com_cpf(client, auth_headers, email2, cpf2, titulo=f"Evento do Participante {uuid.uuid4().hex[:6]}")
    db.expire_all()
    assert db.query(Pessoa).filter(Pessoa.id_pessoa == participante.id_pessoa).one().email_contato == email2


def test_e_mail_que_uma_inscricao_publica_da_propria_pessoa_digitou_nao_valida_sozinho(client, auth_headers, db):
    """Defesa em profundidade para o cadastro que já esteja assim: o e-mail do cadastro de associado igual ao digitado numa inscrição pública DELA vai para a conferência à mão."""
    cpf, email = _cpf_valido(), _email()
    pessoa = _associado(db, cpf, email)
    id_evento = _inscrever_com_cpf(client, auth_headers, _email(), _cpf_valido(), titulo=f"Evento Qualquer {uuid.uuid4().hex[:6]}")
    db.add(Inscricao(contexto_tipo="Evento", id_contexto=id_evento, id_pessoa=pessoa.id_pessoa, status="Confirmado", email_da_inscricao=email.upper()))
    db.commit()
    a = _pedido(client, db, cpf=cpf, email_contato=email)
    assert a.identidade_validada_em is None


# ------------------------------------------------------------------------------------------------ 9. encerrar depois de responder, e o motivo só quando foi escrito para a pessoa
def test_encerrar_depois_de_responder_nao_some_com_a_resposta_nem_manda_aviso_de_encerramento(client, db, auth_headers, emails):
    cpf, email = _cpf_valido(), _email()
    _associado(db, cpf, email)
    a = _pedido(client, db, cpf=cpf, email_contato=email)
    assert client.post(f"{_url(a)}/responder", json={"resposta": TEXTO_DA_RESPOSTA, "resultado": "ATENDIDO"}, headers=auth_headers).status_code == 200
    emails.clear()
    r = client.post(f"{_url(a)}/encerrar", json={"motivo": "Atendimento concluído e arquivado."}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["resposta_enviada_por_email"] is True, "o aviso da resposta não é apagado por quem encerra depois"
    assert emails == [], "quem já foi respondido não recebe aviso de encerramento"
    token = _entrar_na_conta(client, emails, email)
    itens = client.get("/api/visitante/minha-conta", headers=_cabecalho(token)).json()["pedidos_do_titular"]
    assert itens[0]["situacao"] == RESPONDIDO and itens[0]["resposta"] == TEXTO_DA_RESPOSTA
    assert itens[0]["motivo_do_encerramento"] is None and itens[0]["encerrado_em"] is None, "respondido e depois arquivado não vira 'encerrado sem resposta'"
    db.refresh(a)
    assert a.motivo_visivel_ao_titular is None


def test_o_motivo_de_encerramento_antigo_nao_aparece_e_o_novo_aparece(client, db, auth_headers, emails):
    email = _email()
    antigo = _pedido(client, db, email_contato=email, subtipo="ACESSO")
    antigo.status = ENCERRADO
    antigo.motivo_encerramento = "Nota interna escrita antes de saber que a pessoa lê isto: o CPF dela é de outra pessoa."
    antigo.encerrado_em = datetime.utcnow()
    db.commit()  # `motivo_visivel_ao_titular` fica vazio, como em todo pedido de antes da v5.7f
    novo = _pedido(client, db, email_contato=email, subtipo="CORRECAO")
    assert client.post(f"{_url(novo)}/encerrar", json={"motivo": "Não conseguimos conferir a identidade de quem fez o pedido."}, headers=auth_headers).status_code == 200
    token = _entrar_na_conta(client, emails, email)
    itens = {i["protocolo"]: i for i in client.get("/api/visitante/minha-conta", headers=_cabecalho(token)).json()["pedidos_do_titular"]}
    assert itens[antigo.protocolo]["situacao"] == ENCERRADO and itens[antigo.protocolo]["motivo_do_encerramento"] is None
    assert "Nota interna" not in str(itens)
    assert itens[novo.protocolo]["motivo_do_encerramento"] == "Não conseguimos conferir a identidade de quem fez o pedido."


def test_o_aviso_de_encerramento_do_titular_fica_registrado_se_saiu_ou_nao(client, db, auth_headers, emails, monkeypatch):
    saiu = _pedido(client, db, email_contato=_email())
    emails.clear()
    assert client.post(f"{_url(saiu)}/encerrar", json={"motivo": "Não conseguimos conferir a identidade."}, headers=auth_headers).json()["resposta_enviada_por_email"] is True
    assert len(emails) == 1

    def falha(destino, assunto, corpo_texto):
        raise RuntimeError("SMTP fora do ar")

    monkeypatch.setattr(servico.notificacoes, "enviar_email", falha)
    nao_saiu = _pedido(client, db, email_contato=_email())
    r = client.post(f"{_url(nao_saiu)}/encerrar", json={"motivo": "Não conseguimos conferir a identidade."}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["resposta_enviada_por_email"] is False, "a equipe vê que a pessoa não foi avisada"
