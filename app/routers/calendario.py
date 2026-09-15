"""v2.9 (FASE 2) - calendário institucional único: obrigações estatutárias recorrentes (AGO
semestral, eleição quadrienal), assembleias convocadas, mandatos vencendo, prazos de deliberação
e eventos/projetos reais da associação (FASE 4) - tudo com alerta por antecedência configurável,
pra nunca descobrir em dezembro que devia ter feito algo em abril. Leitura liberada a qualquer
usuário autenticado; agendar evento institucional exige permissão `governanca`."""
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.calendario import EventoCalendario
from app.schemas.calendario import EventoCalendarioCriar
from app.security import exigir_permissao, get_current_user
from app.services.calendario import montar_calendario
from app.services.catalogos import validar_codigo_em_catalogo

router = APIRouter()
_permissao_governanca = exigir_permissao("governanca")


@router.get("/api/calendario/", summary="Calendário institucional unificado (obrigações + eventos)")
def obter_calendario(dias_antecedencia: int = Query(90, ge=1, le=730), db: Session = Depends(get_db), _usuario=Depends(get_current_user)):
    return montar_calendario(db, dias_antecedencia)


@router.post("/api/eventos-calendario/", summary="Agendar evento institucional (reunião de diretoria/conselho, data institucional etc.)")
def criar_evento(dados: EventoCalendarioCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    validar_codigo_em_catalogo(db, "categoria_evento_calendario", dados.categoria, "Categoria de evento")
    evento = EventoCalendario(
        titulo=dados.titulo, descricao=dados.descricao, categoria=dados.categoria,
        data_inicio=dados.data_inicio, data_fim=dados.data_fim, id_usuario_criacao=usuario.id_usuario,
    )
    db.add(evento)
    db.commit()
    db.refresh(evento)
    registrar_auditoria(
        db, usuario, "eventos_calendario", "CREATE", id_registro_afetado=evento.id_evento,
        dados_depois={"titulo": evento.titulo, "categoria": evento.categoria},
        ip_origem=request.client.host if request.client else None,
    )
    return {"id_evento": evento.id_evento, "titulo": evento.titulo, "data_inicio": evento.data_inicio}


@router.get("/api/eventos-calendario/", summary="Listar eventos institucionais agendados")
def listar_eventos(db: Session = Depends(get_db), _usuario=Depends(get_current_user)):
    eventos = db.query(EventoCalendario).order_by(EventoCalendario.data_inicio).all()
    return [
        {
            "id_evento": e.id_evento, "titulo": e.titulo, "descricao": e.descricao, "categoria": e.categoria,
            "data_inicio": e.data_inicio, "data_fim": e.data_fim,
        }
        for e in eventos
    ]
