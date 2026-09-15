"""v2.7 (FASE 2) - processo disciplinar. Diferente do que o rascunho original do plano temia
("estatuto vago"), o `ESTATUTO_ASAF.txt` trata disciplina de forma bem concreta: Art. 16
(motivos, ampla defesa) e Art. 17 (as três penas - Advertência/Suspensão/Eliminação - e quem
decide). O que o estatuto de fato não define são os números de prazo - `PRAZO_DEFESA_DIAS`
(nova `RegraEstatutaria`, sem `artigo_origem`, confirmado com o usuário em 15 dias) é o único
parâmetro inventado aqui, documentado como tal.

Decisões confirmadas com o usuário (2026-09-15): (1) processo ABERTO não suspende o direito de
voto por si só - só a PENA de suspensão efetivamente aplicada afeta o voto (via
`status_arrolamento`, já uma categoria calculável desde a v1.1/v2.2); (2) processo comum é
decidido por maioria da Diretoria Executiva (mesmo padrão do Art. 17, Parágrafo Único, que já
usa "demais membros da Diretoria" para o caso de diretor/conselheiro acusado) - o acusado, mesmo
sendo diretor, nunca vota no próprio processo."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint

from app.database import Base

ADVERTENCIA = "Advertência"
SUSPENSAO = "Suspensão"
ELIMINACAO = "Eliminação do quadro social"
PENAS = {ADVERTENCIA, SUSPENSAO, ELIMINACAO}

ABERTO = "Aberto"
EM_JULGAMENTO = "Em julgamento"
DECIDIDO = "Decidido"
ARQUIVADO = "Arquivado"
AGUARDANDO_HOMOLOGACAO = "Aguardando homologação da Assembleia"
HOMOLOGADO = "Homologado"
REJEITADO_PELA_ASSEMBLEIA = "Rejeitado pela Assembleia"


class ProcessoDisciplinar(Base):
    __tablename__ = "processos_disciplinares"
    id_processo = Column(Integer, primary_key=True, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"), nullable=False, index=True)
    motivo_codigo = Column(String(50), nullable=False)  # catálogo motivo_processo_disciplinar (Art. 16, §1º)
    descricao = Column(Text, nullable=False)
    status = Column(String(40), default=ABERTO, index=True)
    data_abertura = Column(DateTime, default=datetime.utcnow)
    prazo_defesa_ate = Column(DateTime, nullable=False)
    defesa_texto = Column(Text, nullable=True)
    defesa_apresentada_em = Column(DateTime, nullable=True)
    pena_aplicada = Column(String(40), nullable=True)
    escalada_automatica = Column(Boolean, default=False)  # Art. 17, I - 4ª advertência virou suspensão sozinha
    suspensao_dias = Column(Integer, nullable=True)
    data_fim_suspensao = Column(DateTime, nullable=True)
    decisao_texto = Column(Text, nullable=True)
    decidido_em = Column(DateTime, nullable=True)
    id_deliberacao_homologacao = Column(Integer, ForeignKey("deliberacoes.id_deliberacao"), nullable=True)
    homologado_em = Column(DateTime, nullable=True)
    id_usuario_abertura = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class ManifestacaoDiretoria(Base):
    """Voto individual de um membro da Diretoria Executiva sobre a pena - `pena_proposta=None`
    significa "arquivar, sem pena". O acusado nunca aparece aqui mesmo que tenha mandato vigente
    de diretor (trava no router, não só convenção)."""
    __tablename__ = "manifestacoes_diretoria_disciplinar"
    __table_args__ = (UniqueConstraint("id_processo", "id_associado_diretor", name="uq_manifestacao_processo_diretor"),)
    id_manifestacao = Column(Integer, primary_key=True, index=True)
    id_processo = Column(Integer, ForeignKey("processos_disciplinares.id_processo"), nullable=False, index=True)
    id_associado_diretor = Column(Integer, ForeignKey("associados.id_associado"), nullable=False, index=True)
    pena_proposta = Column(String(40), nullable=True)
    justificativa = Column(Text, nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
