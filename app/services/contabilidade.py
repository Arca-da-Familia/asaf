"""v3.0 (FASE 3) - núcleo do razão contábil: partida dobrada real (débito/crédito por linha,
sempre balanceada), natureza da conta e Exercício aberto/fechado. Fundação pra todo o financeiro
(módulo mais sensível do sistema) - nenhum router deve montar `LancamentoContabil`/
`PartidaContabil` na mão, sempre por aqui, pra nunca existir lançamento desbalanceado ou fora de
um exercício aberto."""
from datetime import datetime
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


def exigir_conta_analitica(db: Session, id_conta: int) -> PlanoDeContas:
    """v3.1 - conta sintética (que tem conta(s) filha(s) apontando `codigo_contabil_pai` pra
    ela) nunca recebe lançamento direto, só a analítica (folha da árvore) - checado aqui, o
    único ponto por onde `PartidaContabil.id_conta` é gravado (ver `criar_lancamento`), nunca
    confiado a quem chama."""
    conta = db.query(PlanoDeContas).filter(PlanoDeContas.id_conta == id_conta).first()
    if not conta:
        raise HTTPException(status_code=404, detail=f"Conta contábil #{id_conta} não encontrada.")
    tem_filha = db.query(PlanoDeContas.id_conta).filter(PlanoDeContas.codigo_contabil_pai == conta.codigo_contabil).first()
    if tem_filha:
        raise HTTPException(
            status_code=400,
            detail=f"A conta '{conta.codigo_contabil} — {conta.descricao_conta}' é sintética (tem contas filhas) e não pode receber lançamento direto - use uma conta analítica.",
        )
    return conta


def saldo_conta(db: Session, id_conta: int) -> Decimal:
    """Saldo de uma conta contábil, sempre calculado somando `PartidaContabil` daquela conta
    (débito soma, crédito subtrai) - nunca um campo de saldo editável. Mesma mecânica que já
    existia desde a v3.0 para o indicador "saldo em contas Ativo" do livro-caixa (ver
    app/routers/financeiro.py::listar_livro_caixa), generalizada aqui pra qualquer conta -
    usada formalmente pela v3.1 em `ContaFinanceira`."""
    saldo = Decimal("0")
    for tipo_partida, valor in db.query(PartidaContabil.tipo_partida, PartidaContabil.valor).filter(PartidaContabil.id_conta == id_conta):
        saldo += valor if tipo_partida == DEBITO else -valor
    return saldo


def criar_lancamento(
    db: Session,
    *,
    exercicio: Exercicio,
    historico: str,
    tipo_origem: str,
    partidas: Sequence[Tuple],
    id_titulo: Optional[int] = None,
    id_usuario: Optional[int] = None,
    forma_pagamento: Optional[str] = None,
    data_competencia: Optional[datetime] = None,
    data_caixa: Optional[datetime] = None,
    comprovante: Optional[str] = None,
) -> LancamentoContabil:
    """Cria um lançamento em partida dobrada real. `partidas` é uma lista de
    (id_conta, tipo_partida, valor) ou (id_conta, tipo_partida, valor, id_centro_custo),
    tipo_partida sendo DEBITO ou CREDITO - pode ter qualquer quantidade de linhas de cada lado
    (ex.: uma baixa rateada entre várias contas de despesa), desde que a soma dos débitos feche
    exatamente com a soma dos créditos. É a única trava que realmente importa num razão
    contábil, e é sempre recusada aqui, nunca deixada para quem chama garantir na mão.

    v3.1 - toda `id_conta` de toda partida precisa ser uma conta ANALÍTICA (ver
    `exigir_conta_analitica`); `data_competencia`/`data_caixa` separam regime de competência de
    caixa (`data_caixa` default hoje, `data_competencia` default igual a `data_caixa` quando não
    informada - nunca fica nula de propósito num lançamento novo)."""
    partidas_norm = [(p[0], p[1], p[2], p[3] if len(p) > 3 else None) for p in partidas]
    if len(partidas_norm) < 2:
        raise HTTPException(status_code=400, detail="Todo lançamento precisa de ao menos uma partida de débito e uma de crédito.")
    total_debito = sum((valor for _, tipo, valor, _ in partidas_norm if tipo == DEBITO), Decimal("0"))
    total_credito = sum((valor for _, tipo, valor, _ in partidas_norm if tipo == CREDITO), Decimal("0"))
    if total_debito <= 0 or total_credito <= 0:
        raise HTTPException(status_code=400, detail="Todo lançamento precisa de ao menos uma partida de débito e uma de crédito, com valor maior que zero.")
    if total_debito != total_credito:
        raise HTTPException(status_code=400, detail=f"Lançamento desbalanceado: débitos R$ {total_debito} != créditos R$ {total_credito}.")
    for id_conta, _, _, _ in partidas_norm:
        exigir_conta_analitica(db, id_conta)

    agora = datetime.utcnow()
    data_caixa_final = data_caixa or agora
    maior_numero = db.query(LancamentoContabil).filter(LancamentoContabil.id_exercicio == exercicio.id_exercicio).count()
    lancamento = LancamentoContabil(
        id_exercicio=exercicio.id_exercicio, numero_sequencial=maior_numero + 1,
        historico=historico, tipo_origem=tipo_origem, id_titulo=id_titulo,
        id_usuario_lancamento=id_usuario, forma_pagamento=forma_pagamento,
        data_lancamento=data_caixa_final, data_competencia=data_competencia or data_caixa_final,
        comprovante=comprovante,
    )
    db.add(lancamento)
    db.flush()
    for id_conta, tipo_partida, valor, id_centro_custo in partidas_norm:
        db.add(PartidaContabil(
            id_lancamento=lancamento.id_lancamento, id_conta=id_conta, tipo_partida=tipo_partida,
            valor=valor, id_centro_custo=id_centro_custo,
        ))
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
        (p.id_conta, CREDITO if p.tipo_partida == DEBITO else DEBITO, p.valor, p.id_centro_custo)
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


def exige_comprovante(db: Session, tipo_conta: str) -> bool:
    """v3.1 - "anexo de comprovante obrigatório por tipo de lançamento (configurável)": lido do
    catálogo `tipo_conta_contabil` (`OpcaoCatalogo.metadados["exige_comprovante"]`), o mesmo
    catálogo genérico que já define os cinco tipos contábeis - a diretoria liga/desliga pelo
    admin de catálogos (v0.3.1) sem deploy. Ausência de `metadados`/flag = não exige (mudança de
    comportamento só quando alguém decide ligar de propósito)."""
    from app.models.core import Catalogo, OpcaoCatalogo  # import local: financeiro não depende de core em nível de módulo

    opcao = (
        db.query(OpcaoCatalogo)
        .join(Catalogo, Catalogo.id_catalogo == OpcaoCatalogo.id_catalogo)
        .filter(Catalogo.chave == "tipo_conta_contabil", OpcaoCatalogo.rotulo == tipo_conta)
        .first()
    )
    if not opcao or not opcao.metadados:
        return False
    return bool(opcao.metadados.get("exige_comprovante"))
