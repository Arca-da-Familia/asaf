"""v2.5.3b (FASE 2.5 - Painel, achado do usuário 2026-09-15) - justificativa de falta em
assembleia. Presença/falta em si NÃO é um campo gravado em lugar nenhum: é sempre calculado na
leitura a partir de três fatos - credenciamento (v2.3, `Credenciamento`), justificativa aceita
(aqui) e status da assembleia (ver `app.services.chamada.status_presenca`) - mesmo princípio já
usado pro quórum de instalação (nunca um contador incrementado/decrementado manualmente, só
recalculado). O que precisa mesmo de tabela é o PEDIDO de justificativa e a decisão sobre ele."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint

from app.database import Base

PENDENTE = "Pendente"
ACEITA = "Aceita"
REJEITADA = "Rejeitada"
STATUS_JUSTIFICATIVA = {PENDENTE, ACEITA, REJEITADA}


class JustificativaFalta(Base):
    """Uma por (assembleia, associado) - do momento da convocação (edital) até o encerramento
    da sessão (ver validação no router). Quando lançada pelo próprio secretário/diretoria em nome
    do associado (achado do usuário: "app pode ter falhado"), já nasce `ACEITA` - a autoridade
    de quem lança é a mesma que decidiria depois; quando o próprio associado propõe, nasce
    `PENDENTE` e precisa de decisão de quem tem a permissão `governanca`."""
    __tablename__ = "justificativas_falta_assembleia"
    __table_args__ = (UniqueConstraint("id_assembleia", "id_associado", name="uq_justificativa_assembleia_associado"),)
    id_justificativa = Column(Integer, primary_key=True, index=True)
    id_assembleia = Column(Integer, ForeignKey("assembleias.id_assembleia"), nullable=False, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"), nullable=False, index=True)
    motivo = Column(Text, nullable=False)
    status = Column(String(20), default=PENDENTE, index=True)
    motivo_decisao = Column(Text, nullable=True)
    id_usuario_decisao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    decidido_em = Column(DateTime, nullable=True)
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
