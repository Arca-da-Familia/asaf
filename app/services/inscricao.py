"""v4.0 (FASE 4) - motor de inscrição genérico: pré-inscrito → confirmado (ou lista de espera,
quando o consumidor controla vaga) → presente/ausente (marcado depois do evento acontecer) ou
cancelado a qualquer momento antes disso. O motor não sabe o que é "vaga cheia" - isso é decisão
de quem chama (v4.7, vagas e lista de espera), o motor só guarda o status que foi decidido."""
import json
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.motores import AUSENTE, CANCELADO, CONFIRMADO, LISTA_DE_ESPERA, PRESENTE, PRE_INSCRITO, STATUS_INSCRICAO, Inscricao
from app.models.pessoas import Pessoa

_TRANSICOES_VALIDAS = {
    PRE_INSCRITO: {CONFIRMADO, LISTA_DE_ESPERA, CANCELADO},
    CONFIRMADO: {CANCELADO, PRESENTE, AUSENTE},
    LISTA_DE_ESPERA: {CONFIRMADO, CANCELADO},
    CANCELADO: {PRE_INSCRITO},
    PRESENTE: set(),
    AUSENTE: set(),
}


def inscrever(
    db: Session, *, contexto_tipo: str, id_contexto: int, id_pessoa: int,
    respostas_formulario: Optional[dict], id_usuario_operador: Optional[int] = None,
    # v4.6 - só a inscrição pública (site, sem login) preenche estes três; staff/autoatendimento
    # logado (v4.0-v4.5) nunca passa nenhum, ficam None.
    codigo_checkin: Optional[str] = None, token_cancelamento: Optional[str] = None,
    consentimento_lgpd_versao: Optional[str] = None,
    # v4.7 - decidido por quem chama (app/services/vagas.py), nunca pelo motor - PRE_INSCRITO
    # (vaga reservada) ou LISTA_DE_ESPERA (não coube); `categoria_cota`/`identificador_grupo`
    # documentados em app/models/motores.py::Inscricao.
    status_inicial: str = PRE_INSCRITO, categoria_cota: Optional[str] = None,
    identificador_grupo: Optional[str] = None,
) -> Inscricao:
    if not db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa).first():
        raise HTTPException(status_code=404, detail="Pessoa não encontrada.")

    existente = db.query(Inscricao).filter(
        Inscricao.contexto_tipo == contexto_tipo, Inscricao.id_contexto == id_contexto, Inscricao.id_pessoa == id_pessoa,
    ).first()
    if existente:
        if existente.status != CANCELADO:
            raise HTTPException(status_code=400, detail=f"Esta pessoa já está inscrita neste contexto (status '{existente.status}').")
        existente.status = status_inicial
        existente.respostas_formulario = json.dumps(respostas_formulario) if respostas_formulario else None
        existente.data_inscricao = datetime.utcnow()
        existente.categoria_cota = categoria_cota
        existente.identificador_grupo = identificador_grupo
        existente.prazo_confirmacao = None
        if codigo_checkin is not None:
            existente.codigo_checkin = codigo_checkin
            existente.token_cancelamento = token_cancelamento
            existente.consentimento_lgpd_versao = consentimento_lgpd_versao
        db.commit()
        db.refresh(existente)
        return existente

    inscricao = Inscricao(
        contexto_tipo=contexto_tipo, id_contexto=id_contexto, id_pessoa=id_pessoa, status=status_inicial,
        respostas_formulario=json.dumps(respostas_formulario) if respostas_formulario else None,
        codigo_checkin=codigo_checkin, token_cancelamento=token_cancelamento,
        consentimento_lgpd_versao=consentimento_lgpd_versao, categoria_cota=categoria_cota,
        identificador_grupo=identificador_grupo,
    )
    db.add(inscricao)
    db.commit()
    db.refresh(inscricao)
    return inscricao


def alterar_status(db: Session, *, id_inscricao: int, novo_status: str) -> Inscricao:
    if novo_status not in STATUS_INSCRICAO:
        raise HTTPException(status_code=400, detail=f"Status inválido - use um de: {', '.join(sorted(STATUS_INSCRICAO))}.")
    inscricao = db.query(Inscricao).filter(Inscricao.id_inscricao == id_inscricao).first()
    if not inscricao:
        raise HTTPException(status_code=404, detail="Inscrição não encontrada.")
    if novo_status not in _TRANSICOES_VALIDAS[inscricao.status]:
        raise HTTPException(status_code=400, detail=f"Não é possível mudar de '{inscricao.status}' para '{novo_status}'.")
    inscricao.status = novo_status
    db.commit()
    db.refresh(inscricao)
    return inscricao


def cancelar_por_token(db: Session, *, token_cancelamento: str) -> Inscricao:
    """v4.6 - autocancelamento pelo link enviado por e-mail (inscrição pública, sem login) - o
    token é o que autentica quem pode cancelar, nunca o id_inscricao sequencial (que qualquer um
    poderia adivinhar/incrementar)."""
    inscricao = db.query(Inscricao).filter(Inscricao.token_cancelamento == token_cancelamento).first()
    if not inscricao:
        raise HTTPException(status_code=404, detail="Link de cancelamento inválido.")
    if inscricao.status == CANCELADO:
        raise HTTPException(status_code=400, detail="Esta inscrição já estava cancelada.")
    if inscricao.status not in _TRANSICOES_VALIDAS or CANCELADO not in _TRANSICOES_VALIDAS[inscricao.status]:
        raise HTTPException(status_code=400, detail=f"Não é possível cancelar uma inscrição com status '{inscricao.status}'.")
    inscricao.status = CANCELADO
    db.commit()
    db.refresh(inscricao)
    return inscricao


def confirmar_por_token(db: Session, *, token_cancelamento: str) -> Inscricao:
    """v4.7 - quem foi PROMOVIDO da lista de espera confirma pelo mesmo token que já recebeu por
    e-mail (nunca um token novo/id sequencial) antes do `prazo_confirmacao` vencer."""
    inscricao = db.query(Inscricao).filter(Inscricao.token_cancelamento == token_cancelamento).first()
    if not inscricao:
        raise HTTPException(status_code=404, detail="Link de confirmação inválido.")
    if inscricao.status not in _TRANSICOES_VALIDAS or CONFIRMADO not in _TRANSICOES_VALIDAS[inscricao.status]:
        raise HTTPException(status_code=400, detail=f"Não é possível confirmar uma inscrição com status '{inscricao.status}'.")
    inscricao.status = CONFIRMADO
    inscricao.prazo_confirmacao = None
    db.commit()
    db.refresh(inscricao)
    return inscricao


def vincular_cobranca(db: Session, *, id_inscricao: int, id_titulo: int) -> Inscricao:
    inscricao = db.query(Inscricao).filter(Inscricao.id_inscricao == id_inscricao).first()
    if not inscricao:
        raise HTTPException(status_code=404, detail="Inscrição não encontrada.")
    inscricao.id_titulo_cobranca = id_titulo
    db.commit()
    db.refresh(inscricao)
    return inscricao


def listar_inscricoes(db: Session, *, contexto_tipo: str, id_contexto: int) -> list[Inscricao]:
    return (
        db.query(Inscricao)
        .filter(Inscricao.contexto_tipo == contexto_tipo, Inscricao.id_contexto == id_contexto)
        .order_by(Inscricao.data_inscricao)
        .all()
    )
