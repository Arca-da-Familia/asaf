"""v5.4a (FASE 5) - biblioteca de DOCUMENTOS INSTITUCIONAIS, fonte da verdade do que o site de transparência mostra.

Decisão do usuário (2026-10-03): documento oficial (ata, estatuto, certidão, balanço, termo de fomento...) mora no
SISTEMA, não no Directus (o Directus é só o editor do site). O site apenas MOSTRA uma cópia aprovada. Como ata e
termo trazem RG/CPF/endereço de gente e PDF não se edita, cada documento tem:

  - ORIGINAL: o arquivo como é, em armazenamento PRIVADO (download só autenticado e por permissão, sempre auditado);
  - VERSÃO PÚBLICA: outro arquivo, com os dados pessoais cobertos de verdade, que só vai ao site depois de passar
    pelo verificador automático (app/services/documentos_verificacao.py) e ser APROVADA por outra pessoa;
  - CLASSIFICAÇÃO (Pública/Interna/Restrita) e SITUAÇÃO DE PUBLICAÇÃO (rascunho -> em revisão -> aprovado -> retirado).

Versões: um mesmo documento (`grupo_versao`) pode ter várias versões (estatuto reformado, balanço retificado);
só uma é a vigente. Nada se apaga: retirar do site preserva o histórico."""
from datetime import datetime

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, String, Text

from app.database import Base

# --- tipo do documento (código estável; o rótulo vem de TIPOS)
ESTATUTO = "ESTATUTO"
ATA = "ATA"
CERTIDAO = "CERTIDAO"
CNPJ = "CNPJ"
BALANCO = "BALANCO"
RELATORIO_ANUAL = "RELATORIO_ANUAL"
CONSELHO = "CONSELHO"
TERMO_FOMENTO = "TERMO_FOMENTO"
PLANO_TRABALHO = "PLANO_TRABALHO"
ADITIVO = "ADITIVO"
PRESTACAO_CONTAS = "PRESTACAO_CONTAS"
OFICIO = "OFICIO"
OUTRO = "OUTRO"
TIPOS = {
    ESTATUTO: "Estatuto e alterações",
    ATA: "Ata",
    CERTIDAO: "Certidão",
    CNPJ: "Cartão CNPJ",
    BALANCO: "Balanço / prestação de contas anual",
    RELATORIO_ANUAL: "Relatório anual de atividades",
    CONSELHO: "Inscrição em conselho",
    TERMO_FOMENTO: "Termo de fomento / colaboração",
    PLANO_TRABALHO: "Plano de trabalho",
    ADITIVO: "Aditivo",
    PRESTACAO_CONTAS: "Prestação de contas de parceria",
    OFICIO: "Ofício",
    OUTRO: "Outro documento",
}

# --- classificação: só PÚBLICA pode ter o original no site; as outras só vão ao site por uma versão pública aprovada
PUBLICA = "Pública"
INTERNA = "Interna"
RESTRITA = "Restrita"
CLASSIFICACOES = (PUBLICA, INTERNA, RESTRITA)

# --- situação de publicação
RASCUNHO = "Rascunho"
EM_REVISAO = "Em revisão"
APROVADO = "Aprovado"  # no site
RETIRADO = "Retirado"  # já esteve no site; saiu, histórico preservado
SITUACOES = (RASCUNHO, EM_REVISAO, APROVADO, RETIRADO)

# --- a que o documento se liga (sem chave estrangeira de propósito: aponta para tabelas de módulos diferentes)
VINCULOS = ("ata", "estatuto", "parceria", "projeto", "evento", "assembleia")


class DocumentoInstitucional(Base):
    __tablename__ = "documentos_institucionais"
    id_documento = Column(Integer, primary_key=True, index=True)
    tipo = Column(String(30), nullable=False, index=True)
    titulo = Column(String(200), nullable=False)
    descricao = Column(Text, nullable=True)
    data_documento = Column(Date, nullable=True)
    ano = Column(Integer, nullable=True, index=True)
    validade = Column(Date, nullable=True)  # certidão: alerta de vencimento (v12.2)
    classificacao = Column(String(10), nullable=False, default=INTERNA, index=True)
    publicar_no_site = Column(Boolean, nullable=False, default=False)
    vinculo_tipo = Column(String(20), nullable=True, index=True)
    vinculo_id = Column(Integer, nullable=True, index=True)

    # versões do mesmo documento
    grupo_versao = Column(String(32), nullable=False, index=True)
    versao = Column(Integer, nullable=False, default=1)
    vigente = Column(Boolean, nullable=False, default=False, index=True)

    # ORIGINAL (armazenamento privado)
    original_nome = Column(String(150), nullable=True)  # nome opaco (uuid) no armazenamento
    original_nome_arquivo = Column(String(200), nullable=True)  # como a pessoa chamou o arquivo (para o "salvar como")
    original_sha256 = Column(String(64), nullable=True)
    original_tamanho = Column(Integer, nullable=True)

    # VERSÃO PÚBLICA (armazenamento privado até ser aprovada; servida só por rota que confere a situação)
    publico_nome = Column(String(150), nullable=True)
    publico_sha256 = Column(String(64), nullable=True)
    publico_tamanho = Column(Integer, nullable=True)
    publico_paginas = Column(Integer, nullable=True)
    publico_texto = Column(Text, nullable=True)  # texto extraído, para busca
    verificacao_ok = Column(Boolean, nullable=True)
    verificacao_json = Column(Text, nullable=True)  # bloqueios/avisos, sempre com amostra MASCARADA
    verificacao_em = Column(DateTime, nullable=True)

    # publicação
    situacao = Column(String(15), nullable=False, default=RASCUNHO, index=True)
    id_usuario_envio_revisao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    enviado_revisao_em = Column(DateTime, nullable=True)
    id_usuario_aprovacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    aprovado_em = Column(DateTime, nullable=True)
    motivo_recusa = Column(Text, nullable=True)
    id_usuario_recusa = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    recusado_em = Column(DateTime, nullable=True)
    motivo_retirada = Column(Text, nullable=True)
    id_usuario_retirada = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    retirado_em = Column(DateTime, nullable=True)

    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
    atualizado_em = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
