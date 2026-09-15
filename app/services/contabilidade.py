"""v3.0 (FASE 3) - núcleo do razão contábil: partida dobrada real (débito/crédito por linha,
sempre balanceada), natureza da conta e Exercício aberto/fechado. Fundação pra todo o financeiro
(módulo mais sensível do sistema) - nenhum router deve montar `LancamentoContabil`/
`PartidaContabil` na mão, sempre por aqui, pra nunca existir lançamento desbalanceado ou fora de
um exercício aberto."""
from decimal import Decimal
from typing import Optional, Sequence, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.financeiro import Exercicio, LancamentoContabil, PartidaContabil, PlanoDeContas

DEBITO = "Debito"
CREDITO = "Credito"

# v3.0 - os cinco tipos contábeis reais (catálogo `tipo_conta_contabil`, ver
# app/database.py::seed_catalogos) e a natureza que cada um tem. Devedora: débito aumenta,
# crédito diminui (Ativo, Despesa). Credora: crédito aumenta, débito diminui (Passivo,
# Patrimônio Líquido, Receita). Nunca guardada como coluna em `PlanoDeContas` de propósito -
# ver o docstring do modelo.
NATUREZA_POR_TIPO = {
    "Ativo": "Devedora",
    "Despesa": "Devedora",
    "Passivo": "Credora",
    "Patrimônio Líquido": "Credora",
    "Receita": "Credora",
}


def natureza_da_conta(tipo: str) -> str:
    natureza = NATUREZA_POR_TIPO.get(tipo)
    if natureza is None:
        raise HTTPException(status_code=400, detail=f"Tipo de conta contábil desconhecido: '{tipo}'. Use um dos: {', '.join(NATUREZA_POR_TIPO)}.")
    return natureza


def exigir_tipo_conta(conta: PlanoDeContas, tipos_validos: Sequence[str], contexto: str) -> None:
    if conta.tipo not in tipos_validos:
        raise HTTPException(
            status_code=400,
            detail=f"{contexto} precisa ser uma conta do tipo {' ou '.join(tipos_validos)} (esta é '{conta.tipo}').",
        )


def exigir_exercicio_aberto(db: Session) -> Exercicio:
    exercicio = db.query(Exercicio).filter(Exercicio.status == "Aberto").first()
    if not exercicio:
        raise HTTPException(status_code=400, detail="Nenhum exercício contábil aberto. Abra um exercício antes de lançar.")
    return exercicio


def criar_lancamento(
    db: Session,
    *,
    exercicio: Exercicio,
    historico: str,
    tipo_origem: str,
    partidas: Sequence[Tuple[int, str, Decimal]],
    id_titulo: Optional[int] = None,
    id_usuario: Optional[int] = None,
    forma_pagamento: Optional[str] = None,
) -> LancamentoContabil:
    """Cria um lançamento em partida dobrada real. `partidas` é uma lista de
    (id_conta, tipo_partida, valor), tipo_partida sendo DEBITO ou CREDITO - pode ter qualquer
    quantidade de linhas de cada lado (ex.: uma baixa rateada entre várias contas de despesa),
    desde que a soma dos débitos feche exatamente com a soma dos créditos. É a única trava que
    realmente importa num razão contábil, e é sempre recusada aqui, nunca deixada para quem
    chama garantir na mão."""
    if len(partidas) < 2:
        raise HTTPException(status_code=400, detail="Todo lançamento precisa de ao menos uma partida de débito e uma de crédito.")
    total_debito = sum((valor for _, tipo, valor in partidas if tipo == DEBITO), Decimal("0"))
    total_credito = sum((valor for _, tipo, valor in partidas if tipo == CREDITO), Decimal("0"))
    if total_debito <= 0 or total_credito <= 0:
        raise HTTPException(status_code=400, detail="Todo lançamento precisa de ao menos uma partida de débito e uma de crédito, com valor maior que zero.")
    if total_debito != total_credito:
        raise HTTPException(status_code=400, detail=f"Lançamento desbalanceado: débitos R$ {total_debito} != créditos R$ {total_credito}.")

    maior_numero = db.query(LancamentoContabil).filter(LancamentoContabil.id_exercicio == exercicio.id_exercicio).count()
    lancamento = LancamentoContabil(
        id_exercicio=exercicio.id_exercicio, numero_sequencial=maior_numero + 1,
        historico=historico, tipo_origem=tipo_origem, id_titulo=id_titulo,
        id_usuario_lancamento=id_usuario, forma_pagamento=forma_pagamento,
    )
    db.add(lancamento)
    db.flush()
    for id_conta, tipo_partida, valor in partidas:
        db.add(PartidaContabil(id_lancamento=lancamento.id_lancamento, id_conta=id_conta, tipo_partida=tipo_partida, valor=valor))
    db.flush()
    return lancamento


def estornar_lancamento(db: Session, *, original: LancamentoContabil, motivo: str, id_usuario: Optional[int] = None) -> LancamentoContabil:
    """Imutabilidade: o lançamento original nunca é editado nem apagado. A correção é um novo
    lançamento com cada partida invertida (débito vira crédito e vice-versa, mesmo valor) - o
    original só ganha a marca `estornado`/`motivo_estorno`/`id_lancamento_estorno`, permanece
    visível e consultável para sempre."""
    if original.estornado:
        raise HTTPException(status_code=400, detail="Este lançamento já foi estornado.")
    exercicio = exigir_exercicio_aberto(db)
    partidas_invertidas = [
        (p.id_conta, CREDITO if p.tipo_partida == DEBITO else DEBITO, p.valor)
        for p in original.partidas
    ]
    estorno = criar_lancamento(
        db, exercicio=exercicio,
        historico=f"Estorno do lançamento #{original.numero_sequencial}: {motivo}",
        tipo_origem="ESTORNO", partidas=partidas_invertidas,
        id_titulo=original.id_titulo, id_usuario=id_usuario,
    )
    original.estornado = True
    original.motivo_estorno = motivo
    original.id_lancamento_estorno = estorno.id_lancamento
    return estorno


def valor_total_lancamento(lancamento: LancamentoContabil) -> Decimal:
    """Valor "de fato" de um lançamento balanceado: a soma de qualquer um dos dois lados (são
    iguais por construção - ver `criar_lancamento`)."""
    return sum((p.valor for p in lancamento.partidas if p.tipo_partida == DEBITO), Decimal("0"))
