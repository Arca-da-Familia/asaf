"""v3.7 (FASE 3) - fechamento mensal com conciliação obrigatória: saldo do sistema x saldo do
extrato bancário informado por quem conferiu. Diferente do fechamento de EXERCÍCIO (v3.0,
`Exercicio.status`), que fecha o ano inteiro pra lançamento novo - este é por competência
("AAAA-MM") e por Conta Financeira, e existe só pra registrar formalmente "alguém conferiu o
saldo deste mês contra o extrato e bateu" (ou a tentativa foi recusada por divergência aberta -
ver `app/services/fechamento.py::fechar_mes`). Nunca editado/apagado depois de criado - mesma
imutabilidade de `LancamentoContabil`; refazer é impossível por desenho (ver
`uq_fechamento_competencia_conta`), então uma conciliação errada exige revisão humana ANTES de
assinar, não depois."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint

from app.database import Base


class FechamentoMensal(Base):
    __tablename__ = "fechamentos_mensais"
    __table_args__ = (
        UniqueConstraint("competencia", "id_conta_financeira", name="uq_fechamento_competencia_conta"),
    )
    id_fechamento = Column(Integer, primary_key=True, index=True)
    competencia = Column(String(7), nullable=False, index=True)
    id_conta_financeira = Column(Integer, ForeignKey("contas_financeiras.id_conta_financeira"), nullable=False)
    saldo_sistema = Column(Numeric(14, 2), nullable=False)
    saldo_extrato_bancario = Column(Numeric(14, 2), nullable=False)
    divergencia = Column(Numeric(14, 2), nullable=False)
    id_usuario_conferencia = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    assinado_em = Column(DateTime, default=datetime.utcnow)
