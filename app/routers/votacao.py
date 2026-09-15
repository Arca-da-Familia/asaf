"""v2.4 (FASE 2) - motor de votação: abrir votação (com quórum de instalação checado na hora),
votar (aberto ou secreto - de verdade desacoplado, ver app/models/votacao.py), apurar/encerrar
com hash de integridade, impugnar e resolver empate. Permissão `governanca` para abrir/encerrar/
resolver empate; qualquer associado habilitado vota e pode impugnar."""
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.associados import Associado
from app.models.governanca import Assembleia, EM_ANDAMENTO
from app.models.sessao_assembleia import ItemPauta
from app.models.votacao import ABERTA, SECRETA, Impugnacao, Votacao
from app.schemas.votacao import ImpugnacaoCriar, ImpugnacaoResolver, ResolverEmpate, VotacaoAbrir, VotoRegistrar
from app.security import exigir_permissao, get_current_user
from app.services.votacao import (
    apurar_e_encerrar, abrir_votacao, associado_habilitado, ja_votou, prazo_recurso_impugnacao,
    registrar_voto, resolver_empate,
)

router = APIRouter()
_permissao_governanca = exigir_permissao("governanca")


def _associado_do_usuario_ou_403(db: Session, usuario) -> Associado:
    associado = db.query(Associado).filter(Associado.id_usuario == usuario.id_usuario).first()
    if not associado:
        raise HTTPException(status_code=403, detail="Só um associado pode fazer isso - este usuário não está vinculado a um associado.")
    return associado


def _buscar_item_em_andamento_ou_404(db: Session, id_item: int) -> ItemPauta:
    item = db.query(ItemPauta).filter(ItemPauta.id_item == id_item).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item de pauta não encontrado.")
    assembleia = db.query(Assembleia).filter(Assembleia.id_assembleia == item.id_assembleia).first()
    if assembleia.status != EM_ANDAMENTO:
        raise HTTPException(status_code=400, detail=f"Assembleia está '{assembleia.status}' - votação só vale com a sessão 'Em andamento'.")
    return item


def _buscar_votacao_ou_404(db: Session, id_votacao: int) -> Votacao:
    votacao = db.query(Votacao).filter(Votacao.id_votacao == id_votacao).first()
    if not votacao:
        raise HTTPException(status_code=404, detail="Votação não encontrada.")
    return votacao


def _serializar(votacao: Votacao) -> dict:
    return {
        "id_votacao": votacao.id_votacao, "id_item_pauta": votacao.id_item_pauta, "titulo": votacao.titulo,
        "tipo": votacao.tipo, "escrutinio": votacao.escrutinio, "fracao_qualificada": votacao.fracao_qualificada,
        "opcoes_validas": votacao.opcoes_validas.split(","), "status": votacao.status,
        "quorum_instalacao_minimo": votacao.quorum_instalacao_minimo,
        "resultado_contagem": json.loads(votacao.resultado_contagem) if votacao.resultado_contagem else None,
        "resultado_hash": votacao.resultado_hash, "vencedor": votacao.vencedor,
        "aprovado": votacao.aprovado, "empate": votacao.empate,
    }


@router.post("/api/itens-pauta/{id_item}/votacoes", summary="Abrir votação para um item de pauta")
def criar_votacao(id_item: int, dados: VotacaoAbrir, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    item = _buscar_item_em_andamento_ou_404(db, id_item)
    try:
        votacao = abrir_votacao(
            db, item, dados.titulo, dados.tipo, dados.escrutinio, dados.opcoes,
            dados.fracao_qualificada, dados.considerar_abstencao_na_base, usuario.id_usuario,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    registrar_auditoria(
        db, usuario, "votacoes", "CREATE", id_registro_afetado=votacao.id_votacao,
        dados_depois={"titulo": votacao.titulo, "tipo": votacao.tipo, "escrutinio": votacao.escrutinio},
        ip_origem=request.client.host if request.client else None,
    )
    return _serializar(votacao)


@router.get("/api/itens-pauta/{id_item}/votacoes", summary="Listar votações de um item de pauta")
def listar_votacoes_do_item(id_item: int, db: Session = Depends(get_db), _usuario=Depends(get_current_user)):
    votacoes = db.query(Votacao).filter(Votacao.id_item_pauta == id_item).all()
    return [_serializar(v) for v in votacoes]


@router.get("/api/votacoes/{id_votacao}", summary="Detalhar votação (resultado só depois de encerrada)")
def detalhar_votacao(id_votacao: int, db: Session = Depends(get_db), _usuario=Depends(get_current_user)):
    return _serializar(_buscar_votacao_ou_404(db, id_votacao))


@router.post("/api/votacoes/{id_votacao}/votar", summary="Registrar voto")
def votar(id_votacao: int, dados: VotoRegistrar, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    votacao = _buscar_votacao_ou_404(db, id_votacao)
    if votacao.status != ABERTA:
        raise HTTPException(status_code=400, detail="Votação não está aberta.")
    associado = _associado_do_usuario_ou_403(db, usuario)

    item = db.query(ItemPauta).filter(ItemPauta.id_item == votacao.id_item_pauta).first()
    if not associado_habilitado(db, item.id_assembleia, associado.id_associado):
        raise HTTPException(status_code=403, detail="Associado não está na lista de habilitados desta assembleia (Art. 13/4º).")
    if ja_votou(db, votacao, associado.id_associado):
        raise HTTPException(status_code=400, detail="Associado já votou nesta votação.")

    opcoes_permitidas = set(votacao.opcoes_validas.split(",")) | {"Abstenção", "Branco"}
    if dados.opcao not in opcoes_permitidas:
        raise HTTPException(status_code=400, detail=f"Opção inválida - use uma de: {sorted(opcoes_permitidas)}.")

    registrar_voto(db, votacao, associado.id_associado, dados.opcao)
    # Nunca registra QUAL opção na auditoria de uma votação secreta - só o fato de ter votado
    # (a auditoria não pode virar um jeito indireto de quebrar o sigilo).
    dados_auditoria = {"id_associado": associado.id_associado} if votacao.tipo == SECRETA else {"id_associado": associado.id_associado, "opcao": dados.opcao}
    registrar_auditoria(db, usuario, "votos", "REGISTRADO", id_registro_afetado=votacao.id_votacao, dados_depois=dados_auditoria)
    return {"mensagem": "Voto registrado."}


@router.post("/api/votacoes/{id_votacao}/encerrar", summary="Apurar e encerrar votação")
def encerrar_votacao(id_votacao: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    votacao = _buscar_votacao_ou_404(db, id_votacao)
    if votacao.status != ABERTA:
        raise HTTPException(status_code=400, detail="Votação já está encerrada.")
    votacao = apurar_e_encerrar(db, votacao)
    registrar_auditoria(
        db, usuario, "votacoes", "ENCERRADA", id_registro_afetado=votacao.id_votacao,
        dados_depois={"vencedor": votacao.vencedor, "aprovado": votacao.aprovado, "empate": votacao.empate, "resultado_hash": votacao.resultado_hash},
        ip_origem=request.client.host if request.client else None,
    )
    return _serializar(votacao)


@router.post("/api/votacoes/{id_votacao}/resolver-empate", summary="Resolver empate registrado no encerramento")
def resolver_empate_votacao(id_votacao: int, dados: ResolverEmpate, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    votacao = _buscar_votacao_ou_404(db, id_votacao)
    if not votacao.empate:
        raise HTTPException(status_code=400, detail="Esta votação não está em empate.")
    votacao = resolver_empate(db, votacao, dados.vencedor, dados.justificativa)
    registrar_auditoria(
        db, usuario, "votacoes", "EMPATE_RESOLVIDO", id_registro_afetado=votacao.id_votacao,
        dados_depois={"vencedor": dados.vencedor, "justificativa": dados.justificativa},
        ip_origem=request.client.host if request.client else None,
    )
    return _serializar(votacao)


@router.post("/api/votacoes/{id_votacao}/impugnacoes", summary="Registrar impugnação/protesto de voto")
def impugnar(id_votacao: int, dados: ImpugnacaoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    votacao = _buscar_votacao_ou_404(db, id_votacao)
    associado = _associado_do_usuario_ou_403(db, usuario)
    impugnacao = Impugnacao(
        id_votacao=votacao.id_votacao, id_associado_impugnante=associado.id_associado, motivo=dados.motivo,
        prazo_recurso_ate=prazo_recurso_impugnacao(db),
    )
    db.add(impugnacao)
    db.commit()
    db.refresh(impugnacao)
    registrar_auditoria(
        db, usuario, "impugnacoes_votacao", "CREATE", id_registro_afetado=impugnacao.id_impugnacao,
        dados_depois={"id_votacao": id_votacao, "id_associado_impugnante": associado.id_associado},
        ip_origem=request.client.host if request.client else None,
    )
    return {"mensagem": "Impugnação registrada.", "id_impugnacao": impugnacao.id_impugnacao, "prazo_recurso_ate": impugnacao.prazo_recurso_ate}


@router.get("/api/votacoes/{id_votacao}/impugnacoes", summary="Listar impugnações de uma votação")
def listar_impugnacoes(id_votacao: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_governanca)):
    impugnacoes = db.query(Impugnacao).filter(Impugnacao.id_votacao == id_votacao).order_by(Impugnacao.criado_em).all()
    return [
        {
            "id_impugnacao": i.id_impugnacao, "id_associado_impugnante": i.id_associado_impugnante,
            "motivo": i.motivo, "prazo_recurso_ate": i.prazo_recurso_ate, "resolvida": i.resolvida,
            "resolucao": i.resolucao, "criado_em": i.criado_em,
        }
        for i in impugnacoes
    ]


@router.post("/api/votacoes/impugnacoes/{id_impugnacao}/resolver", summary="Resolver uma impugnação")
def resolver_impugnacao(id_impugnacao: int, dados: ImpugnacaoResolver, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    impugnacao = db.query(Impugnacao).filter(Impugnacao.id_impugnacao == id_impugnacao).first()
    if not impugnacao:
        raise HTTPException(status_code=404, detail="Impugnação não encontrada.")
    if impugnacao.resolvida:
        raise HTTPException(status_code=400, detail="Impugnação já resolvida.")
    impugnacao.resolvida = True
    impugnacao.resolucao = dados.resolucao
    db.commit()
    registrar_auditoria(db, usuario, "impugnacoes_votacao", "RESOLVIDA", id_registro_afetado=id_impugnacao, dados_depois={"resolucao": dados.resolucao}, ip_origem=request.client.host if request.client else None)
    return {"mensagem": "Impugnação resolvida."}
