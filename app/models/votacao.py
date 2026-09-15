"""v2.4 (FASE 2) - motor de votação. Duas peças de desenho deliberadas:

1. **Voto secreto de verdade**: `ComprovanteVotoSecreto` ("quem já votou", sem opção nenhuma) e
   `RegistroVotoSecreto` (a opção escolhida, com um identificador aleatório em vez de
   `id_associado`) são tabelas SEM NENHUMA COLUNA EM COMUM que ligue uma à outra - não existe
   junção possível nem por SQL direto de administrador. Em votação aberta/nominal, o vínculo é
   proposital (`VotoAberto` carrega `id_associado`) e aparece na ata (v2.5).

2. **Empate e impugnação não têm nenhuma previsão no `ESTATUTO_ASAF.txt`** (Art. 1º-35 não
   menciona nenhum dos dois) - diferente de quórum/prazo/mandato (v2.0), aqui não há artigo pra
   citar. `REGRA_DESEMPATE` (nova `RegraEstatutaria`, sem `artigo_origem`) e o prazo de recurso de
   impugnação são necessidade operacional da ASAF, não mandato estatutário - documentado como tal,
   não fingido como se tivesse base no texto."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint

from app.database import Base

ABERTA_NOMINAL = "Aberta/Nominal"
SECRETA = "Secreta"
ACLAMACAO = "Aclamação"
TIPOS_VOTACAO = {ABERTA_NOMINAL, SECRETA, ACLAMACAO}

MAIORIA_SIMPLES = "Maioria simples"
MAIORIA_ABSOLUTA = "Maioria absoluta"
QUALIFICADA = "Qualificada"
ESCRUTINIOS = {MAIORIA_SIMPLES, MAIORIA_ABSOLUTA, QUALIFICADA}

ABSTENCAO = "Abstenção"
BRANCO = "Branco"
OPCOES_RESERVADAS = {ABSTENCAO, BRANCO}

ABERTA = "Aberta"
ENCERRADA = "Encerrada"


class Votacao(Base):
    __tablename__ = "votacoes"
    id_votacao = Column(Integer, primary_key=True, index=True)
    id_item_pauta = Column(Integer, ForeignKey("itens_pauta.id_item"), nullable=False, index=True)
    titulo = Column(String, nullable=False)
    tipo = Column(String(20), nullable=False)
    escrutinio = Column(String(20), nullable=False)
    fracao_qualificada = Column(String(20), nullable=True)  # só quando escrutinio=Qualificada, ex. "2/3"
    opcoes_validas = Column(Text, nullable=False)  # CSV - lista de opções além de Abstenção/Branco (sempre disponíveis)
    considerar_abstencao_na_base = Column(Boolean, default=False)
    status = Column(String(20), default=ABERTA, index=True)
    quorum_instalacao_minimo = Column(Integer, nullable=True)  # snapshot no momento da abertura
    aberta_em = Column(DateTime, default=datetime.utcnow)
    encerrada_em = Column(DateTime, nullable=True)
    resultado_contagem = Column(Text, nullable=True)  # JSON {opcao: quantidade}
    resultado_hash = Column(String(64), nullable=True)  # SHA-256 hex
    vencedor = Column(String, nullable=True)
    aprovado = Column(Boolean, nullable=True)  # None = ainda aberta OU empate não resolvido
    empate = Column(Boolean, default=False)
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)


class VotoAberto(Base):
    """Voto aberto/nominal ou aclamação - vínculo pessoa↔voto é proposital aqui."""
    __tablename__ = "votos_abertos"
    __table_args__ = (UniqueConstraint("id_votacao", "id_associado", name="uq_voto_aberto_votacao_associado"),)
    id_voto = Column(Integer, primary_key=True, index=True)
    id_votacao = Column(Integer, ForeignKey("votacoes.id_votacao"), nullable=False, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"), nullable=False, index=True)
    opcao = Column(String, nullable=False)
    criado_em = Column(DateTime, default=datetime.utcnow)


class ComprovanteVotoSecreto(Base):
    """"Quem já votou" numa votação secreta - NUNCA guarda a opção escolhida."""
    __tablename__ = "comprovantes_voto_secreto"
    __table_args__ = (UniqueConstraint("id_votacao", "id_associado", name="uq_comprovante_votacao_associado"),)
    id_comprovante = Column(Integer, primary_key=True, index=True)
    id_votacao = Column(Integer, ForeignKey("votacoes.id_votacao"), nullable=False, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"), nullable=False, index=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class RegistroVotoSecreto(Base):
    """O voto em si, numa votação secreta - NUNCA guarda `id_associado` nem qualquer FK que
    ligue de volta a `ComprovanteVotoSecreto`. `identificador_aleatorio` existe só para permitir
    auditoria de contagem (cada linha é uma cédula), nunca para religar à pessoa."""
    __tablename__ = "registros_voto_secreto"
    id_registro = Column(Integer, primary_key=True, index=True)
    id_votacao = Column(Integer, ForeignKey("votacoes.id_votacao"), nullable=False, index=True)
    identificador_aleatorio = Column(String(64), unique=True, index=True, nullable=False)
    opcao = Column(String, nullable=False)
    criado_em = Column(DateTime, default=datetime.utcnow)


class Impugnacao(Base):
    """Impugnação/protesto de voto (sem previsão específica no estatuto - ver docstring do
    módulo; apoia-se no direito geral de recurso do Art. 13, V)."""
    __tablename__ = "impugnacoes_votacao"
    id_impugnacao = Column(Integer, primary_key=True, index=True)
    id_votacao = Column(Integer, ForeignKey("votacoes.id_votacao"), nullable=False, index=True)
    id_associado_impugnante = Column(Integer, ForeignKey("associados.id_associado"), nullable=False, index=True)
    motivo = Column(Text, nullable=False)
    prazo_recurso_ate = Column(DateTime, nullable=True)
    resolvida = Column(Boolean, default=False)
    resolucao = Column(Text, nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
