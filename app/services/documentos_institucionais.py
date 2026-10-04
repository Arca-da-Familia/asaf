"""v5.4a (FASE 5) - regras do módulo Documentos: criar, anexar original e versão pública, enviar para revisão,
aprovar, recusar, retirar e versionar. As rotas (app/routers/documentos.py) só traduzem HTTP e auditam.

Invariantes que os testes (tests/test_documentos_institucionais.py) travam:
  - o ORIGINAL nunca sai do armazenamento privado e nunca vira a versão pública de documento que não é Pública;
  - só vai ao site versão pública que PASSOU no verificador, e é conferida DE NOVO na aprovação (arquivo
    adulterado ou verificador mais rigoroso = recusa);
  - QUEM ENVIOU PARA REVISÃO (ou criou) NÃO APROVA - a aprovação é de outra pessoa;
  - nada se apaga: recusar volta a rascunho com o motivo, retirar preserva tudo, versão nova não sobrescreve a velha."""
from __future__ import annotations

import hashlib
import os
import re
import uuid
from datetime import date, datetime

from fastapi import HTTPException

from app.models.documentos import (
    APROVADO, CLASSIFICACOES, EM_REVISAO, INTERNA, PUBLICA, RASCUNHO, RETIRADO, TIPOS, VINCULOS, DocumentoInstitucional,
)
from app.services import armazenamento
from app.services.documentos_verificacao import TAMANHO_MAXIMO, Resultado, verificar_versao_publica

PASTA_ORIGINAIS = "documentos-originais"
PASTA_PUBLICOS = "documentos-publicos"
EXTENSOES_DO_ORIGINAL = {".pdf": b"%PDF-", ".jpg": b"\xff\xd8\xff", ".jpeg": b"\xff\xd8\xff", ".png": b"\x89PNG"}
MOTIVO_MINIMO = 10


def _sha256(conteudo: bytes) -> str:
    return hashlib.sha256(conteudo).hexdigest()


def _nome_para_exibir(nome: str | None) -> str:
    """Só o nome do arquivo (sem pasta), sem caractere esquisito, no máximo 120 caracteres."""
    base = os.path.basename((nome or "documento").replace("\\", "/"))
    limpo = re.sub(r"[^\w .\-()]", "_", base, flags=re.UNICODE).strip(" .")
    return (limpo or "documento")[:120]


def _data(valor) -> date | None:
    if valor in (None, ""):
        return None
    if isinstance(valor, date) and not isinstance(valor, datetime):
        return valor
    try:
        return date.fromisoformat(str(valor)[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Data inválida: {valor!r} (use AAAA-MM-DD).")


def _validar_campos(dados: dict) -> dict:
    """Valida e normaliza os campos de cadastro (criar e editar). Devolve só o que veio e é válido."""
    limpo: dict = {}
    if "tipo" in dados:
        if dados["tipo"] not in TIPOS:
            raise HTTPException(status_code=400, detail=f"Tipo inválido. Use um destes: {', '.join(TIPOS)}.")
        limpo["tipo"] = dados["tipo"]
    if "titulo" in dados:
        titulo = (dados["titulo"] or "").strip()
        if len(titulo) < 3 or len(titulo) > 200:
            raise HTTPException(status_code=400, detail="O título precisa ter de 3 a 200 caracteres.")
        limpo["titulo"] = titulo
    if "descricao" in dados:
        limpo["descricao"] = (dados["descricao"] or "").strip() or None
    if "classificacao" in dados:
        if dados["classificacao"] not in CLASSIFICACOES:
            raise HTTPException(status_code=400, detail=f"Classificação inválida. Use: {', '.join(CLASSIFICACOES)}.")
        limpo["classificacao"] = dados["classificacao"]
    if "publicar_no_site" in dados:
        limpo["publicar_no_site"] = bool(dados["publicar_no_site"])
    for campo in ("data_documento", "validade"):
        if campo in dados:
            limpo[campo] = _data(dados[campo])
    if "ano" in dados:
        ano = dados["ano"]
        if ano not in (None, "") and not (1900 <= int(ano) <= 2200):
            raise HTTPException(status_code=400, detail="Ano inválido.")
        limpo["ano"] = int(ano) if ano not in (None, "") else None
    if "vinculo_tipo" in dados or "vinculo_id" in dados:
        tipo, ident = dados.get("vinculo_tipo") or None, dados.get("vinculo_id") or None
        if (tipo is None) != (ident is None):
            raise HTTPException(status_code=400, detail="Informe o tipo e o número do vínculo juntos (ou nenhum dos dois).")
        if tipo is not None and tipo not in VINCULOS:
            raise HTTPException(status_code=400, detail=f"Vínculo inválido. Use: {', '.join(VINCULOS)}.")
        limpo["vinculo_tipo"], limpo["vinculo_id"] = tipo, int(ident) if ident is not None else None
    return limpo


def _validar_original(nome_arquivo: str | None, conteudo: bytes) -> str:
    extensao = os.path.splitext(nome_arquivo or "")[1].lower()
    assinatura = EXTENSOES_DO_ORIGINAL.get(extensao)
    if assinatura is None:
        raise HTTPException(status_code=400, detail="Formato não suportado. Envie PDF, JPG ou PNG.")
    if not conteudo:
        raise HTTPException(status_code=400, detail="O arquivo está vazio.")
    if len(conteudo) > TAMANHO_MAXIMO:
        raise HTTPException(status_code=400, detail=f"Arquivo muito grande (máximo {TAMANHO_MAXIMO // (1024 * 1024)} MB).")
    if not conteudo.startswith(assinatura):
        raise HTTPException(status_code=400, detail="O conteúdo do arquivo não confere com a extensão informada.")
    return extensao


def _exigir_situacao(doc: DocumentoInstitucional, *permitidas: str, acao: str) -> None:
    if doc.situacao not in permitidas:
        raise HTTPException(
            status_code=409,
            detail=f"Não dá para {acao}: o documento está '{doc.situacao}' (precisa estar: {' ou '.join(permitidas)}). "
                   "Para mudar um documento já publicado, crie uma nova versão.",
        )


def _remover_arquivo(pasta: str, nome: str | None) -> None:
    """Melhor esforço (nunca derruba a operação): arquivo trocado em RASCUNHO ainda nunca foi publicado."""
    if nome:
        try:
            armazenamento.obter().remover(pasta, nome)
        except Exception:  # noqa: BLE001
            armazenamento.LOG.exception("não foi possível apagar %s/%s", pasta, nome)


# ------------------------------------------------------------------------------------------ criar
def criar_documento(db, usuario, dados: dict, nome_arquivo: str | None = None, conteudo: bytes | None = None) -> DocumentoInstitucional:
    campos = _validar_campos(dados)
    for obrigatorio in ("tipo", "titulo"):
        if obrigatorio not in campos:
            raise HTTPException(status_code=400, detail=f"Campo obrigatório: {obrigatorio}.")
    campos.setdefault("classificacao", INTERNA)
    if campos.get("ano") is None and campos.get("data_documento"):
        campos["ano"] = campos["data_documento"].year
    doc = DocumentoInstitucional(
        **campos, grupo_versao=uuid.uuid4().hex, versao=1, vigente=True, situacao=RASCUNHO,
        id_usuario_criacao=usuario.id_usuario,
    )
    db.add(doc)
    db.flush()
    if conteudo is not None:
        _gravar_original(doc, nome_arquivo, conteudo)
    db.commit()
    db.refresh(doc)
    return doc


def _gravar_original(doc: DocumentoInstitucional, nome_arquivo: str | None, conteudo: bytes) -> str | None:
    extensao = _validar_original(nome_arquivo, conteudo)
    anterior = doc.original_nome
    nome = armazenamento.nome_aleatorio(extensao)
    armazenamento.obter().salvar(PASTA_ORIGINAIS, nome, conteudo)
    doc.original_nome, doc.original_nome_arquivo = nome, _nome_para_exibir(nome_arquivo)
    doc.original_sha256, doc.original_tamanho = _sha256(conteudo), len(conteudo)
    return anterior  # o original antigo NÃO é apagado (documento de valor jurídico: fica no armazenamento versionado)


def substituir_original(db, doc: DocumentoInstitucional, nome_arquivo: str | None, conteudo: bytes) -> str | None:
    _exigir_situacao(doc, RASCUNHO, acao="trocar o arquivo original")
    anterior = _gravar_original(doc, nome_arquivo, conteudo)
    db.commit()
    db.refresh(doc)
    return anterior


def editar(db, doc: DocumentoInstitucional, dados: dict) -> dict:
    """Edita o cadastro (só em rascunho). Mudar classificação ou 'publicar no site' invalida a versão pública."""
    _exigir_situacao(doc, RASCUNHO, acao="editar o cadastro")
    campos = _validar_campos(dados)
    antes = {k: getattr(doc, k) for k in campos}
    mudou_regra = any(k in campos and campos[k] != getattr(doc, k) for k in ("classificacao", "publicar_no_site"))
    for campo, valor in campos.items():
        setattr(doc, campo, valor)
    if "ano" not in campos and "data_documento" in campos and campos["data_documento"]:
        doc.ano = campos["data_documento"].year
    if mudou_regra and doc.publico_nome:
        _limpar_versao_publica(doc)
    db.commit()
    db.refresh(doc)
    return antes


def _limpar_versao_publica(doc: DocumentoInstitucional) -> None:
    _remover_arquivo(PASTA_PUBLICOS, doc.publico_nome)
    doc.publico_nome = doc.publico_sha256 = doc.publico_texto = doc.verificacao_json = None
    doc.publico_tamanho = doc.publico_paginas = None
    doc.verificacao_ok = None
    doc.verificacao_em = None


# --------------------------------------------------------------------------------- versão pública
def anexar_versao_publica(db, doc: DocumentoInstitucional, conteudo: bytes, *, do_original: bool = False) -> Resultado:
    """Verifica e, se passar, guarda a versão pública. Se NÃO passar, não guarda nada (o arquivo tem dado
    pessoal) e devolve o resultado com os achados MASCARADOS para a pessoa corrigir."""
    _exigir_situacao(doc, RASCUNHO, acao="trocar a versão pública")
    if not doc.publicar_no_site:
        raise HTTPException(status_code=409, detail="Este documento não está marcado para o site: não há versão pública para anexar.")
    resultado = verificar_versao_publica(conteudo)
    if not resultado.ok:
        return resultado
    sha = _sha256(conteudo)
    if doc.classificacao != PUBLICA and not do_original and sha == doc.original_sha256:
        raise HTTPException(
            status_code=422,
            detail="A versão pública é IDÊNTICA ao original, que não é público (classificação "
                   f"'{doc.classificacao}'). Envie uma cópia com os dados pessoais cobertos.",
        )
    _remover_arquivo(PASTA_PUBLICOS, doc.publico_nome)
    nome = armazenamento.nome_aleatorio(".pdf")
    armazenamento.obter().salvar(PASTA_PUBLICOS, nome, conteudo)
    doc.publico_nome, doc.publico_sha256, doc.publico_tamanho = nome, sha, len(conteudo)
    doc.publico_paginas, doc.publico_texto = resultado.paginas, resultado.texto
    doc.verificacao_ok, doc.verificacao_em = True, datetime.utcnow()
    doc.verificacao_json = _json_do_resultado(resultado)
    db.commit()
    db.refresh(doc)
    return resultado


def _json_do_resultado(resultado: Resultado) -> str:
    import json

    return json.dumps(resultado.como_dicionario(), ensure_ascii=False)


def usar_original_como_versao_publica(db, doc: DocumentoInstitucional) -> Resultado:
    """Só para documento PÚBLICO (estatuto, balanço...): o original já é para todo mundo ver, então não se
    exige um segundo arquivo. Passa pelo MESMO verificador - se achar dado pessoal, a classificação está errada."""
    if doc.classificacao != PUBLICA:
        raise HTTPException(status_code=409, detail=f"Só documento 'Pública' pode usar o original como versão pública (este é '{doc.classificacao}').")
    if not doc.original_nome:
        raise HTTPException(status_code=409, detail="Envie o arquivo original antes.")
    conteudo = armazenamento.obter().ler(PASTA_ORIGINAIS, doc.original_nome)
    if conteudo is None:
        raise HTTPException(status_code=404, detail="Arquivo original não encontrado no armazenamento.")
    return anexar_versao_publica(db, doc, conteudo, do_original=True)


# ----------------------------------------------------------------------------------- publicação
def enviar_para_revisao(db, usuario, doc: DocumentoInstitucional) -> None:
    _exigir_situacao(doc, RASCUNHO, acao="enviar para revisão")
    if not doc.publicar_no_site:
        raise HTTPException(status_code=409, detail="Este documento não está marcado para o site.")
    if not doc.publico_nome or not doc.verificacao_ok:
        raise HTTPException(status_code=409, detail="Anexe a versão pública e passe na verificação antes de enviar para revisão.")
    doc.situacao = EM_REVISAO
    doc.id_usuario_envio_revisao, doc.enviado_revisao_em = usuario.id_usuario, datetime.utcnow()
    doc.motivo_recusa = None
    db.commit()


def aprovar(db, usuario, doc: DocumentoInstitucional) -> Resultado:
    _exigir_situacao(doc, EM_REVISAO, acao="aprovar a publicação")
    if usuario.id_usuario in (doc.id_usuario_envio_revisao, doc.id_usuario_criacao):
        raise HTTPException(
            status_code=403,
            detail="Quem criou ou enviou o documento para revisão não pode aprová-lo: a aprovação é de outra pessoa "
                   "(Presidente ou Secretário).",
        )
    conteudo = armazenamento.obter().ler(PASTA_PUBLICOS, doc.publico_nome) if doc.publico_nome else None
    if conteudo is None:
        raise HTTPException(status_code=409, detail="A versão pública não foi encontrada no armazenamento.")
    if _sha256(conteudo) != doc.publico_sha256:
        raise HTTPException(status_code=409, detail="O arquivo da versão pública mudou depois da verificação (SHA-256 diferente): envie de novo.")
    resultado = verificar_versao_publica(conteudo)
    if not resultado.ok:
        raise HTTPException(status_code=422, detail={"mensagem": "A versão pública não passou na verificação final.", "resultado": resultado.como_dicionario()})
    agora = datetime.utcnow()
    doc.situacao, doc.id_usuario_aprovacao, doc.aprovado_em = APROVADO, usuario.id_usuario, agora
    doc.motivo_recusa = doc.id_usuario_recusa = doc.recusado_em = None
    _tornar_vigente(db, doc)
    db.commit()
    return resultado


def recusar(db, usuario, doc: DocumentoInstitucional, motivo: str) -> None:
    _exigir_situacao(doc, EM_REVISAO, acao="recusar")
    motivo = (motivo or "").strip()
    if len(motivo) < MOTIVO_MINIMO:
        raise HTTPException(status_code=400, detail=f"Explique o motivo da recusa (pelo menos {MOTIVO_MINIMO} caracteres).")
    doc.situacao = RASCUNHO
    doc.motivo_recusa, doc.id_usuario_recusa, doc.recusado_em = motivo, usuario.id_usuario, datetime.utcnow()
    db.commit()


def retirar(db, usuario, doc: DocumentoInstitucional, motivo: str) -> None:
    _exigir_situacao(doc, APROVADO, acao="retirar do site")
    motivo = (motivo or "").strip()
    if len(motivo) < MOTIVO_MINIMO:
        raise HTTPException(status_code=400, detail=f"Explique o motivo da retirada (pelo menos {MOTIVO_MINIMO} caracteres).")
    doc.situacao = RETIRADO
    doc.motivo_retirada, doc.id_usuario_retirada, doc.retirado_em = motivo, usuario.id_usuario, datetime.utcnow()
    db.commit()


# ------------------------------------------------------------------------------------- versões
def _irmaos(db, doc: DocumentoInstitucional):
    return db.query(DocumentoInstitucional).filter(DocumentoInstitucional.grupo_versao == doc.grupo_versao)


def _tornar_vigente(db, doc: DocumentoInstitucional) -> None:
    for outro in _irmaos(db, doc).filter(DocumentoInstitucional.id_documento != doc.id_documento).all():
        outro.vigente = False
    doc.vigente = True


def tornar_vigente(db, doc: DocumentoInstitucional) -> None:
    """Para documento que NÃO vai ao site (a vigência dos publicados muda sozinha na aprovação)."""
    if doc.publicar_no_site:
        raise HTTPException(status_code=409, detail="A versão vigente de um documento do site muda quando a nova versão é aprovada.")
    _tornar_vigente(db, doc)
    db.commit()


def nova_versao(db, usuario, doc: DocumentoInstitucional) -> DocumentoInstitucional:
    # Documento do SITE: uma versão em andamento por vez. Documento que não vai ao site não tem fluxo de revisão
    # (fica em 'Rascunho' para sempre), então nada o bloqueia.
    aberta = _irmaos(db, doc).filter(DocumentoInstitucional.situacao.in_((RASCUNHO, EM_REVISAO))).first() if doc.publicar_no_site else None
    if aberta is not None:
        raise HTTPException(status_code=409, detail=f"Já existe uma versão em andamento deste documento (nº {aberta.id_documento}, '{aberta.situacao}'): termine ou recuse essa antes.")
    ultima = _irmaos(db, doc).order_by(DocumentoInstitucional.versao.desc()).first()
    nova = DocumentoInstitucional(
        tipo=doc.tipo, titulo=doc.titulo, descricao=doc.descricao, classificacao=doc.classificacao,
        publicar_no_site=doc.publicar_no_site, vinculo_tipo=doc.vinculo_tipo, vinculo_id=doc.vinculo_id,
        grupo_versao=doc.grupo_versao, versao=ultima.versao + 1, vigente=False, situacao=RASCUNHO,
        id_usuario_criacao=usuario.id_usuario,
    )
    db.add(nova)
    db.commit()
    db.refresh(nova)
    return nova
