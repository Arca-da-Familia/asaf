"""v2.5 (FASE 2) - ata, deliberações e efeitos. Ata nunca é editada depois de assinada - a única
correção possível é uma ata de retificação nova (`POST /api/atas/{id}/retificar`), vinculada à
original. Permissão `governanca` para tudo que escreve; leitura liberada a qualquer usuário
autenticado."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.ata import APROVACAO_CONTAS, ASSINADA, CONCLUIDA, ELEICAO, PENDENTE, RASCUNHO, REVOGADA, Ata, CertidaoDeliberacao, Deliberacao
from app.models.governanca import Assembleia
from app.routers.mandatos import criar_mandato
from app.schemas.ata import AtaRelatoSecretariaAtualizar, AtaRetificar, DeliberacaoConcluir, DeliberacaoCriar, DeliberacaoRevogar
from app.security import exigir_permissao, get_current_user
from app.services.ata import aplicar_efeitos_deliberacao, gerar_corpo_ata, proximo_numero_ata, proximo_numero_certidao
from app.services.conselho_fiscal import parecer_existe_para_ano

router = APIRouter()
_permissao_governanca = exigir_permissao("governanca")


def _serializar_ata(ata: Ata) -> dict:
    return {
        "id_ata": ata.id_ata, "id_assembleia": ata.id_assembleia, "numero_sequencial": ata.numero_sequencial,
        "corpo_texto": ata.corpo_texto, "relato_secretaria": ata.relato_secretaria, "status": ata.status,
        "assinada_em": ata.assinada_em, "id_ata_retificada": ata.id_ata_retificada, "motivo_retificacao": ata.motivo_retificacao,
    }


@router.post("/api/assembleias/{id_assembleia}/ata", summary="Gerar rascunho de ata a partir do registro da sessão")
def gerar_ata(id_assembleia: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    assembleia = db.query(Assembleia).filter(Assembleia.id_assembleia == id_assembleia).first()
    if not assembleia:
        raise HTTPException(status_code=404, detail="Assembleia não encontrada.")
    if db.query(Ata).filter(Ata.id_assembleia == id_assembleia).first():
        raise HTTPException(status_code=400, detail="Esta assembleia já tem ata - corrija por retificação, não crie outra.")

    ata = Ata(id_assembleia=id_assembleia, corpo_texto=gerar_corpo_ata(db, assembleia), id_usuario_criacao=usuario.id_usuario)
    db.add(ata)
    db.commit()
    db.refresh(ata)
    registrar_auditoria(db, usuario, "atas", "CREATE", id_registro_afetado=ata.id_ata, ip_origem=request.client.host if request.client else None)
    return _serializar_ata(ata)


@router.get("/api/assembleias/{id_assembleia}/ata", summary="Detalhar a ata de uma assembleia")
def obter_ata_da_assembleia(id_assembleia: int, db: Session = Depends(get_db), _usuario=Depends(get_current_user)):
    ata = db.query(Ata).filter(Ata.id_assembleia == id_assembleia).first()
    if not ata:
        raise HTTPException(status_code=404, detail="Esta assembleia ainda não tem ata gerada.")
    return _serializar_ata(ata)


def _buscar_ata_ou_404(db: Session, id_ata: int) -> Ata:
    ata = db.query(Ata).filter(Ata.id_ata == id_ata).first()
    if not ata:
        raise HTTPException(status_code=404, detail="Ata não encontrada.")
    return ata


@router.get("/api/atas/{id_ata}", summary="Detalhar ata")
def detalhar_ata(id_ata: int, db: Session = Depends(get_db), _usuario=Depends(get_current_user)):
    return _serializar_ata(_buscar_ata_ou_404(db, id_ata))


@router.put("/api/atas/{id_ata}/relato-secretaria", summary="Atualizar o relato da secretaria (único texto livre da ata, só antes de assinar)")
def atualizar_relato_secretaria(id_ata: int, dados: AtaRelatoSecretariaAtualizar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    ata = _buscar_ata_ou_404(db, id_ata)
    if ata.status != RASCUNHO:
        raise HTTPException(status_code=400, detail=f"Ata está '{ata.status}' - o relato só pode ser alterado enquanto a ata está em rascunho (depois de assinada, ata nunca é editada).")
    ata.relato_secretaria = dados.relato_secretaria
    db.commit()
    db.refresh(ata)
    registrar_auditoria(db, usuario, "atas", "RELATO_SECRETARIA_ATUALIZADO", id_registro_afetado=ata.id_ata, ip_origem=request.client.host if request.client else None)
    return _serializar_ata(ata)


@router.post("/api/atas/{id_ata}/assinar", summary="Assinar a ata (imutável a partir daqui)")
def assinar_ata(id_ata: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    ata = _buscar_ata_ou_404(db, id_ata)
    if ata.status != RASCUNHO:
        raise HTTPException(status_code=400, detail=f"Ata está '{ata.status}', só se assina a partir de '{RASCUNHO}'.")
    ata.status = ASSINADA
    ata.numero_sequencial = proximo_numero_ata(db)
    ata.assinada_em = datetime.utcnow()
    ata.id_usuario_assinatura = usuario.id_usuario
    db.commit()
    registrar_auditoria(db, usuario, "atas", "ASSINADA", id_registro_afetado=ata.id_ata, dados_depois={"numero_sequencial": ata.numero_sequencial}, ip_origem=request.client.host if request.client else None)
    return _serializar_ata(ata)


@router.post("/api/atas/{id_ata}/retificar", summary="Criar ata de retificação (correção nunca edita a original)")
def retificar_ata(id_ata: int, dados: AtaRetificar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    original = _buscar_ata_ou_404(db, id_ata)
    if original.status != ASSINADA:
        raise HTTPException(status_code=400, detail="Só se retifica ata já assinada - ata em rascunho ainda pode virar rascunho de novo (apagar e gerar de novo).")

    retificacao = Ata(
        id_assembleia=original.id_assembleia, corpo_texto=original.corpo_texto,
        id_ata_retificada=original.id_ata, motivo_retificacao=dados.motivo, id_usuario_criacao=usuario.id_usuario,
    )
    db.add(retificacao)
    db.commit()
    db.refresh(retificacao)
    registrar_auditoria(
        db, usuario, "atas", "RETIFICACAO_CRIADA", id_registro_afetado=retificacao.id_ata,
        dados_antes={"id_ata_original": original.id_ata}, dados_depois={"motivo": dados.motivo},
        ip_origem=request.client.host if request.client else None,
    )
    return _serializar_ata(retificacao)


# ==========================================
# DELIBERAÇÕES
# ==========================================
def _serializar_deliberacao(d: Deliberacao) -> dict:
    return {
        "id_deliberacao": d.id_deliberacao, "id_ata": d.id_ata, "tipo": d.tipo, "texto": d.texto,
        "ano_exercicio": d.ano_exercicio, "status_execucao": d.status_execucao,
        "id_associado_responsavel": d.id_associado_responsavel,
        "prazo_execucao": d.prazo_execucao, "concluida_em": d.concluida_em, "observacao_conclusao": d.observacao_conclusao,
    }


@router.post("/api/atas/{id_ata}/deliberacoes", summary="Registrar deliberação vinculada à ata")
def criar_deliberacao(id_ata: int, dados: DeliberacaoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    _buscar_ata_ou_404(db, id_ata)
    if dados.tipo == APROVACAO_CONTAS and not parecer_existe_para_ano(db, dados.ano_exercicio):
        raise HTTPException(
            status_code=400,
            detail=f"Não existe parecer do Conselho Fiscal para o exercício {dados.ano_exercicio} (v2.6) - "
                   "obrigatório antes da assembleia de aprovação de contas.",
        )
    deliberacao = Deliberacao(
        id_ata=id_ata, id_item_pauta=dados.id_item_pauta, id_votacao=dados.id_votacao, tipo=dados.tipo,
        ano_exercicio=dados.ano_exercicio, texto=dados.texto, id_associado_responsavel=dados.id_associado_responsavel,
        prazo_execucao=dados.prazo_execucao, id_usuario_criacao=usuario.id_usuario,
    )
    db.add(deliberacao)
    db.commit()
    db.refresh(deliberacao)
    registrar_auditoria(db, usuario, "deliberacoes", "CREATE", id_registro_afetado=deliberacao.id_deliberacao, ip_origem=request.client.host if request.client else None)
    return _serializar_deliberacao(deliberacao)


@router.get("/api/atas/{id_ata}/deliberacoes", summary="Listar deliberações de uma ata")
def listar_deliberacoes_da_ata(id_ata: int, db: Session = Depends(get_db), _usuario=Depends(get_current_user)):
    deliberacoes = db.query(Deliberacao).filter(Deliberacao.id_ata == id_ata).all()
    return [_serializar_deliberacao(d) for d in deliberacoes]


@router.get("/api/deliberacoes/pendentes", summary="Painel da diretoria - deliberações pendentes de execução, cross-assembleia")
def listar_deliberacoes_pendentes(db: Session = Depends(get_db), _usuario=Depends(_permissao_governanca)):
    pendentes = db.query(Deliberacao).filter(Deliberacao.status_execucao == PENDENTE).order_by(Deliberacao.criado_em).all()
    return [_serializar_deliberacao(d) for d in pendentes]


def _buscar_deliberacao_ou_404(db: Session, id_deliberacao: int) -> Deliberacao:
    deliberacao = db.query(Deliberacao).filter(Deliberacao.id_deliberacao == id_deliberacao).first()
    if not deliberacao:
        raise HTTPException(status_code=404, detail="Deliberação não encontrada.")
    return deliberacao


@router.post("/api/deliberacoes/{id_deliberacao}/concluir", summary="Concluir deliberação (aplica efeitos automáticos conforme o tipo)")
def concluir_deliberacao(id_deliberacao: int, dados: DeliberacaoConcluir, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    deliberacao = _buscar_deliberacao_ou_404(db, id_deliberacao)
    if deliberacao.status_execucao != PENDENTE:
        raise HTTPException(status_code=400, detail=f"Deliberação está '{deliberacao.status_execucao}', só se conclui a partir de '{PENDENTE}'.")

    mandatos_criados = []
    if deliberacao.tipo == ELEICAO:
        for mandato_dados in dados.mandatos_criar:
            resultado = criar_mandato(mandato_dados, request, db=db, usuario=usuario)
            mandatos_criados.append(resultado["id_mandato"])

    deliberacao.status_execucao = CONCLUIDA
    deliberacao.concluida_em = datetime.utcnow()
    deliberacao.observacao_conclusao = dados.observacao
    db.commit()

    nota_pendencia = aplicar_efeitos_deliberacao(db, deliberacao, usuario)
    registrar_auditoria(
        db, usuario, "deliberacoes", "CONCLUIDA", id_registro_afetado=deliberacao.id_deliberacao,
        dados_depois={"mandatos_criados": mandatos_criados, "observacao": dados.observacao},
        ip_origem=request.client.host if request.client else None,
    )
    resposta = _serializar_deliberacao(deliberacao)
    resposta["mandatos_criados"] = mandatos_criados
    if nota_pendencia:
        resposta["pendencia"] = nota_pendencia
    return resposta


@router.post("/api/deliberacoes/{id_deliberacao}/revogar", summary="Revogar formalmente uma deliberação pendente")
def revogar_deliberacao(id_deliberacao: int, dados: DeliberacaoRevogar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    deliberacao = _buscar_deliberacao_ou_404(db, id_deliberacao)
    if deliberacao.status_execucao != PENDENTE:
        raise HTTPException(status_code=400, detail=f"Deliberação está '{deliberacao.status_execucao}', só se revoga a partir de '{PENDENTE}'.")
    deliberacao.status_execucao = REVOGADA
    deliberacao.observacao_conclusao = dados.motivo
    db.commit()
    registrar_auditoria(db, usuario, "deliberacoes", "REVOGADA", id_registro_afetado=deliberacao.id_deliberacao, dados_depois={"motivo": dados.motivo}, ip_origem=request.client.host if request.client else None)
    return _serializar_deliberacao(deliberacao)


@router.post("/api/deliberacoes/{id_deliberacao}/certidao", summary="Emitir certidão de deliberação (extrato numerado)")
def emitir_certidao(id_deliberacao: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    deliberacao = _buscar_deliberacao_ou_404(db, id_deliberacao)
    numero = proximo_numero_certidao(db)
    texto = (
        f"CERTIDÃO DE DELIBERAÇÃO Nº {numero}\n\n"
        f"Tipo: {deliberacao.tipo}\nTexto: {deliberacao.texto}\n"
        f"Status de execução: {deliberacao.status_execucao}\n"
    )
    certidao = CertidaoDeliberacao(id_deliberacao=id_deliberacao, numero_sequencial=numero, texto_gerado=texto, id_usuario_emissao=usuario.id_usuario)
    db.add(certidao)
    db.commit()
    db.refresh(certidao)
    registrar_auditoria(db, usuario, "certidoes_deliberacao", "CREATE", id_registro_afetado=certidao.id_certidao, ip_origem=request.client.host if request.client else None)
    return {"id_certidao": certidao.id_certidao, "numero_sequencial": certidao.numero_sequencial, "texto_gerado": certidao.texto_gerado}


@router.get("/api/deliberacoes/{id_deliberacao}/certidoes", summary="Listar certidões já emitidas de uma deliberação")
def listar_certidoes(id_deliberacao: int, db: Session = Depends(get_db), _usuario=Depends(get_current_user)):
    certidoes = db.query(CertidaoDeliberacao).filter(CertidaoDeliberacao.id_deliberacao == id_deliberacao).order_by(CertidaoDeliberacao.numero_sequencial).all()
    return [{"id_certidao": c.id_certidao, "numero_sequencial": c.numero_sequencial, "emitida_em": c.emitida_em} for c in certidoes]
