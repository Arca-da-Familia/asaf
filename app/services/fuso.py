"""A hora que o sistema guarda é UTC, sem fuso (é assim que o painel manda, que o banco grava e que toda comparação com "agora" é feita). Quem LÊ — e-mail, certificado — quer a
hora de Belém: Parauapebas fica em America/Belem (UTC-3, sem horário de verão desde 2019). Este módulo é o único lugar que faz essa conversão para texto.

Se o banco de fusos do sistema operacional faltar (imagem mínima), cai no deslocamento fixo de -3 horas: vale para qualquer data de 2019 em diante."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:
    FUSO_ASAF = ZoneInfo("America/Belem")
except ZoneInfoNotFoundError:  # pragma: no cover - só em imagem sem tzdata
    FUSO_ASAF = timezone(timedelta(hours=-3))

ROTULO_DO_FUSO = "horário de Belém"


def para_belem(momento_utc: datetime) -> datetime:
    """UTC sem fuso (como o banco guarda) -> o mesmo instante com a hora de parede de Belém. Se já tem fuso, só converte."""
    if momento_utc.tzinfo is None:
        momento_utc = momento_utc.replace(tzinfo=timezone.utc)
    return momento_utc.astimezone(FUSO_ASAF)


def dia_e_hora_em_belem(momento_utc: datetime) -> str:
    """"15/10/2026 às 19:00" — a hora de Belém de um instante guardado em UTC."""
    return para_belem(momento_utc).strftime("%d/%m/%Y às %H:%M")


def dia_em_belem(momento_utc: datetime) -> str:
    """"15/10/2026" — o dia, em Belém, de um instante guardado em UTC (um evento às 23h de Belém é do dia certo, não do dia seguinte em UTC)."""
    return para_belem(momento_utc).strftime("%d/%m/%Y")
