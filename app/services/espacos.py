"""v4.3 (FASE 4) - cadastro de Espaço e bloqueios (manutenção, feriado, uso institucional). Um
bloqueio também vira um `CompromissoAgenda` (motor v4.0) - é assim que uma reserva nunca cai em
cima de um bloqueio, sem duplicar a checagem de sobreposição."""
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.espacos import BloqueioEspaco, Espaco
from app.services import agenda
from app.services.catalogos import validar_codigo_em_catalogo

RECURSO_ESPACO = "Espaco"


def criar_espaco(
    db: Session, *, nome: str, tipo: str, capacidade: Optional[int], recursos_disponiveis: Optional[str],
    regras_uso: Optional[str], horario_funcionamento_inicio: Optional[str], horario_funcionamento_fim: Optional[str],
    exige_aprovacao: bool, valor_reserva: Optional[Decimal], isento_para_associado_adimplente: bool,
    id_conta_contabil_receita: Optional[int], prazo_cancelamento_horas: int, taxa_cancelamento_tardio: Optional[Decimal],
    limite_no_show_bloqueio: Optional[int],
) -> Espaco:
    validar_codigo_em_catalogo(db, "tipo_espaco", tipo, "Tipo de espaço")
    espaco = Espaco(
        nome=nome, tipo=tipo, capacidade=capacidade, recursos_disponiveis=recursos_disponiveis, regras_uso=regras_uso,
        horario_funcionamento_inicio=horario_funcionamento_inicio, horario_funcionamento_fim=horario_funcionamento_fim,
        exige_aprovacao=exige_aprovacao, valor_reserva=valor_reserva, isento_para_associado_adimplente=isento_para_associado_adimplente,
        id_conta_contabil_receita=id_conta_contabil_receita, prazo_cancelamento_horas=prazo_cancelamento_horas,
        taxa_cancelamento_tardio=taxa_cancelamento_tardio, limite_no_show_bloqueio=limite_no_show_bloqueio,
    )
    db.add(espaco)
    db.commit()
    db.refresh(espaco)
    return espaco


def listar_espacos(db: Session) -> list[Espaco]:
    return db.query(Espaco).order_by(Espaco.nome).all()


def obter_espaco(db: Session, id_espaco: int) -> Espaco:
    espaco = db.query(Espaco).filter(Espaco.id_espaco == id_espaco).first()
    if not espaco:
        raise HTTPException(status_code=404, detail="Espaço não encontrado.")
    return espaco


def criar_bloqueio(db: Session, *, id_espaco: int, data_hora_inicio, data_hora_fim, motivo: str, descricao: Optional[str], id_usuario: Optional[int]) -> BloqueioEspaco:
    obter_espaco(db, id_espaco)
    validar_codigo_em_catalogo(db, "motivo_bloqueio_espaco", motivo, "Motivo de bloqueio")

    compromisso = agenda.criar_compromisso(
        db, recurso_tipo=RECURSO_ESPACO, id_recurso=id_espaco, contexto_tipo="BloqueioEspaco", id_contexto=id_espaco,
        data_hora_inicio=data_hora_inicio, data_hora_fim=data_hora_fim, id_usuario=id_usuario,
    )
    bloqueio = BloqueioEspaco(
        id_espaco=id_espaco, data_hora_inicio=data_hora_inicio, data_hora_fim=data_hora_fim, motivo=motivo,
        descricao=descricao, id_compromisso_agenda=compromisso.id_compromisso, id_usuario_registro=id_usuario,
    )
    db.add(bloqueio)
    db.commit()
    db.refresh(bloqueio)
    return bloqueio


def listar_bloqueios(db: Session, *, id_espaco: int) -> list[BloqueioEspaco]:
    return db.query(BloqueioEspaco).filter(BloqueioEspaco.id_espaco == id_espaco).order_by(BloqueioEspaco.data_hora_inicio).all()


def disponibilidade_publica(db: Session, *, id_espaco: int) -> list[dict]:
    """Leitura pública (sem autenticação) - só horário ocupado, nunca quem reservou nem a
    finalidade. Reaproveita o motor de agenda direto (v4.0)."""
    obter_espaco(db, id_espaco)
    compromissos = agenda.listar_compromissos(db, recurso_tipo=RECURSO_ESPACO, id_recurso=id_espaco)
    return [{"data_hora_inicio": c.data_hora_inicio, "data_hora_fim": c.data_hora_fim} for c in compromissos]
