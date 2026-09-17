"""v3.3 (FASE 3) - reembolso de despesa de voluntário/dirigente como fluxo próprio: comprovante
obrigatório, aprovação (quem solicita nunca aprova o próprio reembolso), pagamento - despesa
reembolsada informalmente é o buraco clássico de prestação de contas. Pagamento reaproveita
`TituloFinanceiro`/`baixar_titulo` (v3.0), nunca um conceito paralelo."""
from datetime import datetime
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.compras import ReembolsoDespesa
from app.models.financeiro import TituloFinanceiro


def solicitar_reembolso(
    db: Session, *, id_associado: int, descricao: str, valor: Decimal, comprovante: str,
    id_conta_contabil: int, id_usuario: int,
) -> ReembolsoDespesa:
    if valor <= 0:
        raise HTTPException(status_code=400, detail="Valor deve ser maior que zero.")
    if not comprovante:
        raise HTTPException(status_code=400, detail="Comprovante é obrigatório para reembolso de despesa.")
    reembolso = ReembolsoDespesa(
        id_associado=id_associado, descricao=descricao, valor=valor, comprovante=comprovante,
        id_conta_contabil=id_conta_contabil, status="Solicitado", id_usuario_solicitante=id_usuario,
    )
    db.add(reembolso)
    db.commit()
    db.refresh(reembolso)
    return reembolso


def aprovar_reembolso(db: Session, *, id_reembolso: int, id_usuario_aprovador: int) -> ReembolsoDespesa:
    reembolso = db.query(ReembolsoDespesa).filter(ReembolsoDespesa.id_reembolso == id_reembolso).first()
    if not reembolso:
        raise HTTPException(status_code=404, detail="Reembolso não encontrado.")
    if reembolso.status != "Solicitado":
        raise HTTPException(status_code=400, detail=f"Reembolso '{reembolso.status}' não pode ser aprovado.")
    if reembolso.id_usuario_solicitante == id_usuario_aprovador:
        raise HTTPException(status_code=400, detail="Quem solicitou o reembolso não pode aprová-lo (segregação de funções).")

    reembolso.status = "Aprovado"
    reembolso.id_usuario_aprovador = id_usuario_aprovador
    reembolso.data_aprovacao = datetime.utcnow()

    titulo = TituloFinanceiro(
        tipo_titulo="A Pagar", id_conta_contabil=reembolso.id_conta_contabil,
        descricao=f"Reembolso #{reembolso.id_reembolso} — {reembolso.descricao}",
        valor_original=reembolso.valor, saldo_devedor=reembolso.valor,
        data_vencimento=datetime.utcnow(), status="Pendente",
    )
    db.add(titulo)
    db.flush()
    reembolso.id_titulo_gerado = titulo.id_titulo
    db.commit()
    db.refresh(reembolso)
    return reembolso


def reprovar_reembolso(db: Session, *, id_reembolso: int, motivo: str, id_usuario_aprovador: int) -> ReembolsoDespesa:
    reembolso = db.query(ReembolsoDespesa).filter(ReembolsoDespesa.id_reembolso == id_reembolso).first()
    if not reembolso:
        raise HTTPException(status_code=404, detail="Reembolso não encontrado.")
    if reembolso.status != "Solicitado":
        raise HTTPException(status_code=400, detail=f"Reembolso '{reembolso.status}' não pode ser reprovado.")
    if reembolso.id_usuario_solicitante == id_usuario_aprovador:
        raise HTTPException(status_code=400, detail="Quem solicitou o reembolso não pode reprová-lo (segregação de funções).")
    reembolso.status = "Reprovado"
    reembolso.motivo_reprovacao = motivo
    reembolso.id_usuario_aprovador = id_usuario_aprovador
    reembolso.data_aprovacao = datetime.utcnow()
    db.commit()
    db.refresh(reembolso)
    return reembolso
