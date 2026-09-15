"""v2.8 (FASE 2) - dissolução (Art. 31 do estatuto, Art. 61 do Código Civil). Diferente do que o
checklist original temia ("regra de deliberação pelos associados, se o estatuto for silente"), o
estatuto real NÃO é silente: Art. 31, Parágrafo Único diz que os bens remanescentes vão para uma
entidade congênere com sede/atividade preponderante em Parauapebas/PA, mais de 2 anos de
existência e devidamente credenciada - critério, não nome de entidade específica (a entidade de
verdade só é escolhida no momento da dissolução, obedecendo esse critério).

"Espera-se nunca usar" - por isso o roteiro é um rastreador de etapas sequenciais e auditadas,
não uma automação: liquidação do passivo e destinação de bens dependem de módulos que ainda não
existem (FASE 3/financeiro maduro, FASE 12/patrimônio) - o sistema garante que a ORDEM e a
JUSTIFICATIVA de cada etapa ficam registradas, sem fingir automatizar o que não pode."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text

from app.database import Base

ABERTO = "Aberto"
DELIBERADA = "Deliberada"
LIQUIDACAO_CONCLUIDA = "Liquidação concluída"
PATRIMONIO_DESTINADO = "Patrimônio destinado"
BAIXA_CADASTRAL_CONCLUIDA = "Baixa cadastral concluída"
CANCELADO = "Cancelado"


class ProcessoDissolucao(Base):
    __tablename__ = "processos_dissolucao"
    id_processo_dissolucao = Column(Integer, primary_key=True, index=True)
    motivo = Column(Text, nullable=False)
    status = Column(String(30), default=ABERTO, index=True)
    id_deliberacao = Column(Integer, ForeignKey("deliberacoes.id_deliberacao"), nullable=True)
    deliberada_em = Column(DateTime, nullable=True)
    liquidacao_observacao = Column(Text, nullable=True)
    liquidacao_concluida_em = Column(DateTime, nullable=True)
    entidade_destinataria_nome = Column(String, nullable=True)
    entidade_destinataria_cnpj = Column(String, nullable=True)
    entidade_destinataria_justificativa = Column(Text, nullable=True)
    # As três confirmações do Art. 31, Parágrafo Único - todas obrigatórias antes de destinar.
    confirma_sede_parauapebas = Column(Boolean, nullable=True)
    confirma_anos_minimos = Column(Boolean, nullable=True)
    confirma_credenciada = Column(Boolean, nullable=True)
    patrimonio_destinado_em = Column(DateTime, nullable=True)
    baixa_cadastral_observacao = Column(Text, nullable=True)
    baixa_cadastral_em = Column(DateTime, nullable=True)
    motivo_cancelamento = Column(Text, nullable=True)
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
