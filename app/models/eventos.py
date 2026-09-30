"""v4.5 (FASE 4) - Evento como entidade única e pontual: `titulo`/`descricao`/data/hora/local
(reaproveita `Espaco` da v4.3 quando o evento é num espaço próprio, ou `endereco_avulso` em
texto quando não é), responsável, categoria (catálogo `tipo_evento`, já seedado desde a v4.3 e
nunca usado até agora), vagas (só metadado - a trava real de limite sob concorrência é a v4.7,
não inventada aqui por antecipação) e visibilidade (`"Pública"`/`"Interna"`, mesma convenção de
`ProjetoEvento.visibilidade`, v4.1). **Um evento é UM registro só**, consumido pelo painel (gestão)
e pelo site institucional (leitura pública) - nunca duas tabelas pra representar a mesma coisa,
exatamente como o item do plano exige.

Inscrição (evento inteiro ou por sessão) reaproveita o motor genérico da v4.0
(`app/models/motores.py::Inscricao`, `contexto_tipo="Evento"`/`"SessaoEvento"`) - já existia desde
a v4.0, nunca tinha um consumidor real até esta versão. A deduplicação por CPF e o formulário
público (v4.6) e o limite de vagas sob concorrência real (v4.7) ficam para as próximas versões,
documentado aqui como pendência, não fingido."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint

from app.database import Base

# v4.6 - tipos de pergunta personalizada do formulário de inscrição pública. Sem tabela própria
# de resposta - a resposta mora em `Inscricao.respostas_formulario` (JSON, chave = id_pergunta),
# mesmo raciocínio genérico de `ValorCampo` (v0.3.3) já usado noutro lugar do projeto.
TIPO_PERGUNTA_TEXTO_CURTO = "TEXTO_CURTO"
TIPO_PERGUNTA_TEXTO_LONGO = "TEXTO_LONGO"
TIPO_PERGUNTA_SELECAO_UNICA = "SELECAO_UNICA"
TIPO_PERGUNTA_SELECAO_MULTIPLA = "SELECAO_MULTIPLA"
TIPO_PERGUNTA_NUMERO = "NUMERO"
TIPO_PERGUNTA_DATA = "DATA"
TIPO_PERGUNTA_ARQUIVO = "ARQUIVO"
TIPOS_PERGUNTA_EVENTO = {
    TIPO_PERGUNTA_TEXTO_CURTO, TIPO_PERGUNTA_TEXTO_LONGO, TIPO_PERGUNTA_SELECAO_UNICA,
    TIPO_PERGUNTA_SELECAO_MULTIPLA, TIPO_PERGUNTA_NUMERO, TIPO_PERGUNTA_DATA, TIPO_PERGUNTA_ARQUIVO,
}


class Evento(Base):
    __tablename__ = "eventos"
    id_evento = Column(Integer, primary_key=True, index=True)
    titulo = Column(String, nullable=False)
    descricao = Column(Text, nullable=True)
    categoria = Column(String, nullable=False)  # catálogo `tipo_evento`
    data_hora_inicio = Column(DateTime, nullable=False)
    data_hora_fim = Column(DateTime, nullable=True)
    id_espaco = Column(Integer, ForeignKey("espacos.id_espaco"), nullable=True)
    endereco_avulso = Column(String, nullable=True)
    id_associado_responsavel = Column(Integer, ForeignKey("associados.id_associado"), nullable=True)
    vagas = Column(Integer, nullable=True)  # nulo = sem limite declarado
    # v4.7 - trava real de vaga sob concorrência: `vagas_ocupadas` só muda por UPDATE atômico
    # condicionado (`app/services/vagas.py::reservar_vaga`/`liberar_vaga` - "WHERE vagas_ocupadas
    # < vagas", nunca SELECT-conta-depois-INSERT, que teria brecha de corrida). Só usado quando
    # NENHUMA `CotaInscricaoEvento` está configurada pra este evento - cota configurada assume o
    # controle da própria categoria.
    vagas_ocupadas = Column(Integer, nullable=False, default=0)
    gratuito = Column(Boolean, nullable=False, default=True)
    visibilidade = Column(String, nullable=False, default="Interna")  # "Pública" | "Interna"
    # v4.5 - edições recorrentes ligadas entre si: "a 3ª edição conhece as anteriores" é isto -
    # cada nova edição aponta pra edição imediatamente anterior, formando uma cadeia percorrível
    # (ver app/services/eventos.py::listar_cadeia_edicoes), nunca uma cópia solta sem vínculo.
    id_edicao_anterior = Column(Integer, ForeignKey("eventos.id_evento"), nullable=True)
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
    # v4.8 - elegibilidade ao certificado (ver app/services/certificados.py::calcular_elegibilidade):
    # `carga_horaria_horas` declarada = percentual calculado por horas presentes (check-in/check-out
    # reais) sobre o total; nula = cai pro cálculo por sessão, ou desabilita o certificado se o
    # evento também não tem `SessaoEvento`. `percentual_minimo_certificado` nulo = usa o padrão
    # global (`ConfiguracaoInstitucional.PERCENTUAL_MINIMO_CERTIFICADO_PADRAO`), preenchido =
    # sobrescreve só para este evento.
    carga_horaria_horas = Column(Numeric(6, 2), nullable=True)
    percentual_minimo_certificado = Column(Numeric(5, 2), nullable=True)
    # v4.9 - cobrança de inscrição integrada à FASE 3. `valor_base` nulo = evento continua
    # gratuito (comportamento de sempre, `gratuito=True`) - ver app/services/cobranca_evento.py
    # pra faixa por categoria/data, cupom e isenção por cima deste valor. `id_centro_custo`
    # opcional: liga toda cobrança/reembolso/despesa deste evento a um `CentroDeCusto` (espelha
    # `CentroDeCusto.id_projeto`, v3.1) pra "resultado por centro de custo" sair de graça de
    # `app/services/relatorios.py::receitas_e_despesas_por_centro_custo`.
    valor_base = Column(Numeric(10, 2), nullable=True)
    id_conta_contabil_receita = Column(Integer, ForeignKey("plano_de_contas.id_conta"), nullable=True)
    id_centro_custo = Column(Integer, ForeignKey("centros_de_custo.id_centro_custo"), nullable=True)
    # v4.9 - reembolso por cancelamento de inscrição paga, mesmo par de campos de
    # `Espaco.prazo_cancelamento_horas`/`percentual_reembolso_cancelamento` (consistência entre os
    # dois consumidores que a v4.9 cobra). `percentual_reembolso_cancelamento` nulo = usa o padrão
    # global (`PERCENTUAL_REEMBOLSO_CANCELAMENTO_PADRAO`, mesma convenção de elegibilidade v4.8).
    prazo_cancelamento_horas = Column(Integer, nullable=False, default=24)
    percentual_reembolso_cancelamento = Column(Numeric(5, 2), nullable=True)


class SessaoEvento(Base):
    """Programação do evento (congresso de um dia, várias atividades) - nunca exige criar
    "vários eventos" pra isso, é sempre UM `Evento` com N sessões. Inscrição por sessão usa o
    mesmo motor genérico com `contexto_tipo="SessaoEvento"`, quando fizer sentido (evento simples,
    sem programação, inscreve no `Evento` direto)."""
    __tablename__ = "sessoes_evento"
    id_sessao = Column(Integer, primary_key=True, index=True)
    id_evento = Column(Integer, ForeignKey("eventos.id_evento"), nullable=False, index=True)
    titulo = Column(String, nullable=False)
    descricao = Column(Text, nullable=True)
    data_hora_inicio = Column(DateTime, nullable=False)
    data_hora_fim = Column(DateTime, nullable=True)
    vagas = Column(Integer, nullable=True)
    vagas_ocupadas = Column(Integer, nullable=False, default=0)  # v4.7 - mesmo mecanismo de Evento.vagas_ocupadas
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class CotaInscricaoEvento(Base):
    """v4.7 - cota por categoria (ex.: X vagas pra associados, Y pra comunidade externa) num
    evento ou sessão. Quando existe ao menos uma cota pra um `contexto_tipo`/`id_contexto`, ELA
    passa a controlar a vaga daquela categoria (`Evento.vagas`/`SessaoEvento.vagas` genérico é
    ignorado pra quem cai numa categoria com cota própria); sem nenhuma cota configurada, o
    limite genérico do evento/sessão continua valendo pra todo mundo, como desde a v4.5."""
    __tablename__ = "cotas_inscricao_evento"
    __table_args__ = (
        UniqueConstraint("contexto_tipo", "id_contexto", "categoria", name="uq_cota_inscricao_contexto_categoria"),
    )
    id_cota = Column(Integer, primary_key=True, index=True)
    contexto_tipo = Column(String, nullable=False, index=True)
    id_contexto = Column(Integer, nullable=False, index=True)
    categoria = Column(String, nullable=False)  # catálogo `categoria_cota_inscricao`
    vagas_limite = Column(Integer, nullable=False)
    vagas_ocupadas = Column(Integer, nullable=False, default=0)


class PerguntaEvento(Base):
    """Pergunta personalizada do formulário de inscrição pública (v4.6) - texto curto/longo,
    seleção única/múltipla, número, data ou arquivo, com resposta obrigatória configurável por
    pergunta. `opcoes` é CSV (mesmo padrão de `Votacao.opcoes_validas`), só usado pelos dois tipos
    de seleção."""
    __tablename__ = "perguntas_evento"
    id_pergunta = Column(Integer, primary_key=True, index=True)
    id_evento = Column(Integer, ForeignKey("eventos.id_evento"), nullable=False, index=True)
    enunciado = Column(String, nullable=False)
    tipo = Column(String, nullable=False)
    opcoes = Column(Text, nullable=True)  # CSV - só pra SELECAO_UNICA/SELECAO_MULTIPLA
    obrigatoria = Column(Boolean, nullable=False, default=True)
    ordem = Column(Integer, nullable=False, default=0)
