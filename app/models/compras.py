"""v3.3 (FASE 3) - contas a pagar, compras e segregação de funções: fluxo
solicitação → cotação (quando acima de valor configurado) → aprovação por alçada → pagamento →
conciliação. "Quem lança nunca aprova a própria solicitação" é checado no endpoint (ver
app/services/compras.py), nunca por convenção. Reaproveita `TituloFinanceiro`/`baixar_titulo`
(v3.0) pra pagamento e conciliação - uma compra aprovada só gera o título "A Pagar" de sempre,
nunca um conceito paralelo de pagamento com sua própria baixa.

Também: dados bancários de fornecedor versionados com segundo aprovador obrigatório (o golpe
mais comum contra organizações é a troca de dados bancários - a defesa é processual, não
tecnológica) e reembolso de despesa de voluntário/dirigente como fluxo próprio."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint

from app.database import Base


class DadosBancariosFornecedor(Base):
    """v3.3 - dados bancários de fornecedor são VERSIONADOS (nunca editados) e exigem SEGUNDO
    APROVADOR (nunca quem solicitou a troca) antes de valer - só uma linha "Aprovada" por
    fornecedor conta como vigente (ver app/services/fornecedores.py). Alteração de dados
    bancários é o golpe mais comum contra organizações (fraude do "fornecedor" pedindo troca de
    conta) - a defesa é processual, não tecnológica."""
    __tablename__ = "dados_bancarios_fornecedor"
    id_dados_bancarios = Column(Integer, primary_key=True, index=True)
    id_fornecedor = Column(Integer, ForeignKey("fornecedores.id_fornecedor"), nullable=False, index=True)
    banco = Column(String, nullable=False)
    agencia = Column(String, nullable=False)
    conta = Column(String, nullable=False)
    tipo_conta = Column(String, nullable=False)
    titular = Column(String, nullable=False)
    status = Column(String, default="Pendente", nullable=False)  # Pendente | Aprovado | Rejeitado
    id_usuario_solicitante = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    id_usuario_aprovador = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    motivo_rejeicao = Column(String, nullable=True)
    data_solicitacao = Column(DateTime, default=datetime.utcnow)
    data_aprovacao = Column(DateTime, nullable=True)


class AlcadaAprovacao(Base):
    """v3.3 - faixa de valor -> cargo(s) que podem aprovar (`cargos_autorizados`, códigos do
    catálogo `titulo_cargo` separados por vírgula, mesmo padrão de
    `CampanhaDescontoAntecipado.meses_gatilho`) + se exige dupla assinatura. `valor_maximo=NULL`
    = sem teto (faixa mais alta). Configurável pela diretoria, nunca hardcoded no código - ver
    app/services/compras.py::alcada_aplicavel."""
    __tablename__ = "alcadas_aprovacao"
    id_alcada = Column(Integer, primary_key=True, index=True)
    valor_minimo = Column(Numeric(14, 2), nullable=False)
    valor_maximo = Column(Numeric(14, 2), nullable=True)
    cargos_autorizados = Column(String, nullable=False)
    exige_dupla_assinatura = Column(Boolean, default=False, nullable=False)
    ativo = Column(Boolean, default=True, nullable=False)


class DelegacaoAprovacao(Base):
    """v3.3 - delegação temporária e rastreável: enquanto vigente, `id_associado_delegado` pode
    aprovar no lugar de `id_associado_delegante` (ex.: tesoureiro de férias delega ao vice) - a
    aprovação em si sempre registra quem realmente aprovou (nunca "assinado em nome de outro" sem
    rastro), a delegação só amplia QUEM pode, nunca esconde quem foi."""
    __tablename__ = "delegacoes_aprovacao"
    id_delegacao = Column(Integer, primary_key=True, index=True)
    id_associado_delegante = Column(Integer, ForeignKey("associados.id_associado"), nullable=False)
    id_associado_delegado = Column(Integer, ForeignKey("associados.id_associado"), nullable=False)
    data_inicio = Column(DateTime, nullable=False, default=datetime.utcnow)
    data_fim = Column(DateTime, nullable=False)
    motivo = Column(String, nullable=False)
    id_usuario_registro = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class SolicitacaoCompra(Base):
    """v3.3 - solicitação → cotação → aprovação → pagamento → conciliação. `id_usuario_solicitante`
    nunca pode aparecer como aprovador da própria solicitação (ver
    app/services/compras.py::aprovar_solicitacao) - segregação de funções checada no endpoint,
    não por convenção. Ao reunir aprovações suficientes pra alçada (`AprovacaoCompra`), gera um
    `TituloFinanceiro` "A Pagar" de verdade - pagamento e conciliação são os já existentes desde
    a v3.0, nunca um conceito paralelo."""
    __tablename__ = "solicitacoes_compra"
    id_solicitacao = Column(Integer, primary_key=True, index=True)
    descricao = Column(String, nullable=False)
    justificativa = Column(Text, nullable=True)
    id_fornecedor = Column(Integer, ForeignKey("fornecedores.id_fornecedor"), nullable=True)
    valor_estimado = Column(Numeric(14, 2), nullable=False)
    id_conta_contabil = Column(Integer, ForeignKey("plano_de_contas.id_conta"), nullable=False)
    id_centro_custo = Column(Integer, ForeignKey("centros_de_custo.id_centro_custo"), nullable=True)
    status = Column(String, default="Aguardando Cotação", nullable=False)
    # Aguardando Cotação | Aguardando Aprovação | Aprovada | Reprovada | Paga
    id_usuario_solicitante = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    motivo_reprovacao = Column(String, nullable=True)
    id_titulo_gerado = Column(Integer, ForeignKey("titulos_financeiros.id_titulo"), nullable=True)
    data_solicitacao = Column(DateTime, default=datetime.utcnow)


class CotacaoCompra(Base):
    """v3.3 - cotação de uma solicitação de compra, exigida quando `valor_estimado` está acima de
    `VALOR_MINIMO_EXIGE_COTACAO` (ConfiguracaoInstitucional) - comparar fornecedores antes de
    aprovar é o que evita superfaturamento, não confiar na palavra de quem solicitou."""
    __tablename__ = "cotacoes_compra"
    id_cotacao = Column(Integer, primary_key=True, index=True)
    id_solicitacao = Column(Integer, ForeignKey("solicitacoes_compra.id_solicitacao"), nullable=False, index=True)
    id_fornecedor = Column(Integer, ForeignKey("fornecedores.id_fornecedor"), nullable=False)
    valor = Column(Numeric(14, 2), nullable=False)
    anexo = Column(String, nullable=True)
    id_usuario_registro = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    data_cotacao = Column(DateTime, default=datetime.utcnow)


class AprovacaoCompra(Base):
    """v3.3 - uma aprovação individual de uma solicitação - `UniqueConstraint` garante que a
    MESMA pessoa nunca aprova duas vezes a mesma solicitação (contando pra dupla assinatura de
    verdade, não um clique duplicado por engano). A solicitação vira "Aprovada" quando o número
    de aprovações distintas bate com o exigido pela alçada (1, ou 2 se `exige_dupla_assinatura`)."""
    __tablename__ = "aprovacoes_compra"
    __table_args__ = (UniqueConstraint("id_solicitacao", "id_usuario_aprovador", name="uq_aprovacao_por_solicitacao_e_usuario"),)
    id_aprovacao = Column(Integer, primary_key=True, index=True)
    id_solicitacao = Column(Integer, ForeignKey("solicitacoes_compra.id_solicitacao"), nullable=False, index=True)
    id_usuario_aprovador = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=False)
    id_associado_creditado = Column(Integer, ForeignKey("associados.id_associado"), nullable=True)
    # v3.3 - quando a aprovação usa uma delegação (ver DelegacaoAprovacao), registra QUEM delegou -
    # quem realmente clicou é sempre `id_usuario_aprovador`, isso aqui é só rastro de origem.
    id_delegacao_usada = Column(Integer, ForeignKey("delegacoes_aprovacao.id_delegacao"), nullable=True)
    data_aprovacao = Column(DateTime, default=datetime.utcnow)


class ReembolsoDespesa(Base):
    """v3.3 - reembolso de despesa de voluntário/dirigente como fluxo próprio (comprovante
    obrigatório, aprovação, pagamento) - despesa reembolsada informalmente (sem processo, sem
    comprovante) é o buraco clássico de prestação de contas. Segregação de funções: quem
    solicitou o reembolso nunca aprova o próprio."""
    __tablename__ = "reembolsos_despesa"
    id_reembolso = Column(Integer, primary_key=True, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"), nullable=False)
    descricao = Column(String, nullable=False)
    valor = Column(Numeric(14, 2), nullable=False)
    comprovante = Column(String, nullable=False)
    id_conta_contabil = Column(Integer, ForeignKey("plano_de_contas.id_conta"), nullable=False)
    status = Column(String, default="Solicitado", nullable=False)  # Solicitado | Aprovado | Reprovado | Pago
    id_usuario_solicitante = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    id_usuario_aprovador = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    motivo_reprovacao = Column(String, nullable=True)
    id_titulo_gerado = Column(Integer, ForeignKey("titulos_financeiros.id_titulo"), nullable=True)
    data_solicitacao = Column(DateTime, default=datetime.utcnow)
    data_aprovacao = Column(DateTime, nullable=True)


class ContaAPagarRecorrente(Base):
    """v3.3 - despesa recorrente (aluguel, energia, contador) com geração mensal idempotente,
    mesmo mecanismo de `gerar_cobrancas` (v3.2) espelhado pro lado "A Pagar" - ver
    app/services/contas_a_pagar.py::gerar_contas_a_pagar. Acionada pela mesma rotina mensal
    automática que já gera cobrança e lembrete (v3.2.1), alimentando previsão de fluxo de caixa."""
    __tablename__ = "contas_a_pagar_recorrentes"
    id_conta_recorrente = Column(Integer, primary_key=True, index=True)
    descricao = Column(String, nullable=False)
    valor = Column(Numeric(14, 2), nullable=False)
    id_conta_contabil = Column(Integer, ForeignKey("plano_de_contas.id_conta"), nullable=False)
    id_fornecedor = Column(Integer, ForeignKey("fornecedores.id_fornecedor"), nullable=True)
    dia_vencimento = Column(Integer, nullable=False)
    ativo = Column(Boolean, default=True, nullable=False)
