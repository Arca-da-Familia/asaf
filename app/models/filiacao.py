"""v1.2 (FASE 1) - proposta de filiação: intenção -> triagem -> efetivação. O formulário
público de verdade (no site institucional) é FASE 5, ainda não construída - este modelo e os
endpoints em app/routers/filiacao.py já funcionam via API hoje, prontos para o site consumir
quando existir (não é um esqueleto vazio esperando FASE 5: dá pra propor, conferir, aprovar e
recusar uma filiação de ponta a ponta agora, só falta o HTML público).

Aprovação hoje é sempre feita por quem tem a permissão `associados` (Diretoria/Presidente) - o
plano prevê "aprovação pela diretoria OU assembleia, conforme o estatuto", mas votação de
assembleia é FASE 2 (Governança), ainda não construída; não há o que rotear pra assembleia
ainda. Quando a FASE 2 existir, este é o lugar certo pra conectar um caminho alternativo de
aprovação - registrado aqui em vez de fingir uma distinção que não pode ser aplicada hoje."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String

from app.database import Base

PENDENTE = "Pendente"
EM_CONFERENCIA = "Em Conferência"
APROVADA = "Aprovada"
RECUSADA = "Recusada"


class PropostaFiliacao(Base):
    __tablename__ = "propostas_filiacao"
    id_proposta = Column(Integer, primary_key=True, index=True)
    nome_completo = Column(String, nullable=False)
    cpf = Column(String, nullable=False, index=True)
    email_contato = Column(String, nullable=True)
    telefone_whatsapp = Column(String, nullable=True)
    data_nascimento = Column(DateTime, nullable=True)
    status = Column(String, default=PENDENTE, index=True)
    motivo_recusa = Column(String, nullable=True)
    id_associado_efetivado = Column(Integer, ForeignKey("associados.id_associado"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
    atualizado_em = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
