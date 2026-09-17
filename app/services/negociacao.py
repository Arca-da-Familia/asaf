"""v3.2.2 (FASE 3) - negociação/parcelamento de débito em atraso: régua de cobrança (ver
app/services/lembretes.py) avisa, mas quando o associado procura a tesouraria pra regularizar, o
débito vencido vira um plano de parcelas novo, com termo de confissão de dívida registrado (em
texto - assinatura eletrônica de verdade fica pra FASE 20). Título original nunca é
editado/apagado - vira "Renegociado" (ver TituloFinanceiro.id_negociacao_origem), as parcelas
novas são títulos "A Receber" normais (id_negociacao_parcela), rastreáveis até a origem."""
import calendar
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.associados import Associado
from app.models.financeiro import NegociacaoDivida, TituloFinanceiro


def _somar_meses_data(data: datetime, quantidade: int) -> datetime:
    """`data` + N meses, sem depender de bibliotecas externas (mês 13 não existe) - mesmo
    princípio de app/services/contribuicoes.py::_somar_meses, mas operando em `datetime` direto
    em vez de competência "AAAA-MM"."""
    indice = (data.month - 1) + quantidade
    ano = data.year + indice // 12
    mes = indice % 12 + 1
    dia = min(data.day, calendar.monthrange(ano, mes)[1])
    return data.replace(year=ano, month=mes, day=dia)


def negociar_divida(
    db: Session, *, id_associado: int, ids_titulos_originais: list[int], quantidade_parcelas: int,
    termo: str, id_usuario: Optional[int] = None,
) -> NegociacaoDivida:
    if quantidade_parcelas < 1:
        raise HTTPException(status_code=400, detail="Quantidade de parcelas deve ser maior que zero.")
    if not ids_titulos_originais:
        raise HTTPException(status_code=400, detail="Informe ao menos um título para renegociar.")

    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    if not associado:
        raise HTTPException(status_code=404, detail="Associado não encontrado.")

    titulos_originais = db.query(TituloFinanceiro).filter(TituloFinanceiro.id_titulo.in_(ids_titulos_originais)).all()
    if len(titulos_originais) != len(set(ids_titulos_originais)):
        raise HTTPException(status_code=404, detail="Um ou mais títulos não foram encontrados.")
    for titulo in titulos_originais:
        if titulo.id_associado != id_associado:
            raise HTTPException(status_code=400, detail=f"Título #{titulo.id_titulo} não pertence a este associado.")
        if titulo.tipo_titulo != "A Receber":
            raise HTTPException(status_code=400, detail=f"Título #{titulo.id_titulo} não é 'A Receber' - só débito de associado pode ser renegociado.")
        if titulo.status != "Pendente":
            raise HTTPException(status_code=400, detail=f"Título #{titulo.id_titulo} não está pendente (status atual: '{titulo.status}') - só título em aberto pode ser renegociado.")

    valor_total = sum((t.saldo_devedor for t in titulos_originais), Decimal("0"))
    if valor_total <= 0:
        raise HTTPException(status_code=400, detail="Valor total a renegociar precisa ser maior que zero.")

    negociacao = NegociacaoDivida(
        id_associado=id_associado, valor_total=valor_total, quantidade_parcelas=quantidade_parcelas,
        termo=termo, id_usuario_registro=id_usuario,
    )
    db.add(negociacao)
    db.flush()

    # v3.2.2 - conta contábil das parcelas novas: reaproveita a do primeiro título original (na
    # prática, negociação sempre reúne débitos do mesmo plano/conta - misturar contas diferentes
    # numa única negociação é um caso de uso que ninguém pediu ainda).
    id_conta_contabil = titulos_originais[0].id_conta_contabil

    valor_parcela = (valor_total / quantidade_parcelas).quantize(Decimal("0.01"))
    soma_parcelas = Decimal("0")
    hoje = datetime.utcnow()
    for numero in range(1, quantidade_parcelas + 1):
        if numero == quantidade_parcelas:
            valor_desta_parcela = valor_total - soma_parcelas  # última absorve o arredondamento
        else:
            valor_desta_parcela = valor_parcela
        soma_parcelas += valor_desta_parcela

        db.add(TituloFinanceiro(
            tipo_titulo="A Receber", id_conta_contabil=id_conta_contabil, id_associado=id_associado,
            descricao=f"Parcela {numero}/{quantidade_parcelas} da negociação de dívida #{negociacao.id_negociacao}",
            valor_original=valor_desta_parcela, saldo_devedor=valor_desta_parcela,
            data_vencimento=_somar_meses_data(hoje, numero), status="Pendente",
            id_negociacao_parcela=negociacao.id_negociacao,
        ))

    for titulo in titulos_originais:
        titulo.status = "Renegociado"
        titulo.id_negociacao_origem = negociacao.id_negociacao

    db.commit()
    db.refresh(negociacao)
    return negociacao
