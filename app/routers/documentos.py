"""v5.4a (FASE 5) - Documentos institucionais (biblioteca com sigilo, versão pública e aprovação de publicação).

Permissões (app/database.py::seed_niveis_e_permissoes; o Presidente e o Secretário recebem pelo cargo em mandato):
  - `documentos`           cadastrar, anexar original e versão pública, enviar para revisão, versionar;
  - `documentos_originais` BAIXAR o original de documento Interno/Restrito (RG, CPF...) - separada de propósito,
                           mesmo padrão de `exportar_dados_pessoais`; todo download é auditado;
  - `aprovar_publicacao`   aprovar, recusar e retirar do site. Quem criou ou enviou NÃO aprova o próprio documento.
Ver a lista: qualquer uma das três (ou `auditoria`). O site só enxerga o que foi APROVADO, por
`/api/publico/transparencia/...` (app/routers/publico.py)."""
import json
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.core import Usuario
from app.models.documentos import (
    APROVADO, CLASSIFICACOES, EM_REVISAO, PUBLICA, RASCUNHO, SITUACOES, TIPOS, VINCULOS, DocumentoInstitucional,
)
from app.security import exigir_permissao, get_current_user, usuario_tem_permissao
from app.services import armazenamento
from app.services import documentos_institucionais as servico

router = APIRouter()

_exigir_documentos = exigir_permissao("documentos")
_exigir_aprovador = exigir_permissao("aprovar_publicacao")
PERMISSOES_DE_LEITURA = ("documentos", "documentos_originais", "aprovar_publicacao", "auditoria")
TABELA = "documentos_institucionais"
_TIPOS_DE_ARQUIVO = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}


def _exigir_leitura(usuario: Usuario = Depends(get_current_user), db: Session = Depends(get_db)) -> Usuario:
    if not any(usuario_tem_permissao(db, usuario, p) for p in PERMISSOES_DE_LEITURA):
        raise HTTPException(status_code=403, detail="Sem permissão para ver os documentos institucionais.")
    return usuario


def _ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _buscar(db: Session, id_documento: int) -> DocumentoInstitucional:
    doc = db.query(DocumentoInstitucional).filter(DocumentoInstitucional.id_documento == id_documento).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento não encontrado.")
    return doc


def _pode_baixar_original(db: Session, usuario: Usuario, doc: DocumentoInstitucional) -> bool:
    """Original PÚBLICO: quem gere documentos. Original Interno/Restrito: só `documentos_originais`."""
    if doc.classificacao == PUBLICA:
        return usuario_tem_permissao(db, usuario, "documentos") or usuario_tem_permissao(db, usuario, "documentos_originais")
    return usuario_tem_permissao(db, usuario, "documentos_originais")


def _serializar(db: Session, usuario: Usuario, doc: DocumentoInstitucional) -> dict:
    verificacao = json.loads(doc.verificacao_json) if doc.verificacao_json else None
    pode_aprovar = (
        doc.situacao == EM_REVISAO and usuario_tem_permissao(db, usuario, "aprovar_publicacao")
        and usuario.id_usuario not in (doc.id_usuario_envio_revisao, doc.id_usuario_criacao)
    )
    return {
        "id_documento": doc.id_documento, "tipo": doc.tipo, "tipo_rotulo": TIPOS.get(doc.tipo, doc.tipo),
        "titulo": doc.titulo, "descricao": doc.descricao, "data_documento": doc.data_documento, "ano": doc.ano,
        "validade": doc.validade, "classificacao": doc.classificacao, "publicar_no_site": doc.publicar_no_site,
        "vinculo_tipo": doc.vinculo_tipo, "vinculo_id": doc.vinculo_id,
        "grupo_versao": doc.grupo_versao, "versao": doc.versao, "vigente": doc.vigente,
        "tem_original": bool(doc.original_nome), "original_nome_arquivo": doc.original_nome_arquivo,
        "original_tamanho": doc.original_tamanho, "original_sha256": doc.original_sha256,
        "tem_versao_publica": bool(doc.publico_nome), "publico_tamanho": doc.publico_tamanho,
        "publico_paginas": doc.publico_paginas, "publico_sha256": doc.publico_sha256,
        "verificacao": verificacao, "verificacao_em": doc.verificacao_em,
        "situacao": doc.situacao, "enviado_revisao_em": doc.enviado_revisao_em, "aprovado_em": doc.aprovado_em,
        "motivo_recusa": doc.motivo_recusa, "recusado_em": doc.recusado_em,
        "motivo_retirada": doc.motivo_retirada, "retirado_em": doc.retirado_em,
        "criado_em": doc.criado_em, "atualizado_em": doc.atualizado_em,
        # o que ESTE usuário pode fazer agora (o painel só mostra o botão certo; o servidor confere de novo)
        "pode_baixar_original": bool(doc.original_nome) and _pode_baixar_original(db, usuario, doc),
        "pode_editar": doc.situacao == RASCUNHO and usuario_tem_permissao(db, usuario, "documentos"),
        "pode_aprovar": pode_aprovar,
        "pode_retirar": doc.situacao == APROVADO and usuario_tem_permissao(db, usuario, "aprovar_publicacao"),
    }


class DocumentoEditar(BaseModel):
    tipo: Optional[str] = None
    titulo: Optional[str] = None
    descricao: Optional[str] = None
    classificacao: Optional[str] = None
    publicar_no_site: Optional[bool] = None
    data_documento: Optional[date] = None
    validade: Optional[date] = None
    ano: Optional[int] = None
    vinculo_tipo: Optional[str] = None
    vinculo_id: Optional[int] = None


class Motivo(BaseModel):
    motivo: str = Field(..., min_length=1, max_length=2000)


@router.get("/api/documentos/tipos", summary="Tipos, classificações e situações (para os formulários do painel)")
def listar_tipos(_usuario=Depends(_exigir_leitura)):
    return {
        "tipos": [{"codigo": c, "rotulo": r} for c, r in TIPOS.items()],
        "classificacoes": list(CLASSIFICACOES), "situacoes": list(SITUACOES), "vinculos": list(VINCULOS),
    }


@router.get("/api/documentos", summary="Listar documentos (filtros por tipo, ano, situação, classificação, vigência e busca)")
def listar_documentos(
    tipo: Optional[str] = None, ano: Optional[int] = None, situacao: Optional[str] = None,
    classificacao: Optional[str] = None, vigente: Optional[bool] = None, publicar_no_site: Optional[bool] = None,
    vinculo_tipo: Optional[str] = None, vinculo_id: Optional[int] = None, busca: Optional[str] = None,
    limite: int = 300, deslocamento: int = 0,
    db: Session = Depends(get_db), usuario=Depends(_exigir_leitura),
):
    consulta = db.query(DocumentoInstitucional)
    if tipo:
        consulta = consulta.filter(DocumentoInstitucional.tipo == tipo)
    if ano:
        consulta = consulta.filter(DocumentoInstitucional.ano == ano)
    if situacao:
        consulta = consulta.filter(DocumentoInstitucional.situacao == situacao)
    if classificacao:
        consulta = consulta.filter(DocumentoInstitucional.classificacao == classificacao)
    if vigente is not None:
        consulta = consulta.filter(DocumentoInstitucional.vigente == vigente)
    if publicar_no_site is not None:
        consulta = consulta.filter(DocumentoInstitucional.publicar_no_site == publicar_no_site)
    if vinculo_tipo:
        consulta = consulta.filter(DocumentoInstitucional.vinculo_tipo == vinculo_tipo)
    if vinculo_id:
        consulta = consulta.filter(DocumentoInstitucional.vinculo_id == vinculo_id)
    if busca:
        padrao = f"%{busca.strip()}%"
        consulta = consulta.filter(
            DocumentoInstitucional.titulo.ilike(padrao) | DocumentoInstitucional.descricao.ilike(padrao)
            | DocumentoInstitucional.publico_texto.ilike(padrao)
        )
    documentos = (
        consulta.order_by(DocumentoInstitucional.ano.desc().nullslast(), DocumentoInstitucional.id_documento.desc())
        .offset(max(deslocamento, 0)).limit(min(max(limite, 1), 1000)).all()
    )
    return [_serializar(db, usuario, d) for d in documentos]


@router.post("/api/documentos", summary="Cadastrar um documento (e, se vier, o arquivo ORIGINAL, que fica em armazenamento privado)")
async def criar_documento(
    request: Request,
    tipo: str = Form(...), titulo: str = Form(...), descricao: Optional[str] = Form(None),
    classificacao: str = Form("Interna"), publicar_no_site: bool = Form(False),
    data_documento: Optional[str] = Form(None), validade: Optional[str] = Form(None), ano: Optional[int] = Form(None),
    vinculo_tipo: Optional[str] = Form(None), vinculo_id: Optional[int] = Form(None),
    arquivo: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db), usuario=Depends(_exigir_documentos),
):
    conteudo = await arquivo.read() if arquivo is not None and arquivo.filename else None
    dados = {
        "tipo": tipo, "titulo": titulo, "descricao": descricao, "classificacao": classificacao,
        "publicar_no_site": publicar_no_site, "data_documento": data_documento, "validade": validade,
        "ano": ano, "vinculo_tipo": vinculo_tipo, "vinculo_id": vinculo_id,
    }
    doc = await run_in_threadpool(servico.criar_documento, db, usuario, dados, arquivo.filename if conteudo is not None else None, conteudo)
    registrar_auditoria(
        db, usuario, TABELA, "CRIADO", id_registro_afetado=doc.id_documento, ip_origem=_ip(request),
        dados_depois={"tipo": doc.tipo, "titulo": doc.titulo, "classificacao": doc.classificacao, "original_sha256": doc.original_sha256},
    )
    return _serializar(db, usuario, doc)


@router.get("/api/documentos/{id_documento}", summary="Detalhe de um documento")
def obter_documento(id_documento: int, db: Session = Depends(get_db), usuario=Depends(_exigir_leitura)):
    return _serializar(db, usuario, _buscar(db, id_documento))


@router.patch("/api/documentos/{id_documento}", summary="Editar o cadastro (só em rascunho)")
def editar_documento(id_documento: int, dados: DocumentoEditar, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_documentos)):
    doc = _buscar(db, id_documento)
    enviados = dados.model_dump(exclude_unset=True)
    antes = servico.editar(db, doc, enviados)
    registrar_auditoria(db, usuario, TABELA, "EDITADO", id_registro_afetado=doc.id_documento, dados_antes=antes, dados_depois=enviados, ip_origem=_ip(request))
    return _serializar(db, usuario, doc)


@router.post("/api/documentos/{id_documento}/original", summary="Enviar (ou trocar) o arquivo ORIGINAL - armazenamento privado")
async def enviar_original(id_documento: int, request: Request, arquivo: UploadFile = File(...), db: Session = Depends(get_db), usuario=Depends(_exigir_documentos)):
    doc = _buscar(db, id_documento)
    conteudo = await arquivo.read()
    anterior = await run_in_threadpool(servico.substituir_original, db, doc, arquivo.filename, conteudo)
    registrar_auditoria(
        db, usuario, TABELA, "ORIGINAL_ENVIADO", id_registro_afetado=doc.id_documento, ip_origem=_ip(request),
        dados_depois={"sha256": doc.original_sha256, "tamanho": doc.original_tamanho, "arquivo_anterior": anterior},
    )
    return _serializar(db, usuario, doc)


def _responder_verificacao(db, usuario, doc, resultado, request, acao: str):
    registrar_auditoria(
        db, usuario, TABELA, acao if resultado.ok else "VERSAO_PUBLICA_RECUSADA", id_registro_afetado=doc.id_documento, ip_origem=_ip(request),
        dados_depois={"ok": resultado.ok, "bloqueios": [a.codigo for a in resultado.bloqueios], "paginas": resultado.paginas},
    )
    if not resultado.ok:
        raise HTTPException(
            status_code=422,
            detail={"mensagem": "A versão pública NÃO foi aceita: ela não pode ir ao site do jeito que está.", "resultado": resultado.como_dicionario()},
        )
    return {**_serializar(db, usuario, doc), "resultado_da_verificacao": resultado.como_dicionario()}


@router.post("/api/documentos/{id_documento}/versao-publica", summary="Enviar a VERSÃO PÚBLICA (passa pelo verificador de dado pessoal)")
async def enviar_versao_publica(id_documento: int, request: Request, arquivo: UploadFile = File(...), db: Session = Depends(get_db), usuario=Depends(_exigir_documentos)):
    doc = _buscar(db, id_documento)
    conteudo = await arquivo.read()
    resultado = await run_in_threadpool(servico.anexar_versao_publica, db, doc, conteudo)
    return _responder_verificacao(db, usuario, doc, resultado, request, "VERSAO_PUBLICA_ENVIADA")


@router.post("/api/documentos/{id_documento}/versao-publica/usar-original", summary="Documento PÚBLICO: usar o próprio original como versão pública (também verificado)")
async def usar_original(id_documento: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_documentos)):
    doc = _buscar(db, id_documento)
    resultado = await run_in_threadpool(servico.usar_original_como_versao_publica, db, doc)
    return _responder_verificacao(db, usuario, doc, resultado, request, "VERSAO_PUBLICA_ENVIADA")


@router.post("/api/documentos/{id_documento}/enviar-revisao", summary="Enviar para revisão (aprovação por outra pessoa)")
def enviar_revisao(id_documento: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_documentos)):
    doc = _buscar(db, id_documento)
    servico.enviar_para_revisao(db, usuario, doc)
    registrar_auditoria(db, usuario, TABELA, "ENVIADO_REVISAO", id_registro_afetado=doc.id_documento, ip_origem=_ip(request))
    return _serializar(db, usuario, doc)


@router.post("/api/documentos/{id_documento}/aprovar", summary="Aprovar a publicação no site (Presidente ou Secretário; nunca quem enviou)")
async def aprovar_documento(id_documento: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_aprovador)):
    doc = _buscar(db, id_documento)
    await run_in_threadpool(servico.aprovar, db, usuario, doc)
    registrar_auditoria(
        db, usuario, TABELA, "APROVADO", id_registro_afetado=doc.id_documento, ip_origem=_ip(request),
        dados_depois={"sha256_publicado": doc.publico_sha256, "versao": doc.versao, "enviado_por": doc.id_usuario_envio_revisao},
    )
    return _serializar(db, usuario, doc)


@router.post("/api/documentos/{id_documento}/recusar", summary="Recusar a publicação (volta a rascunho, com o motivo)")
def recusar_documento(id_documento: int, dados: Motivo, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_aprovador)):
    doc = _buscar(db, id_documento)
    servico.recusar(db, usuario, doc, dados.motivo)
    registrar_auditoria(db, usuario, TABELA, "RECUSADO", id_registro_afetado=doc.id_documento, dados_depois={"motivo": dados.motivo}, ip_origem=_ip(request))
    return _serializar(db, usuario, doc)


@router.post("/api/documentos/{id_documento}/retirar", summary="Retirar do site (preserva todo o histórico)")
def retirar_documento(id_documento: int, dados: Motivo, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_aprovador)):
    doc = _buscar(db, id_documento)
    servico.retirar(db, usuario, doc, dados.motivo)
    registrar_auditoria(db, usuario, TABELA, "RETIRADO", id_registro_afetado=doc.id_documento, dados_depois={"motivo": dados.motivo, "sha256": doc.publico_sha256}, ip_origem=_ip(request))
    return _serializar(db, usuario, doc)


@router.post("/api/documentos/{id_documento}/nova-versao", summary="Criar uma nova versão (rascunho vazio) do mesmo documento")
def criar_nova_versao(id_documento: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_documentos)):
    doc = _buscar(db, id_documento)
    nova = servico.nova_versao(db, usuario, doc)
    registrar_auditoria(db, usuario, TABELA, "NOVA_VERSAO", id_registro_afetado=nova.id_documento, dados_depois={"versao": nova.versao, "a_partir_de": doc.id_documento}, ip_origem=_ip(request))
    return _serializar(db, usuario, nova)


@router.post("/api/documentos/{id_documento}/tornar-vigente", summary="Marcar como a versão vigente (documento que não vai ao site)")
def tornar_vigente(id_documento: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_documentos)):
    doc = _buscar(db, id_documento)
    servico.tornar_vigente(db, doc)
    registrar_auditoria(db, usuario, TABELA, "TORNADO_VIGENTE", id_registro_afetado=doc.id_documento, ip_origem=_ip(request))
    return _serializar(db, usuario, doc)


def _resposta_de_arquivo(conteudo: bytes, nome_do_arquivo: str, tipo: str, privado: bool) -> Response:
    seguro = nome_do_arquivo.replace('"', "'")
    return Response(
        content=conteudo, media_type=tipo,
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": f'attachment; filename="{seguro}"' if privado else f'inline; filename="{seguro}"',
            "Cache-Control": "no-store",  # arquivo sigiloso nunca fica em cache de navegador ou de intermediário
        },
    )


@router.get("/api/documentos/{id_documento}/original", summary="Baixar o ORIGINAL (autenticado, por permissão, sempre auditado)")
async def baixar_original(id_documento: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_leitura)):
    doc = _buscar(db, id_documento)
    if not doc.original_nome:
        raise HTTPException(status_code=404, detail="Este documento não tem arquivo original.")
    if not _pode_baixar_original(db, usuario, doc):
        raise HTTPException(
            status_code=403,
            detail="Sem permissão para baixar o original deste documento (ele pode conter dado pessoal: exige a permissão 'documentos_originais').",
        )
    conteudo = await run_in_threadpool(armazenamento.obter().ler, "documentos-originais", doc.original_nome)
    if conteudo is None:
        raise HTTPException(status_code=404, detail="Arquivo original não encontrado no armazenamento.")
    registrar_auditoria(
        db, usuario, TABELA, "ORIGINAL_BAIXADO", id_registro_afetado=doc.id_documento, ip_origem=_ip(request),
        dados_depois={"classificacao": doc.classificacao, "sha256": doc.original_sha256},
    )
    extensao = "." + doc.original_nome.rsplit(".", 1)[-1]
    return _resposta_de_arquivo(conteudo, doc.original_nome_arquivo or doc.original_nome, _TIPOS_DE_ARQUIVO.get(extensao, "application/octet-stream"), privado=True)


@router.get("/api/documentos/{id_documento}/versao-publica", summary="Ver a versão pública (para quem prepara e revisa; antes de ir ao site)")
async def ver_versao_publica(id_documento: int, db: Session = Depends(get_db), usuario=Depends(_exigir_leitura)):
    doc = _buscar(db, id_documento)
    if not doc.publico_nome:
        raise HTTPException(status_code=404, detail="Este documento não tem versão pública.")
    conteudo = await run_in_threadpool(armazenamento.obter().ler, "documentos-publicos", doc.publico_nome)
    if conteudo is None:
        raise HTTPException(status_code=404, detail="Versão pública não encontrada no armazenamento.")
    return _resposta_de_arquivo(conteudo, f"{doc.titulo[:80]}.pdf", "application/pdf", privado=False)
