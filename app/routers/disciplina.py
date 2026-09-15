"""v2.7 (FASE 2) - processo disciplinar (Art. 16/17 do estatuto real). Ampla defesa e
contraditório são travas de verdade: decisão só é aceita depois que a defesa foi apresentada ou o
prazo esgotou (nunca antes). Confidencialidade: só quem tem permissão `governanca` (o órgão
julgador - Diretoria Executiva) ou o próprio acusado enxerga um processo."""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.associados import Associado
from app.models.disciplina import (
    ABERTO, AGUARDANDO_HOMOLOGACAO, HOMOLOGADO, REJEITADO_PELA_ASSEMBLEIA,
    ManifestacaoDiretoria, ProcessoDisciplinar,
)
from app.models.core import Catalogo, OpcaoCatalogo
from app.routers.situacao import desligar_associado
from app.schemas.disciplina import DecisaoExecutar, DefesaApresentar, HomologarRequest, ManifestacaoCriar, ProcessoCriar
from app.schemas.situacao import DesligamentoCriar
from app.security import exigir_permissao, get_current_user, usuario_tem_permissao
from app.services.disciplina import aplicar_pena, calcular_resultado_colegiado, diretores_aptos, pode_julgar_agora
from app.services.estatuto import obter_regra_vigente

router = APIRouter()
_permissao_governanca = exigir_permissao("governanca")


def _associado_do_usuario(db: Session, usuario):
    return db.query(Associado).filter(Associado.id_usuario == usuario.id_usuario).first()


def _serializar(p: ProcessoDisciplinar) -> dict:
    return {
        "id_processo": p.id_processo, "id_associado": p.id_associado, "motivo_codigo": p.motivo_codigo,
        "descricao": p.descricao, "status": p.status, "data_abertura": p.data_abertura,
        "prazo_defesa_ate": p.prazo_defesa_ate, "defesa_apresentada_em": p.defesa_apresentada_em,
        "pena_aplicada": p.pena_aplicada, "escalada_automatica": p.escalada_automatica,
        "suspensao_dias": p.suspensao_dias, "data_fim_suspensao": p.data_fim_suspensao,
        "decidido_em": p.decidido_em, "homologado_em": p.homologado_em,
    }


def _pode_ver(db: Session, usuario, processo: ProcessoDisciplinar) -> bool:
    if usuario_tem_permissao(db, usuario, "governanca"):
        return True
    associado = _associado_do_usuario(db, usuario)
    return bool(associado and associado.id_associado == processo.id_associado)


@router.post("/api/processos-disciplinares/", summary="Abrir processo disciplinar (Art. 16)")
def abrir_processo(dados: ProcessoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    if not db.query(Associado).filter(Associado.id_associado == dados.id_associado).first():
        raise HTTPException(status_code=404, detail="Associado não encontrado.")
    catalogo = db.query(Catalogo).filter(Catalogo.chave == "motivo_processo_disciplinar").first()
    opcao_valida = catalogo and db.query(OpcaoCatalogo).filter(OpcaoCatalogo.id_catalogo == catalogo.id_catalogo, OpcaoCatalogo.codigo == dados.motivo_codigo, OpcaoCatalogo.ativo.is_(True)).first()
    if not opcao_valida:
        raise HTTPException(status_code=400, detail="Motivo não existe (ou está inativo) no catálogo 'motivo_processo_disciplinar' (Art. 16, §1º).")

    prazo_dias = int(obter_regra_vigente(db, "PRAZO_DEFESA_DIAS", "15") or "15")
    processo = ProcessoDisciplinar(
        id_associado=dados.id_associado, motivo_codigo=dados.motivo_codigo, descricao=dados.descricao,
        prazo_defesa_ate=datetime.utcnow() + timedelta(days=prazo_dias), id_usuario_abertura=usuario.id_usuario,
    )
    db.add(processo)
    db.commit()
    db.refresh(processo)
    registrar_auditoria(
        db, usuario, "processos_disciplinares", "ABERTO", id_registro_afetado=processo.id_processo,
        dados_depois={"id_associado": dados.id_associado, "motivo_codigo": dados.motivo_codigo},
        ip_origem=request.client.host if request.client else None,
    )
    return _serializar(processo)


@router.get("/api/processos-disciplinares/", summary="Listar processos disciplinares visíveis ao usuário")
def listar_processos(db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    if usuario_tem_permissao(db, usuario, "governanca"):
        processos = db.query(ProcessoDisciplinar).order_by(ProcessoDisciplinar.data_abertura.desc()).all()
    else:
        associado = _associado_do_usuario(db, usuario)
        processos = (
            db.query(ProcessoDisciplinar).filter(ProcessoDisciplinar.id_associado == associado.id_associado).order_by(ProcessoDisciplinar.data_abertura.desc()).all()
            if associado else []
        )
    return [_serializar(p) for p in processos]


def _buscar_processo_visivel_ou_erro(db: Session, id_processo: int, usuario) -> ProcessoDisciplinar:
    processo = db.query(ProcessoDisciplinar).filter(ProcessoDisciplinar.id_processo == id_processo).first()
    if not processo:
        raise HTTPException(status_code=404, detail="Processo não encontrado.")
    if not _pode_ver(db, usuario, processo):
        # 404, não 403: confidencialidade real não revela nem que o processo existe pra quem não pode vê-lo.
        raise HTTPException(status_code=404, detail="Processo não encontrado.")
    return processo


@router.get("/api/processos-disciplinares/{id_processo}", summary="Detalhar processo disciplinar")
def detalhar_processo(id_processo: int, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    return _serializar(_buscar_processo_visivel_ou_erro(db, id_processo, usuario))


@router.post("/api/processos-disciplinares/{id_processo}/defesa", summary="Apresentar defesa (o próprio acusado)")
def apresentar_defesa(id_processo: int, dados: DefesaApresentar, request: Request, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    processo = _buscar_processo_visivel_ou_erro(db, id_processo, usuario)
    if processo.status != ABERTO:
        raise HTTPException(status_code=400, detail=f"Processo está '{processo.status}', não aceita mais defesa.")
    processo.defesa_texto = dados.texto
    processo.defesa_apresentada_em = datetime.utcnow()
    db.commit()
    registrar_auditoria(db, usuario, "processos_disciplinares", "DEFESA_APRESENTADA", id_registro_afetado=id_processo, ip_origem=request.client.host if request.client else None)
    return _serializar(processo)


@router.post("/api/processos-disciplinares/{id_processo}/manifestacoes", summary="Diretor se manifesta sobre a pena")
def registrar_manifestacao(id_processo: int, dados: ManifestacaoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    processo = _buscar_processo_visivel_ou_erro(db, id_processo, usuario)
    if not pode_julgar_agora(processo):
        raise HTTPException(status_code=400, detail="Ainda dentro do prazo de defesa (Art. 16) - aguarde o prazo esgotar ou a defesa ser apresentada.")

    diretor = _associado_do_usuario(db, usuario)
    if not diretor or diretor.id_associado not in diretores_aptos(db, processo.id_associado):
        raise HTTPException(status_code=403, detail="Só um membro da Diretoria Executiva com mandato vigente (e que não seja o acusado) pode se manifestar.")

    existente = db.query(ManifestacaoDiretoria).filter(ManifestacaoDiretoria.id_processo == id_processo, ManifestacaoDiretoria.id_associado_diretor == diretor.id_associado).first()
    if existente:
        raise HTTPException(status_code=400, detail="Você já se manifestou neste processo.")

    manifestacao = ManifestacaoDiretoria(id_processo=id_processo, id_associado_diretor=diretor.id_associado, pena_proposta=dados.pena_proposta, justificativa=dados.justificativa)
    db.add(manifestacao)
    db.commit()
    registrar_auditoria(db, usuario, "manifestacoes_diretoria_disciplinar", "CREATE", id_registro_afetado=id_processo, dados_depois={"pena_proposta": dados.pena_proposta}, ip_origem=request.client.host if request.client else None)
    return calcular_resultado_colegiado(db, processo)


@router.get("/api/processos-disciplinares/{id_processo}/manifestacoes", summary="Ver apuração das manifestações")
def ver_manifestacoes(id_processo: int, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    processo = _buscar_processo_visivel_ou_erro(db, id_processo, usuario)
    return calcular_resultado_colegiado(db, processo)


@router.post("/api/processos-disciplinares/{id_processo}/decidir", summary="Fechar o processo com a pena decidida pela maioria")
def decidir_processo(id_processo: int, dados: DecisaoExecutar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    processo = _buscar_processo_visivel_ou_erro(db, id_processo, usuario)
    if processo.status != ABERTO:
        raise HTTPException(status_code=400, detail=f"Processo está '{processo.status}', não está aberto pra decisão.")
    if not pode_julgar_agora(processo):
        raise HTTPException(status_code=400, detail="Ainda dentro do prazo de defesa (Art. 16) - não é possível decidir antes disso.")

    resultado = calcular_resultado_colegiado(db, processo)
    if not resultado["quorum_atingido"]:
        raise HTTPException(
            status_code=400,
            detail=f"Quórum de decisão não atingido: {resultado['manifestacoes']}/{resultado['quorum_minimo']} manifestações necessárias entre os {resultado['diretores_aptos']} diretores aptos.",
        )

    efeito = aplicar_pena(db, processo, resultado["resultado"], dados.texto_decisao, usuario.id_usuario, dados.suspensao_dias)
    registrar_auditoria(
        db, usuario, "processos_disciplinares", "DECIDIDO", id_registro_afetado=id_processo,
        dados_depois={"pena_aplicada": efeito["pena_aplicada"], "status": efeito["status"]},
        ip_origem=request.client.host if request.client else None,
    )
    return _serializar(processo)


@router.post("/api/processos-disciplinares/{id_processo}/homologar", summary="Homologar (ou recusar) eliminação pela Assembleia (Art. 17, Parágrafo Único)")
def homologar_eliminacao(id_processo: int, dados: HomologarRequest, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    processo = _buscar_processo_visivel_ou_erro(db, id_processo, usuario)
    if processo.status != AGUARDANDO_HOMOLOGACAO:
        raise HTTPException(status_code=400, detail=f"Processo está '{processo.status}', não está aguardando homologação.")

    processo.homologado_em = datetime.utcnow()
    if dados.aprovado:
        processo.status = HOMOLOGADO
        db.commit()
        desligar_associado(
            processo.id_associado,
            DesligamentoCriar(motivo="CONDUTA_INCOMPATIVEL", data_efetiva=datetime.utcnow().date(), documento_referencia=f"Processo disciplinar #{processo.id_processo}"),
            request, db=db, usuario=usuario,
        )
    else:
        processo.status = REJEITADO_PELA_ASSEMBLEIA
        db.commit()

    registrar_auditoria(
        db, usuario, "processos_disciplinares", "HOMOLOGACAO", id_registro_afetado=id_processo,
        dados_depois={"aprovado": dados.aprovado, "justificativa": dados.justificativa},
        ip_origem=request.client.host if request.client else None,
    )
    return _serializar(processo)
