"""v1.8 (FASE 1) - qualidade permanente da base: detector de duplicidade contínuo (não só na
importação, como a v1.3 já cobria) e higienização de contato, ambos alimentando a MESMA fila de
revisão para a secretaria decidir - o sistema nunca mescla nem descarta nada sozinho."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String

from app.database import Base

DUPLICIDADE_NOME_NASCIMENTO = "duplicidade_nome_nascimento"
CONTATO_TELEFONE_INVALIDO = "contato_telefone_invalido"
CONTATO_EMAIL_SUSPEITO = "contato_email_suspeito"

PENDENTE = "pendente"
IGNORADO = "ignorado"
MESCLADO = "mesclado"
CORRIGIDO = "corrigido"


class FilaRevisaoCadastro(Base):
    __tablename__ = "fila_revisao_cadastro"
    id_fila = Column(Integer, primary_key=True, index=True)
    tipo_sinal = Column(String(30), nullable=False)
    id_pessoa_a = Column(Integer, ForeignKey("pessoas.id_pessoa"), nullable=False, index=True)
    # Nulo para sinais de UMA pessoa só (ex.: telefone com formato inválido) - só sinais de
    # duplicidade (que envolvem DUAS pessoas candidatas) preenchem isto.
    id_pessoa_b = Column(Integer, ForeignKey("pessoas.id_pessoa"), nullable=True, index=True)
    detalhe = Column(String, nullable=True)
    status = Column(String(20), nullable=False, default=PENDENTE)
    criado_em = Column(DateTime, default=datetime.utcnow)
    resolvido_em = Column(DateTime, nullable=True)
    id_usuario_resolveu = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
