from datetime import datetime
from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Float

from app.database import Base

class PlanoDeContas(Base):
    __tablename__ = "plano_de_contas"
    id_conta = Column(Integer, primary_key=True, index=True)
    codigo_contabil = Column(String, unique=True, index=True)
    descricao_conta = Column(String) 
    tipo = Column(String) 

class Fornecedor(Base):
    __tablename__ = "fornecedores"
    id_fornecedor = Column(Integer, primary_key=True, index=True)
    razao_social = Column(String, index=True)
    cnpj = Column(String, unique=True, index=True)
    categoria_servico = Column(String) 
    telefone = Column(String)

class TituloFinanceiro(Base):
    __tablename__ = "titulos_financeiros"
    id_titulo = Column(Integer, primary_key=True, index=True)
    tipo_titulo = Column(String) 
    id_conta_contabil = Column(Integer, ForeignKey("plano_de_contas.id_conta"))
    id_associado = Column(Integer, ForeignKey("associados.id_associado"), nullable=True) 
    id_fornecedor = Column(Integer, ForeignKey("fornecedores.id_fornecedor"), nullable=True)
    descricao = Column(String)
    valor_original = Column(Float)
    saldo_devedor = Column(Float)
    data_emissao = Column(DateTime, default=datetime.utcnow)
    data_vencimento = Column(DateTime)
    status = Column(String, default="Pendente") 

class TransacaoCaixa(Base):
    __tablename__ = "livro_caixa_auditoria"
    id_transacao = Column(Integer, primary_key=True, index=True)
    id_titulo = Column(Integer, ForeignKey("titulos_financeiros.id_titulo"), nullable=True) 
    id_conta_contabil = Column(Integer, ForeignKey("plano_de_contas.id_conta"))
    tipo_movimento = Column(String) 
    valor_efetivado = Column(Float)
    data_registro_servidor = Column(DateTime, default=datetime.utcnow) 
    forma_pagamento = Column(String) 
    status_auditoria = Column(String, default="Pendente de Conciliação") 
    observacao_auditoria = Column(String, nullable=True)

