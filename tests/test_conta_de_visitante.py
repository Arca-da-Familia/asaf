"""v5.6b - conta de visitante: entrar com o e-mail e um código de uso único (sem senha) e consultar inscrições, certificados e doações pelo site.

As promessas que estes testes travam:
  0. o vínculo é o e-mail DIGITADO na inscrição pelo site (`Inscricao.email_da_inscricao`), nunca o do cadastro da pessoa: quem sabe só o CPF de outra pessoa (a deduplicação por CPF grava o e-mail de
     quem se inscreveu no cadastro dela) não entra na conta dela; quem se inscreve com outro e-mail entra com o que digitou; inscrição da secretaria não abre conta;
  1. quem pede o código recebe a MESMA resposta exista ou não algo ligado ao e-mail (nenhum e-mail sai e nada é gravado para quem não tem vínculo); o 4º pedido do mesmo e-mail na hora é recusado
     para qualquer e-mail, e o limite por IP vale;
  2. o código tem 6 números, uso único, 5 tentativas, 10 minutos; erro, vencimento e ausência dão a mesma mensagem; novo pedido invalida o anterior; o banco só guarda impressões (nunca o código nem
     o token da sessão);
  3. a sessão é curta (60 minutos), encerra ao sair e NÃO abre nenhuma rota do painel (nem o contrário): o token do painel não vale na área do visitante e o do visitante não vale no painel;
  4. a área mostra só o que está ligado àquele e-mail: inscrições (o evento encerrado continua lá, inativo; o link secreto só sai quando há o que fazer), certificados (crachá não) e doações (antes da
     confirmação da tesouraria não há valor recebido nem recibo), sem CPF, telefone nem dado de outra pessoa;
  5. o pedido de apagamento abre UM pedido de titular (eliminação) na fila de atendimento, com o e-mail provado pelo código, e a Auditoria guarda o fato sem o e-mail;
  6. o código só volta na resposta na homologação (variável própria E ambiente sem e-mail): com SMTP configurado a variável não faz nada, e nenhuma publicação de produção a define."""
import re
import uuid
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException

from app.models.atendimento import NOVO, TITULAR_LGPD, Atendimento
from app.models.conta_de_visitante import CodigoDeVisitante, SessaoDeVisitante
from app.models.core import AuditLog
from app.models.eventos import Evento
from app.models.intencoes_de_doacao import IntencaoDeDoacao
from app.models.motores import DocumentoEmitido, Inscricao, TemplateDocumento
from app.models.pessoas import Pessoa
from app.services import conta_de_visitante as servico
from tests.test_atendimento import _ip
from tests.test_doacao_online import _confirmar, _contas, _doar, _id_da_intencao, emails, pix  # noqa: F401  (as fixtures `emails` e `pix`)
from tests.test_eventos_inscricao_publica import _criar_evento_publico, _ip_de_teste, _payload_inscricao
from tests.test_pessoas import _cpf_unico


def _email() -> str:
    return f"visitante.{uuid.uuid4().hex[:12]}@example.com"


def _inscrever(client, auth_headers, email: str, **evento) -> tuple[int, dict]:
    id_evento = _criar_evento_publico(client, auth_headers, **evento)
    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao(email=email), headers=_ip_de_teste())
    assert r.status_code == 200, r.text
    return id_evento, r.json()


def _pedir(client, email: str, ip: str | None = None, **extra):
    return client.post("/api/publico/visitante/codigo", json={"email": email, **extra}, headers={"X-Forwarded-For": ip or _ip()})


def _codigo_enviado(emails_enviados: list) -> str:
    assert emails_enviados, "deveria ter saído um e-mail com o código"
    achado = re.search(r"é: (\d{6})", emails_enviados[-1][2])
    assert achado, emails_enviados[-1][2]
    return achado.group(1)


def _entrar(client, email: str, codigo: str, ip: str | None = None):
    return client.post("/api/publico/visitante/entrar", json={"email": email, "codigo": codigo}, headers={"X-Forwarded-For": ip or _ip()})


def _sessao(client, auth_headers, emails_enviados: list, email: str | None = None, **evento) -> tuple[str, str]:
    """Um visitante com uma inscrição, já dentro da área: (e-mail, token da sessão)."""
    email = email or _email()
    _inscrever(client, auth_headers, email, **evento)
    emails_enviados.clear()
    assert _pedir(client, email).status_code == 200
    r = _entrar(client, email, _codigo_enviado(emails_enviados))
    assert r.status_code == 200, r.text
    return email, r.json()["token"]


def _cabecalho(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ------------------------------------------------------------------------------------------------ 1. pedir o código
def test_pedir_o_codigo_manda_um_e_mail_so_para_quem_tem_vinculo_e_a_resposta_e_a_mesma(client, auth_headers, db, emails):
    com_vinculo, sem_vinculo = _email(), _email()
    _inscrever(client, auth_headers, com_vinculo)
    emails.clear()

    r1, r2 = _pedir(client, com_vinculo), _pedir(client, sem_vinculo)
    assert r1.status_code == r2.status_code == 200
    assert r1.json() == r2.json() and set(r1.json()) == {"mensagem", "minutos_de_validade"}, "quem está de fora não descobre se há vínculo"
    assert [destino for destino, _a, _c in emails] == [com_vinculo], "só quem tem vínculo recebe e-mail"
    assert re.fullmatch(r"\d{6}", _codigo_enviado(emails))
    assert db.query(CodigoDeVisitante).filter(CodigoDeVisitante.email == com_vinculo).count() == 1
    assert db.query(CodigoDeVisitante).filter(CodigoDeVisitante.email == sem_vinculo).count() == 0, "para quem não tem vínculo não se grava nada"


def test_o_e_mail_e_conferido_sem_ligar_para_maiusculas_e_espacos(client, auth_headers, emails):
    email = _email()
    _inscrever(client, auth_headers, email)
    emails.clear()
    assert _pedir(client, f"  {email.upper()} ").status_code == 200
    assert [destino for destino, _a, _c in emails] == [email]


def test_e_mail_com_erro_de_escrita_e_recusado_em_portugues(client):
    r = _pedir(client, "isto-nao-e-email")
    assert r.status_code == 422 and "e-mail" in r.text


def test_o_quarto_pedido_do_mesmo_e_mail_na_hora_e_recusado_para_qualquer_e_mail(client, auth_headers, emails):
    com_vinculo, sem_vinculo = _email(), _email()
    _inscrever(client, auth_headers, com_vinculo)
    for email in (com_vinculo, sem_vinculo):
        for _ in range(servico.PEDIDOS_DE_CODIGO_POR_EMAIL_NA_HORA):
            assert _pedir(client, email).status_code == 200
        assert _pedir(client, email).status_code == 429, "o limite conta o PEDIDO, igual para quem tem ou não vínculo"


def test_o_limite_por_ip_vale(client):
    ip = _ip()
    for _ in range(servico.PEDIDOS_DE_CODIGO_POR_IP_NA_HORA):
        assert _pedir(client, _email(), ip=ip).status_code == 200
    assert _pedir(client, _email(), ip=ip).status_code == 429


def test_a_armadilha_de_robo_finge_sucesso_sem_fazer_nada(client, auth_headers, db, emails):
    email = _email()
    _inscrever(client, auth_headers, email)
    emails.clear()
    r = _pedir(client, email, pagina_web="http://spam.example")
    assert r.status_code == 200 and not emails
    assert db.query(CodigoDeVisitante).filter(CodigoDeVisitante.email == email).count() == 0


def test_o_banco_guarda_so_a_impressao_do_codigo_e_da_sessao(client, auth_headers, db, emails):
    email, token = _sessao(client, auth_headers, emails)
    codigo = db.query(CodigoDeVisitante).filter(CodigoDeVisitante.email == email).one()
    assert len(codigo.codigo_hash) == 64 and not re.fullmatch(r"\d{6}", codigo.codigo_hash)
    sessao = db.query(SessaoDeVisitante).filter(SessaoDeVisitante.email == email).one()
    assert len(sessao.token_hash) == 64 and sessao.token_hash != token and token not in sessao.token_hash


# ------------------------------------------------------------------------------------------------ 2. o código
def test_o_codigo_serve_uma_vez_so(client, auth_headers, emails):
    email = _email()
    _inscrever(client, auth_headers, email)
    emails.clear()
    _pedir(client, email)
    codigo = _codigo_enviado(emails)
    assert _entrar(client, email, codigo).status_code == 200
    r = _entrar(client, email, codigo)
    assert r.status_code == 400 and r.json()["detail"] == servico.MENSAGEM_DO_CODIGO_INVALIDO


def test_pedir_um_codigo_novo_invalida_o_anterior(client, auth_headers, emails):
    email = _email()
    _inscrever(client, auth_headers, email)
    emails.clear()
    _pedir(client, email)
    antigo = _codigo_enviado(emails)
    _pedir(client, email)
    novo = _codigo_enviado(emails)
    assert _entrar(client, email, antigo).status_code == (400 if antigo != novo else 200)
    assert _entrar(client, email, novo).status_code == 200


def test_cinco_erros_queimam_o_codigo_mesmo_para_quem_acerta_depois(client, auth_headers, emails):
    email = _email()
    _inscrever(client, auth_headers, email)
    emails.clear()
    _pedir(client, email)
    certo = _codigo_enviado(emails)
    errado = "000000" if certo != "000000" else "111111"
    for _ in range(servico.TENTATIVAS_POR_CODIGO):
        assert _entrar(client, email, errado).status_code == 400
    r = _entrar(client, email, certo)
    assert r.status_code == 400 and r.json()["detail"] == servico.MENSAGEM_DO_CODIGO_INVALIDO


def test_erro_vencimento_e_ausencia_dao_a_mesma_resposta(client, auth_headers, db, emails):
    email = _email()
    _inscrever(client, auth_headers, email)
    emails.clear()
    _pedir(client, email)
    certo = _codigo_enviado(emails)
    sem_codigo = _entrar(client, _email(), "123456")
    errado = _entrar(client, email, "000000" if certo != "000000" else "111111")
    assert sem_codigo.status_code == errado.status_code == 400 and sem_codigo.json() == errado.json()

    with pytest.raises(HTTPException) as vencido:
        servico.entrar(db, email=email, codigo=certo, ip=_ip(), agora=datetime.utcnow() + timedelta(minutes=servico.MINUTOS_DE_VALIDADE_DO_CODIGO + 1))
    assert vencido.value.detail == servico.MENSAGEM_DO_CODIGO_INVALIDO


def test_o_codigo_aceita_espaco_e_hifen_do_que_a_pessoa_copiou(client, auth_headers, emails):
    email = _email()
    _inscrever(client, auth_headers, email)
    emails.clear()
    _pedir(client, email)
    codigo = _codigo_enviado(emails)
    assert _entrar(client, email, f" {codigo[:3]}-{codigo[3:]} ").status_code == 200


def test_o_limite_de_entradas_por_ip_vale(client):
    ip = _ip()
    for _ in range(servico.ENTRADAS_POR_IP_EM_15_MINUTOS):
        assert _entrar(client, _email(), "123456", ip=ip).status_code == 400
    assert _entrar(client, _email(), "123456", ip=ip).status_code == 429


# ------------------------------------------------------------------------------------------------ 3. a sessão
def test_sem_sessao_ou_com_sessao_inventada_a_area_recusa(client):
    assert client.get("/api/visitante/minha-conta").status_code == 401
    assert client.get("/api/visitante/minha-conta", headers=_cabecalho("inventado")).status_code == 401
    assert client.get("/api/visitante/minha-conta", headers={"Authorization": "Basic abc"}).status_code == 401
    assert client.post("/api/visitante/sair").status_code == 401
    assert client.post("/api/visitante/pedir-apagamento").status_code == 401


def test_a_sessao_acaba_em_60_minutos(client, auth_headers, db, emails):
    _email_, token = _sessao(client, auth_headers, emails)
    assert client.get("/api/visitante/minha-conta", headers=_cabecalho(token)).status_code == 200
    sessao = db.query(SessaoDeVisitante).filter(SessaoDeVisitante.email == _email_).one()
    assert sessao.expira_em - sessao.criado_em == timedelta(minutes=servico.MINUTOS_DA_SESSAO) == timedelta(minutes=60)
    with pytest.raises(HTTPException) as vencida:
        servico.sessao_valida(db, token, agora=sessao.expira_em + timedelta(seconds=1))
    assert vencida.value.status_code == 401


def test_sair_encerra_a_sessao(client, auth_headers, emails):
    _email_, token = _sessao(client, auth_headers, emails)
    assert client.post("/api/visitante/sair", headers=_cabecalho(token)).status_code == 200
    assert client.get("/api/visitante/minha-conta", headers=_cabecalho(token)).status_code == 401


def test_o_token_do_painel_nao_abre_a_area_do_visitante_e_o_do_visitante_nao_abre_o_painel(client, auth_headers, emails):
    _email_, token = _sessao(client, auth_headers, emails)
    assert client.get("/api/visitante/minha-conta", headers=auth_headers).status_code == 401
    for rota in ("/api/associados/", "/api/atendimentos/", "/api/intencoes-doacao/", "/api/eventos/"):
        assert client.get(rota, headers=_cabecalho(token)).status_code in (401, 403), rota


# ------------------------------------------------------------------------------------------------ 4. o que a área mostra
def test_a_area_mostra_a_inscricao_sem_cpf_telefone_nem_dado_de_outra_pessoa(client, auth_headers, db, emails):
    email, token = _sessao(client, auth_headers, emails, titulo=f"Palestra da Conta {uuid.uuid4().hex[:6]}")
    outro = _email()
    _inscrever(client, auth_headers, outro)

    r = client.get("/api/visitante/minha-conta", headers=_cabecalho(token))
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["email"] == email and len(corpo["inscricoes"]) == 1 and corpo["certificados"] == [] and corpo["doacoes"] == [] and corpo["pedido_de_apagamento"] is None
    inscricao = corpo["inscricoes"][0]
    assert inscricao["evento"]["titulo"].startswith("Palestra da Conta") and inscricao["pode_cancelar"] is True and inscricao["token"] and inscricao["codigo_checkin"]
    assert inscricao["primeiro_nome"] == "Participante"
    texto = r.text
    pessoa = db.query(Pessoa).filter(Pessoa.email_contato == email).one()
    assert pessoa.cpf not in texto and "11988887777" not in texto and outro not in texto and "Externo" not in texto, "nada além do primeiro nome, sem CPF nem telefone"


def test_o_evento_encerrado_continua_na_lista_inativo_e_sem_link_para_cancelar(client, auth_headers, db, emails):
    email = _email()
    id_evento, _ = _inscrever(client, auth_headers, email)
    evento = db.query(Evento).filter(Evento.id_evento == id_evento).one()
    evento.data_hora_inicio = datetime.utcnow() - timedelta(days=30)
    evento.data_hora_fim = datetime.utcnow() - timedelta(days=30, hours=-2)
    db.commit()
    emails.clear()
    _pedir(client, email)
    token = _entrar(client, email, _codigo_enviado(emails)).json()["token"]

    inscricao = client.get("/api/visitante/minha-conta", headers=_cabecalho(token)).json()["inscricoes"][0]
    assert inscricao["evento_encerrado"] is True and inscricao["pode_cancelar"] is False and inscricao["token"] is None
    assert inscricao["evento"]["titulo"], "o evento encerrado não é apagado: continua consultável"


def test_a_inscricao_cancelada_continua_na_lista(client, auth_headers, db, emails):
    email = _email()
    _inscrever(client, auth_headers, email)
    inscricao = db.query(Inscricao).filter(Inscricao.email_da_inscricao == email).one()
    inscricao.status = "Cancelado"
    db.commit()
    emails.clear()
    _pedir(client, email)
    token = _entrar(client, email, _codigo_enviado(emails)).json()["token"]
    itens = client.get("/api/visitante/minha-conta", headers=_cabecalho(token)).json()["inscricoes"]
    assert len(itens) == 1 and itens[0]["status"] == "Cancelado" and itens[0]["token"] is None


def test_os_certificados_aparecem_com_o_codigo_de_verificacao_e_o_cracha_nao(client, auth_headers, db, emails):
    email, token = _sessao(client, auth_headers, emails, titulo=f"Curso do Certificado {uuid.uuid4().hex[:6]}")
    inscricao = db.query(Inscricao).filter(Inscricao.email_da_inscricao == email).one()
    template = TemplateDocumento(codigo=f"t-{uuid.uuid4().hex[:8]}", nome="Certificado de participação", corpo_texto="x")
    db.add(template)
    db.flush()
    codigo = uuid.uuid4().hex[:16].upper()
    db.add(DocumentoEmitido(
        id_template=template.id_template, numero_sequencial=900_000 + uuid.uuid4().int % 90_000, contexto_tipo="Evento", id_contexto=inscricao.id_contexto,
        id_pessoa=inscricao.id_pessoa, caminho_arquivo=f"/uploads/documentos/{codigo}.pdf", codigo_verificacao=codigo,
    ))
    db.add(DocumentoEmitido(
        id_template=template.id_template, numero_sequencial=800_000 + uuid.uuid4().int % 90_000, contexto_tipo="Evento", id_contexto=inscricao.id_contexto,
        id_pessoa=inscricao.id_pessoa, caminho_arquivo="/uploads/documentos/cracha.pdf", codigo_verificacao=None,
    ))
    db.commit()

    certificados = client.get("/api/visitante/minha-conta", headers=_cabecalho(token)).json()["certificados"]
    assert len(certificados) == 1, "o crachá não é certificado"
    assert certificados[0]["codigo_verificacao"] == codigo and certificados[0]["arquivo"] == f"/uploads/documentos/{codigo}.pdf"
    assert certificados[0]["tipo_documento"] == "Certificado de participação" and certificados[0]["atividade"].startswith("Curso do Certificado")


def test_a_doacao_so_tem_valor_e_recibo_depois_que_a_tesouraria_confirma(client, auth_headers, db, pix, emails, exercicio_financeiro_aberto):  # noqa: F811
    email = _email()
    protocolo_pendente = _doar(client, email=email, valor=30).json()["protocolo"]
    protocolo_confirmado = _doar(client, email=email, valor=50).json()["protocolo"]
    receita, caixa = _contas(client, auth_headers)
    assert _confirmar(client, auth_headers, _id_da_intencao(db, protocolo_confirmado), receita, caixa, valor=45).status_code == 200
    emails.clear()
    assert _pedir(client, email).status_code == 200
    token = _entrar(client, email, _codigo_enviado(emails)).json()["token"]

    doacoes = {d["protocolo"]: d for d in client.get("/api/visitante/minha-conta", headers=_cabecalho(token)).json()["doacoes"]}
    assert set(doacoes) == {protocolo_pendente, protocolo_confirmado}
    pendente, confirmado = doacoes[protocolo_pendente], doacoes[protocolo_confirmado]
    assert pendente["situacao"] == "PENDENTE" and pendente["valor_recebido"] is None and pendente["numero_do_recibo"] is None, "intenção não é dinheiro"
    assert confirmado["situacao"] == "CONFIRMADA" and confirmado["valor_recebido"] == 45 and confirmado["numero_do_recibo"] is not None


def test_so_se_ve_o_que_e_do_proprio_e_mail(client, auth_headers, db, pix, emails):  # noqa: F811
    meu, dele = _email(), _email()
    _doar(client, email=meu, valor=10)
    protocolo_dele = _doar(client, email=dele, valor=20).json()["protocolo"]
    emails.clear()
    _pedir(client, meu)
    token = _entrar(client, meu, _codigo_enviado(emails)).json()["token"]
    doacoes = client.get("/api/visitante/minha-conta", headers=_cabecalho(token)).json()["doacoes"]
    assert len(doacoes) == 1 and doacoes[0]["protocolo"] != protocolo_dele


# ------------------------------------------------------------------------------------------------ 5. o pedido de apagamento
def test_pedir_o_apagamento_abre_um_pedido_de_titular_na_fila_e_nao_apaga_nada(client, auth_headers, db, emails):
    email, token = _sessao(client, auth_headers, emails)
    emails.clear()

    r = client.post("/api/visitante/pedir-apagamento", headers=_cabecalho(token))
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["protocolo"].startswith("ASAF-") and corpo["prazo_dias"] == 15 and corpo["ja_existia"] is False

    atendimento = db.query(Atendimento).filter(Atendimento.protocolo == corpo["protocolo"]).one()
    assert atendimento.tipo == TITULAR_LGPD and atendimento.subtipo == "ELIMINACAO" and atendimento.email_contato == email and atendimento.status == NOVO
    assert "confirmado por código" in atendimento.mensagem and "recibos" in atendimento.mensagem
    assert [destino for destino, _a, _c in emails] == [email], "a pessoa recebe a confirmação com o protocolo"
    assert db.query(Inscricao).filter(Inscricao.email_da_inscricao == email).count() == 1, "o pedido não apaga nada sozinho"

    de_novo = client.post("/api/visitante/pedir-apagamento", headers=_cabecalho(token)).json()
    assert de_novo["protocolo"] == corpo["protocolo"] and de_novo["ja_existia"] is True, "um pedido só, não vários"
    assert db.query(Atendimento).filter(Atendimento.email_contato == email, Atendimento.tipo == TITULAR_LGPD).count() == 1

    conta = client.get("/api/visitante/minha-conta", headers=_cabecalho(token)).json()
    assert conta["pedido_de_apagamento"]["protocolo"] == corpo["protocolo"]

    entrada = db.query(AuditLog).filter(AuditLog.acao == "VISITANTE_PEDIU_APAGAMENTO", AuditLog.id_registro_afetado == atendimento.id_atendimento).one()
    assert entrada.id_usuario is None and email not in (entrada.dados_depois or "") and email not in (entrada.dados_antes or "")


def test_a_auditoria_da_entrada_guarda_o_fato_sem_o_e_mail(client, auth_headers, db, emails):
    email, _token = _sessao(client, auth_headers, emails)
    entradas = db.query(AuditLog).filter(AuditLog.acao == "VISITANTE_ENTROU").order_by(AuditLog.id_log.desc()).limit(5).all()
    assert entradas and all(e.id_usuario is None and email not in (e.dados_depois or "") for e in entradas)


# ------------------------------------------------------------------------------------------------ 6. o código na resposta (só homologação)
def test_o_codigo_volta_na_resposta_so_com_a_variavel_e_sem_e_mail_configurado(client, auth_headers, monkeypatch, emails):
    email = _email()
    _inscrever(client, auth_headers, email)
    for var in ("SMTP_HOST", "SMTP_USUARIO", "SMTP_SENHA"):
        monkeypatch.delenv(var, raising=False)

    monkeypatch.delenv("VISITANTE_CODIGO_NA_RESPOSTA", raising=False)
    assert "codigo_de_teste" not in _pedir(client, email).json(), "sem a variável, nunca"

    monkeypatch.setenv("VISITANTE_CODIGO_NA_RESPOSTA", "1")
    com = _pedir(client, email).json()
    assert re.fullmatch(r"\d{6}", com["codigo_de_teste"]) and _entrar(client, email, com["codigo_de_teste"]).status_code == 200
    assert "codigo_de_teste" not in _pedir(client, _email()).json(), "para quem não tem vínculo a resposta continua igual"


def test_com_e_mail_configurado_a_variavel_nao_faz_nada(client, auth_headers, monkeypatch, emails):
    email = _email()
    _inscrever(client, auth_headers, email)
    monkeypatch.setenv("VISITANTE_CODIGO_NA_RESPOSTA", "1")
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("SMTP_USUARIO", "usuario")
    monkeypatch.setenv("SMTP_SENHA", "senha")
    assert "codigo_de_teste" not in _pedir(client, email).json(), "produção tem e-mail configurado: a variável, mesmo copiada para lá, é inofensiva"


def test_so_a_publicacao_da_homologacao_define_a_variavel_do_codigo_de_teste():
    from pathlib import Path

    raiz = Path(__file__).resolve().parent.parent
    com_a_variavel = {p.name for p in (raiz / ".github" / "workflows").glob("*.yml") if "VISITANTE_CODIGO_NA_RESPOSTA" in p.read_text(encoding="utf-8")}
    assert com_a_variavel == {"deploy-homologacao.yml"}, com_a_variavel
    for pasta in ("infra", "scripts"):
        for arquivo in (raiz / pasta).rglob("*"):
            if arquivo.is_file() and arquivo.suffix in {".sh", ".json", ".bicep", ".yml", ".yaml", ".py"}:
                assert "VISITANTE_CODIGO_NA_RESPOSTA" not in arquivo.read_text(encoding="utf-8", errors="ignore"), arquivo


def test_o_e_mail_do_codigo_nao_mostra_nada_alem_do_codigo_e_dos_prazos(client, auth_headers, emails):
    email = _email()
    _inscrever(client, auth_headers, email)
    emails.clear()
    _pedir(client, email)
    destino, assunto, corpo = emails[-1]
    assert destino == email and "código" in assunto.lower() and "10 minutos" in corpo and "só pode ser usado uma vez" in corpo
    assert "Participante" not in corpo, "o e-mail do código não traz nome nem dado do cadastro"


# ------------------------------------------------------------------------------------------------ 0. o vínculo é o e-mail DIGITADO na inscrição
def _inscrever_com_cpf(client, auth_headers, email: str, cpf: str, **evento) -> int:
    id_evento = _criar_evento_publico(client, auth_headers, **evento)
    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao(email=email, cpf=cpf), headers=_ip_de_teste())
    assert r.status_code == 200, r.text
    return id_evento


def test_quem_sabe_so_o_cpf_de_outra_pessoa_nao_entra_na_conta_dela(client, auth_headers, db, emails):
    """O achado da conferência independente: a deduplicação por CPF grava o e-mail de quem se inscreveu no cadastro de uma pessoa que não tinha e-mail. Com o e-mail do cadastro como chave, o
    atacante veria as inscrições, os links de cancelar e os certificados da vítima. Com o e-mail DIGITADO na inscrição, vê só a inscrição que ele mesmo fez."""
    cpf = _cpf_unico()
    evento_da_secretaria = _criar_evento_publico(client, auth_headers, titulo=f"Evento da Secretaria {uuid.uuid4().hex[:6]}")  # antes de abrir escrita na sessão do teste (SQLite trava)
    vitima = Pessoa(nome_completo="Vitima Silva Santos", cpf=cpf, email_contato=None)
    db.add(vitima)
    db.flush()
    db.add(Inscricao(contexto_tipo="Evento", id_contexto=evento_da_secretaria, id_pessoa=vitima.id_pessoa, status="Confirmado"))
    template = TemplateDocumento(codigo=f"t-{uuid.uuid4().hex[:8]}", nome="Certificado de participação", corpo_texto="x")
    db.add(template)
    db.flush()
    codigo = uuid.uuid4().hex[:16].upper()
    db.add(DocumentoEmitido(
        id_template=template.id_template, numero_sequencial=700_000 + uuid.uuid4().int % 90_000, contexto_tipo="Evento", id_contexto=evento_da_secretaria,
        id_pessoa=vitima.id_pessoa, caminho_arquivo=f"/uploads/documentos/{codigo}.pdf", codigo_verificacao=codigo,
    ))
    db.commit()

    atacante = _email()
    _inscrever_com_cpf(client, auth_headers, atacante, cpf, titulo=f"Evento do Atacante {uuid.uuid4().hex[:6]}")
    db.expire_all()
    assert db.query(Pessoa).filter(Pessoa.id_pessoa == vitima.id_pessoa).one().email_contato == atacante, "a condição do ataque é real: o cadastro dela agora traz o e-mail dele"

    emails.clear()
    assert _pedir(client, atacante).status_code == 200
    token = _entrar(client, atacante, _codigo_enviado(emails)).json()["token"]
    conta = client.get("/api/visitante/minha-conta", headers=_cabecalho(token)).json()
    assert len(conta["inscricoes"]) == 1 and conta["inscricoes"][0]["evento"]["titulo"].startswith("Evento do Atacante"), "só a inscrição que ele mesmo fez"
    assert conta["certificados"] == [], "o certificado dela, de outro evento, não aparece"
    assert "Evento da Secretaria" not in client.get("/api/visitante/minha-conta", headers=_cabecalho(token)).text


def test_quem_se_inscreve_com_outro_e_mail_entra_com_o_que_digitou(client, auth_headers, db, emails):
    cpf = _cpf_unico()
    a, b = _email(), _email()
    _inscrever_com_cpf(client, auth_headers, a, cpf, titulo=f"Primeiro Evento {uuid.uuid4().hex[:6]}")
    _inscrever_com_cpf(client, auth_headers, b, cpf, titulo=f"Segundo Evento {uuid.uuid4().hex[:6]}")
    assert db.query(Pessoa).filter(Pessoa.cpf == cpf).one().email_contato == a, "o cadastro mantém o primeiro e-mail"

    for email, esperado in ((b, "Segundo Evento"), (a, "Primeiro Evento")):
        emails.clear()
        assert _pedir(client, email).status_code == 200
        token = _entrar(client, email, _codigo_enviado(emails)).json()["token"]
        titulos = [i["evento"]["titulo"] for i in client.get("/api/visitante/minha-conta", headers=_cabecalho(token)).json()["inscricoes"]]
        assert len(titulos) == 1 and titulos[0].startswith(esperado), f"{email} vê só a inscrição feita com ele"


def test_inscricao_feita_pela_secretaria_nao_abre_conta(client, auth_headers, db, emails):
    email = _email()
    id_evento = _criar_evento_publico(client, auth_headers)
    pessoa = Pessoa(nome_completo="Pessoa da Secretaria", cpf=_cpf_unico(), email_contato=email)
    db.add(pessoa)
    db.flush()
    db.add(Inscricao(contexto_tipo="Evento", id_contexto=id_evento, id_pessoa=pessoa.id_pessoa, status="Confirmado"))
    db.commit()
    emails.clear()
    r = _pedir(client, email)
    assert r.status_code == 200 and not emails, "sem e-mail digitado na inscrição pelo site não há vínculo, e a resposta é a de sempre"
    assert db.query(CodigoDeVisitante).filter(CodigoDeVisitante.email == email).count() == 0


def test_a_inscricao_pelo_site_grava_o_e_mail_digitado_em_minusculas(client, auth_headers, db):
    email = f"Visitante.{uuid.uuid4().hex[:8]}@Example.com"
    _inscrever(client, auth_headers, email)
    inscricao = db.query(Inscricao).filter(Inscricao.email_da_inscricao == email.strip().lower()).one()
    assert inscricao.email_da_inscricao == inscricao.email_da_inscricao.lower()


# ------------------------------------------------------------------------------------------------ 2b. a contagem de tentativas é atômica
def test_a_contagem_de_tentativas_soma_no_banco_e_nao_regrava_leitura_velha(client, auth_headers, db, emails):
    """O achado da conferência independente: `tentativas += 1` gravava o valor absoluto, e pedidos em paralelo (todos leram 0) gravavam todos 1 e conferiam todos o código. Agora o banco soma."""
    from app.database import SessaoLocal

    email = _email()
    _inscrever(client, auth_headers, email)
    emails.clear()
    _pedir(client, email)
    certo = _codigo_enviado(emails)
    errado = "111111" if certo == "000000" else "000000"
    registro = db.query(CodigoDeVisitante).filter(CodigoDeVisitante.email == email).one()
    assert registro.tentativas == 0  # leitura "velha": a sessão do teste guarda 0

    outra = SessaoLocal()  # outra requisição, ao mesmo tempo, que já gastou 3 tentativas
    try:
        for _ in range(3):
            with pytest.raises(HTTPException):
                servico.entrar(outra, email=email, codigo=errado, ip=_ip())
    finally:
        outra.close()

    with pytest.raises(HTTPException):
        servico.entrar(db, email=email, codigo=errado, ip=_ip())
    db.expire_all()
    assert db.query(CodigoDeVisitante).filter(CodigoDeVisitante.email == email).one().tentativas == 4, "soma no banco: 3 + 1, não 1"

    with pytest.raises(HTTPException):
        servico.entrar(db, email=email, codigo=errado, ip=_ip())
    with pytest.raises(HTTPException):
        servico.entrar(db, email=email, codigo=errado, ip=_ip())
    with pytest.raises(HTTPException):
        servico.entrar(db, email=email, codigo=certo, ip=_ip())  # a 6ª tentativa nem confere o código certo
    db.expire_all()
    assert db.query(CodigoDeVisitante).filter(CodigoDeVisitante.email == email).one().tentativas == servico.TENTATIVAS_POR_CODIGO == 5, "nunca passa de 5"


# ------------------------------------------------------------------------------------------------ 7. a limpeza
def test_a_rotina_de_retencao_varre_codigo_e_sessao_velhos_e_deixa_os_recentes(client, auth_headers, db, emails):
    from app.models.protecao_publica import TentativaAcessoPublico
    from app.services import retencao

    velho, _token_velho = _sessao(client, auth_headers, emails)
    recente, token_recente = _sessao(client, auth_headers, emails)
    antes = datetime.utcnow() - timedelta(days=2)
    db.query(CodigoDeVisitante).filter(CodigoDeVisitante.email == velho).update({"criado_em": antes, "expira_em": antes + timedelta(minutes=10)})
    db.query(SessaoDeVisitante).filter(SessaoDeVisitante.email == velho).update({"criado_em": antes, "expira_em": antes + timedelta(minutes=60)})
    rota_velha, rota_nova = f"visitante-pedir-codigo-do-email-{uuid.uuid4().hex[:6]}", f"visitante-entrar-{uuid.uuid4().hex[:6]}"
    db.add_all([TentativaAcessoPublico(ip="visitante-email:velho", rota=rota_velha, criado_em=antes), TentativaAcessoPublico(ip="visitante-email:novo", rota=rota_nova)])
    db.commit()

    resultado = retencao.aplicar_todas(db)
    assert resultado["falhas"] == [] and resultado["limpeza_tecnica"]["conta_de_visitante"] >= 3
    assert db.query(CodigoDeVisitante).filter(CodigoDeVisitante.email == velho).count() == 0
    assert db.query(SessaoDeVisitante).filter(SessaoDeVisitante.email == velho).count() == 0
    assert db.query(TentativaAcessoPublico).filter(TentativaAcessoPublico.rota == rota_velha).count() == 0
    assert db.query(TentativaAcessoPublico).filter(TentativaAcessoPublico.rota == rota_nova).count() == 1
    assert db.query(CodigoDeVisitante).filter(CodigoDeVisitante.email == recente).count() == 1
    assert client.get("/api/visitante/minha-conta", headers=_cabecalho(token_recente)).status_code == 200, "a sessão recente segue valendo"
    assert retencao.aplicar_todas(db)["limpeza_tecnica"]["conta_de_visitante"] == 0, "rodar de novo não faz nada"
