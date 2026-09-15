"""v2.5 (FASE 2) - ata, deliberações e efeitos. `Ata` nunca é editada depois de assinada -
correção só por ata de retificação nova, vinculada à original (`id_ata_retificada`), mesma lógica
de estorno já usada no financeiro (nunca apagar/reescrever histórico, sempre um novo registro que
aponta pro que corrige). `Deliberacao` existe pra assembleia que delibera não virar assembleia que
ninguém executa - fica "Pendente" até concluída ou formalmente revogada, nunca esquecida."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text

from app.database import Base

RASCUNHO = "Rascunho"
ASSINADA = "Assinada"

PENDENTE = "Pendente"
CONCLUIDA = "Concluída"
REVOGADA = "Revogada"

ELEICAO = "Eleição"
REFORMA_ESTATUTO = "Reforma de estatuto"
APROVACAO_CONTAS = "Aprovação de contas"
DISSOLUCAO = "Dissolução"  # v2.8 - Art. 31: 2/3 dos presentes, quórum próprio (v2.0)
GENERICA = "Genérica"
TIPOS_DELIBERACAO = {ELEICAO, REFORMA_ESTATUTO, APROVACAO_CONTAS, DISSOLUCAO, GENERICA}


class Ata(Base):
    __tablename__ = "atas"
    id_ata = Column(Integer, primary_key=True, index=True)
    id_assembleia = Column(Integer, ForeignKey("assembleias.id_assembleia"), nullable=False, index=True)
    numero_sequencial = Column(Integer, unique=True, nullable=True, index=True)  # só atribuído na assinatura
    corpo_texto = Column(Text, nullable=False)
    relato_secretaria = Column(Text, nullable=True)
    status = Column(String(20), default=RASCUNHO, index=True)
    assinada_em = Column(DateTime, nullable=True)
    id_usuario_assinatura = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    id_ata_retificada = Column(Integer, ForeignKey("atas.id_ata"), nullable=True)
    motivo_retificacao = Column(Text, nullable=True)
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class Deliberacao(Base):
    __tablename__ = "deliberacoes"
    id_deliberacao = Column(Integer, primary_key=True, index=True)
    id_ata = Column(Integer, ForeignKey("atas.id_ata"), nullable=False, index=True)
    id_item_pauta = Column(Integer, ForeignKey("itens_pauta.id_item"), nullable=True)
    id_votacao = Column(Integer, ForeignKey("votacoes.id_votacao"), nullable=True)
    # v2.6 - só usado quando tipo=APROVACAO_CONTAS: exige parecer do Conselho Fiscal já emitido
    # para este ano antes de a deliberação poder ser criada (ver app/routers/ata.py).
    ano_exercicio = Column(Integer, nullable=True)
    tipo = Column(String(30), nullable=False)
    texto = Column(Text, nullable=False)
    status_execucao = Column(String(20), default=PENDENTE, index=True)
    id_associado_responsavel = Column(Integer, ForeignKey("associados.id_associado"), nullable=True)
    prazo_execucao = Column(DateTime, nullable=True)
    concluida_em = Column(DateTime, nullable=True)
    observacao_conclusao = Column(Text, nullable=True)
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class CertidaoDeliberacao(Base):
    """Extrato de UMA deliberação, numerado e emitido sob demanda - evita mandar a ata inteira
    pra quem só precisa de uma linha (ex.: banco pedindo prova de quem é o novo Presidente)."""
    __tablename__ = "certidoes_deliberacao"
    id_certidao = Column(Integer, primary_key=True, index=True)
    id_deliberacao = Column(Integer, ForeignKey("deliberacoes.id_deliberacao"), nullable=False, index=True)
    numero_sequencial = Column(Integer, unique=True, nullable=False, index=True)
    texto_gerado = Column(Text, nullable=False)
    id_usuario_emissao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    emitida_em = Column(DateTime, default=datetime.utcnow)
