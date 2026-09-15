"""v2.3 (FASE 2) - condução da sessão: quórum de instalação em tempo real. Sempre recalculado na
leitura a partir dos credenciamentos existentes - nunca um contador incrementado/decrementado
manualmente que pode dessincronizar da realidade."""
from datetime import datetime

from sqlalchemy.orm import Session

from app.models.governanca import Assembleia, HabilitadoAssembleia
from app.models.sessao_assembleia import Credenciamento
from app.services.assembleia import horarios_convocacao
from app.services.estatuto import avaliar_quorum_minimo, obter_regra_vigente


def _credenciados_habilitados(db: Session, id_assembleia: int) -> int:
    """Só conta pro quórum quem está credenciado (presente, sem saída registrada) E na lista de
    habilitados congelada (v2.2) - presença de quem não tem direito de voto não conta pro quórum
    de instalação (Art. 6º fala em "associados aptos")."""
    return (
        db.query(Credenciamento)
        .join(
            HabilitadoAssembleia,
            (HabilitadoAssembleia.id_assembleia == Credenciamento.id_assembleia)
            & (HabilitadoAssembleia.id_associado == Credenciamento.id_associado),
        )
        .filter(
            Credenciamento.id_assembleia == id_assembleia,
            Credenciamento.hora_saida.is_(None),
            HabilitadoAssembleia.habilitado.is_(True),
        )
        .count()
    )


def quorum_instalacao_atual(db: Session, assembleia: Assembleia) -> dict:
    """Apurado por convocação (1ª/2ª/3ª, Art. 6º): a convocação "aplicável" é a mais recente cujo
    horário já passou - antes da 1ª ninguém instala nada; depois da 1ª mas antes da 2ª, vale o
    quórum da 1ª; e assim por diante."""
    horarios = horarios_convocacao(db, assembleia)
    agora = datetime.utcnow()
    total_habilitados = (
        db.query(HabilitadoAssembleia)
        .filter(HabilitadoAssembleia.id_assembleia == assembleia.id_assembleia, HabilitadoAssembleia.habilitado.is_(True))
        .count()
    )
    credenciados = _credenciados_habilitados(db, assembleia.id_assembleia)

    convocacoes = [
        ("1ª", horarios["primeira_convocacao"], obter_regra_vigente(db, "QUORUM_1A_CONVOCACAO", "2/3") or "2/3"),
        ("2ª", horarios["segunda_convocacao"], obter_regra_vigente(db, "QUORUM_2A_CONVOCACAO", "1/2+1") or "1/2+1"),
        ("3ª", horarios["terceira_convocacao"], obter_regra_vigente(db, "QUORUM_3A_CONVOCACAO", "1/4") or "1/4"),
    ]
    rotulo, _, valor_quorum = convocacoes[0]
    for rotulo_atual, horario, valor_atual in convocacoes:
        if agora >= horario:
            rotulo, valor_quorum = rotulo_atual, valor_atual

    minimo_exigido = avaliar_quorum_minimo(valor_quorum, total_habilitados)
    return {
        "convocacao_aplicavel": rotulo, "quorum_regra": valor_quorum,
        "total_habilitados": total_habilitados, "credenciados_habilitados": credenciados,
        "minimo_exigido": minimo_exigido, "quorum_atingido": credenciados >= minimo_exigido,
    }
