"""v3.4 (FASE 3) - doações, captação e recibos. Doação monetária vira `TituloFinanceiro` +
`LancamentoContabil` de verdade (débito na conta de caixa/banco escolhida, crédito na Receita da
doação) - nunca um número solto numa tabela à parte, mesmo espírito de todo o financeiro deste
projeto. Registrar a doação já É a confirmação de que o dinheiro chegou (mesmo padrão de
"doação em espécie/PIX na hora do evento, lançada depois pela tesouraria") - por isso título e
baixa nascem juntos, no mesmo passo, com o recibo numerado emitido na hora.

Destinação específica (`Doacao.id_centro_custo_destinacao`) só pode ser gasta ali - ver
`saldo_disponivel_centro_custo`, checado em app/services/compras.py::aprovar_solicitacao antes de
qualquer aprovação contra um centro de custo "restrito" (`CentroDeCusto.saldo_restrito`)."""
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.config_cache import obter_configuracao
from app.models.compras import SolicitacaoCompra
from app.models.doacoes import CampanhaArrecadacao, Doacao, RemanejamentoDestinacao
from app.models.financeiro import CentroDeCusto, PlanoDeContas, TituloFinanceiro
from app.services import contabilidade


def _proximo_numero_recibo(db: Session) -> int:
    maior = db.query(Doacao).filter(Doacao.numero_recibo.isnot(None)).count()
    return maior + 1


def registrar_doacao(
    db: Session, *, anonima: bool, nome_doador: Optional[str], documento_doador: Optional[str],
    id_associado: Optional[int], tipo_doacao: str, recorrente: bool, valor: Decimal,
    descricao_bem: Optional[str], id_campanha: Optional[int], id_centro_custo_destinacao: Optional[int],
    id_conta_contabil: int, id_conta_contabil_caixa: Optional[str], id_usuario: Optional[int],
) -> Doacao:
    if valor <= 0:
        raise HTTPException(status_code=400, detail="Valor da doação deve ser maior que zero.")
    if tipo_doacao not in ("Monetaria", "Bens"):
        raise HTTPException(status_code=400, detail="tipo_doacao precisa ser 'Monetaria' ou 'Bens'.")
    if not anonima and not (nome_doador and nome_doador.strip()):
        raise HTTPException(status_code=400, detail="Informe o nome do doador, ou marque a doação como anônima.")

    conta_receita = db.query(PlanoDeContas).filter(PlanoDeContas.id_conta == id_conta_contabil).first()
    if not conta_receita:
        raise HTTPException(status_code=404, detail="Conta contábil de receita não encontrada.")
    contabilidade.exigir_tipo_conta(conta_receita, ["Receita"], "A conta contábil de uma doação")

    if id_centro_custo_destinacao and not db.query(CentroDeCusto).filter(CentroDeCusto.id_centro_custo == id_centro_custo_destinacao).first():
        raise HTTPException(status_code=404, detail="Centro de custo de destinação não encontrado.")

    doacao = Doacao(
        anonima=anonima, nome_doador=None if anonima else nome_doador, documento_doador=None if anonima else documento_doador,
        id_associado=id_associado, tipo_doacao=tipo_doacao, recorrente=recorrente, valor=valor,
        descricao_bem=descricao_bem, id_campanha=id_campanha, id_centro_custo_destinacao=id_centro_custo_destinacao,
        id_conta_contabil=id_conta_contabil, id_usuario_registro=id_usuario,
        numero_recibo=_proximo_numero_recibo(db),
    )
    db.add(doacao)
    db.flush()

    if tipo_doacao == "Monetaria":
        if not id_conta_contabil_caixa:
            raise HTTPException(status_code=400, detail="Doação monetária exige a conta de caixa/banco que recebeu o valor.")
        conta_caixa = db.query(PlanoDeContas).filter(PlanoDeContas.id_conta == int(id_conta_contabil_caixa)).first()
        if not conta_caixa:
            raise HTTPException(status_code=404, detail="Conta contábil de caixa/banco não encontrada.")
        contabilidade.exigir_tipo_conta(conta_caixa, ["Ativo"], "A conta de caixa/banco de uma doação")

        exercicio = contabilidade.exigir_exercicio_aberto(db)
        titulo = TituloFinanceiro(
            tipo_titulo="A Receber", id_conta_contabil=id_conta_contabil, id_associado=id_associado,
            descricao=f"Doação #{doacao.id_doacao} — recibo nº {doacao.numero_recibo}",
            valor_original=valor, saldo_devedor=Decimal("0"), data_vencimento=datetime.utcnow(), status="Pago",
        )
        db.add(titulo)
        db.flush()
        doacao.id_titulo = titulo.id_titulo

        contabilidade.criar_lancamento(
            db, exercicio=exercicio, historico=f"Doação #{doacao.id_doacao} — recibo nº {doacao.numero_recibo}",
            tipo_origem="DOACAO", id_titulo=titulo.id_titulo, id_usuario=id_usuario,
            partidas=[
                (int(id_conta_contabil_caixa), contabilidade.DEBITO, valor, id_centro_custo_destinacao),
                (id_conta_contabil, contabilidade.CREDITO, valor, id_centro_custo_destinacao),
            ],
        )

    db.commit()
    db.refresh(doacao)
    return doacao


def gerar_texto_recibo(db: Session, doacao: Doacao) -> str:
    nome_instituicao = obter_configuracao(db, "NOME_INSTITUICAO", "ASAF - Associação Arca da Família")
    cnpj = obter_configuracao(db, "CNPJ", "") or "(CNPJ não configurado)"
    rodape = obter_configuracao(db, "TEXTO_PADRAO_DOCUMENTO", "") or ""
    doador = "Doador(a) anônimo(a)" if doacao.anonima else f"{doacao.nome_doador}" + (f" (doc. {doacao.documento_doador})" if doacao.documento_doador else "")
    natureza = "em bens (avaliação registrada)" if doacao.tipo_doacao == "Bens" else "em dinheiro"
    return (
        f"{nome_instituicao} — CNPJ {cnpj}\n"
        f"RECIBO DE DOAÇÃO Nº {doacao.numero_recibo}\n\n"
        f"Recebemos de {doador} a doação {natureza} no valor de R$ {doacao.valor:.2f}"
        + (f", referente a: {doacao.descricao_bem}" if doacao.descricao_bem else "")
        + f", em {doacao.data_doacao.strftime('%d/%m/%Y')}.\n\n"
        f"Este recibo não constitui, por si só, declaração de dedutibilidade fiscal — consulte a "
        f"situação tributária vigente da entidade antes de utilizá-lo para esse fim.\n"
        + (f"\n{rodape}\n" if rodape else "")
    )


def saldo_disponivel_centro_custo(db: Session, id_centro_custo: int) -> Decimal:
    """Saldo restrito = doações monetárias recebidas com essa destinação + remanejamentos de
    entrada - remanejamentos de saída - valor das solicitações de compra já Aprovadas/Pagas
    contra esse centro de custo. Nunca inclui doação em Bens (não é dinheiro disponível pra
    gastar) nem solicitação ainda "Aguardando Aprovação" (só compromete saldo quando de fato
    aprovada)."""
    doacoes = db.query(Doacao).filter(
        Doacao.id_centro_custo_destinacao == id_centro_custo, Doacao.tipo_doacao == "Monetaria",
    ).all()
    total_doado = sum((d.valor for d in doacoes), Decimal("0"))

    entradas = db.query(RemanejamentoDestinacao).filter(RemanejamentoDestinacao.id_centro_custo_destino == id_centro_custo).all()
    saidas = db.query(RemanejamentoDestinacao).filter(RemanejamentoDestinacao.id_centro_custo_origem == id_centro_custo).all()
    total_remanejado = sum((r.valor for r in entradas), Decimal("0")) - sum((r.valor for r in saidas), Decimal("0"))

    gastos = db.query(SolicitacaoCompra).filter(
        SolicitacaoCompra.id_centro_custo == id_centro_custo, SolicitacaoCompra.status.in_(["Aprovada"]),
    ).all()
    total_gasto = sum((s.valor_estimado for s in gastos), Decimal("0"))

    return total_doado + total_remanejado - total_gasto


def registrar_remanejamento(
    db: Session, *, id_centro_custo_origem: int, id_centro_custo_destino: int, valor: Decimal,
    motivo: str, id_usuario: Optional[int] = None,
) -> RemanejamentoDestinacao:
    if valor <= 0:
        raise HTTPException(status_code=400, detail="Valor do remanejamento deve ser maior que zero.")
    if id_centro_custo_origem == id_centro_custo_destino:
        raise HTTPException(status_code=400, detail="Origem e destino do remanejamento não podem ser o mesmo centro de custo.")
    for id_cc in (id_centro_custo_origem, id_centro_custo_destino):
        if not db.query(CentroDeCusto).filter(CentroDeCusto.id_centro_custo == id_cc).first():
            raise HTTPException(status_code=404, detail=f"Centro de custo #{id_cc} não encontrado.")

    saldo_origem = saldo_disponivel_centro_custo(db, id_centro_custo_origem)
    if valor > saldo_origem:
        raise HTTPException(status_code=400, detail=f"Saldo restrito insuficiente na origem (disponível: R$ {saldo_origem:.2f}).")

    remanejamento = RemanejamentoDestinacao(
        id_centro_custo_origem=id_centro_custo_origem, id_centro_custo_destino=id_centro_custo_destino,
        valor=valor, motivo=motivo, id_usuario_registro=id_usuario,
    )
    db.add(remanejamento)
    db.commit()
    db.refresh(remanejamento)
    return remanejamento
