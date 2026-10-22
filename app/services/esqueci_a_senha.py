"""Esqueci a minha senha (pedido do Presidente em 21/10: "manda um e-mail com um código, ele coloca o código e troca a senha"). Mesmas regras do código da conta de visitante (v5.6b),
já provadas, mais as da conferência independente desta função:
  - a resposta ao pedido é IDÊNTICA exista ou não uma conta com aquele CPF, no conteúdo E no tempo: a requisição só aplica os limites (iguais para todos); procurar a conta, gerar o
    código e mandar o e-mail acontecem DEPOIS da resposta. O código vai só para quem tem acesso ativo, ao e-mail de login (o que a secretaria cadastrou em "Conceder acesso"; sem ele,
    o e-mail de contato do cadastro);
  - limites: por IP e por CPF (guardado só como impressão), contando o PEDIDO; por conta, no máximo `CODIGOS_POR_CONTA_NO_DIA` códigos e `FALHAS_POR_CONTA_NO_DIA` tentativas em
    24 h, somando todos os códigos (pedir um código novo não dá palpites novos; passou disso, nada sai por 24 h e a Auditoria registra); no sistema todo, no máximo
    `CODIGOS_NO_SISTEMA_NO_DIA` e-mails de código por dia (ninguém esgota a cota diária do Google, que os outros e-mails da ASAF usam);
  - o código tem 6 dígitos, vale 10 minutos, aceita 5 tentativas (contadas antes de conferir, de forma atômica) e morre no primeiro uso certo; qualquer erro dá a mesma mensagem;
  - trocar a senha por aqui, numa transação só: gasta o código, grava a senha, deixa de ser provisória, tira o bloqueio por senha errada, encerra as sessões (nenhuma renova; o acesso
    já aberto vale no máximo `ACCESS_TOKEN_MINUTOS`) e registra na Auditoria (sem o e-mail). O segundo passo (MFA) continua exigido no próximo login: o código troca a senha, não entra
    no painel;
  - quem tem a conta recebe um aviso por e-mail de que a senha foi trocada (se não foi ela, procura a secretaria);
  - na homologação (sem servidor de e-mail), o código volta na resposta SÓ para conta fora do cofre e sem nenhuma permissão do sistema (a do associado que o robô cria): os
    CPFs das contas de teste do cofre estão publicados no repositório, e devolver o código delas deixaria qualquer um trocar a senha do Presidente de teste."""
import hashlib
import hmac
import logging
import re
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import security
from app.auditoria import registrar_auditoria
from app.models.associados import Associado
from app.models.core import AuditLog, PermissaoSistema, TokenAcesso, Usuario
from app.models.nova_senha import CodigoDeNovaSenha
from app.services import comunicacao, notificacoes
from app.services.protecao_publica import limitar_taxa_por_ip

LOG = logging.getLogger("asaf.esqueci_a_senha")

DIGITOS_DO_CODIGO = 6
MINUTOS_DE_VALIDADE_DO_CODIGO = 10
TENTATIVAS_POR_CODIGO = 5
PEDIDOS_POR_CPF_NA_HORA = 3
PEDIDOS_POR_IP_NA_HORA = 10
TROCAS_POR_IP_EM_15_MINUTOS = 20
CODIGOS_POR_CONTA_NO_DIA = 6
FALHAS_POR_CONTA_NO_DIA = 10
CODIGOS_NO_SISTEMA_NO_DIA = 300

# as contas de teste do cofre na homologação (os papéis do `popular_homologacao.py`; os CPFs delas estão no repositório): o código delas nunca volta na resposta, nem se o
# mandato de teste acabar e a conta ficar sem permissão (ver `pode_mostrar_o_codigo_de_teste`; `scripts/hml_contas_do_cofre_definitivas.py` usa a mesma lista)
SUFIXO_DAS_CONTAS_DE_TESTE = "homologacao.example.com"
PAPEIS_DO_COFRE = (
    "secretario", "tesoureiro", "cargo_presidente", "vice_presidente", "vice_presidente_2", "vice_tesoureiro", "conselheiro", "conselheiro_2", "conselheiro_3",
)
EMAILS_DO_COFRE = frozenset(f"{papel}@{SUFIXO_DAS_CONTAS_DE_TESTE}" for papel in PAPEIS_DO_COFRE)

MENSAGEM_DO_PEDIDO = (
    f"Se este CPF tiver acesso ao painel, enviamos um código de {DIGITOS_DO_CODIGO} números para o e-mail cadastrado. Ele vale {MINUTOS_DE_VALIDADE_DO_CODIGO} minutos. "
    "Se não chegar, confira a caixa de spam ou procure a secretaria da ASAF."
)
MENSAGEM_DO_CODIGO_INVALIDO = "Código inválido ou vencido: confira os números ou peça um novo código."
_SO_DIGITOS = re.compile(r"\D")


def _impressao(texto: str) -> str:
    security._checar_jwt_secret_configurado()
    return hmac.new(security.JWT_SECRET.encode("utf-8"), texto.encode("utf-8"), hashlib.sha256).hexdigest()


def _impressao_do_codigo(id_usuario: int, codigo: str) -> str:
    return _impressao(f"nova-senha|{id_usuario}|{codigo}")


def _usuario_do_cpf(db: Session, cpf: str) -> tuple[Optional[Usuario], Optional[Associado]]:
    if len(cpf) != 11:
        return None, None
    associado = db.query(Associado).filter(Associado.cpf == cpf).first()
    if associado is None or associado.id_usuario is None:
        return None, associado
    usuario = db.query(Usuario).filter(Usuario.id_usuario == associado.id_usuario).first()
    return (usuario if usuario is not None and usuario.ativo else None), associado


def _email_da_conta(usuario: Usuario, associado: Optional[Associado]) -> Optional[str]:
    return comunicacao.email_valido(usuario.email) or comunicacao.email_valido(associado.email_contato if associado else None)


def _tentativas_nas_ultimas_24h(db: Session, id_usuario: int, agora: datetime) -> int:
    """As tentativas de todos os códigos da conta nas últimas 24 h (cada tentativa é contada antes de conferir; a certa gasta o código)."""
    return int(
        db.query(func.coalesce(func.sum(CodigoDeNovaSenha.tentativas), 0))
        .filter(CodigoDeNovaSenha.id_usuario == id_usuario, CodigoDeNovaSenha.criado_em > agora - timedelta(hours=24))
        .scalar()
    )


def limitar_pedido(db: Session, *, cpf: str, ip: str) -> str:
    """O que a requisição faz, igual para todo CPF: os limites por IP e por CPF. Devolve o CPF só com os dígitos."""
    cpf = _SO_DIGITOS.sub("", cpf or "")
    limitar_taxa_por_ip(db, ip=ip, rota="nova-senha-pedir", limite=PEDIDOS_POR_IP_NA_HORA, janela_minutos=60)
    limitar_taxa_por_ip(db, ip="nova-senha-cpf:" + _impressao(f"cpf|{cpf}")[:32], rota="nova-senha-pedir-do-cpf", limite=PEDIDOS_POR_CPF_NA_HORA, janela_minutos=60)
    return cpf


def gerar_codigo(db: Session, *, cpf: str, agora: Optional[datetime] = None) -> Optional[tuple[str, str, Usuario]]:
    """Só se o CPF tem acesso ativo, um e-mail que o servidor aceita e não passou dos tetos: grava a impressão de um código novo (o anterior deixa de valer). Devolve (código em
    claro, e-mail, usuário) ou `None`."""
    agora = agora or datetime.utcnow()
    usuario, associado = _usuario_do_cpf(db, cpf)
    if usuario is None:
        return None
    email = _email_da_conta(usuario, associado)
    if email is None:
        return None
    if db.query(CodigoDeNovaSenha.id_codigo).filter(CodigoDeNovaSenha.criado_em > agora - timedelta(hours=24)).count() >= CODIGOS_NO_SISTEMA_NO_DIA:
        LOG.error("o teto diário de códigos de troca de senha do sistema foi atingido: nenhum código sai até a janela de 24 h andar")
        return None
    codigos_da_conta = (
        db.query(CodigoDeNovaSenha.id_codigo)
        .filter(CodigoDeNovaSenha.id_usuario == usuario.id_usuario, CodigoDeNovaSenha.criado_em > agora - timedelta(hours=24)).count()
    )
    if codigos_da_conta >= CODIGOS_POR_CONTA_NO_DIA or _tentativas_nas_ultimas_24h(db, usuario.id_usuario, agora) >= FALHAS_POR_CONTA_NO_DIA:
        ja_registrado = (
            db.query(AuditLog.id_log)
            .filter(AuditLog.acao == "NOVA_SENHA_TRAVADA_NO_DIA", AuditLog.id_registro_afetado == usuario.id_usuario, AuditLog.timestamp > agora - timedelta(hours=24))
            .first()
        )
        if ja_registrado is None:
            registrar_auditoria(
                db, None, "usuarios", "NOVA_SENHA_TRAVADA_NO_DIA", id_registro_afetado=usuario.id_usuario,
                dados_depois={"codigos_no_dia": codigos_da_conta, "teto_de_codigos": CODIGOS_POR_CONTA_NO_DIA, "teto_de_tentativas": FALHAS_POR_CONTA_NO_DIA},
            )
        return None
    db.query(CodigoDeNovaSenha).filter(CodigoDeNovaSenha.id_usuario == usuario.id_usuario, CodigoDeNovaSenha.usado_em.is_(None)).update(
        {"usado_em": agora}, synchronize_session=False,
    )
    codigo = "".join(secrets.choice("0123456789") for _ in range(DIGITOS_DO_CODIGO))
    db.add(CodigoDeNovaSenha(
        id_usuario=usuario.id_usuario, codigo_hash=_impressao_do_codigo(usuario.id_usuario, codigo), criado_em=agora,
        expira_em=agora + timedelta(minutes=MINUTOS_DE_VALIDADE_DO_CODIGO),
    ))
    db.commit()
    return codigo, email, usuario


def gerar_e_enviar(cpf: str) -> None:
    """O que sai DEPOIS da resposta (o tempo dela não diz se o CPF tem conta): procura a conta, gera o código e manda o e-mail. Sessão própria do banco."""
    from app.database import SessaoLocal

    db = SessaoLocal()
    try:
        gerado = gerar_codigo(db, cpf=cpf)
        if gerado is not None:
            codigo, email, _usuario = gerado
            enviar_codigo(email, codigo)
    except Exception as erro:  # noqa: BLE001 - depois da resposta não há a quem devolver o erro: fica no log, só o TIPO (o texto de um erro do banco traria o CPF da consulta)
        db.rollback()
        LOG.error("não foi possível gerar o código para trocar a senha: %s", type(erro).__name__)
    finally:
        db.close()


def pode_mostrar_o_codigo_de_teste(db: Session, usuario: Usuario) -> bool:
    """Na homologação, o código só volta na resposta para conta que NÃO é do cofre e não tem NENHUMA permissão do sistema (nem pelo nível, nem por cargo): a do associado
    que o robô cria."""
    if (usuario.email or "").lower() in EMAILS_DO_COFRE:
        return False
    codigos = [c for (c,) in db.query(PermissaoSistema.codigo_permissao).all()]
    return not any(security.usuario_tem_permissao(db, usuario, codigo) for codigo in codigos)


def enviar_codigo(email: str, codigo: str) -> bool:
    """Melhor esforço (sem servidor de e-mail a pessoa pede de novo ou procura a secretaria). Nunca registra o código nem o endereço no log."""
    texto = (
        "Olá!\n\n"
        f"Seu código para trocar a senha do painel da ASAF é: {codigo}\n\n"
        f"Ele vale por {MINUTOS_DE_VALIDADE_DO_CODIGO} minutos e só pode ser usado uma vez. Se não foi você quem pediu, ignore esta mensagem: a senha só muda com este código.\n\n"
        "ASAF - Associação Arca da Família\n"
    )
    try:
        notificacoes.enviar_email(email, assunto="Código para trocar a senha - ASAF", corpo_texto=texto)
        return True
    except Exception:  # noqa: BLE001 - melhor esforço
        LOG.warning("não foi possível enviar o código para trocar a senha por e-mail")
        return False


def avisar_a_troca(email: str) -> None:
    texto = (
        "Olá!\n\n"
        "A senha do seu acesso ao painel da ASAF acabou de ser trocada pelo código enviado a este e-mail. As sessões que estavam abertas não se renovam mais e se encerram "
        f"em até {security.ACCESS_TOKEN_MINUTOS} minutos.\n\n"
        "Se não foi você, procure a secretaria da ASAF o quanto antes.\n\n"
        "ASAF - Associação Arca da Família\n"
    )
    try:
        notificacoes.enviar_email(email, assunto="Sua senha do painel foi trocada - ASAF", corpo_texto=texto)
    except Exception:  # noqa: BLE001 - melhor esforço
        LOG.warning("não foi possível enviar o aviso de senha trocada por e-mail")


def trocar_senha(db: Session, *, cpf: str, codigo: str, senha_nova: str, ip: str, agora: Optional[datetime] = None) -> tuple[Usuario, Optional[str]]:
    """Confere o código e troca a senha. Devolve (usuário, e-mail para o aviso de senha trocada, que quem chama envia depois da resposta). Qualquer falha do código (CPF sem
    acesso, sem código, vencido, errado, tentativas esgotadas, teto do dia) dá a mesma mensagem."""
    agora = agora or datetime.utcnow()
    cpf = _SO_DIGITOS.sub("", cpf or "")
    limitar_taxa_por_ip(db, ip=ip, rota="nova-senha-trocar", limite=TROCAS_POR_IP_EM_15_MINUTOS, janela_minutos=15)
    erro = security.validar_senha_forte(senha_nova or "")
    if erro:
        raise HTTPException(status_code=400, detail=erro)
    codigo = _SO_DIGITOS.sub("", codigo or "")
    usuario, associado = _usuario_do_cpf(db, cpf)
    if usuario is None or _tentativas_nas_ultimas_24h(db, usuario.id_usuario, agora) >= FALHAS_POR_CONTA_NO_DIA:
        raise HTTPException(status_code=400, detail=MENSAGEM_DO_CODIGO_INVALIDO)
    registro = (
        db.query(CodigoDeNovaSenha)
        .filter(CodigoDeNovaSenha.id_usuario == usuario.id_usuario, CodigoDeNovaSenha.usado_em.is_(None), CodigoDeNovaSenha.expira_em > agora)
        .order_by(CodigoDeNovaSenha.criado_em.desc(), CodigoDeNovaSenha.id_codigo.desc())
        .first()
    )
    if registro is None or registro.tentativas >= TENTATIVAS_POR_CODIGO:
        raise HTTPException(status_code=400, detail=MENSAGEM_DO_CODIGO_INVALIDO)
    # a tentativa é contada ANTES de conferir e de forma ATÔMICA: pedidos em paralelo não ganham tentativas extras
    contou = (
        db.query(CodigoDeNovaSenha)
        .filter(CodigoDeNovaSenha.id_codigo == registro.id_codigo, CodigoDeNovaSenha.usado_em.is_(None), CodigoDeNovaSenha.tentativas < TENTATIVAS_POR_CODIGO)
        .update({CodigoDeNovaSenha.tentativas: CodigoDeNovaSenha.tentativas + 1}, synchronize_session=False)
    )
    db.commit()
    if contou != 1:
        raise HTTPException(status_code=400, detail=MENSAGEM_DO_CODIGO_INVALIDO)
    if len(codigo) != DIGITOS_DO_CODIGO or not hmac.compare_digest(registro.codigo_hash, _impressao_do_codigo(usuario.id_usuario, codigo)):
        raise HTTPException(status_code=400, detail=MENSAGEM_DO_CODIGO_INVALIDO)
    if usuario.senha_hash and security.verificar_senha(senha_nova, usuario.senha_hash):
        raise HTTPException(status_code=400, detail="A senha nova precisa ser diferente da atual.")
    # daqui em diante, UMA transação: o código gasto, a senha, as sessões encerradas e a Auditoria entram juntos ou nada entra
    gasto = (
        db.query(CodigoDeNovaSenha)
        .filter(CodigoDeNovaSenha.id_codigo == registro.id_codigo, CodigoDeNovaSenha.usado_em.is_(None))
        .update({"usado_em": agora}, synchronize_session=False)
    )
    if gasto != 1:
        db.rollback()
        raise HTTPException(status_code=400, detail=MENSAGEM_DO_CODIGO_INVALIDO)
    usuario.senha_hash = security.hash_senha(senha_nova)
    usuario.senha_provisoria = False
    usuario.tentativas_falhas = 0
    usuario.bloqueado_ate = None
    db.query(TokenAcesso).filter(TokenAcesso.id_usuario == usuario.id_usuario).delete(synchronize_session=False)  # nenhuma sessão se renova
    registrar_auditoria(db, usuario, "usuarios", "SENHA_TROCADA_PELO_CODIGO", id_registro_afetado=usuario.id_usuario, ip_origem=ip)  # o commit único
    return usuario, _email_da_conta(usuario, associado)


def limpar_vencidos(db: Session, agora: Optional[datetime] = None) -> int:
    """O resíduo técnico: códigos com mais de 1 dia (valem minutos; os tetos olham só as últimas 24 h) e o contador de pedidos (que guarda só uma impressão do CPF). Chamada pela
    rotina de retenção."""
    from app.models.protecao_publica import TentativaAcessoPublico

    limite = (agora or datetime.utcnow()) - timedelta(days=1)
    total = db.query(CodigoDeNovaSenha).filter(CodigoDeNovaSenha.criado_em < limite).delete(synchronize_session=False)
    total += db.query(TentativaAcessoPublico).filter(TentativaAcessoPublico.rota.like("nova-senha-%"), TentativaAcessoPublico.criado_em < limite).delete(synchronize_session=False)
    db.commit()
    return total
