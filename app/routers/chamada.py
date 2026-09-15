"""v2.5.3b (FASE 2.5 - Painel, achado do usuário 2026-09-15) - autochamada por código da sessão,
justificativa de falta e correção manual pelo secretário. Complementa o credenciamento (v2.3):
`bater-presenca` é o mesmo credenciamento, só que resolvido pelo próprio token do associado (em
vez de escolhido por quem tem a permissão `governanca`) e condicionado a um código só conhecido
por quem está na sala (`Assembleia.codigo_chamada`, gerado em `abrir_sessao`)."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.associados import Associado
from app.models.chamada import ACEITA, PENDENTE, REJEITADA, JustificativaFalta
from app.models.governanca import CONVOCADA, EM_ANDAMENTO, REALIZADA, Assembleia, HabilitadoAssembleia
from app.models.sessao_assembleia import Credenciamento
from app.schemas.chamada import (
    BaterPresencaRequest, CredenciamentoManualCriar, JustificativaCriar, JustificativaDecidir,
)
from app.security import exigir_permissao, get_current_user, usuario_tem_permissao
from app.services.chamada import status_presenca

router = APIRouter()
_permissao_governanca = exigir_permissao("governanca")


def _associado_do_usuario_ou_403(db: Session, usuario) -> Associado:
    associado = db.query(Associado).filter(Associado.id_usuario == usuario.id_usuario).first()
    if not associado:
        raise HTTPException(status_code=403, detail="Só um associado pode fazer isso - este usuário não está vinculado a um associado.")
    return associado


def _buscar_assembleia_ou_404(db: Session, id_assembleia: int) -> Assembleia:
    assembleia = db.query(Assembleia).filter(Assembleia.id_assembleia == id_assembleia).first()
    if not assembleia:
        raise HTTPException(status_code=404, detail="Assembleia não encontrada.")
    return assembleia


def _credenciar(db: Session, id_assembleia: int, associado: Associado, modalidade: str, id_usuario_registro: int) -> Credenciamento:
    if db.query(Credenciamento).filter(Credenciamento.id_assembleia == id_assembleia, Credenciamento.id_associado == associado.id_associado).first():
        raise HTTPException(status_code=400, detail="Associado já foi credenciado nesta sessão.")
    credenciamento = Credenciamento(
        id_assembleia=id_assembleia, id_associado=associado.id_associado, modalidade=modalidade,
        id_usuario_registro=id_usuario_registro,
    )
    db.add(credenciamento)
    db.commit()
    db.refresh(credenciamento)
    return credenciamento


@router.post("/api/assembleias/{id_assembleia}/bater-presenca", summary="Autochamada: associado marca a própria presença com o código da sessão")
def bater_presenca(id_assembleia: int, dados: BaterPresencaRequest, request: Request, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    assembleia = _buscar_assembleia_ou_404(db, id_assembleia)
    if assembleia.status != EM_ANDAMENTO:
        raise HTTPException(status_code=400, detail=f"Assembleia está '{assembleia.status}' - só dá pra bater presença com a sessão 'Em andamento'.")
    if not assembleia.codigo_chamada or dados.codigo != assembleia.codigo_chamada:
        raise HTTPException(status_code=400, detail="Código de chamada incorreto - confira o código anunciado/projetado na sala.")

    associado = _associado_do_usuario_ou_403(db, usuario)
    credenciamento = _credenciar(db, id_assembleia, associado, dados.modalidade, usuario.id_usuario)
    registrar_auditoria(
        db, usuario, "credenciamentos_assembleia", "AUTOCHAMADA", id_registro_afetado=credenciamento.id_credenciamento,
        dados_depois={"id_assembleia": id_assembleia, "id_associado": associado.id_associado, "modalidade": dados.modalidade},
        ip_origem=request.client.host if request.client else None,
    )
    return {"mensagem": "Presença registrada.", "id_credenciamento": credenciamento.id_credenciamento}


@router.get("/api/assembleias/{id_assembleia}/codigo-chamada", summary="Código de chamada da sessão (para anunciar/projetar na sala)")
def obter_codigo_chamada(id_assembleia: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_governanca)):
    assembleia = _buscar_assembleia_ou_404(db, id_assembleia)
    if not assembleia.codigo_chamada:
        raise HTTPException(status_code=400, detail="Esta assembleia ainda não teve a sessão aberta - o código só existe a partir daí.")
    return {"codigo_chamada": assembleia.codigo_chamada}


@router.post("/api/assembleias/{id_assembleia}/credenciamentos/manual", summary="Correção manual de presença pelo secretário (inclusive após o encerramento)")
def credenciar_manual(id_assembleia: int, dados: CredenciamentoManualCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    assembleia = _buscar_assembleia_ou_404(db, id_assembleia)
    if assembleia.status not in (EM_ANDAMENTO, REALIZADA):
        raise HTTPException(status_code=400, detail=f"Assembleia está '{assembleia.status}' - correção manual só vale a partir da sessão aberta.")
    associado = db.query(Associado).filter(Associado.id_associado == dados.id_associado).first()
    if not associado:
        raise HTTPException(status_code=404, detail="Associado não encontrado.")

    credenciamento = _credenciar(db, id_assembleia, associado, dados.modalidade, usuario.id_usuario)
    registrar_auditoria(
        db, usuario, "credenciamentos_assembleia", "CORRECAO_MANUAL", id_registro_afetado=credenciamento.id_credenciamento,
        dados_depois={"id_assembleia": id_assembleia, "id_associado": associado.id_associado, "modalidade": dados.modalidade},
        ip_origem=request.client.host if request.client else None,
    )
    return {"mensagem": "Presença registrada manualmente.", "id_credenciamento": credenciamento.id_credenciamento}


# ==========================================
# JUSTIFICATIVA DE FALTA
# ==========================================
def _serializar_justificativa(j: JustificativaFalta) -> dict:
    return {
        "id_justificativa": j.id_justificativa, "id_assembleia": j.id_assembleia, "id_associado": j.id_associado,
        "motivo": j.motivo, "status": j.status, "motivo_decisao": j.motivo_decisao,
        "decidido_em": j.decidido_em, "criado_em": j.criado_em,
    }


@router.post("/api/assembleias/{id_assembleia}/justificativas", summary="Justificar falta (própria, ou em nome de outro associado por quem tem a permissão `governanca`)")
def criar_justificativa(id_assembleia: int, dados: JustificativaCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    assembleia = _buscar_assembleia_ou_404(db, id_assembleia)
    if assembleia.status not in (CONVOCADA, EM_ANDAMENTO):
        raise HTTPException(status_code=400, detail=f"Assembleia está '{assembleia.status}' - justificativa só vale do edital até o encerramento da sessão.")

    tem_permissao_direta = usuario_tem_permissao(db, usuario, "governanca")
    if dados.id_associado is not None:
        if not tem_permissao_direta:
            raise HTTPException(status_code=403, detail="Só quem tem a permissão `governanca` pode lançar justificativa em nome de outro associado.")
        associado = db.query(Associado).filter(Associado.id_associado == dados.id_associado).first()
        if not associado:
            raise HTTPException(status_code=404, detail="Associado não encontrado.")
        status_inicial = ACEITA  # secretário lançando em nome do associado já é a decisão.
    else:
        associado = _associado_do_usuario_ou_403(db, usuario)
        status_inicial = PENDENTE

    if db.query(JustificativaFalta).filter(JustificativaFalta.id_assembleia == id_assembleia, JustificativaFalta.id_associado == associado.id_associado).first():
        raise HTTPException(status_code=400, detail="Já existe justificativa registrada para este associado nesta assembleia.")

    justificativa = JustificativaFalta(
        id_assembleia=id_assembleia, id_associado=associado.id_associado, motivo=dados.motivo,
        status=status_inicial, id_usuario_criacao=usuario.id_usuario,
        decidido_em=datetime.utcnow() if status_inicial == ACEITA else None,
        id_usuario_decisao=usuario.id_usuario if status_inicial == ACEITA else None,
    )
    db.add(justificativa)
    db.commit()
    db.refresh(justificativa)
    registrar_auditoria(
        db, usuario, "justificativas_falta_assembleia", "CREATE", id_registro_afetado=justificativa.id_justificativa,
        dados_depois={"id_assembleia": id_assembleia, "id_associado": associado.id_associado, "status": status_inicial},
        ip_origem=request.client.host if request.client else None,
    )
    return _serializar_justificativa(justificativa)


@router.get("/api/assembleias/{id_assembleia}/justificativas", summary="Listar justificativas de falta da assembleia")
def listar_justificativas(id_assembleia: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_governanca)):
    justificativas = db.query(JustificativaFalta).filter(JustificativaFalta.id_assembleia == id_assembleia).order_by(JustificativaFalta.criado_em).all()
    return [_serializar_justificativa(j) for j in justificativas]


@router.post("/api/justificativas/{id_justificativa}/decidir", summary="Aceitar ou rejeitar justificativa de falta")
def decidir_justificativa(id_justificativa: int, dados: JustificativaDecidir, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    justificativa = db.query(JustificativaFalta).filter(JustificativaFalta.id_justificativa == id_justificativa).first()
    if not justificativa:
        raise HTTPException(status_code=404, detail="Justificativa não encontrada.")
    if justificativa.status != PENDENTE:
        raise HTTPException(status_code=400, detail=f"Justificativa já está '{justificativa.status}'.")

    justificativa.status = ACEITA if dados.aceitar else REJEITADA
    justificativa.motivo_decisao = dados.motivo_decisao
    justificativa.decidido_em = datetime.utcnow()
    justificativa.id_usuario_decisao = usuario.id_usuario
    db.commit()
    db.refresh(justificativa)
    registrar_auditoria(
        db, usuario, "justificativas_falta_assembleia", "DECIDIDA", id_registro_afetado=justificativa.id_justificativa,
        dados_depois={"status": justificativa.status, "motivo_decisao": dados.motivo_decisao},
        ip_origem=request.client.host if request.client else None,
    )
    return _serializar_justificativa(justificativa)


# ==========================================
# MINHAS ASSEMBLEIAS (v2.5.3b) - visão do próprio associado, fora do módulo Governança
# ==========================================
@router.get("/api/minhas-assembleias", summary="Assembleias em que o associado logado está habilitado, com seu status de presença/falta")
def minhas_assembleias(db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    associado = _associado_do_usuario_ou_403(db, usuario)
    habilitacoes = (
        db.query(HabilitadoAssembleia)
        .filter(HabilitadoAssembleia.id_associado == associado.id_associado)
        .all()
    )
    resultado = []
    for h in habilitacoes:
        assembleia = db.query(Assembleia).filter(Assembleia.id_assembleia == h.id_assembleia).first()
        if not assembleia:
            continue
        justificativa = (
            db.query(JustificativaFalta)
            .filter(JustificativaFalta.id_assembleia == assembleia.id_assembleia, JustificativaFalta.id_associado == associado.id_associado)
            .first()
        )
        resultado.append({
            "id_assembleia": assembleia.id_assembleia, "tipo": assembleia.tipo, "pauta": assembleia.pauta,
            "status": assembleia.status, "data_hora_convocacao": assembleia.data_hora_convocacao,
            "status_presenca": status_presenca(db, assembleia, associado.id_associado),
            "justificativa": _serializar_justificativa(justificativa) if justificativa else None,
        })
    resultado.sort(key=lambda r: r["data_hora_convocacao"], reverse=True)
    return resultado
