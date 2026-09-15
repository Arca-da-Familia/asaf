from datetime import datetime
from sqlalchemy import Boolean, Column, Integer, String, ForeignKey, DateTime, Numeric, UniqueConstraint
from sqlalchemy.orm import relationship

from app.database import Base

class PlanoDeContas(Base):
    """v3.0 - `tipo` é um dos cinco tipos contábeis reais (Ativo, Passivo, Patrimônio Líquido,
    Receita, Despesa - catálogo `tipo_conta_contabil`, ver app/database.py::seed_catalogos), do
    qual deriva a natureza devedora/credora da conta (ver `natureza_da_conta` em
    app/services/contabilidade.py - não guardada como coluna de propósito, pra nunca poder ficar
    dessincronizada do `tipo` depois de uma edição). Conta sintética x analítica (hierarquia,
    só a analítica recebe lançamento) é v3.1."""
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

class Exercicio(Base):
    """v3.0 - ano contábil com abertura/fechamento formal. Exercício fechado não aceita
    lançamento novo (ver `exigir_exercicio_aberto` em app/services/contabilidade.py) - ajuste só
    por lançamento no exercício corrente, igual à contabilidade real."""
    __tablename__ = "exercicios_contabeis"
    id_exercicio = Column(Integer, primary_key=True, index=True)
    ano = Column(Integer, unique=True, index=True, nullable=False)
    status = Column(String, default="Aberto", nullable=False)
    data_abertura = Column(DateTime, default=datetime.utcnow)
    data_fechamento = Column(DateTime, nullable=True)
    id_usuario_abertura = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    id_usuario_fechamento = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)

class TituloFinanceiro(Base):
    __tablename__ = "titulos_financeiros"
    id_titulo = Column(Integer, primary_key=True, index=True)
    tipo_titulo = Column(String)
    id_conta_contabil = Column(Integer, ForeignKey("plano_de_contas.id_conta"))
    id_associado = Column(Integer, ForeignKey("associados.id_associado"), nullable=True)
    id_fornecedor = Column(Integer, ForeignKey("fornecedores.id_fornecedor"), nullable=True)
    descricao = Column(String)
    valor_original = Column(Numeric(14, 2))
    saldo_devedor = Column(Numeric(14, 2))
    data_emissao = Column(DateTime, default=datetime.utcnow)
    data_vencimento = Column(DateTime)
    status = Column(String, default="Pendente")

class LancamentoContabil(Base):
    """v3.0 - lançamento do razão contábil em partida dobrada real: um cabeçalho com N
    `PartidaContabil` (linhas de débito/crédito), sempre balanceado (soma dos débitos = soma dos
    créditos - garantido em app/services/contabilidade.py::criar_lancamento, nunca confiar em
    entrada direta). Numerado sequencialmente por exercício (nunca reaproveitado, nunca
    reordenado). Imutável: nunca editado nem apagado - correção é sempre estorno (novo
    lançamento com débito/crédito invertidos) + o original marcado `estornado`, nunca removido -
    ambos ficam visíveis no razão (ver `estornar_lancamento` em app/services/contabilidade.py)."""
    __tablename__ = "lancamentos_contabeis"
    id_lancamento = Column(Integer, primary_key=True, index=True)
    id_exercicio = Column(Integer, ForeignKey("exercicios_contabeis.id_exercicio"), nullable=False)
    numero_sequencial = Column(Integer, nullable=False)
    id_titulo = Column(Integer, ForeignKey("titulos_financeiros.id_titulo"), nullable=True)
    historico = Column(String, nullable=False)
    tipo_origem = Column(String, nullable=False)
    forma_pagamento = Column(String, nullable=True)
    id_usuario_lancamento = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    data_lancamento = Column(DateTime, default=datetime.utcnow)
    estornado = Column(Boolean, default=False, nullable=False)
    motivo_estorno = Column(String, nullable=True)
    id_lancamento_estorno = Column(Integer, ForeignKey("lancamentos_contabeis.id_lancamento"), nullable=True)

    partidas = relationship("PartidaContabil", back_populates="lancamento", order_by="PartidaContabil.id_partida")

    __table_args__ = (
        UniqueConstraint("id_exercicio", "numero_sequencial", name="uq_lancamento_numero_por_exercicio"),
    )

class PartidaContabil(Base):
    """v3.0 - uma linha de débito ou crédito de um `LancamentoContabil`. Nunca existe sozinha:
    todo lançamento tem no mínimo uma partida de débito e uma de crédito, com a mesma soma dos
    dois lados (validado em app/services/contabilidade.py, nunca confiar em entrada direta)."""
    __tablename__ = "partidas_contabeis"
    id_partida = Column(Integer, primary_key=True, index=True)
    id_lancamento = Column(Integer, ForeignKey("lancamentos_contabeis.id_lancamento"), nullable=False)
    id_conta = Column(Integer, ForeignKey("plano_de_contas.id_conta"), nullable=False)
    tipo_partida = Column(String, nullable=False)  # "Debito" | "Credito" - ver app/services/contabilidade.py
    valor = Column(Numeric(14, 2), nullable=False)

    lancamento = relationship("LancamentoContabil", back_populates="partidas")
