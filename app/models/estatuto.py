"""v2.0 (FASE 2) - o estatuto como configuração, não como código. Nenhum quórum, prazo ou
mandato fica escrito em código: cada parâmetro estatutário vira uma linha de `RegraEstatutaria`,
versionada por vigência - uma assembleia de 2027 continua auditável pelas regras de 2027 mesmo
depois de uma reforma de estatuto em 2031. `DocumentoEstatuto` guarda a referência do estatuto
vigente (registro em cartório) ao qual cada regra se liga via `id_documento_estatuto`.

Diferente de `ConfiguracaoInstitucional` (v0.3.4): aquela guarda só "o valor atual" de uma
chave, sem histórico de vigência. Aqui o histórico É o ponto - uma reforma de estatuto nunca faz
UPDATE no valor de uma regra, só fecha a linha vigente (`vigencia_fim`) e abre uma nova (ver
`app.services.estatuto`). Cláusulas pétreas (data magna, versículos-base, oração oficial) NÃO
entram aqui - são identidade institucional, não regra operacional, e ficam em
`ConfiguracaoInstitucional` (categoria "identidade"), como o estatuto real determina (Art. 33)."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String

from app.database import Base


class DocumentoEstatuto(Base):
    """Estatuto vigente anexado e versionado. A eficácia perante terceiros vem do registro em
    cartório (ver v13.4) - aqui só se guarda a referência para auditoria e para ligar cada
    `RegraEstatutaria` ao documento que a originou."""
    __tablename__ = "documentos_estatuto"
    id_documento_estatuto = Column(Integer, primary_key=True, index=True)
    versao = Column(String(20), nullable=False)
    numero_registro_cartorio = Column(String, nullable=False)
    comarca_registro = Column(String, nullable=True)
    data_registro = Column(DateTime, nullable=True)
    caminho_arquivo = Column(String, nullable=True)
    vigente = Column(Boolean, default=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class RegraEstatutaria(Base):
    """Cada parâmetro estatutário (quórum, prazo, mandato, procuração...) versionado por
    vigência. `parametro` é a chave técnica estável que o código consulta (ver
    `app.services.estatuto.obter_regra_vigente`) - nunca o número cru. `vigencia_fim` nulo
    significa "vigente"; uma reforma futura fecha a linha atual e insere uma nova, preservando o
    histórico completo (nunca UPDATE de `valor` numa linha já vigente no passado)."""
    __tablename__ = "regras_estatutarias"
    id_regra = Column(Integer, primary_key=True, index=True)
    parametro = Column(String(80), nullable=False, index=True)
    valor = Column(String, nullable=False)
    tipo = Column(String(20), default="texto")  # texto, numero, booleano, fracao
    categoria = Column(String(50), default="regras")
    descricao = Column(String, nullable=True)
    artigo_origem = Column(String(50), nullable=True)
    id_documento_estatuto = Column(Integer, ForeignKey("documentos_estatuto.id_documento_estatuto"), nullable=True)
    vigencia_inicio = Column(DateTime, nullable=False, default=datetime.utcnow)
    vigencia_fim = Column(DateTime, nullable=True)
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
