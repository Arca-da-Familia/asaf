"""v3.5 (FASE 3) - orçamento anual (realizado x previsto calculado contra `PartidaContabil`, nunca
guardado em coluna própria - mesma disciplina de `saldo_conta`), fluxo de caixa projetado
(cobranças a receber + contas a pagar já geradas + contas a pagar recorrentes ainda não geradas,
horizonte configurável) e reserva de contingência (uma `ContaFinanceira` marcada, com regra de uso
em texto)."""
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import extract, func
from sqlalchemy.orm import Session

from app.config_cache import obter_configuracao
from app.models.ata import CONCLUIDA, Deliberacao
from app.models.compras import ContaAPagarRecorrente
from app.models.financeiro import CentroDeCusto, ContaFinanceira, LancamentoContabil, PartidaContabil, PlanoDeContas, TituloFinanceiro
from app.models.orcamento import Orcamento, ReservaContingencia
from app.services.contabilidade import DEBITO, natureza_da_conta, saldo_conta
from app.services.contribuicoes import data_vencimento_da_competencia

_HORIZONTE_PADRAO_MESES = 3


def _mes_ano(competencia: str) -> tuple[int, int]:
    try:
        ano_str, mes_str = competencia.split("-")
        ano, mes = int(ano_str), int(mes_str)
        if not (1 <= mes <= 12):
            raise ValueError
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="Competência inválida - use o formato AAAA-MM.")
    return ano, mes


def _somar_meses(competencia: str, quantidade: int) -> str:
    """"AAAA-MM" + N meses, sem depender de `datetime` (mês 13 não existe) - mesma lógica de
    `app.services.contribuicoes._somar_meses`, copiada aqui porque é privada daquele módulo."""
    ano, mes = _mes_ano(competencia)
    indice = (mes - 1) + quantidade
    return f"{ano + indice // 12:04d}-{indice % 12 + 1:02d}"


def _exigir_deliberacao_concluida(db: Session, id_deliberacao: int) -> Deliberacao:
    deliberacao = db.query(Deliberacao).filter(Deliberacao.id_deliberacao == id_deliberacao).first()
    if not deliberacao:
        raise HTTPException(status_code=404, detail="Deliberação não encontrada.")
    if deliberacao.status_execucao != CONCLUIDA:
        raise HTTPException(status_code=400, detail="A deliberação que aprova isto precisa estar 'Concluída' - orçamento/reserva não nasce de deliberação ainda pendente.")
    return deliberacao


# ==========================================
# ORÇAMENTO
# ==========================================
def criar_orcamento(
    db: Session, *, ano: int, id_conta_contabil: int, id_centro_custo: Optional[int], valor_previsto: Decimal,
    id_deliberacao: int, id_usuario: Optional[int],
) -> Orcamento:
    conta = db.query(PlanoDeContas).filter(PlanoDeContas.id_conta == id_conta_contabil).first()
    if not conta:
        raise HTTPException(status_code=404, detail="Conta contábil não encontrada.")
    if id_centro_custo is not None and not db.query(CentroDeCusto).filter(CentroDeCusto.id_centro_custo == id_centro_custo).first():
        raise HTTPException(status_code=404, detail="Centro de custo não encontrado.")
    _exigir_deliberacao_concluida(db, id_deliberacao)

    existente = db.query(Orcamento).filter(
        Orcamento.ano == ano, Orcamento.id_conta_contabil == id_conta_contabil, Orcamento.id_centro_custo == id_centro_custo,
    ).first()
    if existente:
        raise HTTPException(status_code=400, detail="Já existe orçamento para esta conta/centro de custo neste ano - edite ou registre um remanejamento, nunca duas linhas para o mesmo lugar.")

    orcamento = Orcamento(
        ano=ano, id_conta_contabil=id_conta_contabil, id_centro_custo=id_centro_custo, valor_previsto=valor_previsto,
        id_deliberacao=id_deliberacao, id_usuario_registro=id_usuario,
    )
    db.add(orcamento)
    db.commit()
    db.refresh(orcamento)
    return orcamento


def realizado_do_orcamento(db: Session, orcamento: Orcamento) -> Decimal:
    """Soma `PartidaContabil` da conta (e, se houver, do centro de custo) do orçamento, só do
    exercício/ano dele - nunca um campo próprio que possa dessincronizar do razão contábil (mesma
    disciplina de `app.services.contabilidade.saldo_conta`, recortado por ano e, opcionalmente,
    por centro de custo). `data_competencia` nula (lançamento pré-v3.1) é tratada como igual à
    data de caixa, mesma regra já usada em todo o resto do financeiro (ver `LancamentoContabil`)."""
    conta = db.query(PlanoDeContas).filter(PlanoDeContas.id_conta == orcamento.id_conta_contabil).first()
    if not conta:
        raise HTTPException(status_code=404, detail="Conta contábil do orçamento não encontrada.")
    natureza = natureza_da_conta(conta.tipo)

    data_referencia = func.coalesce(LancamentoContabil.data_competencia, LancamentoContabil.data_lancamento)
    consulta = (
        db.query(PartidaContabil.tipo_partida, PartidaContabil.valor)
        .join(LancamentoContabil, LancamentoContabil.id_lancamento == PartidaContabil.id_lancamento)
        .filter(PartidaContabil.id_conta == orcamento.id_conta_contabil)
        .filter(extract("year", data_referencia) == orcamento.ano)
    )
    if orcamento.id_centro_custo is not None:
        consulta = consulta.filter(PartidaContabil.id_centro_custo == orcamento.id_centro_custo)

    debitos = creditos = Decimal("0")
    for tipo_partida, valor in consulta:
        if tipo_partida == DEBITO:
            debitos += valor
        else:
            creditos += valor
    return debitos - creditos if natureza == "Devedora" else creditos - debitos


def _serializar_orcamento(db: Session, orcamento: Orcamento) -> dict:
    realizado = realizado_do_orcamento(db, orcamento)
    percentual = (realizado / orcamento.valor_previsto * 100) if orcamento.valor_previsto else None
    return {
        "id_orcamento": orcamento.id_orcamento, "ano": orcamento.ano, "id_conta_contabil": orcamento.id_conta_contabil,
        "id_centro_custo": orcamento.id_centro_custo, "valor_previsto": orcamento.valor_previsto,
        "id_deliberacao": orcamento.id_deliberacao, "realizado": realizado,
        "percentual_realizado": percentual, "estourado": realizado > orcamento.valor_previsto,
    }


def listar_orcamentos(db: Session, *, ano: Optional[int] = None) -> list[dict]:
    consulta = db.query(Orcamento)
    if ano is not None:
        consulta = consulta.filter(Orcamento.ano == ano)
    return [_serializar_orcamento(db, o) for o in consulta.order_by(Orcamento.ano.desc(), Orcamento.id_conta_contabil).all()]


# ==========================================
# FLUXO DE CAIXA PROJETADO
# ==========================================
def horizonte_fluxo_caixa_meses(db: Session) -> int:
    return int(obter_configuracao(db, "HORIZONTE_FLUXO_CAIXA_MESES", str(_HORIZONTE_PADRAO_MESES)))


def fluxo_de_caixa_projetado(db: Session, *, competencia_inicial: str, horizonte_meses: Optional[int] = None) -> dict:
    """Projeta mês a mês (a partir de `competencia_inicial`, "AAAA-MM"): saldo inicial (soma das
    `ContaFinanceira` ativas, saldo de verdade contra o razão) + entradas (títulos "A Receber"
    pendentes vencendo no mês) - saídas (títulos "A Pagar" pendentes vencendo no mês, MAIS contas
    a pagar recorrentes ativas que ainda não geraram título para aquela competência - ver
    `app/services/contas_a_pagar.py::gerar_contas_a_pagar`, mesma checagem de idempotência,
    nunca conta em dobro quando a rotina mensal já rodou). Responde "tem dinheiro pra pagar o mês
    que vem" sem planilha paralela - tudo calculado contra dado real na hora."""
    horizonte = horizonte_meses if horizonte_meses is not None else horizonte_fluxo_caixa_meses(db)
    if horizonte < 1:
        raise HTTPException(status_code=400, detail="Horizonte precisa ser de pelo menos 1 mês.")

    contas_ativas = db.query(ContaFinanceira).filter(ContaFinanceira.ativo.is_(True)).all()
    saldo = sum((saldo_conta(db, c.id_conta) for c in contas_ativas), Decimal("0"))

    contas_a_pagar_recorrentes = db.query(ContaAPagarRecorrente).filter(ContaAPagarRecorrente.ativo.is_(True)).all()

    meses: list[dict] = []
    competencia = competencia_inicial
    for _ in range(horizonte):
        ano, mes = _mes_ano(competencia)
        inicio_mes = data_vencimento_da_competencia(competencia, 1)
        fim_mes = data_vencimento_da_competencia(competencia, 31)  # `min(dia, ultimo_dia)` já trata o mês curto

        entradas = (
            db.query(func.coalesce(func.sum(TituloFinanceiro.saldo_devedor), Decimal("0")))
            .filter(
                TituloFinanceiro.tipo_titulo == "A Receber", TituloFinanceiro.status == "Pendente",
                TituloFinanceiro.data_vencimento >= inicio_mes, TituloFinanceiro.data_vencimento <= fim_mes,
            )
            .scalar()
        )
        saidas_lancadas = (
            db.query(func.coalesce(func.sum(TituloFinanceiro.saldo_devedor), Decimal("0")))
            .filter(
                TituloFinanceiro.tipo_titulo == "A Pagar", TituloFinanceiro.status == "Pendente",
                TituloFinanceiro.data_vencimento >= inicio_mes, TituloFinanceiro.data_vencimento <= fim_mes,
            )
            .scalar()
        )

        ja_geradas = {
            t.id_conta_a_pagar_recorrente
            for t in db.query(TituloFinanceiro.id_conta_a_pagar_recorrente).filter(
                TituloFinanceiro.competencia == competencia, TituloFinanceiro.id_conta_a_pagar_recorrente.isnot(None),
            )
        }
        recorrentes_projetadas = sum(
            (c.valor for c in contas_a_pagar_recorrentes if c.id_conta_recorrente not in ja_geradas), Decimal("0"),
        )

        saidas = saidas_lancadas + recorrentes_projetadas
        saldo_inicial_mes = saldo
        saldo = saldo_inicial_mes + entradas - saidas

        meses.append({
            "competencia": competencia, "saldo_inicial": saldo_inicial_mes, "entradas_previstas": entradas,
            "saidas_previstas": saidas, "recorrentes_projetadas": recorrentes_projetadas, "saldo_final": saldo,
        })
        competencia = _somar_meses(competencia, 1)

    return {"horizonte_meses": horizonte, "meses": meses}


# ==========================================
# RESERVA DE CONTINGÊNCIA
# ==========================================
def criar_reserva_contingencia(
    db: Session, *, id_conta_financeira: int, regra_uso: str, valor_minimo: Optional[Decimal],
    id_deliberacao: Optional[int], id_usuario: Optional[int],
) -> ReservaContingencia:
    conta_financeira = db.query(ContaFinanceira).filter(ContaFinanceira.id_conta_financeira == id_conta_financeira).first()
    if not conta_financeira:
        raise HTTPException(status_code=404, detail="Conta financeira não encontrada.")
    if db.query(ReservaContingencia).filter(ReservaContingencia.id_conta_financeira == id_conta_financeira).first():
        raise HTTPException(status_code=400, detail="Esta conta financeira já é uma reserva de contingência.")
    if id_deliberacao is not None:
        _exigir_deliberacao_concluida(db, id_deliberacao)

    reserva = ReservaContingencia(
        id_conta_financeira=id_conta_financeira, regra_uso=regra_uso, valor_minimo=valor_minimo,
        id_deliberacao=id_deliberacao, id_usuario_registro=id_usuario,
    )
    db.add(reserva)
    db.commit()
    db.refresh(reserva)
    return reserva


def listar_reservas_contingencia(db: Session) -> list[dict]:
    reservas = db.query(ReservaContingencia).all()
    return [
        {
            "id_reserva": r.id_reserva, "id_conta_financeira": r.id_conta_financeira, "regra_uso": r.regra_uso,
            "valor_minimo": r.valor_minimo, "id_deliberacao": r.id_deliberacao,
            "saldo_atual": saldo_conta(db, db.query(ContaFinanceira).filter(ContaFinanceira.id_conta_financeira == r.id_conta_financeira).first().id_conta),
        }
        for r in reservas
    ]
