"""v4.10 (FASE 4) - mapa de calor de ocupação de espaços: quantas reservas caíram em cada
combinação dia-da-semana x hora, num período. Só conta reserva que de fato aconteceu ou vai
acontecer de verdade (`CONFIRMADA`/`CONCLUIDA`) - nunca `SOLICITADA` (ainda pode ser recusada),
`RECUSADA`/`CANCELADA` (não ocupou o espaço) ou `NAO_COMPARECEU` (reservou mas não usou)."""
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models.espacos import Reserva
from app.services.reservas import CONCLUIDA, CONFIRMADA

DIAS_SEMANA = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"]


def mapa_calor_ocupacao(
    db: Session, *, id_espaco: Optional[int] = None, data_inicio: datetime, data_fim: datetime,
) -> list[dict]:
    consulta = db.query(Reserva).filter(
        Reserva.status.in_([CONFIRMADA, CONCLUIDA]),
        Reserva.data_hora_inicio >= data_inicio, Reserva.data_hora_inicio <= data_fim,
    )
    if id_espaco is not None:
        consulta = consulta.filter(Reserva.id_espaco == id_espaco)

    # o dia da semana e a hora são os do relógio da associação (Belém), não os do instante UTC guardado: uma reserva de domingo 14h de Belém
    # está gravada às 17h UTC e tem de cair na célula das 14h
    from app.services.calendario import fuso_da_associacao, instante_local

    fuso = fuso_da_associacao(db)
    contagem: dict[tuple[int, int], int] = {}
    for reserva in consulta.all():
        local = instante_local(reserva.data_hora_inicio, fuso)
        chave = (local.weekday(), local.hour)
        contagem[chave] = contagem.get(chave, 0) + 1

    return [
        {"dia_semana": dia_semana, "dia_semana_nome": DIAS_SEMANA[dia_semana], "hora": hora, "quantidade": quantidade}
        for (dia_semana, hora), quantidade in sorted(contagem.items())
    ]
