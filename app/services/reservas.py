"""v4.3 (FASE 4) - fluxo de reserva de espaço: instantânea ou solicitação+aprovação (configurável
por `Espaco.exige_aprovacao`), tarifa automática por perfil (associado adimplente x terceiro),
recorrência como N reservas independentes, cancelamento com prazo/taxa, no-show com bloqueio
configurável por reincidência, e checklist de devolução com registro de avaria."""
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.associados import Associado
from app.models.espacos import ChecklistDevolucaoEspaco, Espaco, Reserva
from app.models.financeiro import TituloFinanceiro
from app.services import agenda
from app.services.espacos import RECURSO_ESPACO, obter_espaco

SOLICITADA = "SOLICITADA"
CONFIRMADA = "CONFIRMADA"
RECUSADA = "RECUSADA"
CANCELADA = "CANCELADA"
CONCLUIDA = "CONCLUIDA"
NAO_COMPARECEU = "NAO_COMPARECEU"


def _exigir_associado_apto(db: Session, id_associado: int) -> Associado:
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    if not associado:
        raise HTTPException(status_code=404, detail="Associado solicitante não encontrado.")
    if associado.status_arrolamento == "Ativo - Inadimplente":
        raise HTTPException(status_code=403, detail="Associado inadimplente não pode reservar espaço.")
    return associado


def _exigir_sem_bloqueio_por_no_show(db: Session, *, espaco: Espaco, id_associado: int) -> None:
    if espaco.limite_no_show_bloqueio is None:
        return
    faltas = db.query(Reserva).filter(
        Reserva.id_espaco == espaco.id_espaco, Reserva.id_associado_solicitante == id_associado, Reserva.status == NAO_COMPARECEU,
    ).count()
    if faltas >= espaco.limite_no_show_bloqueio:
        raise HTTPException(status_code=403, detail=f"Bloqueado para reservar este espaço por reincidência de não comparecimento ({faltas} vez(es)) - procure a secretaria.")


def _gerar_cobranca_se_devido(db: Session, *, espaco: Espaco, associado: Associado, reserva: Reserva) -> None:
    if not espaco.valor_reserva or espaco.valor_reserva <= 0:
        return
    if espaco.isento_para_associado_adimplente and associado.status_arrolamento == "Ativo - Em Dia":
        return
    if not espaco.id_conta_contabil_receita:
        return
    titulo = TituloFinanceiro(
        tipo_titulo="A Receber", id_conta_contabil=espaco.id_conta_contabil_receita, id_associado=associado.id_associado,
        descricao=f"Reserva de espaço '{espaco.nome}' em {reserva.data_hora_inicio.strftime('%d/%m/%Y %H:%M')}",
        valor_original=espaco.valor_reserva, saldo_devedor=espaco.valor_reserva, data_vencimento=reserva.data_hora_inicio, status="Pendente",
    )
    db.add(titulo)
    db.flush()
    reserva.id_titulo_cobranca = titulo.id_titulo


def criar_reserva(
    db: Session, *, id_espaco: int, id_associado_solicitante: int, data_hora_inicio: datetime, data_hora_fim: datetime,
    finalidade: str, id_usuario: Optional[int], identificador_serie: Optional[str] = None,
) -> Reserva:
    espaco = obter_espaco(db, id_espaco)
    if not espaco.ativo:
        raise HTTPException(status_code=400, detail="Este espaço está inativo.")
    associado = _exigir_associado_apto(db, id_associado_solicitante)
    _exigir_sem_bloqueio_por_no_show(db, espaco=espaco, id_associado=id_associado_solicitante)

    status_inicial = SOLICITADA if espaco.exige_aprovacao else CONFIRMADA
    reserva = Reserva(
        id_espaco=id_espaco, id_associado_solicitante=id_associado_solicitante, data_hora_inicio=data_hora_inicio,
        data_hora_fim=data_hora_fim, finalidade=finalidade, status=status_inicial, id_usuario_registro=id_usuario,
        identificador_serie=identificador_serie,
    )
    db.add(reserva)
    db.flush()

    try:
        compromisso = agenda.criar_compromisso(
            db, recurso_tipo=RECURSO_ESPACO, id_recurso=id_espaco, contexto_tipo="Reserva", id_contexto=reserva.id_reserva,
            data_hora_inicio=data_hora_inicio, data_hora_fim=data_hora_fim, id_usuario=id_usuario,
        )
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError:
        # v4.3 - a checagem acima (`verificar_conflito`) não garante nada sob concorrência real;
        # em produção (Postgres), a EXCLUDE constraint de `compromissos_agenda` (migração
        # `b4d6f8a0c2e3`) é quem garante de verdade, e dispara aqui como erro de banco, não como
        # HTTPException do serviço - convertido pra 400 amigável do mesmo jeito.
        db.rollback()
        raise HTTPException(status_code=400, detail="Conflito de horário - outra reserva foi confirmada primeiro para este espaço.")

    reserva.id_compromisso_agenda = compromisso.id_compromisso
    if status_inicial == CONFIRMADA:
        _gerar_cobranca_se_devido(db, espaco=espaco, associado=associado, reserva=reserva)
    db.commit()
    db.refresh(reserva)
    return reserva


def criar_reserva_recorrente(
    db: Session, *, id_espaco: int, id_associado_solicitante: int, data_hora_inicio: datetime, data_hora_fim: datetime,
    finalidade: str, quantidade_semanas: int, id_usuario: Optional[int],
) -> list[dict]:
    identificador_serie = uuid.uuid4().hex
    resultados = []
    duracao = data_hora_fim - data_hora_inicio
    for indice in range(quantidade_semanas):
        inicio_ocorrencia = data_hora_inicio + timedelta(weeks=indice)
        try:
            reserva = criar_reserva(
                db, id_espaco=id_espaco, id_associado_solicitante=id_associado_solicitante, data_hora_inicio=inicio_ocorrencia,
                data_hora_fim=inicio_ocorrencia + duracao, finalidade=finalidade, id_usuario=id_usuario, identificador_serie=identificador_serie,
            )
            resultados.append({"ocorrencia": indice + 1, "sucesso": True, "id_reserva": reserva.id_reserva, "data_hora_inicio": reserva.data_hora_inicio})
        except HTTPException as erro:
            # v4.3 - "tratamento individual de exceções": um conflito numa semana específica
            # nunca derruba as outras ocorrências da série.
            resultados.append({"ocorrencia": indice + 1, "sucesso": False, "erro": erro.detail, "data_hora_inicio": inicio_ocorrencia})
    return resultados


def obter_reserva(db: Session, id_reserva: int) -> Reserva:
    reserva = db.query(Reserva).filter(Reserva.id_reserva == id_reserva).first()
    if not reserva:
        raise HTTPException(status_code=404, detail="Reserva não encontrada.")
    return reserva


def aprovar_reserva(db: Session, *, id_reserva: int) -> Reserva:
    reserva = obter_reserva(db, id_reserva)
    if reserva.status != SOLICITADA:
        raise HTTPException(status_code=400, detail=f"Reserva '{reserva.status}' não pode ser aprovada.")
    espaco = obter_espaco(db, reserva.id_espaco)
    associado = db.query(Associado).filter(Associado.id_associado == reserva.id_associado_solicitante).first()
    reserva.status = CONFIRMADA
    _gerar_cobranca_se_devido(db, espaco=espaco, associado=associado, reserva=reserva)
    db.commit()
    db.refresh(reserva)
    return reserva


def recusar_reserva(db: Session, *, id_reserva: int, motivo: str) -> Reserva:
    reserva = obter_reserva(db, id_reserva)
    if reserva.status != SOLICITADA:
        raise HTTPException(status_code=400, detail=f"Reserva '{reserva.status}' não pode ser recusada.")
    reserva.status = RECUSADA
    reserva.motivo_status = motivo
    if reserva.id_compromisso_agenda:
        _liberar_compromisso(db, reserva.id_compromisso_agenda)
        reserva.id_compromisso_agenda = None
    db.commit()
    db.refresh(reserva)
    return reserva


def _liberar_compromisso(db: Session, id_compromisso: int) -> None:
    from app.models.motores import CompromissoAgenda

    compromisso = db.query(CompromissoAgenda).filter(CompromissoAgenda.id_compromisso == id_compromisso).first()
    if compromisso:
        db.delete(compromisso)


def cancelar_reserva(db: Session, *, id_reserva: int, motivo: str, id_usuario: Optional[int]) -> Reserva:
    reserva = obter_reserva(db, id_reserva)
    if reserva.status not in (SOLICITADA, CONFIRMADA):
        raise HTTPException(status_code=400, detail=f"Reserva '{reserva.status}' não pode ser cancelada.")

    espaco = obter_espaco(db, reserva.id_espaco)
    horas_ate_reserva = (reserva.data_hora_inicio - datetime.utcnow()).total_seconds() / 3600
    cancelamento_tardio = horas_ate_reserva < espaco.prazo_cancelamento_horas
    if cancelamento_tardio and espaco.taxa_cancelamento_tardio and espaco.taxa_cancelamento_tardio > 0:
        titulo_taxa = TituloFinanceiro(
            tipo_titulo="A Receber", id_conta_contabil=espaco.id_conta_contabil_receita, id_associado=reserva.id_associado_solicitante,
            descricao=f"Taxa de cancelamento tardio - reserva de '{espaco.nome}'",
            valor_original=espaco.taxa_cancelamento_tardio, saldo_devedor=espaco.taxa_cancelamento_tardio,
            data_vencimento=datetime.utcnow(), status="Pendente",
        )
        db.add(titulo_taxa)

    reserva.status = CANCELADA
    reserva.motivo_status = motivo
    if reserva.id_compromisso_agenda:
        _liberar_compromisso(db, reserva.id_compromisso_agenda)
        reserva.id_compromisso_agenda = None
    db.commit()
    db.refresh(reserva)
    return reserva


def marcar_no_show(db: Session, *, id_reserva: int) -> Reserva:
    reserva = obter_reserva(db, id_reserva)
    if reserva.status != CONFIRMADA:
        raise HTTPException(status_code=400, detail=f"Só uma reserva 'CONFIRMADA' pode ser marcada como não comparecimento (está '{reserva.status}').")
    if reserva.data_hora_inicio > datetime.utcnow():
        raise HTTPException(status_code=400, detail="Não é possível marcar não comparecimento antes do horário da reserva.")
    reserva.status = NAO_COMPARECEU
    db.commit()
    db.refresh(reserva)
    return reserva


def listar_reservas(db: Session, *, id_espaco: Optional[int] = None, id_associado_solicitante: Optional[int] = None) -> list[Reserva]:
    consulta = db.query(Reserva)
    if id_espaco is not None:
        consulta = consulta.filter(Reserva.id_espaco == id_espaco)
    if id_associado_solicitante is not None:
        consulta = consulta.filter(Reserva.id_associado_solicitante == id_associado_solicitante)
    return consulta.order_by(Reserva.data_hora_inicio.desc()).all()


# ==========================================
# CHECKLIST DE ENTREGA/DEVOLUÇÃO
# ==========================================
def registrar_retirada(db: Session, *, id_reserva: int, condicao_retirada: str, id_usuario: Optional[int]) -> ChecklistDevolucaoEspaco:
    reserva = obter_reserva(db, id_reserva)
    if reserva.status != CONFIRMADA:
        raise HTTPException(status_code=400, detail="Só uma reserva confirmada pode registrar retirada do espaço.")
    checklist = db.query(ChecklistDevolucaoEspaco).filter(ChecklistDevolucaoEspaco.id_reserva == id_reserva).first()
    if not checklist:
        checklist = ChecklistDevolucaoEspaco(id_reserva=id_reserva)
        db.add(checklist)
    if checklist.data_retirada is not None:
        raise HTTPException(status_code=400, detail="Retirada já registrada para esta reserva.")
    checklist.condicao_retirada = condicao_retirada
    checklist.data_retirada = datetime.utcnow()
    checklist.id_usuario_retirada = id_usuario
    db.commit()
    db.refresh(checklist)
    return checklist


def registrar_devolucao(
    db: Session, *, id_reserva: int, condicao_devolucao: str, houve_avaria: bool, descricao_avaria: Optional[str], id_usuario: Optional[int],
) -> ChecklistDevolucaoEspaco:
    checklist = db.query(ChecklistDevolucaoEspaco).filter(ChecklistDevolucaoEspaco.id_reserva == id_reserva).first()
    if not checklist or checklist.data_retirada is None:
        raise HTTPException(status_code=400, detail="Registre a retirada antes da devolução.")
    if checklist.data_devolucao is not None:
        raise HTTPException(status_code=400, detail="Devolução já registrada para esta reserva.")
    if houve_avaria and not descricao_avaria:
        raise HTTPException(status_code=400, detail="Descreva a avaria.")

    checklist.condicao_devolucao = condicao_devolucao
    checklist.houve_avaria = houve_avaria
    checklist.descricao_avaria = descricao_avaria
    checklist.data_devolucao = datetime.utcnow()
    checklist.id_usuario_devolucao = id_usuario

    reserva = obter_reserva(db, id_reserva)
    reserva.status = CONCLUIDA
    db.commit()
    db.refresh(checklist)
    return checklist


def obter_checklist(db: Session, id_reserva: int) -> Optional[ChecklistDevolucaoEspaco]:
    return db.query(ChecklistDevolucaoEspaco).filter(ChecklistDevolucaoEspaco.id_reserva == id_reserva).first()
