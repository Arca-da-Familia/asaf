"""v4.9 (FASE 4) - cupom de desconto, motor genérico (`contexto_tipo`/`id_contexto`) reaproveitado
por inscrição de evento e reserva de espaço. Conceito 100% novo neste projeto - nenhum precedente
em código antes desta versão."""
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.financeiro_evento import TIPO_DESCONTO_PERCENTUAL, TIPO_DESCONTO_VALOR_FIXO, CupomDesconto

TIPOS_DESCONTO_VALIDOS = {TIPO_DESCONTO_PERCENTUAL, TIPO_DESCONTO_VALOR_FIXO}


def criar_cupom(
    db: Session, *, codigo: str, contexto_tipo: str, id_contexto: int, tipo_desconto: str, valor_desconto: Decimal,
    limite_uso: Optional[int], data_vigencia_inicio: Optional[datetime], data_vigencia_fim: Optional[datetime],
    id_usuario: Optional[int] = None,
) -> CupomDesconto:
    codigo_normalizado = codigo.strip().upper()
    if len(codigo_normalizado) < 3:
        raise HTTPException(status_code=422, detail="Código do cupom precisa ter ao menos 3 caracteres.")
    if tipo_desconto not in TIPOS_DESCONTO_VALIDOS:
        raise HTTPException(status_code=422, detail=f"tipo_desconto deve ser um de: {', '.join(sorted(TIPOS_DESCONTO_VALIDOS))}.")
    if valor_desconto <= 0:
        raise HTTPException(status_code=422, detail="Valor do desconto precisa ser maior que zero.")
    if tipo_desconto == TIPO_DESCONTO_PERCENTUAL and valor_desconto > 100:
        raise HTTPException(status_code=422, detail="Desconto percentual não pode passar de 100%.")
    if db.query(CupomDesconto).filter(CupomDesconto.codigo == codigo_normalizado).first():
        raise HTTPException(status_code=400, detail=f"Já existe um cupom com o código '{codigo_normalizado}'.")

    cupom = CupomDesconto(
        codigo=codigo_normalizado, contexto_tipo=contexto_tipo, id_contexto=id_contexto,
        tipo_desconto=tipo_desconto, valor_desconto=valor_desconto, limite_uso=limite_uso,
        data_vigencia_inicio=data_vigencia_inicio, data_vigencia_fim=data_vigencia_fim,
        id_usuario_criacao=id_usuario,
    )
    db.add(cupom)
    db.commit()
    db.refresh(cupom)
    return cupom


def listar_cupons(db: Session, *, contexto_tipo: str, id_contexto: int) -> list[CupomDesconto]:
    return (
        db.query(CupomDesconto)
        .filter(CupomDesconto.contexto_tipo == contexto_tipo, CupomDesconto.id_contexto == id_contexto)
        .order_by(CupomDesconto.criado_em.desc())
        .all()
    )


def validar_e_aplicar_cupom(db: Session, *, contexto_tipo: str, id_contexto: int, codigo: str, valor_base: Decimal) -> tuple[Decimal, CupomDesconto]:
    """Valida o cupom contra o contexto certo (um cupom do evento X nunca serve pro evento Y,
    mesmo que o código coincida) e devolve (valor_com_desconto, cupom) - o incremento de
    `usos_atuais` é um UPDATE atômico condicionado (mesmo padrão de `app/services/vagas.py::
    reservar_vaga`: `WHERE usos_atuais < limite_uso`), nunca um SELECT-conta-depois-UPDATE que
    teria brecha de corrida sob dois usos simultâneos do último cupom disponível."""
    agora = datetime.utcnow()
    cupom = (
        db.query(CupomDesconto)
        .filter(
            CupomDesconto.codigo == codigo.strip().upper(), CupomDesconto.contexto_tipo == contexto_tipo,
            CupomDesconto.id_contexto == id_contexto, CupomDesconto.ativo.is_(True),
        )
        .first()
    )
    if not cupom:
        raise HTTPException(status_code=404, detail="Cupom não encontrado para este evento/espaço, ou inativo.")
    if cupom.data_vigencia_inicio and agora < cupom.data_vigencia_inicio:
        raise HTTPException(status_code=400, detail="Este cupom ainda não está vigente.")
    if cupom.data_vigencia_fim and agora > cupom.data_vigencia_fim:
        raise HTTPException(status_code=400, detail="Este cupom expirou.")

    if cupom.limite_uso is not None:
        atualizadas = db.query(CupomDesconto).filter(
            CupomDesconto.id_cupom == cupom.id_cupom, CupomDesconto.usos_atuais < CupomDesconto.limite_uso,
        ).update({CupomDesconto.usos_atuais: CupomDesconto.usos_atuais + 1}, synchronize_session=False)
        if atualizadas == 0:
            db.rollback()
            raise HTTPException(status_code=400, detail="Este cupom já atingiu o limite de usos.")
    else:
        db.query(CupomDesconto).filter(CupomDesconto.id_cupom == cupom.id_cupom).update(
            {CupomDesconto.usos_atuais: CupomDesconto.usos_atuais + 1}, synchronize_session=False,
        )
    db.commit()
    db.refresh(cupom)

    if cupom.tipo_desconto == TIPO_DESCONTO_PERCENTUAL:
        valor_final = valor_base * (Decimal("100") - cupom.valor_desconto) / Decimal("100")
    else:
        valor_final = valor_base - cupom.valor_desconto
    valor_final = max(Decimal("0"), valor_final).quantize(Decimal("0.01"))
    return valor_final, cupom
