"""v3.3 (FASE 3) - contas a pagar recorrentes (aluguel, energia, contador): geração mensal
idempotente, espelhando `app/services/contribuicoes.py::gerar_cobrancas` pro lado "A Pagar" -
mesmo princípio de sempre (rodar duas vezes na mesma competência nunca duplica, garantido pela
`UniqueConstraint` do modelo, não só pela checagem aqui). Acionada pela mesma rotina mensal
automática que já gera cobrança e lembrete (v3.2.1, `scripts/tarefa_mensal_financeiro.py`),
alimentando previsão de fluxo de caixa - a diretoria vê o compromisso do mês assim que ele nasce,
não só quando a conta chega."""
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from app.models.compras import ContaAPagarRecorrente
from app.models.financeiro import TituloFinanceiro
from app.services.contribuicoes import data_vencimento_da_competencia


def gerar_contas_a_pagar(db: Session, *, competencia: str, confirmar: bool, id_usuario: Optional[int] = None) -> dict:
    contas = db.query(ContaAPagarRecorrente).filter(ContaAPagarRecorrente.ativo.is_(True)).all()
    ja_existentes = {
        t.id_conta_a_pagar_recorrente
        for t in db.query(TituloFinanceiro).filter(
            TituloFinanceiro.competencia == competencia,
            TituloFinanceiro.id_conta_a_pagar_recorrente.isnot(None),
        ).all()
    }

    detalhes: list[dict] = []
    valor_total = Decimal("0")
    total_gerados = total_ja_existentes = 0

    for conta in contas:
        if conta.id_conta_recorrente in ja_existentes:
            total_ja_existentes += 1
            continue

        detalhes.append({"id_conta_recorrente": conta.id_conta_recorrente, "descricao": conta.descricao, "valor": conta.valor})
        valor_total += conta.valor
        total_gerados += 1

        if confirmar:
            db.add(TituloFinanceiro(
                tipo_titulo="A Pagar", id_conta_contabil=conta.id_conta_contabil, id_fornecedor=conta.id_fornecedor,
                descricao=f"{conta.descricao} — competência {competencia}",
                valor_original=conta.valor, saldo_devedor=conta.valor,
                data_vencimento=data_vencimento_da_competencia(competencia, conta.dia_vencimento), status="Pendente",
                competencia=competencia, id_conta_a_pagar_recorrente=conta.id_conta_recorrente,
            ))

    if confirmar:
        db.commit()

    return {
        "competencia": competencia, "confirmado": confirmar,
        "total_gerados": total_gerados, "total_ja_existentes": total_ja_existentes,
        "valor_total": valor_total, "detalhes": detalhes,
    }
