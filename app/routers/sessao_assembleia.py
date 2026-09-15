"""v2.3 (FASE 2) - condução da sessão: credenciamento (QR da carteirinha ou busca manual), quórum
de instalação em tempo real, itens de pauta e ocorrências. Tudo aqui exige a assembleia estar
'Em andamento' (`POST /api/assembleias/{id}/abrir-sessao`, v2.2/v2.3) - nunca se credencia gente
numa assembleia que ainda não abriu ou que já encerrou. Permissão `governanca` (mesa/secretaria)
para tudo que escreve; leitura liberada a qualquer usuário autenticado."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.associados import Associado
from app.models.governanca import EM_ANDAMENTO, Assembleia
from app.models.sessao_assembleia import (
    AGUARDANDO, EM_DISCUSSAO, EM_VOTACAO, ENCERRADO, Credenciamento, ItemPauta, OcorrenciaSessao,
)
from app.schemas.sessao_assembleia import CredenciarRequest, ItemPautaCriar, OcorrenciaCriar
from app.security import decodificar_token_carteirinha, exigir_permissao, get_current_user
from app.services.sessao_assembleia import quorum_instalacao_atual

router = APIRouter()
_permissao_governanca = exigir_permissao("governanca")


def _buscar_assembleia_em_andamento_ou_404(db: Session, id_assembleia: int) -> Assembleia:
    assembleia = db.query(Assembleia).filter(Assembleia.id_assembleia == id_assembleia).first()
    if not assembleia:
        raise HTTPException(status_code=404, detail="Assembleia não encontrada.")
    if assembleia.status != EM_ANDAMENTO:
        raise HTTPException(status_code=400, detail=f"Assembleia está '{assembleia.status}' - condução de sessão só vale com a sessão 'Em andamento'.")
    return assembleia


# ==========================================
# CREDENCIAMENTO
# ==========================================
@router.post("/api/assembleias/{id_assembleia}/credenciamentos", summary="Credenciar associado na sessão (QR da carteirinha ou busca manual)")
def credenciar(id_assembleia: int, dados: CredenciarRequest, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    assembleia = _buscar_assembleia_em_andamento_ou_404(db, id_assembleia)

    if dados.token_carteirinha:
        payload = decodificar_token_carteirinha(dados.token_carteirinha)
        associado = db.query(Associado).filter(Associado.id_pessoa == payload["id_pessoa"]).first()
        if not associado:
            raise HTTPException(status_code=404, detail="Carteirinha não corresponde a nenhum associado.")
    else:
        associado = db.query(Associado).filter(Associado.id_associado == dados.id_associado).first()
        if not associado:
            raise HTTPException(status_code=404, detail="Associado não encontrado.")

    if db.query(Credenciamento).filter(Credenciamento.id_assembleia == id_assembleia, Credenciamento.id_associado == associado.id_associado).first():
        raise HTTPException(status_code=400, detail="Associado já foi credenciado nesta sessão.")

    credenciamento = Credenciamento(
        id_assembleia=id_assembleia, id_associado=associado.id_associado, modalidade=dados.modalidade,
        id_usuario_registro=usuario.id_usuario,
    )
    db.add(credenciamento)
    db.commit()
    db.refresh(credenciamento)
    registrar_auditoria(
        db, usuario, "credenciamentos_assembleia", "CREATE", id_registro_afetado=credenciamento.id_credenciamento,
        dados_depois={"id_assembleia": id_assembleia, "id_associado": associado.id_associado, "modalidade": dados.modalidade},
        ip_origem=request.client.host if request.client else None,
    )
    return {
        "id_credenciamento": credenciamento.id_credenciamento, "id_associado": associado.id_associado,
        "nome_completo": associado.nome_completo, "modalidade": credenciamento.modalidade,
        "hora_entrada": credenciamento.hora_entrada,
    }


@router.post("/api/assembleias/{id_assembleia}/credenciamentos/{id_credenciamento}/saida", summary="Registrar saída de um credenciado")
def registrar_saida(id_assembleia: int, id_credenciamento: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    _buscar_assembleia_em_andamento_ou_404(db, id_assembleia)
    credenciamento = db.query(Credenciamento).filter(Credenciamento.id_credenciamento == id_credenciamento, Credenciamento.id_assembleia == id_assembleia).first()
    if not credenciamento:
        raise HTTPException(status_code=404, detail="Credenciamento não encontrado.")
    if credenciamento.hora_saida is not None:
        raise HTTPException(status_code=400, detail="Saída já registrada.")
    credenciamento.hora_saida = datetime.utcnow()
    db.commit()
    registrar_auditoria(db, usuario, "credenciamentos_assembleia", "SAIDA", id_registro_afetado=id_credenciamento, ip_origem=request.client.host if request.client else None)
    return {"mensagem": "Saída registrada."}


@router.get("/api/assembleias/{id_assembleia}/credenciamentos", summary="Listar credenciamentos da sessão")
def listar_credenciamentos(id_assembleia: int, db: Session = Depends(get_db), _usuario=Depends(get_current_user)):
    credenciamentos = db.query(Credenciamento).filter(Credenciamento.id_assembleia == id_assembleia).order_by(Credenciamento.hora_entrada).all()
    return [
        {
            "id_credenciamento": c.id_credenciamento, "id_associado": c.id_associado, "modalidade": c.modalidade,
            "hora_entrada": c.hora_entrada, "hora_saida": c.hora_saida,
        }
        for c in credenciamentos
    ]


@router.get("/api/assembleias/{id_assembleia}/quorum", summary="Quórum de instalação em tempo real (1ª/2ª/3ª convocação)")
def quorum_em_tempo_real(id_assembleia: int, db: Session = Depends(get_db), _usuario=Depends(get_current_user)):
    assembleia = db.query(Assembleia).filter(Assembleia.id_assembleia == id_assembleia).first()
    if not assembleia:
        raise HTTPException(status_code=404, detail="Assembleia não encontrada.")
    return quorum_instalacao_atual(db, assembleia)


# ==========================================
# ITENS DE PAUTA
# ==========================================
@router.post("/api/assembleias/{id_assembleia}/itens-pauta", summary="Adicionar item à pauta da sessão")
def criar_item_pauta(id_assembleia: int, dados: ItemPautaCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    _buscar_assembleia_em_andamento_ou_404(db, id_assembleia)
    item = ItemPauta(
        id_assembleia=id_assembleia, titulo=dados.titulo, descricao=dados.descricao,
        tempo_fala_minutos=dados.tempo_fala_minutos, ordem=dados.ordem,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    registrar_auditoria(db, usuario, "itens_pauta", "CREATE", id_registro_afetado=item.id_item, ip_origem=request.client.host if request.client else None)
    return _serializar_item(item)


def _serializar_item(item: ItemPauta) -> dict:
    return {
        "id_item": item.id_item, "titulo": item.titulo, "descricao": item.descricao,
        "tempo_fala_minutos": item.tempo_fala_minutos, "ordem": item.ordem, "status": item.status,
        "aberto_em": item.aberto_em, "encerrado_em": item.encerrado_em,
    }


@router.get("/api/assembleias/{id_assembleia}/itens-pauta", summary="Listar itens de pauta da sessão")
def listar_itens_pauta(id_assembleia: int, db: Session = Depends(get_db), _usuario=Depends(get_current_user)):
    itens = db.query(ItemPauta).filter(ItemPauta.id_assembleia == id_assembleia).order_by(ItemPauta.ordem).all()
    return [_serializar_item(i) for i in itens]


def _buscar_item_ou_404(db: Session, id_assembleia: int, id_item: int) -> ItemPauta:
    item = db.query(ItemPauta).filter(ItemPauta.id_item == id_item, ItemPauta.id_assembleia == id_assembleia).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item de pauta não encontrado.")
    return item


@router.post("/api/assembleias/{id_assembleia}/itens-pauta/{id_item}/abrir-discussao", summary="Abrir item para discussão")
def abrir_discussao(id_assembleia: int, id_item: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    _buscar_assembleia_em_andamento_ou_404(db, id_assembleia)
    item = _buscar_item_ou_404(db, id_assembleia, id_item)
    if item.status != AGUARDANDO:
        raise HTTPException(status_code=400, detail=f"Item está '{item.status}', só se abre discussão a partir de '{AGUARDANDO}'.")
    item.status = EM_DISCUSSAO
    db.commit()
    registrar_auditoria(db, usuario, "itens_pauta", "DISCUSSAO_ABERTA", id_registro_afetado=item.id_item, ip_origem=request.client.host if request.client else None)
    return _serializar_item(item)


@router.post("/api/assembleias/{id_assembleia}/itens-pauta/{id_item}/abrir-votacao", summary="Abrir item para votação (v2.4 conecta o motor de votação em si)")
def abrir_votacao(id_assembleia: int, id_item: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    _buscar_assembleia_em_andamento_ou_404(db, id_assembleia)
    item = _buscar_item_ou_404(db, id_assembleia, id_item)
    if item.status not in (AGUARDANDO, EM_DISCUSSAO):
        raise HTTPException(status_code=400, detail=f"Item está '{item.status}', não pode abrir votação.")
    item.status = EM_VOTACAO
    item.aberto_em = datetime.utcnow()
    db.commit()
    registrar_auditoria(db, usuario, "itens_pauta", "VOTACAO_ABERTA", id_registro_afetado=item.id_item, ip_origem=request.client.host if request.client else None)
    return _serializar_item(item)


@router.post("/api/assembleias/{id_assembleia}/itens-pauta/{id_item}/encerrar", summary="Encerrar item de pauta")
def encerrar_item(id_assembleia: int, id_item: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    _buscar_assembleia_em_andamento_ou_404(db, id_assembleia)
    item = _buscar_item_ou_404(db, id_assembleia, id_item)
    if item.status == ENCERRADO:
        raise HTTPException(status_code=400, detail="Item já está encerrado.")
    item.status = ENCERRADO
    item.encerrado_em = datetime.utcnow()
    db.commit()
    registrar_auditoria(db, usuario, "itens_pauta", "ENCERRADO", id_registro_afetado=item.id_item, ip_origem=request.client.host if request.client else None)
    return _serializar_item(item)


# ==========================================
# OCORRÊNCIAS
# ==========================================
@router.post("/api/assembleias/{id_assembleia}/ocorrencias", summary="Registrar ocorrência da sessão")
def registrar_ocorrencia(id_assembleia: int, dados: OcorrenciaCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    _buscar_assembleia_em_andamento_ou_404(db, id_assembleia)
    if dados.id_item_pauta is not None:
        _buscar_item_ou_404(db, id_assembleia, dados.id_item_pauta)
    ocorrencia = OcorrenciaSessao(
        id_assembleia=id_assembleia, id_item_pauta=dados.id_item_pauta, descricao=dados.descricao,
        id_usuario_registro=usuario.id_usuario,
    )
    db.add(ocorrencia)
    db.commit()
    db.refresh(ocorrencia)
    registrar_auditoria(db, usuario, "ocorrencias_sessao", "CREATE", id_registro_afetado=ocorrencia.id_ocorrencia, ip_origem=request.client.host if request.client else None)
    return {"mensagem": "Ocorrência registrada.", "id_ocorrencia": ocorrencia.id_ocorrencia}


@router.get("/api/assembleias/{id_assembleia}/ocorrencias", summary="Listar ocorrências da sessão")
def listar_ocorrencias(id_assembleia: int, db: Session = Depends(get_db), _usuario=Depends(get_current_user)):
    ocorrencias = db.query(OcorrenciaSessao).filter(OcorrenciaSessao.id_assembleia == id_assembleia).order_by(OcorrenciaSessao.criado_em).all()
    return [
        {"id_ocorrencia": o.id_ocorrencia, "id_item_pauta": o.id_item_pauta, "descricao": o.descricao, "criado_em": o.criado_em}
        for o in ocorrencias
    ]
