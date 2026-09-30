"""v4.0 (FASE 4) - motor de documento gerado: um template com variáveis `{{nome}}` vira PDF
numerado, com registro de quem emitiu, quando e pra quem. Certificado de voluntariado (FASE 4),
de participação em evento e de conclusão de curso (FASE 14) são o MESMO motor com template
diferente - nunca um gerador de PDF por funcionalidade."""
import io
import json
import os
import re
from datetime import datetime
from typing import Optional

import qrcode
from fastapi import HTTPException
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.motores import DocumentoEmitido, TemplateDocumento
from app.models.pessoas import Pessoa

_DIRETORIO_DOCUMENTOS = "uploads/documentos"
_VARIAVEL = re.compile(r"\{\{\s*(\w+)\s*\}\}")


def criar_template(db: Session, *, codigo: str, nome: str, corpo_texto: str) -> TemplateDocumento:
    if db.query(TemplateDocumento).filter(TemplateDocumento.codigo == codigo).first():
        raise HTTPException(status_code=400, detail=f"Já existe um template com o código '{codigo}'.")
    template = TemplateDocumento(codigo=codigo, nome=nome, corpo_texto=corpo_texto)
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


def listar_templates(db: Session) -> list[TemplateDocumento]:
    return db.query(TemplateDocumento).order_by(TemplateDocumento.nome).all()


def _substituir_variaveis(corpo_texto: str, variaveis: dict) -> str:
    def _resolver(match: re.Match) -> str:
        chave = match.group(1)
        if chave not in variaveis:
            raise HTTPException(status_code=400, detail=f"Variável '{chave}' exigida pelo template não foi informada.")
        return str(variaveis[chave])

    return _VARIAVEL.sub(_resolver, corpo_texto)


def _gerar_pdf(caminho: str, *, titulo: str, corpo: str, numero_sequencial: int, qr_conteudo: Optional[str] = None) -> None:
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    c = canvas.Canvas(caminho, pagesize=A4)
    largura, altura = A4
    margem = 2 * cm

    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(largura / 2, altura - margem, titulo)

    c.setFont("Helvetica", 11)
    y = altura - margem - 1.5 * cm
    largura_util_chars = 90
    for paragrafo in corpo.split("\n"):
        linha_atual = ""
        for palavra in paragrafo.split(" "):
            candidato = f"{linha_atual} {palavra}".strip()
            if len(candidato) > largura_util_chars:
                c.drawString(margem, y, linha_atual)
                y -= 0.6 * cm
                linha_atual = palavra
            else:
                linha_atual = candidato
        c.drawString(margem, y, linha_atual)
        y -= 0.6 * cm

    if qr_conteudo:
        # v4.8 - crachá/certificado de evento: QR desenhado no canto inferior direito, acima do
        # rodapé. `qrcode` é a primeira dependência de geração de QR do lado servidor deste
        # projeto (o QR de carteirinha/MFA/Pix é sempre renderizado no navegador, via
        # `qrcode.react`) - aqui precisa nascer já dentro do PDF, que é gerado no servidor.
        imagem_qr = qrcode.make(qr_conteudo)
        buffer_qr = io.BytesIO()
        imagem_qr.save(buffer_qr, format="PNG")
        buffer_qr.seek(0)
        tamanho_qr = 3 * cm
        c.drawImage(ImageReader(buffer_qr), largura - margem - tamanho_qr, margem, width=tamanho_qr, height=tamanho_qr)

    c.setFont("Helvetica-Oblique", 8)
    c.drawString(margem, margem / 2, f"Documento nº {numero_sequencial} - emitido pelo sistema ASAF")
    c.showPage()
    c.save()


def emitir_documento(
    db: Session, *, codigo_template: str, variaveis: dict, contexto_tipo: Optional[str] = None,
    id_contexto: Optional[int] = None, id_pessoa: Optional[int] = None, id_usuario: Optional[int] = None,
    codigo_verificacao: Optional[str] = None, qr_conteudo: Optional[str] = None,
) -> DocumentoEmitido:
    template = db.query(TemplateDocumento).filter(TemplateDocumento.codigo == codigo_template, TemplateDocumento.ativo.is_(True)).first()
    if not template:
        raise HTTPException(status_code=404, detail=f"Template '{codigo_template}' não encontrado ou inativo.")
    if id_pessoa is not None and not db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa).first():
        raise HTTPException(status_code=404, detail="Pessoa não encontrada.")

    corpo_final = _substituir_variaveis(template.corpo_texto, variaveis)

    ultimo_numero = db.query(func.max(DocumentoEmitido.numero_sequencial)).scalar() or 0
    numero_sequencial = ultimo_numero + 1

    # v4.8 - documento com código de verificação pública (crachá/certificado de evento) é nomeado
    # pelo código opaco, nunca pelo número sequencial: `/uploads/` é servido sem autenticação, e
    # um nome sequencial seria enumerável (incrementar o número baixaria o PDF de qualquer pessoa
    # certificada). Documento interno (sem código de verificação) continua com o nome de sempre.
    nome_arquivo = f"{codigo_verificacao}.pdf" if codigo_verificacao else f"{numero_sequencial:08d}_{template.codigo}.pdf"
    caminho_relativo = f"{_DIRETORIO_DOCUMENTOS}/{nome_arquivo}"
    _gerar_pdf(caminho_relativo, titulo=template.nome, corpo=corpo_final, numero_sequencial=numero_sequencial, qr_conteudo=qr_conteudo)

    documento = DocumentoEmitido(
        id_template=template.id_template, numero_sequencial=numero_sequencial, contexto_tipo=contexto_tipo,
        id_contexto=id_contexto, id_pessoa=id_pessoa, variaveis_usadas=json.dumps(variaveis, default=str),
        caminho_arquivo=f"/{caminho_relativo}", id_usuario_emissao=id_usuario, codigo_verificacao=codigo_verificacao,
    )
    db.add(documento)
    db.commit()
    db.refresh(documento)
    return documento


def listar_documentos_emitidos(db: Session, *, contexto_tipo: Optional[str] = None, id_contexto: Optional[int] = None, id_pessoa: Optional[int] = None) -> list[DocumentoEmitido]:
    consulta = db.query(DocumentoEmitido)
    if contexto_tipo is not None:
        consulta = consulta.filter(DocumentoEmitido.contexto_tipo == contexto_tipo)
    if id_contexto is not None:
        consulta = consulta.filter(DocumentoEmitido.id_contexto == id_contexto)
    if id_pessoa is not None:
        consulta = consulta.filter(DocumentoEmitido.id_pessoa == id_pessoa)
    return consulta.order_by(DocumentoEmitido.numero_sequencial.desc()).all()
