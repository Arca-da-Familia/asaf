"""v5.4h (FASE 5): lançamento tardio de uma saída registrada.

O sistema é só o REGISTRO do que já aconteceu no mundo real (decisão do Presidente, 2026-10-08): a saída foi paga (Pix, dinheiro, boleto) e é lançada depois.
Quanto mais tempo passa entre o pagamento e o lançamento, mais difícil é conferir: por isso a saída lançada depois do limite é marcada como tardia, no cartão da
Auditoria financeira do Conselho Fiscal e no relatório de exceção mensal (padrões suspeitos). O limite (em dias) é uma configuração
(`DIAS_ALERTA_LANCAMENTO_TARDIO`, padrão 5), ajustável na tela de Configurações."""
from datetime import date, datetime, tzinfo
from typing import Optional

from sqlalchemy.orm import Session

from app.config_cache import obter_configuracao
from app.models.financeiro import LancamentoContabil, TituloFinanceiro
from app.services.calendario import dia_local, fuso_da_associacao

CHAVE_DO_LIMITE = "DIAS_ALERTA_LANCAMENTO_TARDIO"
LIMITE_PADRAO_EM_DIAS = 5


def dias_para_lancamento_tardio(db: Session) -> int:
    valor = obter_configuracao(db, CHAVE_DO_LIMITE, str(LIMITE_PADRAO_EM_DIAS))
    try:
        return max(0, int(float(str(valor).strip())))
    except (TypeError, ValueError, OverflowError):
        return LIMITE_PADRAO_EM_DIAS


def hoje_da_associacao(db: Session) -> date:
    """O dia de hoje no fuso da associação (Belém), não no do servidor (UTC): às 22h30 de Belém o servidor já está no dia seguinte, e o lançamento feito \"hoje\" não pode contar um dia de atraso."""
    return dia_local(datetime.utcnow(), fuso_da_associacao(db))


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


def dias_ate_o_lancamento(titulo: TituloFinanceiro, pagamentos: dict[int, date], fuso: Optional[tzinfo] = None) -> Optional[int]:
    """Só para a saída registrada (a que veio com nota fiscal): quantos dias se passaram do pagamento até o lançamento no sistema. O dia do lançamento é o do fuso da associação (`fuso`),
    porque o instante fica gravado em UTC: um lançamento às 22h30 de Belém está gravado no dia seguinte."""
    if not titulo.nota_fiscal or not titulo.data_emissao:
        return None
    pago_em = pagamentos.get(titulo.id_titulo) or (titulo.data_vencimento.date() if titulo.data_vencimento else None)
    if pago_em is None:
        return None
    lancado_em = dia_local(titulo.data_emissao, fuso) if fuso is not None else titulo.data_emissao.date()
    return max(0, (lancado_em - pago_em).days)
