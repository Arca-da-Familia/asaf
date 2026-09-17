"""v3.4 (FASE 3) - doações, captação e recibos. Doação monetária vira `TituloFinanceiro`/
`LancamentoContabil` de verdade (nunca um número solto), com destinação opcional a um
`CentroDeCusto` "restrito" (ver `CentroDeCusto.saldo_restrito` em app/models/financeiro.py) - o
sistema BLOQUEIA gastar esse saldo em outra finalidade (checado na aprovação de compra, v3.3),
exigindo `RemanejamentoDestinacao` formal e auditado pra mudar de finalidade. Recibo numerado
emitido automaticamente no registro (ver app/services/doacoes.py). Doação em bens fica só
registrada em valor avaliado - integração com patrimônio de verdade é a FASE 12 (v12.4), ainda
não existe."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text

from app.database import Base


class CampanhaArrecadacao(Base):
    """v3.4 - meta, prazo e progresso (soma das doações vinculadas) - publicação no site
    institucional é a FASE 5, ainda não existe; por ora só a gestão administrativa."""
    __tablename__ = "campanhas_arrecadacao"
    id_campanha = Column(Integer, primary_key=True, index=True)
    titulo = Column(String, nullable=False)
    descricao = Column(Text, nullable=True)
    meta_valor = Column(Numeric(14, 2), nullable=False)
    prazo = Column(DateTime, nullable=True)
    id_centro_custo = Column(Integer, ForeignKey("centros_de_custo.id_centro_custo"), nullable=True)
    ativa = Column(Boolean, default=True, nullable=False)
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class Doacao(Base):
    __tablename__ = "doacoes"
    id_doacao = Column(Integer, primary_key=True, index=True)
    anonima = Column(Boolean, default=False, nullable=False)
    nome_doador = Column(String, nullable=True)  # NULL quando anônima
    documento_doador = Column(String, nullable=True)  # CPF/CNPJ, NULL quando anônima
    id_associado = Column(Integer, ForeignKey("associados.id_associado"), nullable=True)  # quando o doador já é associado
    tipo_doacao = Column(String, nullable=False)  # "Monetaria" | "Bens"
    recorrente = Column(Boolean, default=False, nullable=False)
    valor = Column(Numeric(14, 2), nullable=False)  # em Bens, é o valor avaliado
    descricao_bem = Column(String, nullable=True)  # só quando tipo_doacao == "Bens"
    id_campanha = Column(Integer, ForeignKey("campanhas_arrecadacao.id_campanha"), nullable=True)
    # v3.4 - destinação específica (opcional): quando preenchido, aponta pra um CentroDeCusto
    # "restrito" - o valor só pode ser gasto ali (ver bloqueio na aprovação de compra, v3.3).
    id_centro_custo_destinacao = Column(Integer, ForeignKey("centros_de_custo.id_centro_custo"), nullable=True)
    id_conta_contabil = Column(Integer, ForeignKey("plano_de_contas.id_conta"), nullable=False)  # Receita
    id_titulo = Column(Integer, ForeignKey("titulos_financeiros.id_titulo"), nullable=True)  # só Monetária
    numero_recibo = Column(Integer, nullable=True, unique=True, index=True)
    id_usuario_registro = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    data_doacao = Column(DateTime, default=datetime.utcnow)


class RemanejamentoDestinacao(Base):
    """v3.4 - realocação FORMAL e auditada de saldo restrito entre destinações (centros de
    custo) - é o único jeito de usar o saldo de uma doação com destinação específica em outra
    finalidade, nunca um ajuste silencioso."""
    __tablename__ = "remanejamentos_destinacao"
    id_remanejamento = Column(Integer, primary_key=True, index=True)
    id_centro_custo_origem = Column(Integer, ForeignKey("centros_de_custo.id_centro_custo"), nullable=False)
    id_centro_custo_destino = Column(Integer, ForeignKey("centros_de_custo.id_centro_custo"), nullable=False)
    valor = Column(Numeric(14, 2), nullable=False)
    motivo = Column(Text, nullable=False)
    id_usuario_registro = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    data_remanejamento = Column(DateTime, default=datetime.utcnow)
