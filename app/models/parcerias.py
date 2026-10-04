"""v5.4a (FASE 5) - PARCERIAS E EMENDAS: o núcleo da v12.1 que a transparência exige (decisão do usuário, 2026-10-03:
emenda, parcela, pagamento, etapa e prestação de contas moram no SISTEMA; o site só mostra o que foi aprovado).

Uma `Parceria` é a emenda parlamentar e/ou o termo de fomento/colaboração que a associação executa. Ela tem:
  - UM centro de custo EXCLUSIVO (criado junto, nunca compartilhado): tudo que entra e sai da parceria é lançamento
    do livro-caixa nesse centro. O DINHEIRO NÃO É DIGITADO DE NOVO: recebido e pago são lidos do razão contábil;
  - PARCELAS (o que está previsto receber), ETAPAS de execução, RELATÓRIOS/prestação de contas (com a situação
    regulares / com ressalvas / irregulares e o prazo de análise);
  - VÍNCULOS com lançamentos do livro-caixa (`LancamentoDaParceria`): cada recebimento/pagamento que vai ao site é
    CLASSIFICADO por uma pessoa, que escreve o texto público (sem nome de pessoa física: para equipe vale função +
    valor individual - lei municipal art. 43 §4º / Lei 13.019 art. 11, VI, a validar juridicamente);
  - PUBLICAÇÃO com a mesma regra dos documentos: rascunho -> em revisão -> aprovado -> retirado, e quem criou ou
    enviou para revisão não aprova (Presidente ou Secretário, permissão `aprovar_publicacao`)."""
from datetime import datetime

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint

from app.database import Base

# --- tipo da parceria
EMENDA = "EMENDA"
TERMO_FOMENTO = "TERMO_FOMENTO"
TERMO_COLABORACAO = "TERMO_COLABORACAO"
ACORDO_COOPERACAO = "ACORDO_COOPERACAO"
OUTRA = "OUTRA"
TIPOS = {
    EMENDA: "Emenda parlamentar",
    TERMO_FOMENTO: "Termo de fomento",
    TERMO_COLABORACAO: "Termo de colaboração",
    ACORDO_COOPERACAO: "Acordo de cooperação",
    OUTRA: "Outra parceria",
}
ESFERAS = ("Municipal", "Estadual", "Federal")

# --- situação da parceria (andamento real; não confundir com a situação de PUBLICAÇÃO)
PROPOSTA = "Proposta"
APROVADA = "Recurso aprovado"
TERMO_ASSINADO = "Termo assinado"
EM_EXECUCAO = "Em execução"
EM_PRESTACAO = "Em prestação de contas"
CONCLUIDA = "Concluída"
CANCELADA = "Cancelada"
SITUACOES = (PROPOSTA, APROVADA, TERMO_ASSINADO, EM_EXECUCAO, EM_PRESTACAO, CONCLUIDA, CANCELADA)

# --- situação de publicação (mesmas palavras do módulo Documentos)
RASCUNHO = "Rascunho"
EM_REVISAO = "Em revisão"
APROVADO = "Aprovado"
RETIRADO = "Retirado"
SITUACOES_DE_PUBLICACAO = (RASCUNHO, EM_REVISAO, APROVADO, RETIRADO)

# --- relatório / prestação de contas
RELATORIO_MONITORAMENTO = "MONITORAMENTO"
RELATORIO_PARCIAL = "PARCIAL"
RELATORIO_FINAL = "FINAL"
TIPOS_DE_RELATORIO = {
    RELATORIO_MONITORAMENTO: "Relatório de monitoramento",
    RELATORIO_PARCIAL: "Prestação de contas parcial",
    RELATORIO_FINAL: "Prestação de contas final",
}
EM_ANALISE = "Em análise"
REGULARES = "Regulares"
COM_RESSALVAS = "Regulares com ressalvas"
IRREGULARES = "Irregulares"
RESULTADOS = (EM_ANALISE, REGULARES, COM_RESSALVAS, IRREGULARES)
PRAZO_DE_ANALISE_PADRAO_EM_DIAS = 150

# --- etapa
ETAPA_PREVISTA = "Prevista"
ETAPA_REALIZADA = "Realizada"
ETAPA_CANCELADA = "Cancelada"
SITUACOES_DE_ETAPA = (ETAPA_PREVISTA, ETAPA_REALIZADA, ETAPA_CANCELADA)

# --- vínculo com o livro-caixa
RECEBIMENTO = "RECEBIMENTO"
PAGAMENTO = "PAGAMENTO"
NATUREZAS = {RECEBIMENTO: "Recebimento", PAGAMENTO: "Pagamento"}
CATEGORIA_FORNECEDOR = "FORNECEDOR"
CATEGORIA_EQUIPE = "EQUIPE"
CATEGORIA_TARIFA = "TARIFA"
CATEGORIA_OUTRO = "OUTRO"
CATEGORIAS_DE_PAGAMENTO = {
    CATEGORIA_FORNECEDOR: "Fornecedor / prestador de serviço (aparece com razão social e CNPJ)",
    CATEGORIA_EQUIPE: "Equipe (aparece só a função e o valor, sem nome)",
    CATEGORIA_TARIFA: "Tarifa bancária ou taxa",
    CATEGORIA_OUTRO: "Outro pagamento",
}


class Parceria(Base):
    __tablename__ = "parcerias"
    id_parceria = Column(Integer, primary_key=True, index=True)
    tipo = Column(String(20), nullable=False, index=True)
    ano = Column(Integer, nullable=False, index=True)
    titulo = Column(String(200), nullable=False)
    objeto = Column(Text, nullable=False)
    esfera = Column(String(10), nullable=True)
    orgao_concedente = Column(String(200), nullable=True)  # secretaria / órgão que repassa o recurso
    numero_emenda = Column(String(40), nullable=True)
    identificador_unico = Column(String(60), nullable=True, unique=True)  # ID único da emenda no sistema do órgão
    proponente = Column(String(200), nullable=True)  # vereador/parlamentar autor da emenda (agente público)
    numero_termo = Column(String(60), nullable=True)
    valor_total = Column(Numeric(14, 2), nullable=False)
    data_assinatura = Column(Date, nullable=True)
    vigencia_inicio = Column(Date, nullable=True)
    vigencia_fim = Column(Date, nullable=True)
    situacao = Column(String(30), nullable=False, default=PROPOSTA, index=True)
    # centro de custo EXCLUSIVO (criado junto com a parceria): o dinheiro vem do razão, nunca é digitado de novo
    id_centro_custo = Column(Integer, ForeignKey("centros_de_custo.id_centro_custo"), nullable=True, unique=True)

    # --- publicação (mesma regra dos documentos)
    situacao_publicacao = Column(String(12), nullable=False, default=RASCUNHO, index=True)
    id_usuario_envio_revisao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    enviado_revisao_em = Column(DateTime, nullable=True)
    id_usuario_aprovacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    aprovado_em = Column(DateTime, nullable=True)
    motivo_recusa = Column(Text, nullable=True)
    id_usuario_recusa = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    recusado_em = Column(DateTime, nullable=True)
    motivo_retirada = Column(Text, nullable=True)
    id_usuario_retirada = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    retirado_em = Column(DateTime, nullable=True)

    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow, nullable=False)
    atualizado_em = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class ParcelaParceria(Base):
    """O que está PREVISTO receber. O que foi de fato recebido vem do livro-caixa (`LancamentoDaParceria`)."""
    __tablename__ = "parcelas_parceria"
    __table_args__ = (UniqueConstraint("id_parceria", "numero", name="uq_parcela_numero_por_parceria"),)
    id_parcela = Column(Integer, primary_key=True, index=True)
    id_parceria = Column(Integer, ForeignKey("parcerias.id_parceria"), nullable=False, index=True)
    numero = Column(Integer, nullable=False)
    valor_previsto = Column(Numeric(14, 2), nullable=False)
    data_prevista = Column(Date, nullable=True)
    observacao = Column(String(200), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow, nullable=False)


class EtapaParceria(Base):
    """Etapa de execução (oficina, entrega, evento): data, local e público atendido. Fotos com autorização de
    imagem entram na v5.4b (precisam de um caminho próprio que confira a autorização)."""
    __tablename__ = "etapas_parceria"
    id_etapa = Column(Integer, primary_key=True, index=True)
    id_parceria = Column(Integer, ForeignKey("parcerias.id_parceria"), nullable=False, index=True)
    titulo = Column(String(200), nullable=False)
    descricao = Column(Text, nullable=True)
    data_prevista = Column(Date, nullable=True)
    data_realizacao = Column(Date, nullable=True)
    local = Column(String(200), nullable=True)
    publico_atendido = Column(Integer, nullable=True)
    situacao = Column(String(12), nullable=False, default=ETAPA_PREVISTA)
    criado_em = Column(DateTime, default=datetime.utcnow, nullable=False)


class RelatorioParceria(Base):
    """Relatório de monitoramento ou prestação de contas. `resultado` só deixa de ser "Em análise" depois de o
    relatório ter sido apresentado e com a data do resultado."""
    __tablename__ = "relatorios_parceria"
    id_relatorio = Column(Integer, primary_key=True, index=True)
    id_parceria = Column(Integer, ForeignKey("parcerias.id_parceria"), nullable=False, index=True)
    tipo = Column(String(15), nullable=False)
    periodo_inicio = Column(Date, nullable=True)
    periodo_fim = Column(Date, nullable=True)
    data_prevista = Column(Date, nullable=True)
    data_apresentacao = Column(Date, nullable=True)
    prazo_analise_dias = Column(Integer, nullable=False, default=PRAZO_DE_ANALISE_PADRAO_EM_DIAS)
    resultado = Column(String(25), nullable=False, default=EM_ANALISE)
    data_resultado = Column(Date, nullable=True)
    observacao = Column(Text, nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow, nullable=False)


class LancamentoDaParceria(Base):
    """Liga UM lançamento do livro-caixa à parceria e diz como ele aparece no site. Valor e data NÃO são guardados
    aqui: são lidos do razão (o estorno do lançamento tira o item do site sozinho). Um lançamento pertence a, no
    máximo, uma parceria."""
    __tablename__ = "lancamentos_parceria"
    id_vinculo = Column(Integer, primary_key=True, index=True)
    id_parceria = Column(Integer, ForeignKey("parcerias.id_parceria"), nullable=False, index=True)
    id_lancamento = Column(Integer, ForeignKey("lancamentos_contabeis.id_lancamento"), nullable=False, unique=True)
    natureza = Column(String(12), nullable=False)
    id_parcela = Column(Integer, ForeignKey("parcelas_parceria.id_parcela"), nullable=True)  # recebimento de qual parcela
    categoria = Column(String(12), nullable=True)  # só pagamento
    descricao_publica = Column(String(200), nullable=False)
    funcao = Column(String(80), nullable=True)  # só categoria EQUIPE: o que aparece no lugar do nome
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow, nullable=False)
    atualizado_em = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
