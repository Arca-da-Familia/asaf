"""v1.5 (FASE 1) - publica um evento genérico na linha do tempo de um associado. Ver docstring
de app/models/linha_do_tempo.py: isto é a narrativa unificada que a Ficha 360º lê, nunca a fonte
de verdade de nenhum cálculo (essa continua em cada tabela de domínio)."""
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models.linha_do_tempo import EventoLinhaDoTempo


def publicar_evento_linha_do_tempo(
    db: Session,
    id_associado: int,
    modulo_origem: str,
    tipo: str,
    titulo: str,
    descricao: Optional[str] = None,
    data_evento: Optional[datetime] = None,
) -> EventoLinhaDoTempo:
    evento = EventoLinhaDoTempo(
        id_associado=id_associado,
        modulo_origem=modulo_origem,
        tipo=tipo,
        titulo=titulo,
        descricao=descricao,
        data_evento=data_evento or datetime.utcnow(),
    )
    db.add(evento)
    db.commit()
    db.refresh(evento)
    return evento
