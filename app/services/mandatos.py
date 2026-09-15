"""v2.1 - leitura de mandatos vigentes e das permissões que eles concedem. Nada aqui é
persistido/recalculado por job: cada função consulta o estado atual e responde na hora (mesmo
princípio de app/services/categoria_associado.py para o período de experiência/licença)."""
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.models.core import Catalogo, OpcaoCatalogo
from app.models.mandatos import Mandato


def mandatos_vigentes_do_associado(db: Session, id_associado: int, em: Optional[datetime] = None) -> list[Mandato]:
    momento = em or datetime.utcnow()
    candidatos = (
        db.query(Mandato)
        .filter(
            Mandato.id_associado == id_associado,
            Mandato.data_inicio <= momento,
            Mandato.data_fim_previsto >= momento,
        )
        .all()
    )
    return [m for m in candidatos if m.vigente(momento)]


def permissoes_por_mandatos_vigentes(db: Session, id_associado: int, em: Optional[datetime] = None) -> set[str]:
    """Une `metadados["permissoes"]` de cada cargo (catálogo `titulo_cargo`) de todo mandato
    vigente do associado agora. Usada por `app.security.usuario_tem_permissao` - cargo concede
    permissão automaticamente enquanto o mandato estiver vigente, sem intervenção manual."""
    mandatos = mandatos_vigentes_do_associado(db, id_associado, em=em)
    if not mandatos:
        return set()

    catalogo_cargo = db.query(Catalogo).filter(Catalogo.chave == "titulo_cargo").first()
    if not catalogo_cargo:
        return set()

    codigos_cargo = {m.cargo_codigo for m in mandatos}
    opcoes = (
        db.query(OpcaoCatalogo)
        .filter(OpcaoCatalogo.id_catalogo == catalogo_cargo.id_catalogo, OpcaoCatalogo.codigo.in_(codigos_cargo))
        .all()
    )
    permissoes: set[str] = set()
    for opcao in opcoes:
        if opcao.metadados and isinstance(opcao.metadados.get("permissoes"), list):
            permissoes.update(opcao.metadados["permissoes"])
    return permissoes


def mandatos_vencendo(db: Session, dias: int = 90) -> list[dict]:
    """Alerta de mandato vencendo (90/30/7 dias) - calculado sob demanda na leitura, nunca por
    job/cron que pode falhar em silêncio. Só considera mandato hoje vigente (encerramento
    antecipado já resolvido não "vence" de novo)."""
    agora = datetime.utcnow()
    limite = agora + timedelta(days=dias)
    candidatos = (
        db.query(Mandato)
        .filter(
            Mandato.data_fim_efetivo.is_(None),
            Mandato.data_inicio <= agora,
            Mandato.data_fim_previsto >= agora,
            Mandato.data_fim_previsto <= limite,
        )
        .order_by(Mandato.data_fim_previsto)
        .all()
    )
    return [
        {"mandato": m, "dias_restantes": (m.data_fim_previsto - agora).days}
        for m in candidatos
    ]
