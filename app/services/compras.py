"""v3.3 (FASE 3) - fluxo solicitação → cotação (quando acima de valor configurado) → aprovação
por alçada → pagamento → conciliação. Segregação de funções ("quem solicita nunca aprova a
própria solicitação") e conflito de interesse (`DeclaracaoConflitoInteresse`) checados aqui, no
endpoint - nunca por convenção. Pagamento/conciliação reaproveitam `TituloFinanceiro`/
`baixar_titulo` (v3.0) - uma compra aprovada só gera o título "A Pagar" de sempre."""
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.config_cache import obter_configuracao
from app.models.associados import Associado
from app.models.compras import AlcadaAprovacao, AprovacaoCompra, CotacaoCompra, DelegacaoAprovacao, SolicitacaoCompra
from app.models.financeiro import TituloFinanceiro
from app.models.mandatos import DeclaracaoConflitoInteresse
from app.services.mandatos import mandatos_vigentes_do_associado

_VALOR_MINIMO_COTACAO_PADRAO = Decimal("1000")
_QUANTIDADE_MINIMA_COTACOES = 2


def _valor_minimo_cotacao(db: Session) -> Decimal:
    valor = obter_configuracao(db, "VALOR_MINIMO_EXIGE_COTACAO", str(_VALOR_MINIMO_COTACAO_PADRAO))
    try:
        return Decimal(valor)
    except Exception:
        return _VALOR_MINIMO_COTACAO_PADRAO


def alcada_aplicavel(db: Session, valor: Decimal) -> AlcadaAprovacao:
    alcada = (
        db.query(AlcadaAprovacao)
        .filter(
            AlcadaAprovacao.ativo.is_(True),
            AlcadaAprovacao.valor_minimo <= valor,
        )
        .filter((AlcadaAprovacao.valor_maximo.is_(None)) | (AlcadaAprovacao.valor_maximo >= valor))
        .order_by(AlcadaAprovacao.valor_minimo.desc())
        .first()
    )
    if not alcada:
        raise HTTPException(status_code=400, detail=f"Nenhuma alçada de aprovação configurada para o valor R$ {valor:.2f} - cadastre uma faixa em Alçadas de Aprovação antes de prosseguir.")
    return alcada


def _associado_do_usuario(db: Session, id_usuario: int) -> Optional[Associado]:
    return db.query(Associado).filter(Associado.id_usuario == id_usuario).first()


def _cargos_vigentes(db: Session, id_associado: int) -> set[str]:
    return {m.cargo_codigo for m in mandatos_vigentes_do_associado(db, id_associado)}


def _tem_conflito_interesse(db: Session, id_associado: Optional[int], id_fornecedor: Optional[int]) -> bool:
    if not id_associado:
        return False
    declaracoes = db.query(DeclaracaoConflitoInteresse).filter(
        DeclaracaoConflitoInteresse.id_associado == id_associado,
        DeclaracaoConflitoInteresse.ativa.is_(True),
    ).all()
    for d in declaracoes:
        if d.id_fornecedor is None or d.id_fornecedor == id_fornecedor:
            return True
    return False


def _pode_aprovar(db: Session, *, id_usuario_aprovador: int, solicitacao: SolicitacaoCompra, alcada: AlcadaAprovacao) -> tuple[bool, Optional[str], Optional[int]]:
    """Retorna (pode, motivo_recusa, id_delegacao_usada)."""
    if id_usuario_aprovador == solicitacao.id_usuario_solicitante:
        return False, "Quem solicitou a compra não pode aprová-la (segregação de funções).", None

    associado = _associado_do_usuario(db, id_usuario_aprovador)
    if not associado:
        return False, "Aprovador não está vinculado a um associado com mandato.", None

    if _tem_conflito_interesse(db, associado.id_associado, solicitacao.id_fornecedor):
        return False, "Aprovador tem declaração de conflito de interesse ativa envolvendo este fornecedor - use outro aprovador.", None

    cargos_autorizados = set(alcada.cargos_autorizados.split(","))
    if _cargos_vigentes(db, associado.id_associado) & cargos_autorizados:
        return True, None, None

    # v3.3 - delegação temporária: alguém com o cargo exigido pode delegar a aprovação a outra
    # pessoa (ex.: tesoureiro de férias delega ao vice) - sempre rastreável, quem de fato aprovou
    # continua sendo `id_usuario_aprovador`.
    agora = datetime.utcnow()
    delegacoes = (
        db.query(DelegacaoAprovacao)
        .filter(
            DelegacaoAprovacao.id_associado_delegado == associado.id_associado,
            DelegacaoAprovacao.data_inicio <= agora, DelegacaoAprovacao.data_fim >= agora,
        )
        .all()
    )
    for delegacao in delegacoes:
        if _cargos_vigentes(db, delegacao.id_associado_delegante) & cargos_autorizados:
            return True, None, delegacao.id_delegacao

    return False, f"Aprovador não tem o cargo exigido para esta alçada ({', '.join(sorted(cargos_autorizados))}).", None


def criar_solicitacao(
    db: Session, *, descricao: str, justificativa: Optional[str], id_fornecedor: Optional[int],
    valor_estimado: Decimal, id_conta_contabil: int, id_centro_custo: Optional[int], id_usuario: int,
) -> SolicitacaoCompra:
    if valor_estimado <= 0:
        raise HTTPException(status_code=400, detail="Valor estimado deve ser maior que zero.")
    solicitacao = SolicitacaoCompra(
        descricao=descricao, justificativa=justificativa, id_fornecedor=id_fornecedor,
        valor_estimado=valor_estimado, id_conta_contabil=id_conta_contabil, id_centro_custo=id_centro_custo,
        id_usuario_solicitante=id_usuario, status="Aguardando Aprovação",
    )
    db.add(solicitacao)
    db.commit()
    db.refresh(solicitacao)
    return solicitacao


def registrar_cotacao(db: Session, *, id_solicitacao: int, id_fornecedor: int, valor: Decimal, anexo: Optional[str], id_usuario: int) -> CotacaoCompra:
    solicitacao = db.query(SolicitacaoCompra).filter(SolicitacaoCompra.id_solicitacao == id_solicitacao).first()
    if not solicitacao:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    if solicitacao.status not in ("Aguardando Aprovação",):
        raise HTTPException(status_code=400, detail=f"Solicitação '{solicitacao.status}' não aceita novas cotações.")
    cotacao = CotacaoCompra(id_solicitacao=id_solicitacao, id_fornecedor=id_fornecedor, valor=valor, anexo=anexo, id_usuario_registro=id_usuario)
    db.add(cotacao)
    db.commit()
    db.refresh(cotacao)
    return cotacao


def aprovar_solicitacao(db: Session, *, id_solicitacao: int, id_usuario_aprovador: int) -> dict:
    solicitacao = db.query(SolicitacaoCompra).filter(SolicitacaoCompra.id_solicitacao == id_solicitacao).first()
    if not solicitacao:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    if solicitacao.status != "Aguardando Aprovação":
        raise HTTPException(status_code=400, detail=f"Solicitação '{solicitacao.status}' não pode ser aprovada.")

    if solicitacao.valor_estimado >= _valor_minimo_cotacao(db):
        quantidade_cotacoes = db.query(CotacaoCompra).filter(CotacaoCompra.id_solicitacao == id_solicitacao).count()
        if quantidade_cotacoes < _QUANTIDADE_MINIMA_COTACOES:
            raise HTTPException(status_code=400, detail=f"Valor acima de R$ {_valor_minimo_cotacao(db):.2f} exige ao menos {_QUANTIDADE_MINIMA_COTACOES} cotações antes de aprovar (tem {quantidade_cotacoes}).")

    alcada = alcada_aplicavel(db, solicitacao.valor_estimado)
    pode, motivo, id_delegacao = _pode_aprovar(db, id_usuario_aprovador=id_usuario_aprovador, solicitacao=solicitacao, alcada=alcada)
    if not pode:
        raise HTTPException(status_code=403, detail=motivo)

    ja_aprovou = db.query(AprovacaoCompra).filter(
        AprovacaoCompra.id_solicitacao == id_solicitacao, AprovacaoCompra.id_usuario_aprovador == id_usuario_aprovador,
    ).first()
    if ja_aprovou:
        raise HTTPException(status_code=400, detail="Este usuário já aprovou esta solicitação.")

    associado = _associado_do_usuario(db, id_usuario_aprovador)
    db.add(AprovacaoCompra(
        id_solicitacao=id_solicitacao, id_usuario_aprovador=id_usuario_aprovador,
        id_associado_creditado=associado.id_associado if associado else None, id_delegacao_usada=id_delegacao,
    ))
    db.commit()

    quantidade_aprovacoes = db.query(AprovacaoCompra).filter(AprovacaoCompra.id_solicitacao == id_solicitacao).count()
    quantidade_exigida = 2 if alcada.exige_dupla_assinatura else 1
    if quantidade_aprovacoes < quantidade_exigida:
        return {"mensagem": f"Aprovação registrada ({quantidade_aprovacoes}/{quantidade_exigida}) - aguardando mais aprovações.", "status": solicitacao.status, "aprovacoes": quantidade_aprovacoes, "aprovacoes_exigidas": quantidade_exigida}

    solicitacao.status = "Aprovada"
    titulo = TituloFinanceiro(
        tipo_titulo="A Pagar", id_conta_contabil=solicitacao.id_conta_contabil, id_fornecedor=solicitacao.id_fornecedor,
        descricao=f"Compra aprovada #{solicitacao.id_solicitacao} — {solicitacao.descricao}",
        valor_original=solicitacao.valor_estimado, saldo_devedor=solicitacao.valor_estimado,
        data_vencimento=datetime.utcnow(), status="Pendente",
    )
    db.add(titulo)
    db.flush()
    solicitacao.id_titulo_gerado = titulo.id_titulo
    db.commit()
    return {"mensagem": "Solicitação aprovada - título gerado.", "status": solicitacao.status, "id_titulo_gerado": titulo.id_titulo}


def reprovar_solicitacao(db: Session, *, id_solicitacao: int, motivo: str) -> SolicitacaoCompra:
    solicitacao = db.query(SolicitacaoCompra).filter(SolicitacaoCompra.id_solicitacao == id_solicitacao).first()
    if not solicitacao:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    if solicitacao.status != "Aguardando Aprovação":
        raise HTTPException(status_code=400, detail=f"Solicitação '{solicitacao.status}' não pode ser reprovada.")
    solicitacao.status = "Reprovada"
    solicitacao.motivo_reprovacao = motivo
    db.commit()
    db.refresh(solicitacao)
    return solicitacao
