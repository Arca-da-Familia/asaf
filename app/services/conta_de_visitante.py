"""v5.6b (FASE 5) - conta de visitante: o código por e-mail, a sessão curta e o que a área mostra (ver app/models/conta_de_visitante.py).

Regras que não mudam:
  - O que o servidor responde ao pedir um código é IDÊNTICO para um e-mail com vínculo e para um sem: quem está de fora não descobre se alguém se inscreveu ou doou com aquele endereço. O código só
    é gerado e enviado quando existe algo ligado ao e-mail: uma inscrição em evento FEITA PELO SITE COM ESSE E-MAIL DIGITADO (nunca o e-mail do cadastro da pessoa, que a deduplicação por CPF pode ter
    preenchido com o de outra pessoa) ou um pedido de doação pelo site; o certificado aparece junto da inscrição que o originou. Para os outros, nada é gravado nem enviado.
  - O limite de pedidos por e-mail conta o PEDIDO (e guarda só uma impressão do endereço, nunca o endereço), não a existência de vínculo: o 4º pedido é recusado para qualquer e-mail.
  - O código tem 6 dígitos, vale 10 minutos, aceita 5 tentativas e morre no primeiro uso certo. Cada erro, vencimento ou ausência de código dá a MESMA resposta.
  - A área só LÊ. O que dá para fazer nela (cancelar ou confirmar uma inscrição) continua passando pelo link secreto da v5.5c; o apagamento vira um pedido de titular na fila de atendimento (a
    pessoa não apaga dado sozinha, porque recibo e registro contábil a lei manda guardar: quem atende decide o que sai e o que fica)."""
import hashlib
import hmac
import logging
import os
import re
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import textos_de_privacidade
from app.models.atendimento import ENCERRADO, EM_ATENDIMENTO, IDENTIDADE_CODIGO_NO_EMAIL, NOVO, RESPONDIDO, TITULAR_LGPD, Atendimento
from app.models.conta_de_visitante import CodigoDeVisitante, SessaoDeVisitante
from app.models.doacoes import CampanhaArrecadacao, Doacao
from app.models.eventos import Evento
from app.models.intencoes_de_doacao import CONFIRMADA, IntencaoDeDoacao
from app.models.motores import DocumentoEmitido, Inscricao, TemplateDocumento
from app.models.pessoas import Pessoa
from app import security
from app.services import armazenamento
from app.services import atendimento as atendimentos
from app.services import inscricao as servico_de_inscricao
from app.services import notificacoes
from app.services.protecao_publica import limitar_taxa_por_ip
from app.services.status_do_evento import evento_do_contexto

LOG = logging.getLogger("asaf.conta_de_visitante")

DIGITOS_DO_CODIGO = 6
MINUTOS_DE_VALIDADE_DO_CODIGO = 10
TENTATIVAS_POR_CODIGO = 5
MINUTOS_DA_SESSAO = 60
PEDIDOS_DE_CODIGO_POR_EMAIL_NA_HORA = 3
PEDIDOS_DE_CODIGO_POR_IP_NA_HORA = 10
ENTRADAS_POR_IP_EM_15_MINUTOS = 20
VERSAO_AVISO_DE_PRIVACIDADE_VISITANTE = textos_de_privacidade.versao_atual("VISITANTE")  # o texto exato de cada versão: app/textos_de_privacidade.py
MENSAGEM_DO_CODIGO_INVALIDO = "Código inválido ou vencido: confira os números ou peça um novo código."
MENSAGEM_DO_PEDIDO = (
    "Se houver inscrição em evento, pedido de doação ou solicitação do titular de dados feitos pelo site com este e-mail, tentamos enviar um código de 6 números. Ele vale por 10 minutos e só pode ser usado uma vez. "
    "Se não chegar em alguns minutos, olhe também a caixa de spam."
)

_SO_DIGITOS = re.compile(r"\D")


def normalizar_email(email: str) -> str:
    return (email or "").strip().lower()


def codigo_de_teste_na_resposta() -> bool:
    """SÓ para a homologação: o robô não lê e-mail (a API de teste nem tem SMTP), então ali, e somente ali, o código volta na resposta do pedido. Dupla trava: precisa da variável
    `VISITANTE_CODIGO_NA_RESPOSTA=1` (que só a publicação da homologação define) E o ambiente NÃO pode ter e-mail configurado. A produção tem e-mail configurado: mesmo que alguém
    copiasse a variável para lá, ela não faz nada."""
    return os.environ.get("VISITANTE_CODIGO_NA_RESPOSTA") == "1" and not notificacoes.smtp_configurado()


def _impressao_do_codigo(email: str, codigo: str) -> str:
    security._checar_jwt_secret_configurado()  # o segredo do servidor é a chave da impressão: sem ele, nada de código (500 de configuração, não 400 do usuário)
    return hmac.new(security.JWT_SECRET.encode("utf-8"), f"visitante|{email}|{codigo}".encode("utf-8"), hashlib.sha256).hexdigest()


def _impressao_da_sessao(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _impressao_do_email(email: str) -> str:
    return "visitante-email:" + hashlib.sha256(email.encode("utf-8")).hexdigest()[:24]


# ------------------------------------------------------------------------------------------------ o que está ligado a um e-mail
def _inscricoes_do_email(db: Session, email: str, so_uma: bool = False) -> list[Inscricao]:
    """As inscrições em evento feitas pelo site com este e-mail DIGITADO (`Inscricao.email_da_inscricao`). Nunca o e-mail do cadastro da pessoa: a deduplicação por CPF grava o e-mail de quem se
    inscreveu no cadastro de outra pessoa que não tinha e-mail, e quem soubesse o CPF dela entraria na conta dela."""
    consulta = db.query(Inscricao).filter(Inscricao.email_da_inscricao == email, Inscricao.contexto_tipo.in_(("Evento", "SessaoEvento")))
    return consulta.limit(1).all() if so_uma else consulta.all()


def _pedidos_do_titular_do_email(db: Session, email: str) -> list[Atendimento]:
    """As solicitações do titular de dados (LGPD) feitas com este e-mail DIGITADO (v5.7f): é por aqui, e só aqui, que a resposta com dado pessoal é entregue."""
    return (
        db.query(Atendimento)
        .filter(Atendimento.tipo == TITULAR_LGPD, func.lower(Atendimento.email_contato) == email)
        .order_by(Atendimento.criado_em.desc(), Atendimento.id_atendimento.desc())
        .all()
    )


def email_tem_vinculo(db: Session, email: str) -> bool:
    """Existe algo para mostrar? Uma inscrição em evento feita pelo site COM ESTE E-MAIL (o certificado só aparece junto de uma inscrição assim), um pedido de doação pelo site com ele ou uma
    solicitação do titular de dados feita com ele (a resposta é lida aqui, v5.7f)."""
    if _inscricoes_do_email(db, email, so_uma=True):
        return True
    if db.query(IntencaoDeDoacao.id_intencao).filter(func.lower(IntencaoDeDoacao.email_doador) == email).first() is not None:
        return True
    return db.query(Atendimento.id_atendimento).filter(Atendimento.tipo == TITULAR_LGPD, func.lower(Atendimento.email_contato) == email).first() is not None


# ------------------------------------------------------------------------------------------------ pedir o código
def pedir_codigo(db: Session, *, email: str, ip: str, agora: Optional[datetime] = None) -> Optional[str]:
    """Aplica os limites e, só se o e-mail tem vínculo, grava a impressão de um código novo (o anterior deixa de valer) e o devolve em claro para quem chamou o enviar por e-mail.
    Devolve `None` quando não há vínculo. Nunca diz a quem pede qual dos dois casos aconteceu."""
    agora = agora or datetime.utcnow()
    email = normalizar_email(email)
    limitar_taxa_por_ip(db, ip=ip, rota="visitante-pedir-codigo", limite=PEDIDOS_DE_CODIGO_POR_IP_NA_HORA, janela_minutos=60)
    limitar_taxa_por_ip(db, ip=_impressao_do_email(email), rota="visitante-pedir-codigo-do-email", limite=PEDIDOS_DE_CODIGO_POR_EMAIL_NA_HORA, janela_minutos=60)
    if not email_tem_vinculo(db, email):
        return None
    db.query(CodigoDeVisitante).filter(CodigoDeVisitante.email == email, CodigoDeVisitante.usado_em.is_(None)).update({"usado_em": agora}, synchronize_session=False)
    codigo = "".join(secrets.choice("0123456789") for _ in range(DIGITOS_DO_CODIGO))
    db.add(CodigoDeVisitante(
        email=email, codigo_hash=_impressao_do_codigo(email, codigo), criado_em=agora, expira_em=agora + timedelta(minutes=MINUTOS_DE_VALIDADE_DO_CODIGO),
    ))
    db.commit()
    return codigo


def enviar_codigo_por_email(email: str, codigo: str) -> bool:
    """Melhor esforço (SMTP fora do ar ou não configurado não derruba nada: a pessoa pede de novo). Nunca registra o código no log."""
    texto = (
        "Olá!\n\n"
        f"Seu código para entrar na área do visitante da ASAF é: {codigo}\n\n"
        f"Ele vale por {MINUTOS_DE_VALIDADE_DO_CODIGO} minutos e só pode ser usado uma vez. Se não foi você quem pediu, ignore esta mensagem: ninguém entra sem este código.\n\n"
        "ASAF - Associação Arca da Família\n"
    )
    try:
        notificacoes.enviar_email(email, assunto="Seu código de acesso - ASAF", corpo_texto=texto)
        return True
    except Exception:
        LOG.warning("não foi possível enviar o código de acesso do visitante por e-mail")
        return False


# ------------------------------------------------------------------------------------------------ entrar
def entrar(db: Session, *, email: str, codigo: str, ip: str, agora: Optional[datetime] = None) -> tuple[str, datetime]:
    """Confere o código e abre a sessão. Devolve (token da sessão em claro, quando ela acaba). Qualquer falha dá a mesma mensagem."""
    agora = agora or datetime.utcnow()
    email = normalizar_email(email)
    limitar_taxa_por_ip(db, ip=ip, rota="visitante-entrar", limite=ENTRADAS_POR_IP_EM_15_MINUTOS, janela_minutos=15)
    codigo = _SO_DIGITOS.sub("", codigo or "")
    registro = (
        db.query(CodigoDeVisitante)
        .filter(CodigoDeVisitante.email == email, CodigoDeVisitante.usado_em.is_(None), CodigoDeVisitante.expira_em > agora)
        .order_by(CodigoDeVisitante.criado_em.desc(), CodigoDeVisitante.id_codigo.desc())
        .first()
    )
    if registro is None or registro.tentativas >= TENTATIVAS_POR_CODIGO:
        raise HTTPException(status_code=400, detail=MENSAGEM_DO_CODIGO_INVALIDO)
    # a tentativa é contada ANTES de conferir e de forma ATÔMICA (`tentativas = tentativas + 1` no banco, só enquanto restar tentativa): pedidos em paralelo não ganham tentativas extras,
    # porque cada um precisa conseguir uma das cinco vagas para poder conferir o código
    contou = (
        db.query(CodigoDeVisitante)
        .filter(CodigoDeVisitante.id_codigo == registro.id_codigo, CodigoDeVisitante.usado_em.is_(None), CodigoDeVisitante.tentativas < TENTATIVAS_POR_CODIGO)
        .update({CodigoDeVisitante.tentativas: CodigoDeVisitante.tentativas + 1}, synchronize_session=False)
    )
    db.commit()
    if contou != 1:
        raise HTTPException(status_code=400, detail=MENSAGEM_DO_CODIGO_INVALIDO)
    if len(codigo) != DIGITOS_DO_CODIGO or not hmac.compare_digest(registro.codigo_hash, _impressao_do_codigo(email, codigo)):
        raise HTTPException(status_code=400, detail=MENSAGEM_DO_CODIGO_INVALIDO)
    # uso único de verdade, mesmo com dois pedidos ao mesmo tempo: só um consegue passar `usado_em` de vazio para preenchido
    gasto = db.query(CodigoDeVisitante).filter(CodigoDeVisitante.id_codigo == registro.id_codigo, CodigoDeVisitante.usado_em.is_(None)).update({"usado_em": agora}, synchronize_session=False)
    if gasto != 1:
        db.rollback()
        raise HTTPException(status_code=400, detail=MENSAGEM_DO_CODIGO_INVALIDO)
    token = secrets.token_urlsafe(32)
    expira_em = agora + timedelta(minutes=MINUTOS_DA_SESSAO)
    db.add(SessaoDeVisitante(email=email, token_hash=_impressao_da_sessao(token), criado_em=agora, expira_em=expira_em))
    db.commit()
    return token, expira_em


def sessao_valida(db: Session, token: Optional[str], agora: Optional[datetime] = None) -> SessaoDeVisitante:
    agora = agora or datetime.utcnow()
    if not token:
        raise HTTPException(status_code=401, detail="Entre com o seu e-mail para ver esta página.")
    sessao = db.query(SessaoDeVisitante).filter(SessaoDeVisitante.token_hash == _impressao_da_sessao(token)).first()
    if sessao is None or sessao.encerrada_em is not None or sessao.expira_em <= agora:
        raise HTTPException(status_code=401, detail="A sua sessão acabou: peça um novo código para entrar.")
    return sessao


def sair(db: Session, sessao: SessaoDeVisitante, agora: Optional[datetime] = None) -> None:
    sessao.encerrada_em = agora or datetime.utcnow()
    db.commit()


# ------------------------------------------------------------------------------------------------ o que a área mostra
def _primeiro_nome(pessoa: Optional[Pessoa]) -> Optional[str]:
    return pessoa.nome_completo.split()[0] if pessoa and pessoa.nome_completo else None


def minhas_inscricoes(db: Session, email: str) -> list[dict]:
    itens = []
    for inscricao in _inscricoes_do_email(db, email):
        resumo = servico_de_inscricao.resumo_publico_da_inscricao(db, inscricao)
        # o link secreto (cancelar ou confirmar) só sai quando há o que fazer com ele
        resumo["token"] = inscricao.token_cancelamento if (resumo["pode_cancelar"] or resumo["pode_confirmar"]) else None
        resumo["inscrito_em"] = inscricao.data_inscricao
        itens.append(resumo)
    return sorted(itens, key=lambda i: (i["evento"]["data_hora_inicio"] is not None, i["evento"]["data_hora_inicio"] or datetime.min), reverse=True)


def _e_arquivo_publico(caminho: Optional[str]) -> bool:
    """O PDF só é oferecido se o endereço guardado é de uma pasta pública do armazenamento (nunca um caminho qualquer)."""
    alvo = armazenamento.separar_url(caminho)
    return alvo is not None and alvo[0] in armazenamento.PASTAS


def meus_certificados(db: Session, email: str) -> list[dict]:
    """Só o certificado de quem se inscreveu NAQUELE evento com este e-mail (a pessoa e o evento têm de coincidir com uma inscrição dele): o certificado de outro evento da mesma pessoa não aparece."""
    pares = set()
    for inscricao in _inscricoes_do_email(db, email):
        evento = evento_do_contexto(db, inscricao.contexto_tipo, inscricao.id_contexto)
        if evento is not None:
            pares.add((inscricao.id_pessoa, evento.id_evento))
    ids = {id_pessoa for id_pessoa, _ in pares}
    if not ids:
        return []
    linhas = (
        db.query(DocumentoEmitido, TemplateDocumento, Pessoa)
        .join(TemplateDocumento, TemplateDocumento.id_template == DocumentoEmitido.id_template)
        .join(Pessoa, Pessoa.id_pessoa == DocumentoEmitido.id_pessoa)
        .filter(DocumentoEmitido.id_pessoa.in_(ids), DocumentoEmitido.codigo_verificacao.isnot(None))
        .order_by(DocumentoEmitido.emitida_em.desc(), DocumentoEmitido.id_documento.desc())
        .all()
    )
    itens = []
    for documento, template, pessoa in linhas:
        if documento.contexto_tipo != "Evento" or (documento.id_pessoa, documento.id_contexto) not in pares:
            continue
        evento = db.query(Evento).filter(Evento.id_evento == documento.id_contexto).first() if documento.contexto_tipo == "Evento" and documento.id_contexto else None
        itens.append({
            "tipo_documento": template.nome, "atividade": evento.titulo if evento else None, "primeiro_nome": _primeiro_nome(pessoa), "emitida_em": documento.emitida_em,
            "codigo_verificacao": documento.codigo_verificacao,
            "arquivo": documento.caminho_arquivo if _e_arquivo_publico(documento.caminho_arquivo) else None,
        })
    return itens


def minhas_doacoes(db: Session, email: str) -> list[dict]:
    linhas = (
        db.query(IntencaoDeDoacao).filter(func.lower(IntencaoDeDoacao.email_doador) == email).order_by(IntencaoDeDoacao.criado_em.desc(), IntencaoDeDoacao.id_intencao.desc()).all()
    )
    itens = []
    for intencao in linhas:
        campanha = db.query(CampanhaArrecadacao.titulo).filter(CampanhaArrecadacao.id_campanha == intencao.id_campanha).first() if intencao.id_campanha else None
        doacao = db.query(Doacao).filter(Doacao.id_doacao == intencao.id_doacao).first() if intencao.id_doacao else None
        confirmada = intencao.status == CONFIRMADA and doacao is not None
        itens.append({
            "protocolo": intencao.protocolo, "situacao": intencao.status, "pedida_em": intencao.criado_em, "valor_informado": intencao.valor_informado,
            "campanha": campanha[0] if campanha else None, "expira_em": intencao.expira_em,
            # só a confirmação da tesouraria vira dinheiro: antes disso não há valor recebido nem recibo
            "valor_recebido": doacao.valor if confirmada else None, "data_da_doacao": doacao.data_doacao if confirmada else None,
            "numero_do_recibo": doacao.numero_recibo if confirmada else None, "recibo_enviado_por_email": intencao.recibo_enviado_por_email if confirmada else None,
        })
    return itens


def _pedido_de_apagamento_aberto(db: Session, email: str) -> Optional[Atendimento]:
    return (
        db.query(Atendimento)
        .filter(
            Atendimento.tipo == TITULAR_LGPD, Atendimento.subtipo == "ELIMINACAO", Atendimento.chave_remetente == atendimentos.chave_do_remetente(None, email, None),
            Atendimento.status.in_([NOVO, EM_ATENDIMENTO]),
        )
        .order_by(Atendimento.id_atendimento.desc())
        .first()
    )


def meus_pedidos_do_titular(db: Session, email: str) -> list[dict]:
    """As solicitações do titular de dados feitas com este e-mail e a resposta da equipe (v5.7f). A resposta só aparece quando o pedido foi respondido E a identidade tinha sido validada (o servidor
    já recusa responder sem isso; aqui é a segunda trava). Nunca o CPF nem o texto do pedido."""
    itens = []
    for a in _pedidos_do_titular_do_email(db, email):
        # a resposta fica na conta mesmo que o pedido tenha sido encerrado depois de respondido (encerrar é o último passo de quem atende)
        entregue = a.resposta is not None and a.respondido_em is not None and a.identidade_validada_em is not None
        sem_resposta_e_encerrado = a.status == ENCERRADO and a.respondido_em is None
        itens.append({
            "protocolo": a.protocolo, "o_que_pediu": atendimentos.ROTULOS_DO_SUBTIPO_LGPD.get(a.subtipo or ""), "situacao": RESPONDIDO if a.respondido_em is not None else a.status,
            "pedido_em": a.criado_em, "prazo_em": a.prazo_em,
            "respondido_em": a.respondido_em if entregue else None, "resposta": a.resposta if entregue else None,
            # o pedido encerrado SEM resposta (por exemplo, sem a identidade validada) mostra o motivo, mas só o que foi escrito já sabendo que a pessoa o lê (o de antes da v5.7f era nota interna)
            "encerrado_em": a.encerrado_em if sem_resposta_e_encerrado else None,
            "motivo_do_encerramento": a.motivo_encerramento if sem_resposta_e_encerrado and a.motivo_visivel_ao_titular else None,
        })
    return itens


def minha_conta(db: Session, sessao: SessaoDeVisitante) -> dict:
    email = sessao.email
    pedido = _pedido_de_apagamento_aberto(db, email)
    return {
        "email": email, "sessao_expira_em": sessao.expira_em,
        "inscricoes": minhas_inscricoes(db, email), "certificados": meus_certificados(db, email), "doacoes": minhas_doacoes(db, email),
        "pedidos_do_titular": meus_pedidos_do_titular(db, email),
        "pedido_de_apagamento": {"protocolo": pedido.protocolo, "prazo_em": pedido.prazo_em, "status": pedido.status} if pedido else None,
    }


# ------------------------------------------------------------------------------------------------ pedir o apagamento
def pedir_apagamento(db: Session, sessao: SessaoDeVisitante, agora: Optional[datetime] = None) -> tuple[Atendimento, bool]:
    """Abre (ou devolve o que já está aberto) um pedido de titular de eliminação na fila de atendimento. O e-mail já foi provado pelo código; quem atende decide o que sai e o que a lei manda
    guardar. Devolve (atendimento, novo)."""
    agora = agora or datetime.utcnow()
    aberto = _pedido_de_apagamento_aberto(db, sessao.email)
    if aberto is not None:
        return aberto, False
    primeira = _inscricoes_do_email(db, sessao.email, so_uma=True)
    pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == primeira[0].id_pessoa).first() if primeira else None
    doador = db.query(IntencaoDeDoacao.nome_doador).filter(func.lower(IntencaoDeDoacao.email_doador) == sessao.email).order_by(IntencaoDeDoacao.id_intencao).first()
    nome = (pessoa.nome_completo if pessoa and pessoa.nome_completo else None) or (doador[0] if doador else None) or "Titular do e-mail informado"
    mensagem = (
        f"Pedido feito pela área do visitante do site, com o e-mail {sessao.email} confirmado por código de uso único em {agora:%d/%m/%Y %H:%M} (UTC). "
        "A pessoa pede a eliminação dos dados pessoais ligados a este e-mail: inscrições em eventos, certificados e pedidos de doação feitos pelo site. "
        "Manter apenas o que a lei obriga a guardar (recibos e registros contábeis)."
    )
    atendimento, novo = atendimentos.registrar_pelo_site(
        db, tipo=TITULAR_LGPD, subtipo="ELIMINACAO", assunto="Eliminação de dados pela área do visitante", mensagem=mensagem, nome_completo=nome, email=sessao.email,
        telefone=None, cpf=None, versao_do_aviso=VERSAO_AVISO_DE_PRIVACIDADE_VISITANTE, agora=agora, identidade=IDENTIDADE_CODIGO_NO_EMAIL,
    )
    return atendimento, novo


# ------------------------------------------------------------------------------------------------ limpeza
def limpar_vencidos(db: Session, agora: Optional[datetime] = None) -> int:
    """Varre o resíduo técnico: códigos e sessões com mais de 1 dia (eles valem minutos) e o contador de pedidos por e-mail, que guarda só uma impressão do endereço. Chamada pela rotina de retenção.
    Devolve quantas linhas apagou."""
    from app.models.protecao_publica import TentativaAcessoPublico

    limite = (agora or datetime.utcnow()) - timedelta(days=1)
    total = db.query(CodigoDeVisitante).filter(CodigoDeVisitante.criado_em < limite).delete(synchronize_session=False)
    total += db.query(SessaoDeVisitante).filter(SessaoDeVisitante.criado_em < limite).delete(synchronize_session=False)
    total += db.query(TentativaAcessoPublico).filter(TentativaAcessoPublico.rota.like("visitante-%"), TentativaAcessoPublico.criado_em < limite).delete(synchronize_session=False)
    db.commit()
    return total
