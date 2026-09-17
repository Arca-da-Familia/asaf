"""v3.2 (FASE 3) - mensalidades e cobrança recorrente: valor vigente de um `PlanoDeContribuicao`
(versionado por reajuste), geração de `TituloFinanceiro` em lote por competência (idempotente -
ver `TituloFinanceiro.uq_titulo_cobranca_por_competencia`), isenção/desconto e aplicação de
crédito de associado. Reaproveita o `TituloFinanceiro`/`baixar_titulo` que já existem desde a
v2.6/v3.0 - uma "Cobrança" é só um título "A Receber" que nasce em lote, nunca um conceito
paralelo com sua própria baixa/estorno/auditoria."""
import calendar
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.associados import Associado, DependenteFamiliar
from app.models.financeiro import CreditoAssociado, Exercicio, IsencaoContribuicao, PlanoDeContribuicao, TituloFinanceiro, ValorPlanoContribuicao
from app.services import contabilidade

# v3.2 - status de arrolamento (catálogo `status_arrolamento`, v0.1/v0.2) que ainda geram
# cobrança - "Desligado", "Licenciado" e "Suspenso (Estatuto)" não são cobrados enquanto durar a
# condição (ajustável aqui se a diretoria decidir diferente, mas nunca hardcoded dentro do loop
# de geração).
STATUS_ELEGIVEIS_PARA_COBRANCA = {"Ativo - Em Dia", "Ativo - Inadimplente", "Em Experiência"}


def _mes_ano(competencia: str) -> tuple[int, int]:
    try:
        ano_str, mes_str = competencia.split("-")
        ano, mes = int(ano_str), int(mes_str)
        if not (1 <= mes <= 12):
            raise ValueError
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="Competência inválida - use o formato AAAA-MM.")
    return ano, mes


def data_vencimento_da_competencia(competencia: str, dia_vencimento: int) -> datetime:
    ano, mes = _mes_ano(competencia)
    ultimo_dia = calendar.monthrange(ano, mes)[1]
    return datetime(ano, mes, min(dia_vencimento, ultimo_dia))


def valor_vigente(db: Session, id_plano: int, data_referencia: datetime) -> Decimal:
    """Valor vigente na data de referência - nunca o valor atual, sempre o que vale NAQUELA
    competência (reajuste tem data de vigência, ver `ValorPlanoContribuicao`)."""
    linha = (
        db.query(ValorPlanoContribuicao)
        .filter(
            ValorPlanoContribuicao.id_plano == id_plano,
            ValorPlanoContribuicao.data_vigencia_inicio <= data_referencia,
        )
        .filter(
            (ValorPlanoContribuicao.data_vigencia_fim.is_(None))
            | (ValorPlanoContribuicao.data_vigencia_fim >= data_referencia)
        )
        .order_by(ValorPlanoContribuicao.data_vigencia_inicio.desc())
        .first()
    )
    if not linha:
        raise HTTPException(status_code=400, detail=f"Plano de contribuição #{id_plano} não tem valor vigente cadastrado para {data_referencia.date().isoformat()}.")
    return linha.valor


def _titular_do_nucleo(db: Session, associado: Associado) -> Optional[Associado]:
    """v3.2 - "cobrança por família": se este associado é um DEPENDENTE registrado de outra
    pessoa (`DependenteFamiliar.id_pessoa_vinculada`) e essa outra pessoa também é associado
    elegível, ele é o titular do núcleo - retorna esse titular (ou None se este associado não é
    dependente de ninguém, ou se o "titular" não é ele mesmo um associado cobrável)."""
    vinculo = (
        db.query(DependenteFamiliar)
        .filter(DependenteFamiliar.id_pessoa_vinculada == associado.pessoa.id_pessoa)
        .first()
    )
    if not vinculo:
        return None
    titular = db.query(Associado).filter(Associado.id_pessoa == vinculo.id_pessoa_titular).first()
    if not titular or titular.status_arrolamento not in STATUS_ELEGIVEIS_PARA_COBRANCA:
        return None
    return titular


def _percentual_isencao(db: Session, id_associado: int, id_plano: int, data_referencia: datetime) -> Decimal:
    isencoes = (
        db.query(IsencaoContribuicao)
        .filter(
            IsencaoContribuicao.id_associado == id_associado,
            IsencaoContribuicao.data_inicio <= data_referencia,
        )
        .filter(
            (IsencaoContribuicao.data_fim.is_(None)) | (IsencaoContribuicao.data_fim >= data_referencia)
        )
        .filter((IsencaoContribuicao.id_plano.is_(None)) | (IsencaoContribuicao.id_plano == id_plano))
        .all()
    )
    if not isencoes:
        return Decimal("0")
    return min(Decimal("100"), max(i.percentual_desconto for i in isencoes))


def gerar_cobrancas(db: Session, *, competencia: str, confirmar: bool, id_usuario: Optional[int] = None) -> dict:
    """Geração em lote de `TituloFinanceiro` (A Receber) por competência, sempre com prévia
    disponível (`confirmar=False` não grava nada) e sempre idempotente: rodar duas vezes na
    mesma competência nunca duplica cobrança - a `UniqueConstraint` do modelo é a trava real,
    a checagem aqui só evita fazer trabalho à toa."""
    data_referencia = data_vencimento_da_competencia(competencia, 1)  # só pra achar o valor vigente do mês
    planos = db.query(PlanoDeContribuicao).filter(PlanoDeContribuicao.ativo.is_(True)).all()

    chaves_existentes = {
        (t.id_associado, t.id_plano_contribuicao)
        for t in db.query(TituloFinanceiro).filter(TituloFinanceiro.competencia == competencia).all()
    }

    detalhes: list[dict] = []
    valor_total = Decimal("0")
    total_gerados = total_ja_existentes = total_dependentes_pulados = total_isentos_totais = 0

    for plano in planos:
        data_vencimento = data_vencimento_da_competencia(competencia, plano.dia_vencimento)
        valor_base = valor_vigente(db, plano.id_plano, data_vencimento_da_competencia(competencia, 1))
        associados = (
            db.query(Associado)
            .filter(Associado.categoria == plano.categoria)
            .filter(Associado.status_arrolamento.in_(STATUS_ELEGIVEIS_PARA_COBRANCA))
            .all()
        )
        for associado in associados:
            if (associado.id_associado, plano.id_plano) in chaves_existentes:
                total_ja_existentes += 1
                continue
            if plano.cobranca_por_nucleo_familiar and _titular_do_nucleo(db, associado) is not None:
                total_dependentes_pulados += 1
                continue

            percentual = _percentual_isencao(db, associado.id_associado, plano.id_plano, data_vencimento)
            valor_final = (valor_base * (Decimal("100") - percentual) / Decimal("100")).quantize(Decimal("0.01"))
            if valor_final <= 0:
                total_isentos_totais += 1
                continue

            detalhes.append({
                "id_associado": associado.id_associado, "nome": associado.nome_completo,
                "id_plano": plano.id_plano, "descricao_plano": plano.descricao, "valor": valor_final,
            })
            valor_total += valor_final
            total_gerados += 1

            if confirmar:
                db.add(TituloFinanceiro(
                    tipo_titulo="A Receber", id_conta_contabil=plano.id_conta_contabil,
                    id_associado=associado.id_associado,
                    descricao=f"{plano.descricao} — competência {competencia}",
                    valor_original=valor_final, saldo_devedor=valor_final,
                    data_vencimento=data_vencimento, status="Pendente",
                    id_plano_contribuicao=plano.id_plano, competencia=competencia,
                ))

    if confirmar:
        db.commit()

    return {
        "competencia": competencia, "confirmado": confirmar,
        "total_gerados": total_gerados, "total_ja_existentes": total_ja_existentes,
        "total_dependentes_pulados": total_dependentes_pulados, "total_isentos_totais": total_isentos_totais,
        "valor_total": valor_total, "detalhes": detalhes,
    }


def aplicar_credito(
    db: Session, *, credito: CreditoAssociado, titulo: TituloFinanceiro,
    id_conta_contabil_adiantamento: int, exercicio: Exercicio, id_usuario: Optional[int] = None,
) -> Decimal:
    """Consome um `CreditoAssociado` existente contra um título do MESMO associado, sem tocar em
    caixa (o dinheiro já entrou quando o crédito nasceu - ver `registrar_pagamento_a_maior`).
    Gera lançamento contábil de verdade (débito na conta de adiantamento - reduz o passivo -,
    crédito na conta do título) - crédito de associado nunca é só um número numa tabela solta,
    é razão contábil como qualquer outra movimentação. Retorna o valor efetivamente aplicado."""
    if credito.id_associado != titulo.id_associado:
        raise HTTPException(status_code=400, detail="Este crédito pertence a outro associado.")
    if credito.valor <= 0:
        raise HTTPException(status_code=400, detail="Este crédito já foi totalmente utilizado.")
    if titulo.status == "Pago":
        raise HTTPException(status_code=400, detail="Este título já está totalmente pago.")

    valor_aplicado = min(credito.valor, titulo.saldo_devedor)
    credito.valor -= valor_aplicado
    titulo.saldo_devedor -= valor_aplicado
    if titulo.saldo_devedor <= 0:
        titulo.status = "Pago"
        titulo.saldo_devedor = Decimal("0")

    contabilidade.criar_lancamento(
        db, exercicio=exercicio,
        historico=f"Aplicação de crédito #{credito.id_credito} no título #{titulo.id_titulo}",
        tipo_origem="APLICACAO_CREDITO",
        partidas=[
            (id_conta_contabil_adiantamento, contabilidade.DEBITO, valor_aplicado),
            (titulo.id_conta_contabil, contabilidade.CREDITO, valor_aplicado),
        ],
        id_titulo=titulo.id_titulo, id_usuario=id_usuario,
    )
    return valor_aplicado


def registrar_pagamento_a_maior(
    db: Session, *, titulo: TituloFinanceiro, excedente: Decimal, origem: str,
) -> CreditoAssociado:
    """"Pagamento a maior (crédito em conta do associado)" - o excedente de uma baixa nunca é
    perdido nem devolvido informalmente: vira um `CreditoAssociado` novo, consumível depois em
    qualquer título futuro do mesmo associado (`aplicar_credito`)."""
    if not titulo.id_associado:
        raise HTTPException(status_code=400, detail="Pagamento a maior só é aplicável a título de um associado (crédito precisa de um dono).")
    credito = CreditoAssociado(
        id_associado=titulo.id_associado, valor=excedente, valor_original=excedente,
        origem=origem, id_titulo_origem=titulo.id_titulo,
    )
    db.add(credito)
    db.flush()
    return credito
