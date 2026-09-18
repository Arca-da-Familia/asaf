"""v4.0 (FASE 4) - motor de indicadores: aplicável a projeto, evento, área e plano estratégico
(v12.9) sem fórmula fixa em código - a meta e a periodicidade são dado, quem mede é quem sabe a
fonte real (nunca calculado por mágica dentro do motor)."""
from typing import Optional

from decimal import Decimal
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.motores import Indicador, MedicaoIndicador
from app.services.catalogos import validar_codigo_em_catalogo


def criar_indicador(
    db: Session, *, nome: str, unidade: str, meta: Optional[Decimal], periodicidade: str,
    contexto_tipo: Optional[str] = None, id_contexto: Optional[int] = None,
) -> Indicador:
    validar_codigo_em_catalogo(db, "unidade_medida_indicador", unidade, "Unidade de medida")
    validar_codigo_em_catalogo(db, "periodicidade_indicador", periodicidade, "Periodicidade")
    indicador = Indicador(nome=nome, unidade=unidade, meta=meta, periodicidade=periodicidade, contexto_tipo=contexto_tipo, id_contexto=id_contexto)
    db.add(indicador)
    db.commit()
    db.refresh(indicador)
    return indicador


def listar_indicadores(db: Session, *, contexto_tipo: Optional[str] = None, id_contexto: Optional[int] = None) -> list[Indicador]:
    consulta = db.query(Indicador).filter(Indicador.ativo.is_(True))
    if contexto_tipo is not None:
        consulta = consulta.filter(Indicador.contexto_tipo == contexto_tipo)
    if id_contexto is not None:
        consulta = consulta.filter(Indicador.id_contexto == id_contexto)
    return consulta.order_by(Indicador.nome).all()


def registrar_medicao(
    db: Session, *, id_indicador: int, valor: Decimal, periodo: str, fonte: Optional[str], id_usuario: Optional[int],
) -> MedicaoIndicador:
    indicador = db.query(Indicador).filter(Indicador.id_indicador == id_indicador).first()
    if not indicador:
        raise HTTPException(status_code=404, detail="Indicador não encontrado.")
    if db.query(MedicaoIndicador).filter(MedicaoIndicador.id_indicador == id_indicador, MedicaoIndicador.periodo == periodo).first():
        raise HTTPException(status_code=400, detail=f"Já existe medição deste indicador para o período '{periodo}' - registre uma correção como observação, nunca duas medições do mesmo período.")

    medicao = MedicaoIndicador(id_indicador=id_indicador, valor=valor, periodo=periodo, fonte=fonte, id_usuario_medicao=id_usuario)
    db.add(medicao)
    db.commit()
    db.refresh(medicao)
    return medicao


def listar_medicoes(db: Session, *, id_indicador: int) -> list[MedicaoIndicador]:
    return db.query(MedicaoIndicador).filter(MedicaoIndicador.id_indicador == id_indicador).order_by(MedicaoIndicador.periodo).all()
