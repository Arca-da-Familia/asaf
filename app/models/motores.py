"""v4.0 (FASE 4) - motores compartilhados, construídos uma vez e usados por tudo: sem isso, os
mesmos quatro/cinco mecanismos seriam reimplementados em projeto, evento, aula (FASE 14) e
assembleia (FASE 2) - quatro versões divergentes da mesma regra é como um sistema envelhece mal.

`contexto_tipo`/`id_contexto` (e `recurso_tipo`/`id_recurso` no motor de agenda) são a PRIMEIRA
associação polimórfica deste projeto - até aqui, todo relacionamento era FK explícita por tipo
(ex.: `CentroDeCusto.id_projeto`). Decisão deliberada aqui: estes cinco motores existem
EXATAMENTE pra serem genéricos entre entidades que não existem ainda (projeto/evento nascem só na
v4.1/v4.5, aula só na FASE 14) - uma FK explícita pra cada consumidor futuro exigiria alterar o
motor toda vez que uma fase nova aparecesse, o oposto do que "motor compartilhado" quer dizer.
`contexto_tipo` é sempre uma string curta e estável (ex.: "Assembleia", "Projeto", "Evento",
"Turma") - nunca o nome da tabela SQL, pra sobreviver a um rename de tabela sem quebrar dado
histórico.

`Credenciamento` (v2.5.3, `app/models/sessao_assembleia.py`) já resolve presença de assembleia
com FK explícita e está carregando cálculo de quórum - **não migrado** pra `RegistroPresenca`
aqui (fora de escopo, risco desnecessário numa peça já travada da governança); `RegistroPresenca`
serve só consumidores NOVOS (projeto/evento desta fase, aula da FASE 14)."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint

from app.database import Base


class RegistroPresenca(Base):
    """Motor de presença/check-in único. `hora_saida` nula = ainda presente/não registrou saída
    (nem todo contexto exige saída - uma palestra de 1h pode nunca pedir check-out)."""
    __tablename__ = "registros_presenca"
    id_registro = Column(Integer, primary_key=True, index=True)
    contexto_tipo = Column(String, nullable=False, index=True)
    id_contexto = Column(Integer, nullable=False, index=True)
    id_pessoa = Column(Integer, ForeignKey("pessoas.id_pessoa"), nullable=False, index=True)
    hora_entrada = Column(DateTime, nullable=False, default=datetime.utcnow)
    hora_saida = Column(DateTime, nullable=True)
    meio_registro = Column(String, nullable=False)
    id_usuario_operador = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)


PRE_INSCRITO = "Pré-inscrito"
CONFIRMADO = "Confirmado"
LISTA_DE_ESPERA = "Lista de Espera"
CANCELADO = "Cancelado"
PRESENTE = "Presente"
AUSENTE = "Ausente"
STATUS_INSCRICAO = {PRE_INSCRITO, CONFIRMADO, LISTA_DE_ESPERA, CANCELADO, PRESENTE, AUSENTE}


class Inscricao(Base):
    """Motor de inscrição genérico. Uma pessoa só tem UMA inscrição por contexto (não duas linhas
    concorrentes pro mesmo evento) - reinscrever depois de cancelar reaproveita a linha, nunca
    cria outra (ver `app/services/inscricao.py::inscrever`). `respostas_formulario` é JSON em
    texto (formulário dinâmico por contexto, sem tabela própria de resposta - o mesmo raciocínio
    de `ValorCampo` genérico, v0.3.3, já usado noutro lugar do projeto)."""
    __tablename__ = "inscricoes"
    __table_args__ = (
        UniqueConstraint("contexto_tipo", "id_contexto", "id_pessoa", name="uq_inscricao_contexto_pessoa"),
    )
    id_inscricao = Column(Integer, primary_key=True, index=True)
    contexto_tipo = Column(String, nullable=False, index=True)
    id_contexto = Column(Integer, nullable=False, index=True)
    id_pessoa = Column(Integer, ForeignKey("pessoas.id_pessoa"), nullable=False, index=True)
    status = Column(String, nullable=False, default=PRE_INSCRITO)
    respostas_formulario = Column(Text, nullable=True)
    id_titulo_cobranca = Column(Integer, ForeignKey("titulos_financeiros.id_titulo"), nullable=True)
    data_inscricao = Column(DateTime, default=datetime.utcnow)


class TemplateDocumento(Base):
    """Motor de documento gerado. `corpo_texto` guarda variáveis no formato `{{nome_variavel}}`,
    substituídas na emissão (ver `app/services/documentos.py::emitir_documento`) - certificado de
    voluntariado, de participação em evento e de conclusão de curso são o MESMO motor com
    template diferente, nunca três geradores de PDF separados."""
    __tablename__ = "templates_documento"
    id_template = Column(Integer, primary_key=True, index=True)
    codigo = Column(String, unique=True, nullable=False, index=True)
    nome = Column(String, nullable=False)
    corpo_texto = Column(Text, nullable=False)
    ativo = Column(Boolean, default=True, nullable=False)


class DocumentoEmitido(Base):
    """Registro de emissão - numerado sequencialmente, nunca reaproveitado - com o que foi emitido
    pra quem e quando. `variaveis_usadas` (JSON em texto) preserva o valor exato de cada variável
    NO MOMENTO da emissão - o template pode mudar depois sem afetar o que já foi emitido."""
    __tablename__ = "documentos_emitidos"
    id_documento = Column(Integer, primary_key=True, index=True)
    id_template = Column(Integer, ForeignKey("templates_documento.id_template"), nullable=False)
    numero_sequencial = Column(Integer, nullable=False, unique=True, index=True)
    contexto_tipo = Column(String, nullable=True, index=True)
    id_contexto = Column(Integer, nullable=True, index=True)
    id_pessoa = Column(Integer, ForeignKey("pessoas.id_pessoa"), nullable=True)
    variaveis_usadas = Column(Text, nullable=True)
    caminho_arquivo = Column(String, nullable=False)
    id_usuario_emissao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    emitida_em = Column(DateTime, default=datetime.utcnow)


class Indicador(Base):
    """Motor de indicadores. `contexto_tipo`/`id_contexto` nulos = indicador institucional (não
    amarrado a um projeto/área específica) - aplicável a projeto, evento, área e plano
    estratégico (v12.9) sem tabela nova cada vez."""
    __tablename__ = "indicadores"
    id_indicador = Column(Integer, primary_key=True, index=True)
    nome = Column(String, nullable=False)
    unidade = Column(String, nullable=False)
    meta = Column(Numeric(14, 2), nullable=True)
    periodicidade = Column(String, nullable=False)
    contexto_tipo = Column(String, nullable=True, index=True)
    id_contexto = Column(Integer, nullable=True, index=True)
    ativo = Column(Boolean, default=True, nullable=False)


class MedicaoIndicador(Base):
    """Uma medição por período por indicador - repetir a medição do mesmo período é erro de
    operação, nunca duplicação silenciosa (`UniqueConstraint` no banco, mesma disciplina de
    `TituloFinanceiro`/geração em lote)."""
    __tablename__ = "medicoes_indicador"
    __table_args__ = (
        UniqueConstraint("id_indicador", "periodo", name="uq_medicao_indicador_periodo"),
    )
    id_medicao = Column(Integer, primary_key=True, index=True)
    id_indicador = Column(Integer, ForeignKey("indicadores.id_indicador"), nullable=False)
    valor = Column(Numeric(14, 2), nullable=False)
    periodo = Column(String, nullable=False)
    fonte = Column(String, nullable=True)
    id_usuario_medicao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    medido_em = Column(DateTime, default=datetime.utcnow)


class CompromissoAgenda(Base):
    """Motor de agenda/conflito. `recurso_tipo`/`id_recurso` é O QUE está sendo reservado (uma
    sala, um espaço, um instrutor) - `contexto_tipo`/`id_contexto` é QUEM está reservando (a
    reserva de espaço, a turma, o evento). Regra de conflito (sobreposição de horário) escrita
    uma vez em `app/services/agenda.py::verificar_conflito`, reutilizada por reserva de espaço
    (v4.3), aula (FASE 14) e evento (v4.5) - nunca reimplementada em cada consumidor."""
    __tablename__ = "compromissos_agenda"
    id_compromisso = Column(Integer, primary_key=True, index=True)
    recurso_tipo = Column(String, nullable=False, index=True)
    id_recurso = Column(Integer, nullable=False, index=True)
    contexto_tipo = Column(String, nullable=False)
    id_contexto = Column(Integer, nullable=False)
    data_hora_inicio = Column(DateTime, nullable=False)
    data_hora_fim = Column(DateTime, nullable=False)
    id_usuario_registro = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
