"""v5.4h (FASE 5): lançamento tardio de uma saída registrada.

O sistema é só o REGISTRO do que já aconteceu no mundo real (decisão do Presidente, 2026-10-08): a saída foi paga (Pix, dinheiro, boleto) e é lançada depois.
Quanto mais tempo passa entre o pagamento e o lançamento, mais difícil é conferir: por isso a saída lançada depois do limite é marcada como tardia, no cartão da
Auditoria financeira do Conselho Fiscal e no relatório de exceção mensal (padrões suspeitos). O limite (em dias) é uma configuração
(`DIAS_ALERTA_LANCAMENTO_TARDIO`, padrão 5), ajustável na tela de Configurações."""
from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from app.config_cache import obter_configuracao
from app.models.financeiro import LancamentoContabil, TituloFinanceiro

CHAVE_DO_LIMITE = "DIAS_ALERTA_LANCAMENTO_TARDIO"
LIMITE_PADRAO_EM_DIAS = 5


def dias_para_lancamento_tardio(db: Session) -> int:
    valor = obter_configuracao(db, CHAVE_DO_LIMITE, str(LIMITE_PADRAO_EM_DIAS))
    try:
        return max(0, int(float(str(valor).strip())))
    except (TypeError, ValueError, OverflowError):
        return LIMITE_PADRAO_EM_DIAS


def datas_de_pagamento(db: Session, ids_titulos: list[int]) -> dict[int, date]:
    """A data em que cada título foi pago (a primeira baixa que não foi estornada), por título. É a data que a pessoa informou ao registrar a saída."""
    if not ids_titulos:
        return {}
    pagamentos: dict[int, date] = {}
    baixas = (
        db.query(LancamentoContabil)
        .filter(
            LancamentoContabil.id_titulo.in_(ids_titulos), LancamentoContabil.tipo_origem == "BAIXA_TITULO", LancamentoContabil.estornado.is_(False),
        )
        .order_by(LancamentoContabil.id_lancamento)
        .all()
    )
    for baixa in baixas:
        data = baixa.data_competencia or baixa.data_lancamento
        if data is not None:
            pagamentos.setdefault(baixa.id_titulo, data.date())
    return pagamentos


def dias_ate_o_lancamento(titulo: TituloFinanceiro, pagamentos: dict[int, date]) -> Optional[int]:
    """Só para a saída registrada (a que veio com nota fiscal): quantos dias se passaram do pagamento até o lançamento no sistema."""
    if not titulo.nota_fiscal or not titulo.data_emissao:
        return None
    pago_em = pagamentos.get(titulo.id_titulo) or (titulo.data_vencimento.date() if titulo.data_vencimento else None)
    if pago_em is None:
        return None
    return max(0, (titulo.data_emissao.date() - pago_em).days)
