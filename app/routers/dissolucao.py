"""v2.8 (FASE 2) - roteiro de dissolução (Art. 31 do estatuto): deliberação → liquidação do
passivo → destinação do patrimônio remanescente → baixa cadastral, cada etapa sequencial e
auditada. Permissão `governanca` para tudo - "espera-se nunca usar", mas a ausência de rastro
claro é justamente o que trava uma dissolução real quando ela precisa acontecer."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.ata import CONCLUIDA, DISSOLUCAO as TIPO_DISSOLUCAO, Deliberacao
from app.models.dissolucao import (
    ABERTO, BAIXA_CADASTRAL_CONCLUIDA, CANCELADO, DELIBERADA, LIQUIDACAO_CONCLUIDA,
    PATRIMONIO_DESTINADO, ProcessoDissolucao,
)
from app.schemas.dissolucao import (
    BaixaCadastralRequest, CancelarProcessoRequest, DeliberarRequest, DestinarPatrimonioRequest,
    LiquidacaoConcluirRequest, ProcessoDissolucaoCriar,
)
from app.security import exigir_permissao, get_current_user
from app.services.estatuto import obter_regra_vigente

router = APIRouter()
_permissao_governanca = exigir_permissao("governanca")


def _serializar(p: ProcessoDissolucao) -> dict:
    return {
        "id_processo_dissolucao": p.id_processo_dissolucao, "motivo": p.motivo, "status": p.status,
        "id_deliberacao": p.id_deliberacao, "deliberada_em": p.deliberada_em,
        "liquidacao_concluida_em": p.liquidacao_concluida_em,
        "entidade_destinataria_nome": p.entidade_destinataria_nome,
        "entidade_destinataria_cnpj": p.entidade_destinataria_cnpj,
        "patrimonio_destinado_em": p.patrimonio_destinado_em,
        "baixa_cadastral_em": p.baixa_cadastral_em, "motivo_cancelamento": p.motivo_cancelamento,
    }


def _buscar_ou_404(db: Session, id_processo_dissolucao: int) -> ProcessoDissolucao:
    processo = db.query(ProcessoDissolucao).filter(ProcessoDissolucao.id_processo_dissolucao == id_processo_dissolucao).first()
    if not processo:
        raise HTTPException(status_code=404, detail="Processo de dissolução não encontrado.")
    return processo


def _exigir_status(processo: ProcessoDissolucao, esperado: str):
    if processo.status != esperado:
        raise HTTPException(status_code=400, detail=f"Processo está '{processo.status}', esta ação só vale a partir de '{esperado}'.")


@router.post("/api/processos-dissolucao/", summary="Abrir processo de dissolução (Art. 31)")
def abrir_processo(dados: ProcessoDissolucaoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    processo = ProcessoDissolucao(motivo=dados.motivo, id_usuario_criacao=usuario.id_usuario)
    db.add(processo)
    db.commit()
    db.refresh(processo)
    registrar_auditoria(db, usuario, "processos_dissolucao", "ABERTO", id_registro_afetado=processo.id_processo_dissolucao, ip_origem=request.client.host if request.client else None)
    return _serializar(processo)


@router.get("/api/processos-dissolucao/", summary="Listar processos de dissolução")
def listar_processos(db: Session = Depends(get_db), _usuario=Depends(get_current_user)):
    processos = db.query(ProcessoDissolucao).order_by(ProcessoDissolucao.criado_em.desc()).all()
    return [_serializar(p) for p in processos]


@router.get("/api/processos-dissolucao/{id_processo_dissolucao}", summary="Detalhar processo de dissolução")
def detalhar_processo(id_processo_dissolucao: int, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    return _serializar(_buscar_ou_404(db, id_processo_dissolucao))


@router.post("/api/processos-dissolucao/{id_processo_dissolucao}/deliberar", summary="Vincular a deliberação de dissolução aprovada pela Assembleia")
def registrar_deliberacao(id_processo_dissolucao: int, dados: DeliberarRequest, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    processo = _buscar_ou_404(db, id_processo_dissolucao)
    _exigir_status(processo, ABERTO)

    deliberacao = db.query(Deliberacao).filter(Deliberacao.id_deliberacao == dados.id_deliberacao).first()
    if not deliberacao:
        raise HTTPException(status_code=404, detail="Deliberação não encontrada.")
    if deliberacao.tipo != TIPO_DISSOLUCAO:
        raise HTTPException(status_code=400, detail=f"Deliberação precisa ser do tipo '{TIPO_DISSOLUCAO}' (Art. 31 - quórum de 2/3 dos presentes, v2.0).")
    if deliberacao.status_execucao != CONCLUIDA:
        raise HTTPException(status_code=400, detail="Deliberação de dissolução ainda não foi concluída pela Assembleia.")

    processo.id_deliberacao = dados.id_deliberacao
    processo.status = DELIBERADA
    processo.deliberada_em = datetime.utcnow()
    db.commit()
    registrar_auditoria(db, usuario, "processos_dissolucao", "DELIBERADA", id_registro_afetado=id_processo_dissolucao, dados_depois={"id_deliberacao": dados.id_deliberacao}, ip_origem=request.client.host if request.client else None)
    return _serializar(processo)


@router.post("/api/processos-dissolucao/{id_processo_dissolucao}/concluir-liquidacao", summary="Registrar liquidação do passivo concluída")
def concluir_liquidacao(id_processo_dissolucao: int, dados: LiquidacaoConcluirRequest, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    processo = _buscar_ou_404(db, id_processo_dissolucao)
    _exigir_status(processo, DELIBERADA)
    processo.liquidacao_observacao = dados.observacao
    processo.liquidacao_concluida_em = datetime.utcnow()
    processo.status = LIQUIDACAO_CONCLUIDA
    db.commit()
    registrar_auditoria(db, usuario, "processos_dissolucao", "LIQUIDACAO_CONCLUIDA", id_registro_afetado=id_processo_dissolucao, ip_origem=request.client.host if request.client else None)
    return _serializar(processo)


@router.post("/api/processos-dissolucao/{id_processo_dissolucao}/destinar-patrimonio", summary="Destinar o patrimônio remanescente (Art. 31, Parágrafo Único)")
def destinar_patrimonio(id_processo_dissolucao: int, dados: DestinarPatrimonioRequest, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    processo = _buscar_ou_404(db, id_processo_dissolucao)
    _exigir_status(processo, LIQUIDACAO_CONCLUIDA)

    anos_minimos = obter_regra_vigente(db, "ANOS_MINIMOS_ENTIDADE_DESTINATARIA_PATRIMONIO", "2") or "2"
    if not (dados.confirma_sede_parauapebas and dados.confirma_anos_minimos and dados.confirma_credenciada):
        raise HTTPException(
            status_code=400,
            detail=f"Art. 31, Parágrafo Único exige confirmar os três critérios: sede/atividade preponderante em "
                   f"Parauapebas/PA, mais de {anos_minimos} anos de existência, e credenciamento pelos órgãos competentes.",
        )

    processo.entidade_destinataria_nome = dados.entidade_nome
    processo.entidade_destinataria_cnpj = dados.entidade_cnpj
    processo.entidade_destinataria_justificativa = dados.justificativa
    processo.confirma_sede_parauapebas = True
    processo.confirma_anos_minimos = True
    processo.confirma_credenciada = True
    processo.patrimonio_destinado_em = datetime.utcnow()
    processo.status = PATRIMONIO_DESTINADO
    db.commit()
    registrar_auditoria(
        db, usuario, "processos_dissolucao", "PATRIMONIO_DESTINADO", id_registro_afetado=id_processo_dissolucao,
        dados_depois={"entidade_nome": dados.entidade_nome, "entidade_cnpj": dados.entidade_cnpj},
        ip_origem=request.client.host if request.client else None,
    )
    return _serializar(processo)


@router.post("/api/processos-dissolucao/{id_processo_dissolucao}/baixa-cadastral", summary="Registrar baixa cadastral (fim do roteiro)")
def registrar_baixa_cadastral(id_processo_dissolucao: int, dados: BaixaCadastralRequest, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    processo = _buscar_ou_404(db, id_processo_dissolucao)
    _exigir_status(processo, PATRIMONIO_DESTINADO)
    processo.baixa_cadastral_observacao = dados.observacao
    processo.baixa_cadastral_em = datetime.utcnow()
    processo.status = BAIXA_CADASTRAL_CONCLUIDA
    db.commit()
    registrar_auditoria(db, usuario, "processos_dissolucao", "BAIXA_CADASTRAL_CONCLUIDA", id_registro_afetado=id_processo_dissolucao, ip_origem=request.client.host if request.client else None)
    return _serializar(processo)


@router.post("/api/processos-dissolucao/{id_processo_dissolucao}/cancelar", summary="Cancelar processo de dissolução")
def cancelar_processo(id_processo_dissolucao: int, dados: CancelarProcessoRequest, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    processo = _buscar_ou_404(db, id_processo_dissolucao)
    if processo.status in (BAIXA_CADASTRAL_CONCLUIDA, CANCELADO):
        raise HTTPException(status_code=400, detail=f"Processo já está '{processo.status}', não pode mais ser cancelado.")
    processo.status = CANCELADO
    processo.motivo_cancelamento = dados.motivo
    db.commit()
    registrar_auditoria(db, usuario, "processos_dissolucao", "CANCELADO", id_registro_afetado=id_processo_dissolucao, dados_depois={"motivo": dados.motivo}, ip_origem=request.client.host if request.client else None)
    return _serializar(processo)
