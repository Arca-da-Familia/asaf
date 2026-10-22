"""v6.2c (FASE 6) - publicar um aviso DEPOIS: quem tem `comunicar` escolhe data e hora; a tarefa periódica (de 15 em 15 minutos: `scripts/publicar_avisos_agendados.py`) publica na
hora (ver app/models/comunicacao.py::AvisoAgendado).

O que este módulo garante:
  - agendar passa pelas mesmas regras de publicar (título, texto, variáveis, categoria, modelo, filtro por situação só para quem pode, grupo não vazio, o total conferido igual ao de
    agora), mais: a hora fica entre 5 minutos e 90 dias à frente, e a validade não pode acabar antes do dia da publicação;
  - na hora de publicar o grupo é calculado de NOVO pela mesma regra (é o grupo daquele momento que recebe; o total conferido ao agendar fica registrado); se o autor perdeu `comunicar`
    (ou o login foi desativado), se a validade já passou ou se ninguém está mais no grupo, o agendamento é CANCELADO com o motivo, e nada é publicado;
  - quem tem `comunicar` cancela antes da hora, com motivo;
  - a tarefa do GitHub pode atrasar (de minutos a horas): o aviso sai NA PRIMEIRA rodada depois da hora marcada, nunca antes; a tela diz isso;
  - agendar, cancelar e publicar vão para a Auditoria (a publicação também gera o AVISO_PUBLICADO de sempre, em nome do autor)."""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.models.comunicacao import AGENDADO, AGENDAMENTO_CANCELADO, PUBLICADO, AvisoAgendado
from app.models.core import Usuario
from app.services import comunicacao
from app.services.catalogos import validar_codigo_em_catalogo
from app.services.fuso import para_belem

LOG = logging.getLogger("asaf.avisos_agendados")

MINIMO_A_FRENTE = timedelta(minutes=5)
MAXIMO_A_FRENTE = timedelta(days=90)


def _utc_sem_fuso(momento: datetime) -> datetime:
    """A hora vem do navegador com fuso (ou já em UTC, sem fuso): o banco guarda UTC sem fuso."""
    if momento.tzinfo is not None:
        momento = momento.astimezone(timezone.utc).replace(tzinfo=None)
    return momento


def _serializar(a: AvisoAgendado) -> dict:
    return {
        "id_agendado": a.id_agendado, "publicar_em": a.publicar_em, "situacao": a.situacao, "titulo": a.titulo, "categoria": a.categoria, "valido_ate": a.valido_ate,
        "exige_confirmacao": a.exige_confirmacao, "por_email": a.por_email, "publico_descricao": a.publico_descricao, "total_conferido": a.total_conferido,
        "id_aviso": a.id_aviso, "motivo": a.motivo, "criado_em": a.criado_em,
    }


def agendar(
    db: Session, usuario: Usuario, *, titulo: str, texto: str, categoria: str, valido_ate: date, exige_confirmacao: bool, por_email: bool, publico: dict,
    total_confirmado: int, publicar_em: datetime, id_modelo: Optional[int] = None, agora: Optional[datetime] = None,
) -> dict:
    agora = agora or datetime.utcnow()
    titulo, texto = comunicacao.validar_texto_e_titulo(titulo, texto)
    validar_codigo_em_catalogo(db, comunicacao.CATALOGO_DE_CATEGORIA, categoria, "Categoria do aviso")
    comunicacao.validar_modelo(db, id_modelo)
    publicar_em = _utc_sem_fuso(publicar_em)
    if publicar_em < agora + MINIMO_A_FRENTE:
        raise HTTPException(status_code=422, detail="A hora de publicar tem de ser pelo menos 5 minutos à frente. Para publicar já, use Publicar.")
    if publicar_em > agora + MAXIMO_A_FRENTE:
        raise HTTPException(status_code=422, detail="Dá para agendar até 90 dias à frente.")
    dia_da_publicacao = para_belem(publicar_em).date()
    if valido_ate < dia_da_publicacao:
        raise HTTPException(status_code=422, detail="O \"no mural até\" não pode acabar antes do dia em que o aviso vai ser publicado.")
    if valido_ate > dia_da_publicacao + timedelta(days=comunicacao.DIAS_MAXIMOS_NO_MURAL):
        raise HTTPException(status_code=422, detail="Um aviso fica no mural por no máximo 2 anos.")
    normalizado = comunicacao.normalizar_publico(db, publico, usuario)
    destinos = comunicacao.resolver_publico(db, normalizado)
    if not destinos:
        raise HTTPException(status_code=422, detail="Ninguém está neste grupo hoje: o aviso não foi agendado.")
    if total_confirmado != len(destinos):
        raise HTTPException(
            status_code=409,
            detail=f"O grupo mudou desde a conferência: agora são {len(destinos)} pessoa(s), não {total_confirmado}. Confira de novo antes de agendar.",
        )
    agendado = AvisoAgendado(
        publicar_em=publicar_em, situacao=AGENDADO, titulo=titulo, texto=texto, categoria=categoria, valido_ate=valido_ate, exige_confirmacao=bool(exige_confirmacao),
        por_email=bool(por_email), publico=normalizado, publico_descricao=comunicacao.descrever_publico(db, normalizado), total_conferido=len(destinos),
        id_modelo=id_modelo, id_usuario_autor=usuario.id_usuario, criado_em=agora,
    )
    db.add(agendado)
    db.flush()
    registrar_auditoria(
        db, usuario, "avisos_agendados", "AVISO_AGENDADO", id_registro_afetado=agendado.id_agendado,
        dados_depois={"titulo": titulo, "publicar_em": publicar_em.isoformat(), "publico": agendado.publico_descricao, "total_conferido": len(destinos), "por_email": agendado.por_email},
    )
    db.refresh(agendado)
    return _serializar(agendado)


def listar(db: Session, *, situacao: Optional[str]) -> list[dict]:
    consulta = db.query(AvisoAgendado)
    if situacao:
        consulta = consulta.filter(AvisoAgendado.situacao == situacao)
    # os que vão sair: o próximo primeiro; os que já saíram ou foram cancelados: o mais novo primeiro (senão os novos sumiriam depois de 200)
    ordem = (AvisoAgendado.publicar_em, AvisoAgendado.id_agendado) if situacao == AGENDADO else (AvisoAgendado.publicar_em.desc(), AvisoAgendado.id_agendado.desc())
    return [_serializar(a) for a in consulta.order_by(*ordem).limit(200).all()]


def cancelar(db: Session, usuario: Usuario, id_agendado: int, motivo: str) -> dict:
    agendado = db.get(AvisoAgendado, id_agendado)
    if agendado is None:
        raise HTTPException(status_code=404, detail="Agendamento não encontrado.")
    motivo = (motivo or "").strip()
    if not (comunicacao.MOTIVO_MINIMO <= len(motivo) <= comunicacao.MOTIVO_MAXIMO):
        raise HTTPException(status_code=422, detail=f"Escreva o motivo do cancelamento (de {comunicacao.MOTIVO_MINIMO} a {comunicacao.MOTIVO_MAXIMO} letras).")
    # troca condicional: se a rotina já pegou o agendamento para publicar (ou outra pessoa cancelou), esta não vale
    trocou = db.query(AvisoAgendado).filter(AvisoAgendado.id_agendado == id_agendado, AvisoAgendado.situacao == AGENDADO).update(
        {"situacao": AGENDAMENTO_CANCELADO, "motivo": motivo, "id_usuario_cancelamento": usuario.id_usuario}, synchronize_session=False,
    )
    if trocou != 1:
        db.rollback()
        db.refresh(agendado)
        raise HTTPException(status_code=409, detail=f"Este agendamento já está \"{agendado.situacao}\".")
    registrar_auditoria(db, usuario, "avisos_agendados", "AVISO_AGENDADO_CANCELADO", id_registro_afetado=id_agendado, dados_depois={"motivo": motivo})
    db.refresh(agendado)
    return _serializar(agendado)


def _cancelar_sozinho(db: Session, agendado: AvisoAgendado, motivo: str) -> None:
    """Cancela e AVISA no sino quem agendou (uma convocação que não sai não pode passar sem ninguém saber)."""
    from app.services import notificacoes_painel

    agendado.situacao, agendado.motivo = AGENDAMENTO_CANCELADO, motivo
    notificacoes_painel.notificar(
        db, [agendado.id_usuario_autor], tipo="aviso_agendado_cancelado", titulo=f"O aviso agendado não saiu: {agendado.titulo}", texto=motivo[:500],
        link="/comunicacao/agendados",
    )
    registrar_auditoria(db, None, "avisos_agendados", "AVISO_AGENDADO_CANCELADO", id_registro_afetado=agendado.id_agendado, dados_depois={"motivo": motivo, "pelo_sistema": True})


def publicar_os_que_chegaram_a_hora(db: Session, agora: Optional[datetime] = None) -> dict:
    """A rodada da tarefa periódica: publica o que já passou da hora. Um agendamento que dá erro não impede os outros (e conta como falha)."""
    from app.security import usuario_tem_permissao

    agora = agora or datetime.utcnow()
    resultado = {"publicados": 0, "cancelados": 0, "falhas": 0}
    prontos = db.query(AvisoAgendado).filter(AvisoAgendado.situacao == AGENDADO, AvisoAgendado.publicar_em <= agora).order_by(AvisoAgendado.publicar_em).all()
    for agendado in prontos:
        try:
            autor = db.get(Usuario, agendado.id_usuario_autor)
            if autor is None or not autor.ativo or not usuario_tem_permissao(db, autor, comunicacao.PERMISSAO):
                _cancelar_sozinho(db, agendado, "Quem agendou não tem mais a permissão de publicar avisos na hora marcada.")
                resultado["cancelados"] += 1
                continue
            if agendado.valido_ate < comunicacao.hoje():
                _cancelar_sozinho(db, agendado, "A validade do aviso acabou antes de ele ser publicado (a rotina atrasou).")
                resultado["cancelados"] += 1
                continue
            # PEGA a linha na mesma transação em que o aviso nasce (troca condicional: quem cancelou antes ganha; nada fica "Agendado" com o aviso já publicado, que sairia de novo)
            pegou = db.query(AvisoAgendado).filter(AvisoAgendado.id_agendado == agendado.id_agendado, AvisoAgendado.situacao == AGENDADO).update(
                {"situacao": PUBLICADO}, synchronize_session=False,
            )
            if pegou != 1:
                db.rollback()
                continue
            try:
                aviso = comunicacao.publicar(
                    db, autor, titulo=agendado.titulo, texto=agendado.texto, categoria=agendado.categoria, valido_ate=agendado.valido_ate,
                    exige_confirmacao=agendado.exige_confirmacao, publico=agendado.publico, total_confirmado=0, por_email=agendado.por_email,
                    id_modelo=agendado.id_modelo, conferir_total=False, total_maximo=agendado.total_conferido,
                )
            except HTTPException as erro:
                db.rollback()  # desfaz também a troca para Publicado
                db.refresh(agendado)
                _cancelar_sozinho(db, agendado, f"Não foi possível publicar na hora marcada: {erro.detail}")
                resultado["cancelados"] += 1
                continue
            db.refresh(agendado)
            agendado.id_aviso = aviso.id_aviso
            registrar_auditoria(
                db, None, "avisos_agendados", "AVISO_AGENDADO_PUBLICADO", id_registro_afetado=agendado.id_agendado,
                dados_depois={"id_aviso": aviso.id_aviso, "total_conferido": agendado.total_conferido, "total_publicado": aviso.total_destinatarios},
            )
            resultado["publicados"] += 1
        except Exception:  # noqa: BLE001 - um agendamento com problema não pode segurar os outros; quem roda precisa saber
            db.rollback()
            LOG.exception("falha ao publicar o aviso agendado %s", agendado.id_agendado)
            resultado["falhas"] += 1
    return resultado
