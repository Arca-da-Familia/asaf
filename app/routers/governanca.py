"""v2.2 (FASE 2) - convocação e habilitação de assembleia. Permissão `governanca` para criar,
convocar e cancelar assembleia; qualquer associado autenticado pode propor petição de convocação
e aderir a uma (Art. 8º/10 - é direito dos associados, não só da diretoria). Leitura liberada a
qualquer usuário autenticado."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.associados import Associado
from app.models.governanca import (
    COLETANDO_ADESOES, CONVOCADA, CANCELADA, CONVERTIDA_EM_ASSEMBLEIA, ORIGEM_PETICAO, ORIGEM_PRESIDENTE,
    QUORUM_ATINGIDO, RASCUNHO, Assembleia, AdesaoPeticao, HabilitadoAssembleia, PeticaoConvocacao,
)
from app.schemas.governanca import AssembleiaCriar, PeticaoConvocacaoCriar
from app.security import exigir_permissao, get_current_user, usuario_tem_permissao
from app.services.assembleia import (
    calcular_lista_habilitados, fracao_adesao_peticao, gerar_edital, horarios_convocacao,
    peticao_atingiu_quorum, pode_converter_sem_presidente, validar_prazo_convocacao,
)

router = APIRouter()
_permissao_governanca = exigir_permissao("governanca")


def _associado_do_usuario_ou_404(db: Session, usuario) -> Associado:
    associado = db.query(Associado).filter(Associado.id_usuario == usuario.id_usuario).first()
    if not associado:
        raise HTTPException(status_code=403, detail="Só um associado pode fazer isso - este usuário não está vinculado a um associado.")
    return associado


def _serializar_assembleia(db: Session, a: Assembleia) -> dict:
    return {
        "id_assembleia": a.id_assembleia, "tipo": a.tipo, "pauta": a.pauta,
        "status": a.status, "origem_convocacao": a.origem_convocacao,
        "local_fisico": a.local_fisico, "link_remoto": a.link_remoto,
        "convocada_em": a.convocada_em, **horarios_convocacao(db, a),
    }


@router.post("/api/assembleias/", summary="Criar assembleia (rascunho)")
def criar_assembleia(dados: AssembleiaCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    assembleia = Assembleia(
        tipo=dados.tipo, pauta=dados.pauta, data_hora_convocacao=dados.data_hora_convocacao,
        local_fisico=dados.local_fisico, link_remoto=dados.link_remoto,
        origem_convocacao=ORIGEM_PRESIDENTE, id_usuario_criacao=usuario.id_usuario,
    )
    db.add(assembleia)
    db.commit()
    db.refresh(assembleia)
    registrar_auditoria(
        db, usuario, "assembleias", "CREATE", id_registro_afetado=assembleia.id_assembleia,
        dados_depois={"tipo": assembleia.tipo, "status": assembleia.status},
        ip_origem=request.client.host if request.client else None,
    )
    return _serializar_assembleia(db, assembleia)


@router.get("/api/assembleias/", summary="Listar assembleias")
def listar_assembleias(status: Optional[str] = None, db: Session = Depends(get_db), _usuario=Depends(get_current_user)):
    consulta = db.query(Assembleia)
    if status:
        consulta = consulta.filter(Assembleia.status == status)
    assembleias = consulta.order_by(Assembleia.data_hora_convocacao.desc()).all()
    return [_serializar_assembleia(db, a) for a in assembleias]


def _buscar_assembleia_ou_404(db: Session, id_assembleia: int) -> Assembleia:
    assembleia = db.query(Assembleia).filter(Assembleia.id_assembleia == id_assembleia).first()
    if not assembleia:
        raise HTTPException(status_code=404, detail="Assembleia não encontrada.")
    return assembleia


@router.get("/api/assembleias/{id_assembleia}", summary="Detalhar assembleia")
def detalhar_assembleia(id_assembleia: int, db: Session = Depends(get_db), _usuario=Depends(get_current_user)):
    return _serializar_assembleia(db, _buscar_assembleia_ou_404(db, id_assembleia))


@router.post("/api/assembleias/{id_assembleia}/convocar", summary="Convocar assembleia (gera edital e congela lista de habilitados)")
def convocar_assembleia(id_assembleia: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    assembleia = _buscar_assembleia_ou_404(db, id_assembleia)
    if assembleia.status != RASCUNHO:
        raise HTTPException(status_code=400, detail=f"Assembleia está '{assembleia.status}', só se convoca a partir de '{RASCUNHO}'.")

    erro_prazo = validar_prazo_convocacao(db, assembleia.data_hora_convocacao)
    if erro_prazo:
        raise HTTPException(status_code=400, detail=erro_prazo)

    habilitados = calcular_lista_habilitados(db, assembleia)
    qtd_habilitados = sum(1 for h in habilitados if h.habilitado)
    assembleia.edital_texto = gerar_edital(db, assembleia, qtd_habilitados)
    assembleia.status = CONVOCADA
    assembleia.convocada_em = datetime.utcnow()
    db.commit()

    registrar_auditoria(
        db, usuario, "assembleias", "CONVOCADA", id_registro_afetado=assembleia.id_assembleia,
        dados_depois={"qtd_habilitados": qtd_habilitados, "qtd_associados_avaliados": len(habilitados)},
        ip_origem=request.client.host if request.client else None,
    )
    return _serializar_assembleia(db, assembleia)


@router.get("/api/assembleias/{id_assembleia}/edital", summary="Texto do edital de convocação")
def edital_assembleia(id_assembleia: int, db: Session = Depends(get_db), _usuario=Depends(get_current_user)):
    assembleia = _buscar_assembleia_ou_404(db, id_assembleia)
    if not assembleia.edital_texto:
        raise HTTPException(status_code=400, detail="Assembleia ainda não foi convocada - edital só existe depois da convocação.")
    return {"edital_texto": assembleia.edital_texto}


@router.get("/api/assembleias/{id_assembleia}/habilitados", summary="Lista de habilitados congelada na convocação")
def habilitados_assembleia(id_assembleia: int, apenas_habilitados: bool = False, db: Session = Depends(get_db), _usuario=Depends(_permissao_governanca)):
    _buscar_assembleia_ou_404(db, id_assembleia)
    consulta = db.query(HabilitadoAssembleia).filter(HabilitadoAssembleia.id_assembleia == id_assembleia)
    if apenas_habilitados:
        consulta = consulta.filter(HabilitadoAssembleia.habilitado.is_(True))
    return [
        {
            "id_associado": h.id_associado, "habilitado": h.habilitado, "motivo_inabilitacao": h.motivo_inabilitacao,
            "status_arrolamento_no_momento": h.status_arrolamento_no_momento,
        }
        for h in consulta.all()
    ]


@router.post("/api/assembleias/{id_assembleia}/cancelar", summary="Cancelar assembleia")
def cancelar_assembleia(id_assembleia: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    assembleia = _buscar_assembleia_ou_404(db, id_assembleia)
    if assembleia.status in (CANCELADA,):
        raise HTTPException(status_code=400, detail="Assembleia já está cancelada.")
    assembleia.status = CANCELADA
    db.commit()
    registrar_auditoria(db, usuario, "assembleias", "CANCELADA", id_registro_afetado=assembleia.id_assembleia, ip_origem=request.client.host if request.client else None)
    return {"mensagem": "Assembleia cancelada."}


# ==========================================
# PETIÇÃO DE CONVOCAÇÃO (Art. 8º/10 do estatuto, Art. 60 do Código Civil)
# ==========================================
def _serializar_peticao(db: Session, p: PeticaoConvocacao) -> dict:
    adesoes, base, fracao = fracao_adesao_peticao(db, p)
    return {
        "id_peticao": p.id_peticao, "pauta_proposta": p.pauta_proposta, "status": p.status,
        "data_quorum_atingido": p.data_quorum_atingido,
        "adesoes": adesoes, "base_associados_ativos": base, "fracao_atual": round(fracao, 4),
        "pode_converter_sem_presidente": pode_converter_sem_presidente(db, p),
    }


@router.post("/api/peticoes-convocacao/", summary="Propor petição de convocação de assembleia")
def propor_peticao(dados: PeticaoConvocacaoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    _associado_do_usuario_ou_404(db, usuario)
    peticao = PeticaoConvocacao(pauta_proposta=dados.pauta_proposta, id_usuario_criacao=usuario.id_usuario)
    db.add(peticao)
    db.commit()
    db.refresh(peticao)
    registrar_auditoria(db, usuario, "peticoes_convocacao", "CREATE", id_registro_afetado=peticao.id_peticao, ip_origem=request.client.host if request.client else None)
    return _serializar_peticao(db, peticao)


def _buscar_peticao_ou_404(db: Session, id_peticao: int) -> PeticaoConvocacao:
    peticao = db.query(PeticaoConvocacao).filter(PeticaoConvocacao.id_peticao == id_peticao).first()
    if not peticao:
        raise HTTPException(status_code=404, detail="Petição não encontrada.")
    return peticao


@router.get("/api/peticoes-convocacao/", summary="Listar petições de convocação")
def listar_peticoes(db: Session = Depends(get_db), _usuario=Depends(get_current_user)):
    return [_serializar_peticao(db, p) for p in db.query(PeticaoConvocacao).order_by(PeticaoConvocacao.criado_em.desc()).all()]


@router.get("/api/peticoes-convocacao/{id_peticao}", summary="Detalhar petição de convocação")
def detalhar_peticao(id_peticao: int, db: Session = Depends(get_db), _usuario=Depends(get_current_user)):
    return _serializar_peticao(db, _buscar_peticao_ou_404(db, id_peticao))


@router.post("/api/peticoes-convocacao/{id_peticao}/aderir", summary="Aderir a uma petição de convocação")
def aderir_peticao(id_peticao: int, request: Request, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    peticao = _buscar_peticao_ou_404(db, id_peticao)
    associado = _associado_do_usuario_ou_404(db, usuario)
    if peticao.status != COLETANDO_ADESOES:
        raise HTTPException(status_code=400, detail=f"Petição está '{peticao.status}', não aceita mais adesão.")
    if db.query(AdesaoPeticao).filter(AdesaoPeticao.id_peticao == id_peticao, AdesaoPeticao.id_associado == associado.id_associado).first():
        raise HTTPException(status_code=400, detail="Você já aderiu a esta petição.")

    db.add(AdesaoPeticao(id_peticao=id_peticao, id_associado=associado.id_associado))
    db.commit()

    if peticao_atingiu_quorum(db, peticao) and peticao.data_quorum_atingido is None:
        peticao.status = QUORUM_ATINGIDO
        peticao.data_quorum_atingido = datetime.utcnow()
        db.commit()
        registrar_auditoria(
            db, usuario, "peticoes_convocacao", "QUORUM_ATINGIDO", id_registro_afetado=peticao.id_peticao,
            ip_origem=request.client.host if request.client else None,
        )

    registrar_auditoria(db, usuario, "adesoes_peticao", "CREATE", id_registro_afetado=peticao.id_peticao, ip_origem=request.client.host if request.client else None)
    return _serializar_peticao(db, peticao)


@router.post("/api/peticoes-convocacao/{id_peticao}/converter-em-assembleia", summary="Converter petição em assembleia formal")
def converter_peticao_em_assembleia(id_peticao: int, dados: AssembleiaCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    peticao = _buscar_peticao_ou_404(db, id_peticao)
    if peticao.status != QUORUM_ATINGIDO:
        raise HTTPException(status_code=400, detail=f"Petição precisa estar '{QUORUM_ATINGIDO}' antes de virar assembleia (está '{peticao.status}').")

    # Quem converte: Presidente/Diretoria (permissão `governanca`) a qualquer momento após o
    # quórum, OU (Art. 10, Parágrafo Único) qualquer aderente, mas só depois de esgotado o prazo
    # que o Presidente tinha pra convocar sem que ele o tenha feito.
    tem_permissao_direta = usuario_tem_permissao(db, usuario, "governanca")
    if not tem_permissao_direta:
        associado = _associado_do_usuario_ou_404(db, usuario)
        aderiu = db.query(AdesaoPeticao).filter(AdesaoPeticao.id_peticao == id_peticao, AdesaoPeticao.id_associado == associado.id_associado).first()
        if not aderiu or not pode_converter_sem_presidente(db, peticao):
            raise HTTPException(
                status_code=403,
                detail="Só a Diretoria pode converter agora - o prazo do Art. 10 (Parágrafo Único) para o Presidente convocar ainda não esgotou.",
            )

    erro_prazo = validar_prazo_convocacao(db, dados.data_hora_convocacao)
    if erro_prazo:
        raise HTTPException(status_code=400, detail=erro_prazo)

    assembleia = Assembleia(
        tipo=dados.tipo, pauta=dados.pauta or peticao.pauta_proposta, data_hora_convocacao=dados.data_hora_convocacao,
        local_fisico=dados.local_fisico, link_remoto=dados.link_remoto,
        origem_convocacao=ORIGEM_PETICAO, id_peticao_origem=peticao.id_peticao, id_usuario_criacao=usuario.id_usuario,
    )
    db.add(assembleia)
    peticao.status = CONVERTIDA_EM_ASSEMBLEIA
    db.commit()
    db.refresh(assembleia)

    registrar_auditoria(
        db, usuario, "peticoes_convocacao", "CONVERTIDA_EM_ASSEMBLEIA", id_registro_afetado=peticao.id_peticao,
        dados_depois={"id_assembleia": assembleia.id_assembleia}, ip_origem=request.client.host if request.client else None,
    )
    return _serializar_assembleia(db, assembleia)
