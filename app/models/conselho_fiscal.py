"""v2.6 (FASE 2) - Conselho Fiscal como órgão com poder real: parecer sobre prestação de contas
e fila de questionamentos sobre lançamento financeiro. `ano_exercicio` é um inteiro solto (não FK
para um `Exercicio` de verdade) de propósito - o modelo formal de exercício contábil é FASE 3/
v3.0, que ainda não existe; fingir uma FK pra tabela que não existe seria pior que não ter FK
nenhuma. Quando v3.0 existir, isto ganha a FK de verdade."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text

from app.database import Base

FAVORAVEL = "Favorável"
COM_RESSALVA = "Com ressalva"
CONTRARIO = "Contrário"
TIPOS_PARECER = {FAVORAVEL, COM_RESSALVA, CONTRARIO}

ABERTO = "Aberto"
RESPONDIDO = "Respondido"


class ParecerPrestacaoContas(Base):
    __tablename__ = "pareceres_prestacao_contas"
    id_parecer = Column(Integer, primary_key=True, index=True)
    ano_exercicio = Column(Integer, nullable=False, index=True)
    tipo = Column(String(20), nullable=False)
    texto = Column(Text, nullable=False)
    id_associado_conselheiro = Column(Integer, ForeignKey("associados.id_associado"), nullable=False, index=True)
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class QuestionamentoLancamento(Base):
    __tablename__ = "questionamentos_lancamento"
    id_questionamento = Column(Integer, primary_key=True, index=True)
    id_titulo = Column(Integer, ForeignKey("titulos_financeiros.id_titulo"), nullable=False, index=True)
    id_associado_questionador = Column(Integer, ForeignKey("associados.id_associado"), nullable=False, index=True)
    pergunta = Column(Text, nullable=False)
    status = Column(String(20), default=ABERTO, index=True)
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class RespostaQuestionamento(Base):
    """Histórico preservado: cada resposta é uma linha nova, nunca edição da anterior - fila de
    pergunta/resposta pode ter ida e volta (conselheiro reabre com nova dúvida, tesouraria
    responde de novo)."""
    __tablename__ = "respostas_questionamento"
    id_resposta = Column(Integer, primary_key=True, index=True)
    id_questionamento = Column(Integer, ForeignKey("questionamentos_lancamento.id_questionamento"), nullable=False, index=True)
    texto = Column(Text, nullable=False)
    id_usuario_resposta = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


# v5.4h - Auditoria financeira: o Conselho Fiscal aprova, reprova ou ressalva cada título do mês. Cada decisão é uma linha nova (nunca
# edição da anterior); a decisão VIGENTE de um conselheiro é a mais recente dele naquele título. Reprovar e ressalvar abrem um
# questionamento (a fila que a tesouraria já responde), e é esse questionamento aberto que suspende o título.
APROVADO = "Aprovado"
REPROVADO = "Reprovado"
DECISOES_AUDITORIA = {APROVADO, REPROVADO, COM_RESSALVA}


class AuditoriaDeTitulo(Base):
    __tablename__ = "auditorias_de_titulo"
    id_auditoria = Column(Integer, primary_key=True, index=True)
    id_titulo = Column(Integer, ForeignKey("titulos_financeiros.id_titulo"), nullable=False, index=True)
    id_associado_conselheiro = Column(Integer, ForeignKey("associados.id_associado"), nullable=False, index=True)
    decisao = Column(String(20), nullable=False)
    observacao = Column(Text, nullable=True)
    id_questionamento = Column(Integer, ForeignKey("questionamentos_lancamento.id_questionamento"), nullable=True)
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
