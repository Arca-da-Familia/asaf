"""v5.4b (FASE 5) - fotos das etapas de uma parceria, com AUTORIZAÇÃO DE IMAGEM (o tratamento da imagem e as regras comuns
ficam em `app/services/fotos.py`, que as fotos de evento também usam).

Foto de oficina, entrega ou evento mostra pessoas (muitas vezes crianças). Regras que os testes travam:
  - a foto SÓ é aceita com a confirmação de que há autorização de uso de imagem (dos responsáveis, no caso de criança ou
    adolescente) e com a descrição para quem não enxerga (texto alternativo); sem as duas coisas nada é guardado;
  - a imagem é REGRAVADA no servidor: some tudo que o celular escreveu dentro do arquivo (localização/GPS, modelo do aparelho,
    data), a rotação é aplicada, o lado maior fica em até 2000 px e o formato é sempre JPEG. A foto original nunca é guardada;
  - a foto fica em armazenamento PRIVADO; ao público só chega pela rota que confere que a parceria está APROVADA, e o site
    copia a foto no build (como o PDF), conferindo o SHA-256;
  - quem retira a autorização pode APAGAR a foto: some do site e do armazenamento (a trilha de auditoria registra quem apagou).
O texto alternativo vai ao site: passa pelo mesmo verificador de dado pessoal dos demais textos públicos."""
from __future__ import annotations

import hashlib

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.documentos import DocumentoInstitucional
from app.models.parcerias import EtapaParceria, FotoEtapaParceria, Parceria
from app.services import armazenamento
from app.services.fotos import FOTOS_POR_ETAPA, MENSAGEM_SEM_AUTORIZACAO, remover_arquivo, tratar_imagem, validar_alt
from app.services.parcerias import _tocar

PASTA_DAS_FOTOS = "fotos-etapas"


def _etapa(db: Session, parceria: Parceria, id_etapa: int) -> EtapaParceria:
    etapa = db.query(EtapaParceria).filter(EtapaParceria.id_etapa == id_etapa, EtapaParceria.id_parceria == parceria.id_parceria).first()
    if not etapa:
        raise HTTPException(status_code=404, detail="Etapa não encontrada nesta parceria.")
    return etapa


def fotos_da_etapa(db: Session, id_etapa: int) -> list[FotoEtapaParceria]:
    return db.query(FotoEtapaParceria).filter(FotoEtapaParceria.id_etapa == id_etapa).order_by(FotoEtapaParceria.id_foto).all()


def adicionar_foto(
    db: Session, usuario, parceria: Parceria, id_etapa: int, conteudo: bytes, *, alt: str | None, autorizacao_imagem: bool,
    id_documento_autorizacao: int | None = None,
) -> FotoEtapaParceria:
    etapa = _etapa(db, parceria, id_etapa)
    if not autorizacao_imagem:
        raise HTTPException(status_code=400, detail=MENSAGEM_SEM_AUTORIZACAO)
    texto = validar_alt(alt)
    if id_documento_autorizacao is not None and not db.query(DocumentoInstitucional.id_documento).filter(
        DocumentoInstitucional.id_documento == id_documento_autorizacao
    ).first():
        raise HTTPException(status_code=404, detail=f"O documento nº {id_documento_autorizacao} (termo de autorização) não existe.")
    if len(fotos_da_etapa(db, etapa.id_etapa)) >= FOTOS_POR_ETAPA:
        raise HTTPException(status_code=409, detail=f"Esta etapa já tem {FOTOS_POR_ETAPA} fotos (o máximo). Apague uma para enviar outra.")

    jpeg, largura, altura = tratar_imagem(conteudo)
    nome = armazenamento.nome_aleatorio(".jpg")
    armazenamento.obter().salvar(PASTA_DAS_FOTOS, nome, jpeg)
    foto = FotoEtapaParceria(
        id_etapa=etapa.id_etapa, id_parceria=parceria.id_parceria, arquivo_nome=nome, sha256=hashlib.sha256(jpeg).hexdigest(),
        tamanho=len(jpeg), largura=largura, altura=altura, alt=texto, autorizacao_imagem=True,
        id_documento_autorizacao=id_documento_autorizacao, id_usuario_criacao=usuario.id_usuario,
    )
    db.add(foto)
    _tocar(parceria)
    db.commit()
    db.refresh(foto)
    return foto


def buscar_foto(db: Session, parceria: Parceria, id_foto: int) -> FotoEtapaParceria:
    foto = db.query(FotoEtapaParceria).filter(FotoEtapaParceria.id_foto == id_foto, FotoEtapaParceria.id_parceria == parceria.id_parceria).first()
    if not foto:
        raise HTTPException(status_code=404, detail="Foto não encontrada nesta parceria.")
    return foto


def apagar_foto(db: Session, parceria: Parceria, id_foto: int) -> FotoEtapaParceria:
    """Apaga de verdade (a pessoa retirou a autorização): linha do banco e arquivo. A auditoria guarda quem apagou."""
    foto = buscar_foto(db, parceria, id_foto)
    remover_arquivo(PASTA_DAS_FOTOS, foto.arquivo_nome)  # primeiro o arquivo: se falhar, a foto continua cadastrada
    db.delete(foto)
    _tocar(parceria)
    db.commit()
    return foto


def apagar_fotos_da_etapa(db: Session, parceria: Parceria, id_etapa: int) -> None:
    """Etapa apagada leva as fotos junto (do banco e do armazenamento)."""
    for foto in fotos_da_etapa(db, id_etapa):
        apagar_foto(db, parceria, foto.id_foto)


def ler_arquivo(foto: FotoEtapaParceria) -> bytes:
    conteudo = armazenamento.obter().ler(PASTA_DAS_FOTOS, foto.arquivo_nome)
    if conteudo is None:
        raise HTTPException(status_code=404, detail="Foto não encontrada no armazenamento.")
    return conteudo


def para_o_painel(foto: FotoEtapaParceria) -> dict:
    return {
        "id_foto": foto.id_foto, "id_etapa": foto.id_etapa, "alt": foto.alt, "largura": foto.largura, "altura": foto.altura,
        "tamanho": foto.tamanho, "autorizacao_imagem": foto.autorizacao_imagem,
        "id_documento_autorizacao": foto.id_documento_autorizacao, "criado_em": foto.criado_em,
    }
