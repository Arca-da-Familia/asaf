"""v3.6 (FASE 3) - demonstrativos financeiros (balancete por período, receitas x despesas por
conta/centro de custo, relatório de inadimplência, extrato por conta financeira, relatório por
projeto) e prestação de contas do exercício, versionada, com o parecer do Conselho Fiscal (v2.6)
já emitido anexado. Todo relatório é calculado na hora contra `PartidaContabil`/`TituloFinanceiro`
- nenhum número duplicado que possa dessincronizar do razão contábil de verdade, mesma disciplina
de `app.services.contabilidade.saldo_conta`."""
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.associados import Associado
from app.models.conselho_fiscal import ParecerPrestacaoContas
from app.models.financeiro import CentroDeCusto, ContaFinanceira, LancamentoContabil, PartidaContabil, PlanoDeContas, TituloFinanceiro
from app.models.projetos import ProjetoEvento
from app.models.relatorios import PrestacaoDeContas
from app.services.contabilidade import DEBITO, natureza_da_conta

DIAS_TOLERANCIA_INADIMPLENCIA_PADRAO = 30


def _contas_analiticas(db: Session) -> list[PlanoDeContas]:
    contas = db.query(PlanoDeContas).all()
    ids_com_filha = {c.codigo_contabil_pai for c in contas if c.codigo_contabil_pai}
    return [c for c in contas if c.codigo_contabil not in ids_com_filha]


def _data_referencia_lancamento(lancamento: LancamentoContabil) -> datetime:
    return lancamento.data_competencia or lancamento.data_lancamento


def _partidas_com_data(db: Session):
    """Todas as partidas do razão contábil, cada uma com a data de referência do lançamento
    (`data_competencia`, ou `data_lancamento` quando nula - mesma regra usada em todo o resto do
    financeiro desde a v3.1)."""
    data_referencia = func.coalesce(LancamentoContabil.data_competencia, LancamentoContabil.data_lancamento)
    return (
        db.query(PartidaContabil.id_conta, PartidaContabil.tipo_partida, PartidaContabil.valor, PartidaContabil.id_centro_custo, data_referencia)
        .join(LancamentoContabil, LancamentoContabil.id_lancamento == PartidaContabil.id_lancamento)
        .all()
    )


# ==========================================
# BALANCETE POR PERÍODO
# ==========================================
def balancete_por_periodo(db: Session, *, data_inicio: datetime, data_fim: datetime) -> list[dict]:
    if data_fim < data_inicio:
        raise HTTPException(status_code=400, detail="Data final não pode ser anterior à data inicial.")

    agregados: dict[int, dict] = {}
    for id_conta, tipo_partida, valor, _id_centro_custo, data_ref in _partidas_com_data(db):
        alvo = agregados.setdefault(id_conta, {"saldo_anterior": Decimal("0"), "debitos": Decimal("0"), "creditos": Decimal("0")})
        if data_ref < data_inicio:
            alvo["saldo_anterior"] += valor if tipo_partida == DEBITO else -valor
        elif data_ref <= data_fim:
            if tipo_partida == DEBITO:
                alvo["debitos"] += valor
            else:
                alvo["creditos"] += valor

    resultado = []
    for conta in _contas_analiticas(db):
        dados = agregados.get(conta.id_conta, {"saldo_anterior": Decimal("0"), "debitos": Decimal("0"), "creditos": Decimal("0")})
        natureza = natureza_da_conta(conta.tipo)
        saldo_anterior = dados["saldo_anterior"] if natureza == "Devedora" else -dados["saldo_anterior"]
        movimento_liquido = (dados["debitos"] - dados["creditos"]) if natureza == "Devedora" else (dados["creditos"] - dados["debitos"])
        resultado.append({
            "id_conta": conta.id_conta, "codigo_contabil": conta.codigo_contabil, "descricao_conta": conta.descricao_conta,
            "tipo": conta.tipo, "saldo_anterior": saldo_anterior, "debitos_periodo": dados["debitos"],
            "creditos_periodo": dados["creditos"], "saldo_atual": saldo_anterior + movimento_liquido,
        })
    return resultado


# ==========================================
# RECEITAS X DESPESAS
# ==========================================
def receitas_e_despesas_por_conta(db: Session, *, data_inicio: datetime, data_fim: datetime) -> list[dict]:
    balancete = balancete_por_periodo(db, data_inicio=data_inicio, data_fim=data_fim)
    return [
        {
            "id_conta": linha["id_conta"], "codigo_contabil": linha["codigo_contabil"], "descricao_conta": linha["descricao_conta"],
            "tipo": linha["tipo"], "valor_periodo": linha["saldo_atual"] - linha["saldo_anterior"],
        }
        for linha in balancete
        if linha["tipo"] in ("Receita", "Despesa") and linha["saldo_atual"] != linha["saldo_anterior"]
    ]


def receitas_e_despesas_por_centro_custo(db: Session, *, data_inicio: datetime, data_fim: datetime) -> list[dict]:
    contas = {c.id_conta: c for c in db.query(PlanoDeContas).all()}
    centros = {c.id_centro_custo: c for c in db.query(CentroDeCusto).all()}

    agregados: dict[Optional[int], dict] = {}
    for id_conta, tipo_partida, valor, id_centro_custo, data_ref in _partidas_com_data(db):
        if not (data_inicio <= data_ref <= data_fim):
            continue
        conta = contas.get(id_conta)
        if not conta or conta.tipo not in ("Receita", "Despesa"):
            continue
        alvo = agregados.setdefault(id_centro_custo, {"receitas": Decimal("0"), "despesas": Decimal("0")})
        valor_natural = valor if (conta.tipo == "Despesa") == (tipo_partida == DEBITO) else -valor
        if conta.tipo == "Receita":
            alvo["receitas"] += valor_natural
        else:
            alvo["despesas"] += valor_natural

    resultado = []
    for id_centro_custo, dados in agregados.items():
        centro = centros.get(id_centro_custo) if id_centro_custo is not None else None
        resultado.append({
            "id_centro_custo": id_centro_custo, "nome_centro_custo": centro.nome if centro else "Sem centro de custo",
            "receitas": dados["receitas"], "despesas": dados["despesas"], "resultado": dados["receitas"] - dados["despesas"],
        })
    return resultado


# ==========================================
# INADIMPLÊNCIA
# ==========================================
def relatorio_inadimplencia(db: Session) -> list[dict]:
    hoje = datetime.utcnow()
    inadimplentes = db.query(Associado).filter(Associado.status_arrolamento == "Ativo - Inadimplente").all()

    resultado = []
    for associado in inadimplentes:
        titulos_vencidos = (
            db.query(TituloFinanceiro)
            .filter(
                TituloFinanceiro.id_associado == associado.id_associado, TituloFinanceiro.tipo_titulo == "A Receber",
                TituloFinanceiro.status == "Pendente", TituloFinanceiro.data_vencimento < hoje,
            )
            .all()
        )
        if not titulos_vencidos:
            continue
        resultado.append({
            "id_associado": associado.id_associado, "nome_completo": associado.nome_completo,
            "quantidade_titulos_vencidos": len(titulos_vencidos),
            "total_devido": sum((t.saldo_devedor for t in titulos_vencidos), Decimal("0")),
            "dias_atraso_maximo": max((hoje - t.data_vencimento).days for t in titulos_vencidos),
        })
    return sorted(resultado, key=lambda r: r["dias_atraso_maximo"], reverse=True)


# ==========================================
# EXTRATO POR CONTA FINANCEIRA
# ==========================================
def extrato_conta_financeira(db: Session, *, id_conta_financeira: int, data_inicio: Optional[datetime], data_fim: Optional[datetime]) -> dict:
    conta_financeira = db.query(ContaFinanceira).filter(ContaFinanceira.id_conta_financeira == id_conta_financeira).first()
    if not conta_financeira:
        raise HTTPException(status_code=404, detail="Conta financeira não encontrada.")

    movimentos = []
    for id_conta, tipo_partida, valor, _id_centro_custo, data_ref in _partidas_com_data(db):
        if id_conta != conta_financeira.id_conta:
            continue
        movimentos.append((data_ref, tipo_partida, valor))
    movimentos.sort(key=lambda m: m[0])

    linhas = []
    saldo_corrente = Decimal("0")
    for data_ref, tipo_partida, valor in movimentos:
        saldo_corrente += valor if tipo_partida == DEBITO else -valor
        if data_inicio is not None and data_ref < data_inicio:
            continue
        if data_fim is not None and data_ref > data_fim:
            continue
        linhas.append({"data": data_ref, "tipo_partida": tipo_partida, "valor": valor, "saldo_apos": saldo_corrente})

    return {"id_conta_financeira": id_conta_financeira, "saldo_atual": saldo_corrente, "movimentos": linhas}


# ==========================================
# RELATÓRIO POR PROJETO
# ==========================================
def relatorio_por_projeto(db: Session, *, data_inicio: datetime, data_fim: datetime) -> list[dict]:
    por_centro_custo = receitas_e_despesas_por_centro_custo(db, data_inicio=data_inicio, data_fim=data_fim)
    centros = {c.id_centro_custo: c for c in db.query(CentroDeCusto).filter(CentroDeCusto.id_projeto.isnot(None)).all()}
    projetos = {p.id_projeto: p for p in db.query(ProjetoEvento).all()}

    resultado = []
    for linha in por_centro_custo:
        centro = centros.get(linha["id_centro_custo"])
        if not centro:
            continue
        projeto = projetos.get(centro.id_projeto)
        resultado.append({
            "id_projeto": centro.id_projeto, "nome_projeto": projeto.nome_projeto if projeto else f"Projeto #{centro.id_projeto}",
            "id_centro_custo": centro.id_centro_custo, "receitas": linha["receitas"], "despesas": linha["despesas"],
            "resultado": linha["resultado"],
        })
    return resultado


# ==========================================
# PRESTAÇÃO DE CONTAS DO EXERCÍCIO (versionada)
# ==========================================
def _gerar_texto_prestacao(db: Session, *, ano_exercicio: int, parecer: Optional[ParecerPrestacaoContas]) -> str:
    inicio_ano = datetime(ano_exercicio, 1, 1)
    fim_ano = datetime(ano_exercicio, 12, 31, 23, 59, 59)
    balancete = balancete_por_periodo(db, data_inicio=inicio_ano, data_fim=fim_ano)
    receitas_despesas = receitas_e_despesas_por_conta(db, data_inicio=inicio_ano, data_fim=fim_ano)

    total_receitas = sum((l["valor_periodo"] for l in receitas_despesas if l["tipo"] == "Receita"), Decimal("0"))
    total_despesas = sum((l["valor_periodo"] for l in receitas_despesas if l["tipo"] == "Despesa"), Decimal("0"))

    linhas = [
        f"PRESTAÇÃO DE CONTAS — EXERCÍCIO {ano_exercicio}",
        "",
        "1. BALANCETE (saldo por conta contábil)",
    ]
    for l in balancete:
        if l["saldo_atual"] == 0 and l["debitos_periodo"] == 0 and l["creditos_periodo"] == 0:
            continue
        linhas.append(f"   {l['codigo_contabil']} — {l['descricao_conta']}: saldo R$ {l['saldo_atual']:.2f}")

    linhas += ["", "2. RECEITAS X DESPESAS DO EXERCÍCIO"]
    for l in receitas_despesas:
        linhas.append(f"   [{l['tipo']}] {l['codigo_contabil']} — {l['descricao_conta']}: R$ {l['valor_periodo']:.2f}")
    linhas.append(f"   TOTAL RECEITAS: R$ {total_receitas:.2f} — TOTAL DESPESAS: R$ {total_despesas:.2f} — RESULTADO: R$ {(total_receitas - total_despesas):.2f}")

    linhas += ["", "3. PARECER DO CONSELHO FISCAL"]
    if parecer:
        linhas.append(f"   Parecer {parecer.tipo} (emitido em {parecer.criado_em.date().isoformat() if parecer.criado_em else '?'}):")
        linhas.append(f"   {parecer.texto}")
    else:
        linhas.append("   Nenhum parecer do Conselho Fiscal emitido para este exercício até o momento da geração.")

    return "\n".join(linhas)


def gerar_prestacao_de_contas(db: Session, *, ano_exercicio: int, id_usuario: Optional[int]) -> PrestacaoDeContas:
    parecer = (
        db.query(ParecerPrestacaoContas)
        .filter(ParecerPrestacaoContas.ano_exercicio == ano_exercicio)
        .order_by(ParecerPrestacaoContas.criado_em.desc())
        .first()
    )
    conteudo = _gerar_texto_prestacao(db, ano_exercicio=ano_exercicio, parecer=parecer)

    ultima_versao = (
        db.query(func.max(PrestacaoDeContas.versao))
        .filter(PrestacaoDeContas.ano_exercicio == ano_exercicio)
        .scalar()
    ) or 0

    prestacao = PrestacaoDeContas(
        ano_exercicio=ano_exercicio, versao=ultima_versao + 1, conteudo=conteudo,
        id_parecer=parecer.id_parecer if parecer else None, id_usuario_geracao=id_usuario,
    )
    db.add(prestacao)
    db.commit()
    db.refresh(prestacao)
    return prestacao


def listar_prestacoes_de_contas(db: Session, *, ano_exercicio: Optional[int] = None) -> list[PrestacaoDeContas]:
    consulta = db.query(PrestacaoDeContas)
    if ano_exercicio is not None:
        consulta = consulta.filter(PrestacaoDeContas.ano_exercicio == ano_exercicio)
    return consulta.order_by(PrestacaoDeContas.ano_exercicio.desc(), PrestacaoDeContas.versao.desc()).all()
