"""v4.1 (FASE 4) - Projeto como entidade única e configurável. `ProjetoEvento`/`projetos_eventos`
é o nome herdado do protótipo v0.1/v0.2 - mantido aqui de propósito (não renomeado) porque
`CentroDeCusto.id_projeto` (v3.1), `app/services/relatorios.py::relatorio_por_projeto` (v3.6) e
`EventoCalendario` (v2.9) já apontam pra ele; renomear a tabela agora trocaria FK/nome em módulos
já testados e em produção sem necessidade real. Quando a v4.5 (Evento como entidade própria)
chegar, a decisão de separar de vez "Projeto" e "Evento" em tabelas diferentes é revisitada com
esse nome em mente - não decidida aqui por antecipação."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint

from app.database import Base

# Status DERIVADO de um ItemCronograma (nunca escolhido à mão) - não confundir com o catálogo
# `status_projeto`, que é do Projeto em si (codificado em maiúsculas, ex.: "PLANEJAMENTO").
STATUS_PENDENTE = "Pendente"
STATUS_CONCLUIDO = "Concluído"
STATUS_ATRASADO = "Atrasado"


class ProjetoEvento(Base):
    __tablename__ = "projetos_eventos"
    id_projeto = Column(Integer, primary_key=True, index=True)
    nome_projeto = Column(String, index=True)
    tipo_foco = Column(String)
    fase_pdca = Column(String, default="Plan (Planejamento)")
    data_inicio = Column(DateTime)
    data_fim_prevista = Column(DateTime)
    necessita_alvara_bombeiros = Column(Boolean, default=False)
    status_liberacao = Column(String, default="Não Aplicável")
    # v4.1 - campos que fazem de Projeto uma entidade única e configurável de verdade (antes só
    # existiam nome/tipo/datas/alvará, um protótipo v0.1/v0.2 sem proteção nenhuma - ver achado
    # da v2.9, resolvido nesta versão).
    descricao = Column(Text, nullable=True)
    tipo_projeto = Column(String, nullable=True)  # catálogo `tipo_projeto` (já existia desde antes desta versão)
    status = Column(String, nullable=False, default="PLANEJAMENTO")  # catálogo `status_projeto`
    id_associado_responsavel = Column(Integer, ForeignKey("associados.id_associado"), nullable=True)
    publico_alvo = Column(String, nullable=True)
    id_centro_custo = Column(Integer, ForeignKey("centros_de_custo.id_centro_custo"), nullable=True)
    visibilidade = Column(String, nullable=False, default="Interna")  # "Pública" | "Interna"
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class AlocacaoVoluntario(Base):
    """v2.9 - alocação de voluntário (Associado) em projeto, `app/services/projetos.py::alocar_voluntario`
    já exigia termo de adesão vigente (v1.6) como trava real desde então.

    v4.4 - escala de voluntariado de verdade: turno/horário, habilidades exigidas (CSV do catálogo
    `habilidade_voluntario`, comparadas com `Pessoa.habilidades` na candidatura, mas sem bloquear -
    só informativo, quem bloqueia é o termo vigente), horas previstas x realizadas, e status (a
    alocação pode nascer `PENDENTE` de uma autocandidatura do próprio voluntário pelo painel,
    esperando confirmação do coordenador do projeto - `EquipeProjeto.papel == "COORDENADOR"`, ver
    `app/services/projetos.py::exigir_coordenador_do_projeto`) - ou já nascer `CONFIRMADA`, quando
    é a própria equipe quem aloca direto (fluxo antigo, mantido)."""
    __tablename__ = "alocacoes_voluntarios"
    id_alocacao = Column(Integer, primary_key=True, index=True)
    id_projeto = Column(Integer, ForeignKey("projetos_eventos.id_projeto"))
    id_associado = Column(Integer, ForeignKey("associados.id_associado"))
    funcao_desempenhada = Column(String)
    id_vaga = Column(Integer, ForeignKey("vagas_escala_voluntario.id_vaga"), nullable=True)
    turno_data_hora_inicio = Column(DateTime, nullable=True)
    turno_data_hora_fim = Column(DateTime, nullable=True)
    habilidades_exigidas = Column(String, nullable=True)  # CSV catálogo `habilidade_voluntario`
    horas_previstas = Column(Float, default=0.0)
    horas_realizadas = Column(Float, default=0.0)
    status = Column(String, nullable=False, default="CONFIRMADA")  # catálogo `status_alocacao_voluntario`
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class VagaEscalaVoluntario(Base):
    """v4.4 - vaga de turno publicada pelo coordenador do projeto, para autocandidatura do
    voluntário pelo painel (autoatendimento) - a vaga em si não é a alocação, é a "oferta"; cada
    candidatura vira uma linha própria em `AlocacaoVoluntario` (`id_vaga` aponta pra aqui),
    permitindo `vagas_disponiveis > 1` (mais de um voluntário no mesmo turno)."""
    __tablename__ = "vagas_escala_voluntario"
    id_vaga = Column(Integer, primary_key=True, index=True)
    id_projeto = Column(Integer, ForeignKey("projetos_eventos.id_projeto"), nullable=False, index=True)
    funcao_desempenhada = Column(String, nullable=False)
    habilidades_exigidas = Column(String, nullable=True)  # CSV catálogo `habilidade_voluntario`
    turno_data_hora_inicio = Column(DateTime, nullable=False)
    turno_data_hora_fim = Column(DateTime, nullable=False)
    vagas_disponiveis = Column(Integer, nullable=False, default=1)
    horas_previstas = Column(Float, default=0.0)
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class TrocaTurnoVoluntario(Base):
    """v4.4 - troca de turno entre voluntários: quem está alocado pede a troca por outro
    associado (que precisa ter termo de adesão vigente também), o coordenador do projeto confirma
    ou recusa - nunca uma troca automática sem confirmação, mesmo entre dois voluntários que já
    concordaram entre si informalmente."""
    __tablename__ = "trocas_turno_voluntario"
    id_troca = Column(Integer, primary_key=True, index=True)
    id_alocacao = Column(Integer, ForeignKey("alocacoes_voluntarios.id_alocacao"), nullable=False, index=True)
    id_associado_substituto = Column(Integer, ForeignKey("associados.id_associado"), nullable=False)
    status = Column(String, nullable=False, default="SOLICITADA")  # catálogo `status_troca_turno`
    motivo = Column(String, nullable=True)
    id_usuario_solicitacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    id_usuario_resolucao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
    resolvido_em = Column(DateTime, nullable=True)


class ItemCronograma(Base):
    """Marco (data-alvo sem "dono" único) ou tarefa (tem responsável) do cronograma do projeto.
    **Nunca guarda status** - "Pendente"/"Em Andamento"/"Concluído"/"Atrasado" é sempre
    CALCULADO a partir de `prazo`/`concluido_em` (ver `app/services/projetos.py::status_item_cronograma`)
    contra a data de hoje, exatamente como o requisito pede ("status derivado do andamento real,
    não escolhido à mão") - a mesma disciplina já usada pra `status_arrolamento` (v1.1) e pra
    quórum de assembleia (nunca um campo que alguém marca à mão e que pode ficar desatualizado)."""
    __tablename__ = "itens_cronograma_projeto"
    id_item = Column(Integer, primary_key=True, index=True)
    id_projeto = Column(Integer, ForeignKey("projetos_eventos.id_projeto"), nullable=False, index=True)
    tipo = Column(String, nullable=False)  # "Marco" | "Tarefa"
    titulo = Column(String, nullable=False)
    id_associado_responsavel = Column(Integer, ForeignKey("associados.id_associado"), nullable=True)
    prazo = Column(DateTime, nullable=False)
    concluido_em = Column(DateTime, nullable=True)
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class EquipeProjeto(Base):
    """Quem compõe a equipe de um projeto, com papel e período - base real pra permissão
    contextual futura ("coordenador só vê beneficiários do projeto dele", preparação pro RLS da
    FASE 15). `data_fim` nula = ainda ativo na equipe."""
    __tablename__ = "equipe_projeto"
    id_membro = Column(Integer, primary_key=True, index=True)
    id_projeto = Column(Integer, ForeignKey("projetos_eventos.id_projeto"), nullable=False, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"), nullable=False, index=True)
    papel = Column(String, nullable=False)  # catálogo `papel_equipe_projeto`
    data_inicio = Column(DateTime, default=datetime.utcnow)
    data_fim = Column(DateTime, nullable=True)
    id_usuario_registro = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)


class RelatorioFinalProjeto(Base):
    """Encerramento formal do projeto - um snapshot gerado (resultados x metas via motor de
    indicadores v4.0, execução financeira via `Orcamento` v3.5 quando o projeto tiver centro de
    custo), **versionado**: gerar de novo nunca edita a versão anterior, sempre cria uma linha
    nova - mesmo padrão de `PrestacaoDeContas` (v3.6)/`Ata` retificada. Arquivado e reutilizável
    em prestação de contas a doador e em edital futuro (v12.6)."""
    __tablename__ = "relatorios_finais_projeto"
    __table_args__ = (
        UniqueConstraint("id_projeto", "versao", name="uq_relatorio_final_projeto_versao"),
    )
    id_relatorio = Column(Integer, primary_key=True, index=True)
    id_projeto = Column(Integer, ForeignKey("projetos_eventos.id_projeto"), nullable=False, index=True)
    versao = Column(Integer, nullable=False)
    conteudo = Column(Text, nullable=False)
    id_usuario_geracao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    gerado_em = Column(DateTime, default=datetime.utcnow)
