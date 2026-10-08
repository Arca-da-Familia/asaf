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

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint

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
    # v5.4h - o que a pessoa declarou no formulário público do site: ciência do aviso de privacidade (com a versão do texto, que o servidor
    # confere) e, de 16 a 17 anos, a declaração de que tem a autorização expressa dos pais ou responsáveis (o papel é conferido pela secretaria)
    consentimento_lgpd_em = Column(DateTime, nullable=True)
    consentimento_lgpd_versao = Column(String(20), nullable=True)
    autorizacao_responsavel_declarada = Column(Boolean, nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
    atualizado_em = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# v5.4h - Estatuto Art. 12, par. único VI: o pedido de adesão tem de ser PROPOSTO por 3 sócios. Cada sócio apto decide uma vez por pedido (propõe ou
# recusa, com o motivo); a decisão pode ser mudada enquanto o pedido está aberto. Só quem PROPÕE conta para os 3.
PROPOE = "Propõe"
RECUSA = "Recusa"
PROPONENTES_EXIGIDOS = 3


class PropostaDeSocio(Base):
    __tablename__ = "propostas_de_socios"
    __table_args__ = (UniqueConstraint("id_proposta", "id_associado", name="uq_proposta_de_socio"),)
    id_proposta_socio = Column(Integer, primary_key=True, index=True)
    id_proposta = Column(Integer, ForeignKey("propostas_filiacao.id_proposta"), nullable=False, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"), nullable=False, index=True)
    decisao = Column(String(10), nullable=False)
    observacao = Column(String, nullable=True)
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
    atualizado_em = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
