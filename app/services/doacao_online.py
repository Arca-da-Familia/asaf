"""v5.6a (FASE 5) - doar pelo site com Pix estático (ver app/models/intencoes_de_doacao.py).

O que o serviço garante:
  1. o Pix é sempre o da associação (CHAVE_PIX, lida do banco a cada pedido: a chave mudou, o site muda), e sem chave a doação pelo site simplesmente não está disponível;
  2. quem se identifica ganha um protocolo e o código "copia e cola" já com o valor; o mesmo pedido mandado de novo em 24 horas devolve o mesmo protocolo (duplo clique);
  3. a intenção NÃO é dinheiro: só a confirmação da tesouraria, com o valor RECEBIDO, cria a doação (título, lançamento e recibo numerado) e manda o recibo por e-mail;
  4. a tesouraria é avisada no sino de cada intenção nova; a que ninguém confirma expira sozinha (e ainda pode ser confirmada, o dinheiro pode chegar atrasado)."""
import hashlib
import re
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session

from app.config_cache import obter_configuracao
from app.models.associados import Associado
from app.models.core import ConfiguracaoInstitucional, Usuario
from app.models.doacoes import CampanhaArrecadacao, Doacao
from app.models.intencoes_de_doacao import CONFIRMADA, EXPIRADA, NAO_LOCALIZADA, PENDENTE, IntencaoDeDoacao
from app.models.pessoas import Pessoa
from app.services import doacoes, instituicao, notificacoes
from app.services.formato import reais
from app.services.notificacoes_painel import notificar, usuarios_com_permissao
from app.services.pix import gerar_payload_pix

# o texto do aviso de privacidade do formulário de doação tem versão: o site manda a versão que mostrou e o servidor recusa se o texto mudou
# versão 2 (2026-10-16): o aviso passou a dizer o prazo de guarda do pedido sem confirmação (a versão 1 dizia que não havia prazo para apagá-lo)
VERSAO_AVISO_DE_PRIVACIDADE_DOACAO = "2"

PERMISSAO_DA_TESOURARIA = "financeiro"
JANELA_DO_DUPLO_CLIQUE = timedelta(hours=24)
DIAS_PARA_EXPIRAR_PADRAO = 15
CHAVE_DO_PRAZO = "PRAZO_DIAS_INTENCAO_DOACAO"
DESCRICAO_NO_PIX = "Doacao ASAF"

ROTULOS_DA_SITUACAO = {
    PENDENTE: "Aguardando conferência",
    CONFIRMADA: "Confirmada",
    NAO_LOCALIZADA: "Pix não localizado",
    EXPIRADA: "Prazo vencido sem confirmação",
}
# o que ainda precisa de uma decisão da tesouraria
A_CONFERIR = (PENDENTE, EXPIRADA)


# ------------------------------------------------------------------------------------------------ o Pix da associação
def dados_do_pix(db: Session) -> Optional[dict]:
    """A chave, o beneficiário e a cidade do Pix, direto do banco (sem cache: a chave não pode ficar velha em outra réplica). `None` se a chave ainda não foi cadastrada OU se ela
    continua só interna: a página de doação publica a chave (o código "copia e cola" a leva dentro), e isso só acontece depois que alguém marca "vai para o site" em Instituição."""
    chave = instituicao.campos_publicos(db).get("CHAVE_PIX")
    if not chave:
        return None
    configs = {
        c.chave_configuracao: (c.valor_configuracao or "").strip()
        for c in db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao.in_(["NOME_BENEFICIARIO_PIX", "CIDADE_BENEFICIARIO_PIX"])).all()
    }
    return {"chave": chave, "beneficiario": configs.get("NOME_BENEFICIARIO_PIX") or "ASAF", "cidade": configs.get("CIDADE_BENEFICIARIO_PIX") or "NA"}


def exigir_pix(db: Session) -> dict:
    pix = dados_do_pix(db)
    if pix is None:
        raise HTTPException(status_code=503, detail="A doação pelo site ainda não está disponível. Fale com a secretaria da associação.")
    return pix


def copia_e_cola(pix: dict, *, valor: Optional[Decimal], txid: str) -> str:
    return gerar_payload_pix(
        chave_pix=pix["chave"], nome_beneficiario=pix["beneficiario"], cidade_beneficiario=pix["cidade"], valor=valor, txid=txid, descricao=DESCRICAO_NO_PIX,
    )


def exigir_aviso_de_privacidade(aceito: bool, versao: Optional[str]) -> None:
    if not aceito:
        raise HTTPException(status_code=400, detail="Para continuar é preciso ler e aceitar o aviso de privacidade.")
    if versao != VERSAO_AVISO_DE_PRIVACIDADE_DOACAO:
        raise HTTPException(status_code=422, detail="O aviso de privacidade foi atualizado: recarregue a página, leia e aceite a versão atual.")


def dias_para_expirar(db: Session) -> int:
    valor = obter_configuracao(db, CHAVE_DO_PRAZO, str(DIAS_PARA_EXPIRAR_PADRAO))
    try:
        dias = int(float(str(valor).strip()))
    except (TypeError, ValueError, OverflowError):
        return DIAS_PARA_EXPIRAR_PADRAO
    return dias if dias >= 1 else DIAS_PARA_EXPIRAR_PADRAO


# ------------------------------------------------------------------------------------------------ as campanhas que o site mostra
def _recebendo(agora: datetime):
    """Campanha ativa e dentro do prazo (o dia do prazo ainda vale)."""
    inicio_do_dia = datetime(agora.year, agora.month, agora.day)
    return (CampanhaArrecadacao.ativa.is_(True), or_(CampanhaArrecadacao.prazo.is_(None), CampanhaArrecadacao.prazo >= inicio_do_dia))


def campanha_que_recebe(db: Session, id_campanha: int, agora: Optional[datetime] = None) -> CampanhaArrecadacao:
    campanha = db.query(CampanhaArrecadacao).filter(CampanhaArrecadacao.id_campanha == id_campanha, *_recebendo(agora or datetime.utcnow())).first()
    if campanha is None:
        raise HTTPException(status_code=400, detail="Essa campanha não está recebendo doações. Escolha outra ou doe sem campanha.")
    return campanha


def arrecadado_por_campanha(db: Session, ids: list[int]) -> dict[int, Decimal]:
    """Dinheiro que entrou (doação em bens tem valor avaliado, mas não é arrecadação), só das doações CONFIRMADAS: a intenção nunca conta."""
    if not ids:
        return {}
    linhas = (
        db.query(Doacao.id_campanha, func.coalesce(func.sum(Doacao.valor), 0))
        .filter(Doacao.id_campanha.in_(ids), Doacao.tipo_doacao != "Bens").group_by(Doacao.id_campanha).all()
    )
    return {id_campanha: Decimal(str(total)) for id_campanha, total in linhas}


def campanhas_publicas(db: Session, agora: Optional[datetime] = None) -> list[dict]:
    """Transparência: o que cada campanha em andamento pede, quanto já recebeu e até quando (a destinação, o centro de custo, é interna e não sai)."""
    campanhas = db.query(CampanhaArrecadacao).filter(*_recebendo(agora or datetime.utcnow())).order_by(CampanhaArrecadacao.criado_em.desc(), CampanhaArrecadacao.id_campanha.desc()).all()
    arrecadado = arrecadado_por_campanha(db, [c.id_campanha for c in campanhas])
    resultado = []
    for c in campanhas:
        recebido = arrecadado.get(c.id_campanha, Decimal("0"))
        meta = Decimal(str(c.meta_valor))
        resultado.append({
            "id_campanha": c.id_campanha, "titulo": c.titulo, "descricao": c.descricao, "meta_valor": meta, "valor_arrecadado": recebido,
            "percentual": int((recebido / meta * 100).to_integral_value()) if meta > 0 else 0,
            "prazo": c.prazo.date().isoformat() if c.prazo else None,
        })
    return resultado


# ------------------------------------------------------------------------------------------------ a intenção, pelo site
def _so_digitos(texto: Optional[str]) -> str:
    return re.sub(r"\D", "", texto or "")


def _impressao(nome: str, email: str, cpf: Optional[str], valor: Optional[Decimal], id_campanha: Optional[int]) -> str:
    normalizado = "|".join([re.sub(r"\s+", " ", nome).strip().lower(), email.strip().lower(), _so_digitos(cpf), str(valor or ""), str(id_campanha or "")])
    return hashlib.sha256(normalizado.encode("utf-8")).hexdigest()


def txid_da_intencao(intencao: IntencaoDeDoacao) -> str:
    return f"ASAF{intencao.protocolo}"


def registrar_intencao(
    db: Session, *, nome_completo: str, email: str, cpf: Optional[str], valor: Optional[Decimal], id_campanha: Optional[int], versao_do_aviso: str,
    agora: Optional[datetime] = None,
) -> tuple[IntencaoDeDoacao, bool]:
    """Grava a intenção, dá o protocolo e avisa a tesouraria. Devolve (intenção, nova): o mesmo pedido ainda pendente, mandado de novo em 24 horas, devolve o mesmo protocolo
    e `nova=False`, sem avisar ninguém de novo. Faz commit."""
    agora = agora or datetime.utcnow()
    if id_campanha is not None:
        campanha_que_recebe(db, id_campanha, agora)
    impressao = _impressao(nome_completo, email, cpf, valor, id_campanha)
    repetida = (
        db.query(IntencaoDeDoacao)
        .filter(IntencaoDeDoacao.impressao_do_pedido == impressao, IntencaoDeDoacao.status == PENDENTE, IntencaoDeDoacao.criado_em >= agora - JANELA_DO_DUPLO_CLIQUE)
        .order_by(IntencaoDeDoacao.id_intencao).first()
    )
    if repetida is not None:
        return repetida, False

    intencao = IntencaoDeDoacao(
        protocolo=f"TMP-{uuid.uuid4().hex[:20]}", nome_doador=nome_completo, email_doador=email, documento_doador=_so_digitos(cpf) or None, valor_informado=valor,
        id_campanha=id_campanha, status=PENDENTE, impressao_do_pedido=impressao, consentimento_lgpd_versao=versao_do_aviso, consentimento_lgpd_em=agora, criado_em=agora,
        expira_em=agora + timedelta(days=dias_para_expirar(db)),
    )
    db.add(intencao)
    db.flush()
    intencao.protocolo = f"DOA-{agora.year}-{intencao.id_intencao:05d}"
    notificar(
        db, usuarios_com_permissao(db, PERMISSAO_DA_TESOURARIA), tipo="doacao_nova", titulo=f"Doação a conferir {intencao.protocolo}",
        texto=f"{nome_completo} vai doar pelo Pix" + (f" {reais(valor)}" if valor else "") + ". Procure no extrato do banco e confirme no painel.", link="/doacoes",
    )
    db.commit()
    db.refresh(intencao)
    return intencao, True


def _primeiro_nome(nome: str) -> str:
    return nome.split()[0] if nome.split() else nome


def confirmar_recebimento_por_email(intencao: IntencaoDeDoacao, pix: dict) -> bool:
    """O e-mail que guarda o protocolo e o código do Pix (para quem fechou a página antes de pagar). Melhor esforço: a intenção já está gravada. Devolve se saiu."""
    codigo = copia_e_cola(pix, valor=intencao.valor_informado, txid=txid_da_intencao(intencao))
    valor = f"Valor combinado: {reais(intencao.valor_informado)}\n" if intencao.valor_informado else ""
    texto = (
        f"Olá, {_primeiro_nome(intencao.nome_doador)}.\n\n"
        "Obrigado por querer ajudar a Associação Arca da Família (ASAF).\n\n"
        f"Protocolo: {intencao.protocolo}\n{valor}\n"
        "Para concluir, pague pelo Pix do seu banco. Código Pix (copia e cola):\n\n"
        f"{codigo}\n\n"
        "Atenção: a doação só é registrada depois que a tesouraria localizar o Pix no extrato do banco da associação. Quando isso acontecer, o sistema tenta enviar o recibo por e-mail. "
        "Se pagou e não recebeu o recibo em alguns dias, fale com a secretaria citando o protocolo.\n\nASAF - Associação Arca da Família\n"
    )
    try:
        notificacoes.enviar_email(intencao.email_doador, assunto=f"Sua doação à ASAF - protocolo {intencao.protocolo}", corpo_texto=texto)
        return True
    except Exception:
        return False


# ------------------------------------------------------------------------------------------------ o que a tesouraria faz
def _associado_do_cpf(db: Session, cpf: Optional[str]) -> Optional[int]:
    """Se o doador já é associado (pelo CPF, que o sistema já conhece), a doação fica ligada ao cadastro dele. Sem CPF, nunca adivinha."""
    if not cpf:
        return None
    achado = db.query(Associado.id_associado).join(Pessoa, Pessoa.id_pessoa == Associado.id_pessoa).filter(Pessoa.cpf == cpf).first()
    return achado[0] if achado else None


def _texto_do_email_do_recibo(intencao: IntencaoDeDoacao, doacao: Doacao, recibo: str) -> str:
    return (
        f"Olá, {_primeiro_nome(intencao.nome_doador)}.\n\n"
        f"A Associação Arca da Família (ASAF) confirmou o recebimento da sua doação de {reais(doacao.valor)}. Muito obrigado!\n\n"
        f"Protocolo: {intencao.protocolo}\n\n{recibo}\nASAF - Associação Arca da Família\n"
    )


def confirmar(
    db: Session, intencao: IntencaoDeDoacao, usuario: Usuario, *, valor_recebido: Decimal, id_conta_contabil: int, id_conta_contabil_caixa: int,
    id_centro_custo_destinacao: Optional[int], agora: Optional[datetime] = None,
) -> Doacao:
    """A tesouraria achou o dinheiro no extrato: nasce a doação (a mesma de sempre: título pago, lançamento, recibo numerado) com o valor RECEBIDO, e a intenção vira Confirmada,
    na mesma transação (nunca uma sem a outra). Sem destinação informada, vale a do centro de custo da campanha. Depois tenta mandar o recibo por e-mail."""
    if intencao.status == CONFIRMADA:
        raise HTTPException(status_code=400, detail="Esta doação já foi confirmada.")
    agora = agora or datetime.utcnow()
    campanha = db.query(CampanhaArrecadacao).filter(CampanhaArrecadacao.id_campanha == intencao.id_campanha).first() if intencao.id_campanha else None
    destinacao = id_centro_custo_destinacao or (campanha.id_centro_custo if campanha else None)
    try:
        doacao = doacoes.registrar_doacao(
            db, anonima=False, nome_doador=intencao.nome_doador, documento_doador=intencao.documento_doador, id_associado=_associado_do_cpf(db, intencao.documento_doador),
            tipo_doacao="Monetaria", recorrente=False, valor=valor_recebido, descricao_bem=None, id_campanha=intencao.id_campanha, id_centro_custo_destinacao=destinacao,
            id_conta_contabil=id_conta_contabil, id_conta_contabil_caixa=str(id_conta_contabil_caixa), id_usuario=usuario.id_usuario, commit=False,
        )
    except HTTPException:
        db.rollback()
        raise
    intencao.status = CONFIRMADA
    intencao.id_doacao = doacao.id_doacao
    intencao.resolvido_em = agora
    intencao.id_usuario_resolucao = usuario.id_usuario
    db.commit()
    db.refresh(intencao)
    db.refresh(doacao)

    try:
        notificacoes.enviar_email(
            intencao.email_doador, assunto=f"Recibo da sua doação à ASAF - nº {doacao.numero_recibo}",
            corpo_texto=_texto_do_email_do_recibo(intencao, doacao, doacoes.gerar_texto_recibo(db, doacao)),
        )
        intencao.recibo_enviado_por_email = True
    except Exception:
        # a doação e o recibo já existem; o e-mail é conveniência (SMTP fora do ar ou não configurado): a tela avisa que o recibo precisa chegar por outro meio
        intencao.recibo_enviado_por_email = False
    db.commit()
    db.refresh(intencao)
    return doacao


def marcar_nao_localizada(db: Session, intencao: IntencaoDeDoacao, usuario: Usuario, observacao: Optional[str], agora: Optional[datetime] = None) -> IntencaoDeDoacao:
    """Não achou o Pix no extrato. Nada é apagado: se o dinheiro chegar depois, ainda dá para confirmar."""
    if intencao.status == CONFIRMADA:
        raise HTTPException(status_code=400, detail="Esta doação já foi confirmada.")
    intencao.status = NAO_LOCALIZADA
    intencao.observacao = (observacao or "").strip()[:300] or None
    intencao.resolvido_em = agora or datetime.utcnow()
    intencao.id_usuario_resolucao = usuario.id_usuario
    db.commit()
    db.refresh(intencao)
    return intencao


def expirar_vencidas(db: Session, agora: Optional[datetime] = None) -> int:
    """Rotina do sistema: a intenção pendente que passou do prazo vira Expirada (sai da frente da tesouraria, mas continua podendo ser confirmada). Devolve quantas. Faz commit."""
    agora = agora or datetime.utcnow()
    vencidas = db.query(IntencaoDeDoacao).filter(IntencaoDeDoacao.status == PENDENTE, IntencaoDeDoacao.expira_em < agora).all()
    for intencao in vencidas:
        intencao.status = EXPIRADA
    db.commit()
    return len(vencidas)


# ------------------------------------------------------------------------------------------------ o que o painel mostra
def filtrar(db: Session, *, situacao: Optional[str] = None, busca: Optional[str] = None):
    """`situacao` aceita uma situação ou `a_conferir` (Aguardando conferência + Prazo vencido sem confirmação)."""
    consulta = db.query(IntencaoDeDoacao)
    if situacao == "a_conferir":
        consulta = consulta.filter(IntencaoDeDoacao.status.in_(A_CONFERIR))
    elif situacao:
        consulta = consulta.filter(IntencaoDeDoacao.status == situacao)
    texto = (busca or "").strip()
    if texto:
        condicoes = [
            IntencaoDeDoacao.protocolo.ilike(f"%{texto}%"), IntencaoDeDoacao.nome_doador.ilike(f"%{texto}%"), IntencaoDeDoacao.email_doador.ilike(f"%{texto}%"),
        ]
        if re.fullmatch(r"[\d\s.\-/]+", texto) and _so_digitos(texto):
            condicoes.append(IntencaoDeDoacao.documento_doador.contains(_so_digitos(texto)))
        consulta = consulta.filter(or_(*condicoes))
    return consulta


def ordenar_para_a_tela(consulta):
    """O que espera conferência primeiro (a mais nova em cima: é a que a pessoa acabou de pagar), depois o resto."""
    ordem = case(
        (IntencaoDeDoacao.status == PENDENTE, 0), (IntencaoDeDoacao.status == EXPIRADA, 1), (IntencaoDeDoacao.status == NAO_LOCALIZADA, 2), else_=3,
    )
    return consulta.order_by(ordem, IntencaoDeDoacao.criado_em.desc(), IntencaoDeDoacao.id_intencao.desc())


def resumo(db: Session) -> dict:
    por_situacao = dict(db.query(IntencaoDeDoacao.status, func.count()).group_by(IntencaoDeDoacao.status).all())
    return {
        "pendentes": por_situacao.get(PENDENTE, 0), "expiradas": por_situacao.get(EXPIRADA, 0), "nao_localizadas": por_situacao.get(NAO_LOCALIZADA, 0),
        "confirmadas": por_situacao.get(CONFIRMADA, 0), "a_conferir": por_situacao.get(PENDENTE, 0) + por_situacao.get(EXPIRADA, 0),
    }


def serializar_lista(db: Session, intencoes: list[IntencaoDeDoacao]) -> list[dict]:
    ids_campanha = {i.id_campanha for i in intencoes if i.id_campanha}
    campanhas = {c.id_campanha: c for c in db.query(CampanhaArrecadacao).filter(CampanhaArrecadacao.id_campanha.in_(ids_campanha)).all()} if ids_campanha else {}
    ids_doacao = {i.id_doacao for i in intencoes if i.id_doacao}
    recibos = {d.id_doacao: d for d in db.query(Doacao).filter(Doacao.id_doacao.in_(ids_doacao)).all()} if ids_doacao else {}
    itens = []
    for i in intencoes:
        campanha = campanhas.get(i.id_campanha)
        doacao = recibos.get(i.id_doacao)
        itens.append({
            "id_intencao": i.id_intencao, "protocolo": i.protocolo, "nome_doador": i.nome_doador, "email_doador": i.email_doador, "documento_doador": i.documento_doador,
            "valor_informado": i.valor_informado, "id_campanha": i.id_campanha, "campanha_titulo": campanha.titulo if campanha else None,
            "id_centro_custo_sugerido": campanha.id_centro_custo if campanha else None, "status": i.status, "status_rotulo": ROTULOS_DA_SITUACAO.get(i.status, i.status),
            "criado_em": i.criado_em, "expira_em": i.expira_em, "resolvido_em": i.resolvido_em, "id_doacao": i.id_doacao,
            "numero_recibo": doacao.numero_recibo if doacao else None, "valor_recebido": doacao.valor if doacao else None, "observacao": i.observacao,
            "recibo_enviado_por_email": i.recibo_enviado_por_email, "pode_confirmar": i.status != CONFIRMADA,
        })
    return itens
