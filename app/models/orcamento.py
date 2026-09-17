"""v3.5 (FASE 3) - orçamento anual por conta contábil e centro de custo, sempre aprovado em
assembleia (vinculado à `Deliberacao` que aprovou, v2.5 - nunca um orçamento "de gaveta" sem
respaldo de quem tem poder pra aprová-lo) e reserva de contingência como conta financeira própria
(nunca "fundo perdido" numa planilha à parte), com regra de uso registrada por escrito."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint

from app.database import Base


class Orcamento(Base):
    """Uma linha de orçamento = quanto se planeja gastar/arrecadar numa conta contábil (e,
    opcionalmente, num centro de custo específico) em um ano. O realizado NUNCA é guardado aqui -
    é sempre calculado contra `PartidaContabil` na hora (ver
    `app/services/orcamento.py::realizado_do_orcamento`), mesma disciplina de `ContaFinanceira`
    (v3.1): nenhum número duplicado que possa dessincronizar do razão contábil de verdade."""
    __tablename__ = "orcamentos"
    __table_args__ = (
        UniqueConstraint("ano", "id_conta_contabil", "id_centro_custo", name="uq_orcamento_ano_conta_centro"),
    )
    id_orcamento = Column(Integer, primary_key=True, index=True)
    ano = Column(Integer, nullable=False, index=True)
    id_conta_contabil = Column(Integer, ForeignKey("plano_de_contas.id_conta"), nullable=False)
    id_centro_custo = Column(Integer, ForeignKey("centros_de_custo.id_centro_custo"), nullable=True)
    valor_previsto = Column(Numeric(14, 2), nullable=False)
    id_deliberacao = Column(Integer, ForeignKey("deliberacoes.id_deliberacao"), nullable=False)
    id_usuario_registro = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class ReservaContingencia(Base):
    """Reserva de contingência = uma `ContaFinanceira` (v3.1) já existente, marcada como reserva,
    com a regra de quando pode ser usada registrada em texto - qualquer movimentação nela
    continua sendo um lançamento contábil normal (débito/crédito de verdade), a regra aqui é só o
    texto que quem aprova a retirada consulta antes de aprovar (mesmo espírito do termo de
    negociação de dívida, v3.2.2: processo humano documentado, não travado em código - travar de
    verdade exigiria prever toda exceção legítima de antemão, o que é pior que confiar em quem
    aprova ler a regra)."""
    __tablename__ = "reservas_contingencia"
    id_reserva = Column(Integer, primary_key=True, index=True)
    id_conta_financeira = Column(Integer, ForeignKey("contas_financeiras.id_conta_financeira"), unique=True, nullable=False)
    regra_uso = Column(Text, nullable=False)
    valor_minimo = Column(Numeric(14, 2), nullable=True)
    id_deliberacao = Column(Integer, ForeignKey("deliberacoes.id_deliberacao"), nullable=True)
    id_usuario_registro = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
