"""v2.2 (FASE 2) - Assembleias: convocação e habilitação. Substitui o protótipo v0.1/v0.2 deste
mesmo arquivo (Assembleia/RegistroVoto/DocumentoInstitucional sem autenticação, sem permissão,
sem auditoria - nunca chegou a ganhar migração Alembic própria, então nunca existiu de fato em
produção; ver PLANO_PROJETO.md v2.2). Condução da sessão (credenciamento, quórum em tempo real -
v2.3) e o motor de votação de verdade (v2.4) ainda não existem - aqui só convocação e a lista de
habilitados, congelada no momento em que a convocação sai.

Tipos (Art. 5º): Ordinária, Extraordinária, Solene. Convocação (Art. 8º/10): pelo Presidente ou
por petição de 1/5 dos associados ativos - `PeticaoConvocacao`/`AdesaoPeticao` modelam esse
segundo caminho. Procuração (Art. 7º) é sempre vedada (`PROCURACAO_PERMITIDA`, v2.0) - não há
modelo de procuração aqui de propósito, só o parâmetro já existe pronto pra uma reforma futura."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint

from app.database import Base

ORDINARIA = "Ordinária"
EXTRAORDINARIA = "Extraordinária"
SOLENE = "Solene"
TIPOS_ASSEMBLEIA = {ORDINARIA, EXTRAORDINARIA, SOLENE}

RASCUNHO = "Rascunho"
CONVOCADA = "Convocada"
EM_ANDAMENTO = "Em andamento"
REALIZADA = "Realizada"
CANCELADA = "Cancelada"

ORIGEM_PRESIDENTE = "Presidente"
ORIGEM_PETICAO = "Petição"

COLETANDO_ADESOES = "Coletando adesões"
QUORUM_ATINGIDO = "Quórum atingido"
CONVERTIDA_EM_ASSEMBLEIA = "Convertida em assembleia"


class Assembleia(Base):
    __tablename__ = "assembleias"
    id_assembleia = Column(Integer, primary_key=True, index=True)
    tipo = Column(String(20), nullable=False)
    pauta = Column(Text, nullable=False)
    # Momento da 1ª chamada - 2ª e 3ª são calculadas na leitura (Art. 6º: 30 min após cada uma
    # anterior), nunca gravadas - ver app/services/assembleia.py.
    data_hora_convocacao = Column(DateTime, nullable=False)
    local_fisico = Column(String, nullable=True)
    link_remoto = Column(String, nullable=True)
    status = Column(String(20), default=RASCUNHO, index=True)
    origem_convocacao = Column(String(20), default=ORIGEM_PRESIDENTE)
    id_peticao_origem = Column(Integer, ForeignKey("peticoes_convocacao.id_peticao"), nullable=True)
    edital_texto = Column(Text, nullable=True)
    convocada_em = Column(DateTime, nullable=True)
    # v2.5.3b (achado do usuário 2026-09-15) - código de chamada, gerado só quando a sessão abre
    # (app/routers/governanca.py::abrir_sessao). Existe pra provar presença física na sala -
    # quem conduz anuncia/projeta o código, e só quem está lá consegue se autocredenciar com ele
    # (ver app/routers/chamada.py). Nunca exposto no serializador de leitura geral da assembleia
    # (get_current_user) - só num endpoint próprio, restrito a quem tem permissão `governanca`.
    codigo_chamada = Column(String(10), nullable=True)
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class HabilitadoAssembleia(Base):
    """Lista de habilitados a votar, calculada e CONGELADA no momento da convocação (nunca
    recalculada depois do fato - ver ponto de revisão da FASE 2). Critério é só o que o estatuto
    real tem (Art. 13 caput + Art. 4º): em dia com as obrigações e em pleno gozo dos direitos
    associativos - "categoria com direito a voto" e "tempo mínimo de filiação" foram descartados
    de propósito por não terem base no texto (ESTATUTO_ASAF.txt, Art. 1º-35)."""
    __tablename__ = "habilitados_assembleia"
    __table_args__ = (UniqueConstraint("id_assembleia", "id_associado", name="uq_habilitado_assembleia_associado"),)
    id_habilitado = Column(Integer, primary_key=True, index=True)
    id_assembleia = Column(Integer, ForeignKey("assembleias.id_assembleia"), nullable=False, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"), nullable=False, index=True)
    habilitado = Column(Boolean, nullable=False)
    motivo_inabilitacao = Column(String, nullable=True)
    status_arrolamento_no_momento = Column(String, nullable=True)
    congelado_em = Column(DateTime, default=datetime.utcnow)


class PeticaoConvocacao(Base):
    """v2.2 (Art. 8º/10 do estatuto, Art. 60 do Código Civil) - convocação por petição de 1/5
    dos associados ativos. Ao atingir o quórum de adesão, o pedido segue formalmente ao
    Presidente (Art. 10, Parágrafo Único), que tem `PRAZO_ATENDIMENTO_PEDIDO_CONVOCACAO_DIAS`
    (v2.0, hoje 30) para convocar; passado o prazo sem convocação, os próprios associados podem
    convocar - `pode_converter_sem_presidente` (app/services/assembleia.py) checa essa janela."""
    __tablename__ = "peticoes_convocacao"
    id_peticao = Column(Integer, primary_key=True, index=True)
    pauta_proposta = Column(Text, nullable=False)
    status = Column(String(30), default=COLETANDO_ADESOES, index=True)
    data_quorum_atingido = Column(DateTime, nullable=True)
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class AdesaoPeticao(Base):
    __tablename__ = "adesoes_peticao"
    __table_args__ = (UniqueConstraint("id_peticao", "id_associado", name="uq_adesao_peticao_associado"),)
    id_adesao = Column(Integer, primary_key=True, index=True)
    id_peticao = Column(Integer, ForeignKey("peticoes_convocacao.id_peticao"), nullable=False, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"), nullable=False, index=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
