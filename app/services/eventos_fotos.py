"""v5.5 (FASE 5) - fotos de um evento, com AUTORIZAÇÃO DE IMAGEM (mesmas regras das fotos de etapa de parceria: ver
`app/services/fotos.py`). A foto fica em armazenamento PRIVADO (`fotos-eventos`); ao público só chega pela rota que confere que o
evento é Público a cada pedido, e o site copia a foto no build conferindo o SHA-256. Quem retira a autorização apaga a foto."""
from __future__ import annotations

import hashlib

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.documentos import DocumentoInstitucional
from app.models.eventos import Evento, FotoEvento
from app.services import armazenamento
from app.services.fotos import FOTOS_POR_EVENTO, MENSAGEM_SEM_AUTORIZACAO, tratar_imagem, validar_alt

PASTA_DAS_FOTOS = "fotos-eventos"


def fotos_do_evento(db: Session, id_evento: int) -> list[FotoEvento]:
    return db.query(FotoEvento).filter(FotoEvento.id_evento == id_evento).order_by(FotoEvento.id_foto).all()


def adicionar_foto(
    db: Session, usuario, evento: Evento, conteudo: bytes, *, alt: str | None, autorizacao_imagem: bool,
    id_documento_autorizacao: int | None = None,
) -> FotoEvento:
    if not autorizacao_imagem:
        raise HTTPException(status_code=400, detail=MENSAGEM_SEM_AUTORIZACAO)
    texto = validar_alt(alt)
    if id_documento_autorizacao is not None and not db.query(DocumentoInstitucional.id_documento).filter(
        DocumentoInstitucional.id_documento == id_documento_autorizacao
    ).first():
        raise HTTPException(status_code=404, detail=f"O documento nº {id_documento_autorizacao} (termo de autorização) não existe.")
    if len(fotos_do_evento(db, evento.id_evento)) >= FOTOS_POR_EVENTO:
        raise HTTPException(status_code=409, detail=f"Este evento já tem {FOTOS_POR_EVENTO} fotos (o máximo). Apague uma para enviar outra.")

    jpeg, largura, altura = tratar_imagem(conteudo)
    nome = armazenamento.nome_aleatorio(".jpg")
    armazenamento.obter().salvar(PASTA_DAS_FOTOS, nome, jpeg)
    foto = FotoEvento(
        id_evento=evento.id_evento, arquivo_nome=nome, sha256=hashlib.sha256(jpeg).hexdigest(), tamanho=len(jpeg),
        largura=largura, altura=altura, alt=texto, autorizacao_imagem=True,
        id_documento_autorizacao=id_documento_autorizacao, id_usuario_criacao=usuario.id_usuario,
    )
    db.add(foto)
    db.commit()
    db.refresh(foto)
    return foto


def buscar_foto(db: Session, evento: Evento, id_foto: int) -> FotoEvento:
    foto = db.query(FotoEvento).filter(FotoEvento.id_foto == id_foto, FotoEvento.id_evento == evento.id_evento).first()
    if not foto:
        raise HTTPException(status_code=404, detail="Foto não encontrada neste evento.")
    return foto


def apagar_foto(db: Session, evento: Evento, id_foto: int) -> FotoEvento:
    """Apaga de verdade (a pessoa retirou a autorização): linha do banco e arquivo. A auditoria guarda quem apagou."""
    foto = buscar_foto(db, evento, id_foto)
    nome = foto.arquivo_nome
    db.delete(foto)
    db.commit()
    try:
        armazenamento.obter().remover(PASTA_DAS_FOTOS, nome)
    except Exception:  # noqa: BLE001 - o registro já saiu do banco e do site; arquivo órfão fica no log
        armazenamento.LOG.exception("não foi possível apagar a foto %s/%s", PASTA_DAS_FOTOS, nome)
    return foto


def ler_arquivo(foto: FotoEvento) -> bytes:
    conteudo = armazenamento.obter().ler(PASTA_DAS_FOTOS, foto.arquivo_nome)
    if conteudo is None:
        raise HTTPException(status_code=404, detail="Foto não encontrada no armazenamento.")
    return conteudo


def para_o_painel(foto: FotoEvento) -> dict:
    return {
        "id_foto": foto.id_foto, "id_evento": foto.id_evento, "alt": foto.alt, "largura": foto.largura, "altura": foto.altura,
        "tamanho": foto.tamanho, "autorizacao_imagem": foto.autorizacao_imagem,
        "id_documento_autorizacao": foto.id_documento_autorizacao, "criado_em": foto.criado_em,
    }


def para_o_publico(foto: FotoEvento) -> dict:
    """Só o que o site precisa: nada de quem enviou, do termo de autorização nem do nome do arquivo no armazenamento."""
    return {
        "id_foto": foto.id_foto, "alt": foto.alt, "largura": foto.largura, "altura": foto.altura, "tamanho": foto.tamanho,
        "sha256": foto.sha256, "arquivo": f"/api/publico/eventos/{foto.id_evento}/fotos/{foto.id_foto}",
    }
