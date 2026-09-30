"""v4.9 (FASE 4) - isenção justificada de taxa de inscrição/uso de espaço. Mesmo raciocínio de
`app/services/contribuicoes.py::IsencaoContribuicao` (motivo de catálogo + aprovador +
percentual), generalizado por `contexto_tipo`/`id_contexto`."""
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.financeiro_evento import IsencaoTaxaContexto
from app.services.catalogos import validar_codigo_em_catalogo


def conceder_isencao(
    db: Session, *, contexto_tipo: str, id_contexto: int, id_pessoa: int, motivo: str,
    percentual_isencao: Decimal, id_usuario_aprovador: Optional[int] = None,
) -> IsencaoTaxaContexto:
    validar_codigo_em_catalogo(db, "motivo_isencao_taxa_evento", motivo, "Motivo de isenção")
    if not (Decimal("0") < percentual_isencao <= Decimal("100")):
        raise HTTPException(status_code=422, detail="Percentual de isenção precisa ser maior que 0 e no máximo 100.")
    isencao = IsencaoTaxaContexto(
        contexto_tipo=contexto_tipo, id_contexto=id_contexto, id_pessoa=id_pessoa, motivo=motivo,
        percentual_isencao=percentual_isencao, id_usuario_aprovador=id_usuario_aprovador,
    )
    db.add(isencao)
    db.commit()
    db.refresh(isencao)
    return isencao


def listar_isencoes(db: Session, *, contexto_tipo: str, id_contexto: int) -> list[IsencaoTaxaContexto]:
    return (
        db.query(IsencaoTaxaContexto)
        .filter(IsencaoTaxaContexto.contexto_tipo == contexto_tipo, IsencaoTaxaContexto.id_contexto == id_contexto)
        .order_by(IsencaoTaxaContexto.criado_em.desc())
        .all()
    )


def percentual_isento(db: Session, *, contexto_tipo: str, id_contexto: int, id_pessoa: int) -> Decimal:
    """Maior percentual de isenção concedido a esta pessoa neste contexto (mesma regra de
    `contribuicoes._percentual_isencao`: mais de uma isenção nunca soma, só a maior vale)."""
    isencoes = (
        db.query(IsencaoTaxaContexto)
        .filter(
            IsencaoTaxaContexto.contexto_tipo == contexto_tipo, IsencaoTaxaContexto.id_contexto == id_contexto,
            IsencaoTaxaContexto.id_pessoa == id_pessoa,
        )
        .all()
    )
    if not isencoes:
        return Decimal("0")
    return min(Decimal("100"), max(i.percentual_isencao for i in isencoes))
