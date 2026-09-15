"""v2.3 (FASE 2) - condução da sessão de assembleia: credenciamento (presença, presencial ou
remota - híbrida é caso de primeira classe, mesmo credenciamento pras duas modalidades, só a
`modalidade` muda), pauta item a item com controle de abertura/encerramento, e registro de
ocorrências. O motor de votação de verdade (`Votacao`, apuração, voto secreto) é v2.4, ainda não
existe - aqui só o controle de "este item está em votação agora ou não", sem contar voto nenhum."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint

from app.database import Base

PRESENCIAL = "Presencial"
REMOTO = "Remoto"
MODALIDADES_CREDENCIAMENTO = {PRESENCIAL, REMOTO}

AGUARDANDO = "Aguardando"
EM_DISCUSSAO = "Em discussão"
EM_VOTACAO = "Em votação"
ENCERRADO = "Encerrado"
STATUS_ITEM_PAUTA = {AGUARDANDO, EM_DISCUSSAO, EM_VOTACAO, ENCERRADO}


class Credenciamento(Base):
    """Presença de um associado na sessão - registra QUALQUER associado presente, habilitado a
    votar ou não (associado inadimplente pode comparecer, só não conta pro quórum). O cruzamento
    com `HabilitadoAssembleia` (v2.2, congelada na convocação) acontece na leitura, em
    `app.services.sessao_assembleia.quorum_instalacao_atual` - nunca gravado aqui."""
    __tablename__ = "credenciamentos_assembleia"
    __table_args__ = (UniqueConstraint("id_assembleia", "id_associado", name="uq_credenciamento_assembleia_associado"),)
    id_credenciamento = Column(Integer, primary_key=True, index=True)
    id_assembleia = Column(Integer, ForeignKey("assembleias.id_assembleia"), nullable=False, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"), nullable=False, index=True)
    modalidade = Column(String(20), nullable=False)
    hora_entrada = Column(DateTime, default=datetime.utcnow)
    hora_saida = Column(DateTime, nullable=True)
    id_usuario_registro = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)


class ItemPauta(Base):
    """Item individual da pauta da assembleia - a `Assembleia.pauta` (v2.2) continua sendo o
    texto corrido do edital (Art. 9º), este é o desdobramento operacional pra mesa controlar item
    a item durante a sessão."""
    __tablename__ = "itens_pauta"
    id_item = Column(Integer, primary_key=True, index=True)
    id_assembleia = Column(Integer, ForeignKey("assembleias.id_assembleia"), nullable=False, index=True)
    ordem = Column(Integer, default=0)
    titulo = Column(String, nullable=False)
    descricao = Column(Text, nullable=True)
    tempo_fala_minutos = Column(Integer, nullable=True)
    status = Column(String(20), default=AGUARDANDO, index=True)
    aberto_em = Column(DateTime, nullable=True)
    encerrado_em = Column(DateTime, nullable=True)


class OcorrenciaSessao(Base):
    __tablename__ = "ocorrencias_sessao"
    id_ocorrencia = Column(Integer, primary_key=True, index=True)
    id_assembleia = Column(Integer, ForeignKey("assembleias.id_assembleia"), nullable=False, index=True)
    id_item_pauta = Column(Integer, ForeignKey("itens_pauta.id_item"), nullable=True)
    descricao = Column(Text, nullable=False)
    id_usuario_registro = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
