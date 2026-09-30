"""v4.9 (FASE 4) - reembolso por cancelamento (inscrição de evento paga ou reserva de espaço
paga). Nunca estorna o título original (o dinheiro realmente entrou - ver o comentário de
`TituloFinanceiro.id_titulo_reembolso_de`, app/models/financeiro.py): gera um título "A Pagar"
novo, devolvendo o percentual aplicável, pago pelo mesmo `POST /baixar-titulo/` de sempre - nunca
uma devolução "por fora". Só processa reembolso de título que já foi de fato PAGO - título ainda
pendente no cancelamento simplesmente deixa de ser cobrado (fora do escopo desta versão decidir o
que fazer com dívida não paga cancelada - isso já é outro problema, pré-existente)."""
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from app.config_cache import obter_configuracao
from app.models.financeiro import TituloFinanceiro

_CHAVE_PERCENTUAL_PADRAO = "PERCENTUAL_REEMBOLSO_CANCELAMENTO_PADRAO"


def calcular_percentual_reembolso(
    db: Session, *, horas_ate_evento: float, prazo_horas: int, percentual_override: Optional[Decimal],
) -> Decimal:
    """Dentro do prazo (cancelou com antecedência suficiente) = reembolso total, sempre - nunca
    configurável pra baixo disso, cancelar a tempo nunca deveria custar nada. Fora do prazo usa o
    percentual configurado (por evento/espaço, ou o padrão global) - pode ser 0 (sem reembolso
    nenhum fora do prazo) até 100 (reembolso total mesmo em cima da hora, se a diretoria decidir
    assim)."""
    if horas_ate_evento >= prazo_horas:
        return Decimal("100")
    if percentual_override is not None:
        return Decimal(percentual_override)
    return Decimal(obter_configuracao(db, _CHAVE_PERCENTUAL_PADRAO, "0") or "0")


def gerar_reembolso(
    db: Session, *, titulo_original: TituloFinanceiro, percentual: Decimal, motivo: str, id_usuario: Optional[int] = None,
) -> Optional[TituloFinanceiro]:
    if percentual <= 0 or titulo_original.status != "Pago":
        return None
    valor_reembolso = (titulo_original.valor_original * percentual / Decimal("100")).quantize(Decimal("0.01"))
    if valor_reembolso <= 0:
        return None

    reembolso = TituloFinanceiro(
        tipo_titulo="A Pagar", id_conta_contabil=titulo_original.id_conta_contabil,
        id_associado=titulo_original.id_associado,
        descricao=f"Reembolso ({percentual}%) - {motivo} - título original #{titulo_original.id_titulo}",
        valor_original=valor_reembolso, saldo_devedor=valor_reembolso,
        data_vencimento=datetime.utcnow(), status="Pendente",
        id_titulo_reembolso_de=titulo_original.id_titulo,
    )
    db.add(reembolso)
    db.commit()
    db.refresh(reembolso)
    return reembolso
