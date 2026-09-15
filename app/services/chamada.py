"""v2.5.3b (FASE 2.5 - Painel, achado do usuário 2026-09-15) - autochamada por código da sessão
e status de presença calculado (nunca gravado - mesmo princípio do quórum de instalação, v2.3)."""
import secrets
from typing import Optional

from sqlalchemy.orm import Session

from app.models.chamada import ACEITA, JustificativaFalta
from app.models.governanca import REALIZADA, Assembleia, HabilitadoAssembleia
from app.models.sessao_assembleia import Credenciamento

PRESENTE = "Presente"
FALTA = "Falta"
FALTA_JUSTIFICADA = "Falta justificada"
PENDENTE = "Pendente"


def gerar_codigo_chamada() -> str:
    """6 dígitos - curto o bastante pra anunciar em voz alta ou projetar na sala, aleatório o
    bastante pra não ser adivinhado por quem não está presente."""
    return f"{secrets.randbelow(1_000_000):06d}"


def status_presenca(db: Session, assembleia: Assembleia, id_associado: int) -> Optional[str]:
    """None se o associado não está na lista de habilitados desta assembleia (não se aplica -
    ex.: assembleia ainda não convocada, ou associado desligado antes da convocação)."""
    habilitado = (
        db.query(HabilitadoAssembleia)
        .filter(
            HabilitadoAssembleia.id_assembleia == assembleia.id_assembleia,
            HabilitadoAssembleia.id_associado == id_associado,
        )
        .first()
    )
    if not habilitado:
        return None

    credenciado = (
        db.query(Credenciamento)
        .filter(
            Credenciamento.id_assembleia == assembleia.id_assembleia,
            Credenciamento.id_associado == id_associado,
        )
        .first()
    )
    if credenciado:
        return PRESENTE

    justificativa = (
        db.query(JustificativaFalta)
        .filter(
            JustificativaFalta.id_assembleia == assembleia.id_assembleia,
            JustificativaFalta.id_associado == id_associado,
        )
        .first()
    )
    if justificativa and justificativa.status == ACEITA:
        return FALTA_JUSTIFICADA

    if assembleia.status == REALIZADA:
        return FALTA

    return PENDENTE
