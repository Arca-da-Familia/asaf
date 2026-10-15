"""v5.7c (FASE 5) - a foto pública de quem está na Diretoria e no Conselho Fiscal. "A pessoa se sente representada quando vê o rosto de quem responde pela instituição": o site mostra nome,
cargo e a foto de quem AUTORIZOU o uso da imagem. Mesmas regras das fotos de evento (`eventos_fotos.py`): sem a autorização a foto nem é guardada; o arquivo é regravado em JPEG sem metadado e fica em
armazenamento PRIVADO; ao público só chega pela rota que confere, a cada pedido, que a pessoa TEM mandato vigente; quem retira a autorização apaga a foto (some do sistema na hora e do site na
próxima publicação). É uma foto por pessoa (a nova substitui a anterior), e o texto alternativo é gerado do nome e do cargo (a diretoria não precisa escrevê-lo)."""
from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.associados import Associado
from app.models.documentos import DocumentoInstitucional
from app.models.mandatos import FotoDaDiretoria, Mandato
from app.services import armazenamento
from app.services.fotos import MENSAGEM_SEM_AUTORIZACAO, remover_arquivo, tratar_imagem

PASTA_DAS_FOTOS = "fotos-diretoria"


def foto_da_pessoa(db: Session, id_pessoa: int) -> Optional[FotoDaDiretoria]:
    return db.query(FotoDaDiretoria).filter(FotoDaDiretoria.id_pessoa == id_pessoa).first()


def _associado(db: Session, id_associado: int) -> Associado:
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    if not associado:
        raise HTTPException(status_code=404, detail="Associado não encontrado.")
    return associado


def texto_alternativo(nome: str, cargo: Optional[str]) -> str:
    return f"Foto de {nome}" + (f", {cargo}" if cargo else "")


def salvar_foto(
    db: Session, usuario, id_associado: int, conteudo: bytes, *, autorizacao_imagem: bool, id_documento_autorizacao: Optional[int] = None,
    cargo: Optional[str] = None,
) -> FotoDaDiretoria:
    """Guarda (ou troca) a foto da pessoa. Recusa sem a autorização de imagem, com arquivo que não é imagem de verdade, ou com um termo de autorização que não existe."""
    if not autorizacao_imagem:
        raise HTTPException(status_code=400, detail=MENSAGEM_SEM_AUTORIZACAO)
    associado = _associado(db, id_associado)
    if id_documento_autorizacao is not None and not db.query(DocumentoInstitucional.id_documento).filter(
        DocumentoInstitucional.id_documento == id_documento_autorizacao
    ).first():
        raise HTTPException(status_code=404, detail=f"O documento nº {id_documento_autorizacao} (termo de autorização) não existe.")
    jpeg, largura, altura = tratar_imagem(conteudo)
    nome_do_arquivo = armazenamento.nome_aleatorio(".jpg")
    armazenamento.obter().salvar(PASTA_DAS_FOTOS, nome_do_arquivo, jpeg)
    anterior = foto_da_pessoa(db, associado.id_pessoa)
    nome_antigo = anterior.arquivo_nome if anterior else None
    dados = dict(
        arquivo_nome=nome_do_arquivo, sha256=hashlib.sha256(jpeg).hexdigest(), tamanho=len(jpeg), largura=largura, altura=altura,
        alt=texto_alternativo(associado.nome_completo, cargo), autorizacao_imagem=True, id_documento_autorizacao=id_documento_autorizacao,
        id_usuario_criacao=usuario.id_usuario, criado_em=datetime.utcnow(),
    )
    if anterior:
        for campo, valor in dados.items():
            setattr(anterior, campo, valor)
        foto = anterior
    else:
        foto = FotoDaDiretoria(id_pessoa=associado.id_pessoa, **dados)
        db.add(foto)
    db.commit()
    db.refresh(foto)
    if nome_antigo:  # a troca já está gravada: o arquivo velho sai (se falhar, sobra um arquivo órfão, nunca uma foto sem arquivo)
        try:
            remover_arquivo(PASTA_DAS_FOTOS, nome_antigo)
        except HTTPException:
            pass
    return foto


def apagar_foto(db: Session, id_associado: int) -> FotoDaDiretoria:
    """A pessoa retirou a autorização: apaga de verdade (linha e arquivo). A auditoria guarda quem apagou."""
    associado = _associado(db, id_associado)
    foto = foto_da_pessoa(db, associado.id_pessoa)
    if not foto:
        raise HTTPException(status_code=404, detail="Esta pessoa não tem foto cadastrada para o site.")
    remover_arquivo(PASTA_DAS_FOTOS, foto.arquivo_nome)  # primeiro o arquivo: se falhar, a foto continua cadastrada e dá para tentar de novo
    db.delete(foto)
    db.commit()
    return foto


def ler_arquivo(foto: FotoDaDiretoria) -> bytes:
    conteudo = armazenamento.obter().ler(PASTA_DAS_FOTOS, foto.arquivo_nome)
    if conteudo is None:
        raise HTTPException(status_code=404, detail="Foto não encontrada no armazenamento.")
    return conteudo


def para_o_painel(foto: Optional[FotoDaDiretoria]) -> dict:
    if foto is None:
        return {"foto": None}
    return {
        "foto": {
            "id_foto": foto.id_foto, "alt": foto.alt, "largura": foto.largura, "altura": foto.altura, "tamanho": foto.tamanho,
            "autorizacao_imagem": foto.autorizacao_imagem, "id_documento_autorizacao": foto.id_documento_autorizacao, "criado_em": foto.criado_em,
        }
    }


def pessoa_tem_mandato_vigente(db: Session, id_pessoa: int) -> bool:
    """A foto só é pública enquanto a pessoa está em algum mandato vigente (mesma regra de `GET /api/publico/diretoria`)."""
    ids_associados = [i for (i,) in db.query(Associado.id_associado).filter(Associado.id_pessoa == id_pessoa).all()]
    if not ids_associados:
        return False
    return any(m.vigente() for m in db.query(Mandato).filter(Mandato.id_associado.in_(ids_associados)).all())


def foto_publica(db: Session, id_foto: int) -> Optional[FotoDaDiretoria]:
    """A foto que o site pode mostrar agora, ou `None` (não existe, não tem autorização ou a pessoa não tem mandato vigente: todos respondem igual)."""
    foto = db.query(FotoDaDiretoria).filter(FotoDaDiretoria.id_foto == id_foto).first()
    if foto is None or not foto.autorizacao_imagem or not pessoa_tem_mandato_vigente(db, foto.id_pessoa):
        return None
    return foto
