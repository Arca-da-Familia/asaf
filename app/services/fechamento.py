"""v3.7 (FASE 3) - fechamento mensal com conciliação obrigatória: `fechar_mes` recusa (400) fechar
o mês se o saldo do sistema não bater com o saldo do extrato bancário informado por quem conferiu
- divergência aberta bloqueia o fechamento, sempre. Não existe "forçar fechamento mesmo com
divergência" - a saída correta é investigar a diferença (lançamento faltando, erro de digitação
no extrato) antes de tentar de novo, nunca assinar embaixo de um número que não bate."""
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.financeiro import ContaFinanceira, LancamentoContabil, PartidaContabil
from app.models.fechamento import FechamentoMensal
from app.services.contabilidade import DEBITO
from app.services.contribuicoes import data_vencimento_da_competencia

TOLERANCIA_CENTAVOS = Decimal("0.01")


def _saldo_sistema_ate_competencia(db: Session, *, id_conta: int, competencia: str) -> Decimal:
    """Saldo da conta contábil (débito soma, crédito subtrai) considerando só lançamentos com
    data de referência até o ÚLTIMO dia da competência - mesma regra de data (`data_competencia`
    ou `data_lancamento`) usada em todo o resto do financeiro desde a v3.1."""
    fim_do_mes = data_vencimento_da_competencia(competencia, 31)
    data_referencia = func.coalesce(LancamentoContabil.data_competencia, LancamentoContabil.data_lancamento)
    saldo = Decimal("0")
    consulta = (
        db.query(PartidaContabil.tipo_partida, PartidaContabil.valor)
        .join(LancamentoContabil, LancamentoContabil.id_lancamento == PartidaContabil.id_lancamento)
        .filter(PartidaContabil.id_conta == id_conta, data_referencia <= fim_do_mes)
    )
    for tipo_partida, valor in consulta:
        saldo += valor if tipo_partida == DEBITO else -valor
    return saldo


def fechar_mes(
    db: Session, *, competencia: str, id_conta_financeira: int, saldo_extrato_bancario: Decimal, id_usuario: Optional[int],
) -> FechamentoMensal:
    conta_financeira = db.query(ContaFinanceira).filter(ContaFinanceira.id_conta_financeira == id_conta_financeira).first()
    if not conta_financeira:
        raise HTTPException(status_code=404, detail="Conta financeira não encontrada.")

    if db.query(FechamentoMensal).filter(
        FechamentoMensal.competencia == competencia, FechamentoMensal.id_conta_financeira == id_conta_financeira,
    ).first():
        raise HTTPException(status_code=400, detail=f"A competência {competencia} desta conta financeira já está fechada.")

    saldo_sistema = _saldo_sistema_ate_competencia(db, id_conta=conta_financeira.id_conta, competencia=competencia)
    divergencia = saldo_sistema - saldo_extrato_bancario
    if abs(divergencia) > TOLERANCIA_CENTAVOS:
        raise HTTPException(
            status_code=400,
            detail=f"Divergência de R$ {divergencia:.2f} entre o saldo do sistema (R$ {saldo_sistema:.2f}) e o saldo do extrato bancário (R$ {saldo_extrato_bancario:.2f}) - concilie antes de fechar o mês.",
        )

    fechamento = FechamentoMensal(
        competencia=competencia, id_conta_financeira=id_conta_financeira, saldo_sistema=saldo_sistema,
        saldo_extrato_bancario=saldo_extrato_bancario, divergencia=divergencia, id_usuario_conferencia=id_usuario,
    )
    db.add(fechamento)
    db.commit()
    db.refresh(fechamento)
    return fechamento


def listar_fechamentos(db: Session, *, competencia: Optional[str] = None) -> list[FechamentoMensal]:
    consulta = db.query(FechamentoMensal)
    if competencia:
        consulta = consulta.filter(FechamentoMensal.competencia == competencia)
    return consulta.order_by(FechamentoMensal.competencia.desc()).all()
