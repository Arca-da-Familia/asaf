"""v3.6 (FASE 3) - prestação de contas do exercício: um snapshot gerado (balancete + receitas x
despesas + parecer do Conselho Fiscal já emitido, v2.6, anexado), versionado - gerar de novo
NUNCA edita a versão anterior, sempre cria uma linha nova (mesmo espírito de `ValorPlanoContribuicao`/
`Ata` retificada: histórico completo preservado, nunca reescrito). Os demais relatórios do
intervalo (balancete, receitas x despesas, inadimplência, extrato, por projeto) são todos
calculados na hora contra o razão contábil - não têm tabela própria, ver
`app/services/relatorios.py`."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, Text, UniqueConstraint

from app.database import Base


class PrestacaoDeContas(Base):
    __tablename__ = "prestacoes_de_contas"
    __table_args__ = (
        UniqueConstraint("ano_exercicio", "versao", name="uq_prestacao_ano_versao"),
    )
    id_prestacao = Column(Integer, primary_key=True, index=True)
    ano_exercicio = Column(Integer, nullable=False, index=True)
    versao = Column(Integer, nullable=False)
    conteudo = Column(Text, nullable=False)
    id_parecer = Column(Integer, ForeignKey("pareceres_prestacao_contas.id_parecer"), nullable=True)
    id_usuario_geracao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    gerada_em = Column(DateTime, default=datetime.utcnow)
