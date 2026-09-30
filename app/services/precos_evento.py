"""v4.9 (FASE 4) - preço de inscrição de evento por categoria e por janela de vigência (lote
promocional por data). Mesmo padrão versionado de `app/services/contribuicoes.py::valor_vigente`
- mudar o preço nunca afeta retroativamente quem já pagou pela faixa vigente na hora."""
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.financeiro_evento import FaixaPrecoEvento
from app.services.catalogos import validar_codigo_em_catalogo


def criar_faixa_preco(
    db: Session, *, id_evento: int, categoria: str, valor: Decimal,
    data_vigencia_inicio: Optional[datetime], data_vigencia_fim: Optional[datetime], id_usuario: Optional[int] = None,
) -> FaixaPrecoEvento:
    validar_codigo_em_catalogo(db, "categoria_cota_inscricao", categoria, "Categoria de preço")
    if valor < 0:
        raise HTTPException(status_code=422, detail="Valor da faixa de preço não pode ser negativo.")
    faixa = FaixaPrecoEvento(
        id_evento=id_evento, categoria=categoria, valor=valor,
        data_vigencia_inicio=data_vigencia_inicio or datetime.utcnow(), data_vigencia_fim=data_vigencia_fim,
        id_usuario_registro=id_usuario,
    )
    db.add(faixa)
    db.commit()
    db.refresh(faixa)
    return faixa


def listar_faixas_preco(db: Session, *, id_evento: int) -> list[FaixaPrecoEvento]:
    return (
        db.query(FaixaPrecoEvento)
        .filter(FaixaPrecoEvento.id_evento == id_evento)
        .order_by(FaixaPrecoEvento.categoria, FaixaPrecoEvento.data_vigencia_inicio.desc())
        .all()
    )


def valor_vigente_evento(db: Session, *, id_evento: int, categoria: str, data_referencia: Optional[datetime] = None) -> Optional[Decimal]:
    """Valor vigente da categoria pedida na data de referência - `None` quando o evento não tem
    nenhuma faixa cadastrada para essa categoria (quem chama decide o que fazer: cair no
    `Evento.valor_base` genérico, ou recusar, conforme o caso)."""
    data_referencia = data_referencia or datetime.utcnow()
    linha = (
        db.query(FaixaPrecoEvento)
        .filter(
            FaixaPrecoEvento.id_evento == id_evento, FaixaPrecoEvento.categoria == categoria,
            FaixaPrecoEvento.data_vigencia_inicio <= data_referencia,
        )
        .filter(
            (FaixaPrecoEvento.data_vigencia_fim.is_(None)) | (FaixaPrecoEvento.data_vigencia_fim >= data_referencia)
        )
        .order_by(FaixaPrecoEvento.data_vigencia_inicio.desc())
        .first()
    )
    return linha.valor if linha else None
