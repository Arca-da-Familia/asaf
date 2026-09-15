"""v2.7 (FASE 2) - processo disciplinar: quórum de decisão colegiada (maioria da Diretoria
Executiva, Art. 17 por analogia), escalada automática de advertência pra suspensão (Art. 17, I -
"a partir da 4ª advertência será considerada suspensão", não é decisão de ninguém, é a regra) e
aplicação dos efeitos de cada pena."""
import math
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.models.associados import Associado
from app.models.disciplina import (
    ADVERTENCIA, DECIDIDO, ELIMINACAO, PENAS, SUSPENSAO, ManifestacaoDiretoria, ProcessoDisciplinar,
)
from app.models.mandatos import Mandato
from app.services.estatuto import obter_regra_vigente


def diretores_aptos(db: Session, excluir_id_associado: int) -> list[int]:
    """`id_associado` de todo mandato vigente em cargo da Diretoria Executiva, excluindo o
    acusado - ele nunca vota no próprio processo, mesmo sendo diretor (Art. 17, Parágrafo Único
    aplicado por analogia: quem é julgado não é quem julga)."""
    mandatos = db.query(Mandato).filter(Mandato.orgao_codigo == "DIRETORIA_EXECUTIVA").all()
    return sorted({m.id_associado for m in mandatos if m.vigente() and m.id_associado != excluir_id_associado})


def pode_julgar_agora(processo: ProcessoDisciplinar) -> bool:
    """Trava de ampla defesa (Art. 16): só pode julgar depois que a defesa foi apresentada OU o
    prazo de defesa esgotou - nunca antes de um dos dois."""
    if processo.defesa_apresentada_em is not None:
        return True
    return datetime.utcnow() >= processo.prazo_defesa_ate


def calcular_resultado_colegiado(db: Session, processo: ProcessoDisciplinar) -> dict:
    aptos = diretores_aptos(db, processo.id_associado)
    manifestacoes = db.query(ManifestacaoDiretoria).filter(
        ManifestacaoDiretoria.id_processo == processo.id_processo,
        ManifestacaoDiretoria.id_associado_diretor.in_(aptos),
    ).all()
    quorum_minimo = math.floor(len(aptos) / 2) + 1 if aptos else 0
    quorum_atingido = len(manifestacoes) >= quorum_minimo and quorum_minimo > 0

    contagem: dict[Optional[str], int] = {}
    for m in manifestacoes:
        contagem[m.pena_proposta] = contagem.get(m.pena_proposta, 0) + 1
    vencedora = max(contagem, key=contagem.get) if contagem else None

    return {
        "diretores_aptos": len(aptos), "quorum_minimo": quorum_minimo, "manifestacoes": len(manifestacoes),
        "quorum_atingido": quorum_atingido, "resultado": vencedora, "contagem": contagem,
    }


def contar_advertencias_anteriores(db: Session, id_associado: int) -> int:
    return db.query(ProcessoDisciplinar).filter(
        ProcessoDisciplinar.id_associado == id_associado,
        ProcessoDisciplinar.status == DECIDIDO,
        ProcessoDisciplinar.pena_aplicada == ADVERTENCIA,
    ).count()


def aplicar_pena(
    db: Session, processo: ProcessoDisciplinar, pena: Optional[str], texto_decisao: str,
    id_usuario: Optional[int], suspensao_dias: Optional[int] = None,
) -> dict:
    """Materializa o efeito da pena decidida. Devolve o que de fato aconteceu (a pena gravada
    pode não ser a informada, por causa da escalada automática do Art. 17, I)."""
    from app.models.situacao import ADVERTENCIA_DISCIPLINAR, SUSPENSAO_DISCIPLINAR, MudancaSituacao
    from app.models.disciplina import AGUARDANDO_HOMOLOGACAO, ARQUIVADO

    processo.decisao_texto = texto_decisao
    processo.decidido_em = datetime.utcnow()

    if pena is None:
        processo.status = ARQUIVADO
        db.commit()
        return {"pena_aplicada": None, "status": processo.status}

    associado = db.query(Associado).filter(Associado.id_associado == processo.id_associado).first()

    if pena == ADVERTENCIA:
        anteriores = contar_advertencias_anteriores(db, processo.id_associado)
        if anteriores >= 3:
            # Art. 17, I: a 4ª advertência já É suspensão - não é uma escolha nova da Diretoria,
            # é o próprio estatuto dizendo o que a 4ª ocorrência significa.
            processo.escalada_automatica = True
            return aplicar_pena(db, processo, SUSPENSAO, texto_decisao + " [Escalada automática: 4ª advertência, Art. 17, I]", id_usuario, suspensao_dias)
        processo.pena_aplicada = ADVERTENCIA
        processo.status = DECIDIDO
        db.add(MudancaSituacao(id_associado=processo.id_associado, tipo=ADVERTENCIA_DISCIPLINAR, motivo=processo.motivo_codigo, data_efetiva=datetime.utcnow(), id_usuario_registrou=id_usuario))
        db.commit()
        return {"pena_aplicada": ADVERTENCIA, "status": processo.status}

    if pena == SUSPENSAO:
        dias = suspensao_dias or int(obter_regra_vigente(db, "SUSPENSAO_DISCIPLINAR_PADRAO_DIAS", "30") or "30")
        processo.pena_aplicada = SUSPENSAO
        processo.suspensao_dias = dias
        processo.data_fim_suspensao = datetime.utcnow() + timedelta(days=dias)
        processo.status = DECIDIDO
        if associado:
            associado.status_arrolamento = "Suspenso (Estatuto)"
        db.add(MudancaSituacao(
            id_associado=processo.id_associado, tipo=SUSPENSAO_DISCIPLINAR, motivo=processo.motivo_codigo,
            data_efetiva=datetime.utcnow(), data_fim_prevista=processo.data_fim_suspensao, id_usuario_registrou=id_usuario,
        ))
        db.commit()
        return {"pena_aplicada": SUSPENSAO, "status": processo.status, "data_fim_suspensao": processo.data_fim_suspensao}

    if pena == ELIMINACAO:
        # Art. 17, Parágrafo Único: eliminação SEMPRE exige homologação da Assembleia Geral
        # Extraordinária - a Diretoria propõe, nunca executa sozinha.
        processo.pena_aplicada = ELIMINACAO
        processo.status = AGUARDANDO_HOMOLOGACAO
        db.commit()
        return {"pena_aplicada": ELIMINACAO, "status": processo.status}

    raise ValueError(f"Pena '{pena}' não reconhecida.")
