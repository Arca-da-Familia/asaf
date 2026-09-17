from datetime import datetime
from sqlalchemy import Boolean, Column, Integer, String, ForeignKey, DateTime, Numeric, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.database import Base

class PlanoDeContas(Base):
    """v3.0 - `tipo` é um dos cinco tipos contábeis reais (Ativo, Passivo, Patrimônio Líquido,
    Receita, Despesa - catálogo `tipo_conta_contabil`, ver app/database.py::seed_catalogos), do
    qual deriva a natureza devedora/credora da conta (ver `natureza_da_conta` em
    app/services/contabilidade.py - não guardada como coluna de propósito, pra nunca poder ficar
    dessincronizada do `tipo` depois de uma edição).

    v3.1 - `codigo_contabil_pai` faz da conta uma hierarquia (sintética x analítica): uma conta
    que é `pai` de outra (outra linha aponta `codigo_contabil_pai` pra ela) é sintética e nunca
    recebe lançamento direto - só quem não tem filha (analítica/folha) recebe, checado em
    `app/services/contabilidade.py::exigir_conta_analitica`, chamado por `criar_lancamento` pra
    todo `id_conta` de toda partida, nunca confiado a quem chama."""
    __tablename__ = "plano_de_contas"
    id_conta = Column(Integer, primary_key=True, index=True)
    codigo_contabil = Column(String, unique=True, index=True)
    descricao_conta = Column(String)
    tipo = Column(String)
    codigo_contabil_pai = Column(String, ForeignKey("plano_de_contas.codigo_contabil"), nullable=True)


class CentroDeCusto(Base):
    """v3.1 - "quanto custou o projeto X" sem planilha paralela: campo opcional em
    `PartidaContabil` (a partida sabe a conta E o centro de custo), nunca tabela paralela que
    pode divergir do lançamento real. `id_projeto` liga a um `ProjetoEvento` (FASE 4, ainda
    prototípico) quando o centro de custo corresponder a um projeto/evento real - opcional,
    porque nem todo centro de custo é um projeto (ex.: "Administrativo", "Manutenção predial")."""
    __tablename__ = "centros_de_custo"
    id_centro_custo = Column(Integer, primary_key=True, index=True)
    codigo = Column(String, unique=True, index=True)
    nome = Column(String, nullable=False)
    id_projeto = Column(Integer, ForeignKey("projetos_eventos.id_projeto"), nullable=True)
    ativo = Column(Boolean, default=True, nullable=False)


class ContaFinanceira(Base):
    """v3.1 - especialização de uma `PlanoDeContas` do tipo Ativo (Caixa, conta corrente,
    poupança, conta de aplicação). Nunca guarda saldo em coluna própria - o saldo é sempre
    calculado somando `PartidaContabil` daquela conta (débito soma, crédito subtrai - ver
    `app/services/contabilidade.py::saldo_conta`), a mesma mecânica que já existia desde a v3.0
    para o indicador "saldo em contas Ativo" do livro-caixa. Editar o saldo direto nunca é
    possível porque a coluna simplesmente não existe."""
    __tablename__ = "contas_financeiras"
    id_conta_financeira = Column(Integer, primary_key=True, index=True)
    id_conta = Column(Integer, ForeignKey("plano_de_contas.id_conta"), unique=True, nullable=False)
    tipo_conta_financeira = Column(String, nullable=False)
    banco = Column(String, nullable=True)
    agencia = Column(String, nullable=True)
    numero_conta = Column(String, nullable=True)
    ativo = Column(Boolean, default=True, nullable=False)

class Fornecedor(Base):
    __tablename__ = "fornecedores"
    id_fornecedor = Column(Integer, primary_key=True, index=True)
    razao_social = Column(String, index=True)
    cnpj = Column(String, unique=True, index=True)
    categoria_servico = Column(String)
    telefone = Column(String)
    # v3.3 - validação automática de situação cadastral (API pública "Minha Receita", ver
    # app/services/fornecedores.py::validar_situacao_cadastral) antes de aprovar pagamento. Sem
    # SLA garantido - nunca bloqueia o processo se a API estiver fora (`situacao_cadastral` fica
    # "Não verificado" e o processo segue, registrado como decisão consciente).
    situacao_cadastral = Column(String, nullable=True)
    data_ultima_validacao_cadastral = Column(DateTime, nullable=True)

class Exercicio(Base):
    """v3.0 - ano contábil com abertura/fechamento formal. Exercício fechado não aceita
    lançamento novo (ver `exigir_exercicio_aberto` em app/services/contabilidade.py) - ajuste só
    por lançamento no exercício corrente, igual à contabilidade real."""
    __tablename__ = "exercicios_contabeis"
    id_exercicio = Column(Integer, primary_key=True, index=True)
    ano = Column(Integer, unique=True, index=True, nullable=False)
    status = Column(String, default="Aberto", nullable=False)
    data_abertura = Column(DateTime, default=datetime.utcnow)
    data_fechamento = Column(DateTime, nullable=True)
    id_usuario_abertura = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    id_usuario_fechamento = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)

class TituloFinanceiro(Base):
    __tablename__ = "titulos_financeiros"
    __table_args__ = (
        UniqueConstraint("id_associado", "id_plano_contribuicao", "competencia", name="uq_titulo_cobranca_por_competencia"),
        # v3.3 - mesma trava de idempotência do lado "A Pagar" (ver
        # app/services/contas_a_pagar.py::gerar_contas_a_pagar) - rodar a geração mensal duas
        # vezes nunca duplica a despesa recorrente, garantido no banco, não só na lógica.
        UniqueConstraint("id_conta_a_pagar_recorrente", "competencia", name="uq_titulo_conta_a_pagar_recorrente_por_competencia"),
    )
    id_titulo = Column(Integer, primary_key=True, index=True)
    tipo_titulo = Column(String)
    id_conta_contabil = Column(Integer, ForeignKey("plano_de_contas.id_conta"))
    id_associado = Column(Integer, ForeignKey("associados.id_associado"), nullable=True)
    id_fornecedor = Column(Integer, ForeignKey("fornecedores.id_fornecedor"), nullable=True)
    descricao = Column(String)
    valor_original = Column(Numeric(14, 2))
    saldo_devedor = Column(Numeric(14, 2))
    data_emissao = Column(DateTime, default=datetime.utcnow)
    data_vencimento = Column(DateTime)
    status = Column(String, default="Pendente")
    # v3.2 - título gerado por `gerar_cobrancas` (mensalidade/contribuição recorrente). Os dois
    # juntos (nunca um sem o outro) são a chave de IDEMPOTÊNCIA da geração em lote: rodar a
    # geração duas vezes na mesma competência nunca duplica cobrança - a `UniqueConstraint` acima
    # garante isso no banco, não só na lógica do serviço (ver
    # app/services/contribuicoes.py::gerar_cobrancas). Título lançado manualmente (fora da
    # geração em lote) nunca preenche estes dois - ambos ficam `NULL`, fora da constraint.
    id_plano_contribuicao = Column(Integer, ForeignKey("planos_contribuicao.id_plano"), nullable=True)
    competencia = Column(String(7), nullable=True)  # "AAAA-MM"
    # v3.2.3 - título-bloco (pagamento antecipado com desconto, ver `CampanhaDescontoAntecipado`
    # abaixo): `competencia` acima é o PRIMEIRO mês coberto, `competencia_fim` o ÚLTIMO - NULL em
    # todo título normal (um mês só). `id_conta_contabil` de um título-bloco aponta pra conta de
    # Passivo de receita diferida da campanha (nunca a Receita do plano direto) - é assim que
    # `baixar_titulo` (sem mudar nada nele) já credita a conta certa sozinho; a Receita real só é
    # reconhecida depois, mês a mês, por `contribuicoes.reconhecer_receita_diferida_do_mes`.
    competencia_fim = Column(String(7), nullable=True)  # "AAAA-MM"
    id_campanha_desconto_antecipado = Column(Integer, ForeignKey("campanhas_desconto_antecipado.id_campanha"), nullable=True)
    # v3.2.2 - negociação/parcelamento de débito (ver `NegociacaoDivida` abaixo):
    # `id_negociacao_origem` marca o título ORIGINAL que foi renegociado (status vira
    # "Renegociado" - nunca editado/apagado, só superado por parcelas novas, mesmo espírito de
    # imutabilidade de todo título/lançamento deste projeto). `id_negociacao_parcela` marca cada
    # título NOVO (parcela) nascido de uma negociação - nunca os dois preenchidos no mesmo título.
    id_negociacao_origem = Column(Integer, ForeignKey("negociacoes_divida.id_negociacao"), nullable=True)
    id_negociacao_parcela = Column(Integer, ForeignKey("negociacoes_divida.id_negociacao"), nullable=True)
    # v3.3 - título "A Pagar" gerado pela rotina mensal de contas a pagar recorrentes (aluguel,
    # energia, contador) - ver app/services/contas_a_pagar.py::gerar_contas_a_pagar. NULL em todo
    # título que não veio dessa geração.
    id_conta_a_pagar_recorrente = Column(Integer, ForeignKey("contas_a_pagar_recorrentes.id_conta_recorrente"), nullable=True)


class PlanoDeContribuicao(Base):
    """v3.2 - mensalidade/contribuição recorrente por categoria de associado (Art. 55 do
    estatuto). O VALOR não é coluna aqui - mora em `ValorPlanoContribuicao`, versionado por
    vigência (reajuste é uma linha nova com `data_vigencia_inicio`, nunca edição que apaga
    quanto se cobrava antes - ver app/services/contribuicoes.py::valor_vigente)."""
    __tablename__ = "planos_contribuicao"
    id_plano = Column(Integer, primary_key=True, index=True)
    categoria = Column(String, nullable=False)  # rótulo do catálogo `categoria_associado` (v0.3.1)
    descricao = Column(String, nullable=False)
    periodicidade = Column(String, nullable=False, default="Mensal")  # catálogo `periodicidade_contribuicao`
    dia_vencimento = Column(Integer, nullable=False)
    # v3.2 - "cobrança por família/núcleo doméstico (v1.7) quando o estatuto previr": quando
    # ligado, um associado que é DEPENDENTE (`DependenteFamiliar.id_pessoa_vinculada`) de outro
    # associado titular não recebe cobrança própria nesta competência - só o titular é cobrado
    # (ver app/services/contribuicoes.py::gerar_cobrancas).
    cobranca_por_nucleo_familiar = Column(Boolean, default=False, nullable=False)
    id_conta_contabil = Column(Integer, ForeignKey("plano_de_contas.id_conta"), nullable=False)
    ativo = Column(Boolean, default=True, nullable=False)


class ValorPlanoContribuicao(Base):
    """v3.2 - valor vigente de um `PlanoDeContribuicao`, versionado: reajuste NUNCA edita o
    valor anterior, sempre encerra a vigência dele (`data_vigencia_fim`) e cria uma linha nova -
    histórico completo de quanto se cobrava em cada época preservado para sempre."""
    __tablename__ = "valores_plano_contribuicao"
    id_valor = Column(Integer, primary_key=True, index=True)
    id_plano = Column(Integer, ForeignKey("planos_contribuicao.id_plano"), nullable=False)
    valor = Column(Numeric(14, 2), nullable=False)
    data_vigencia_inicio = Column(DateTime, nullable=False, default=datetime.utcnow)
    data_vigencia_fim = Column(DateTime, nullable=True)
    motivo_reajuste = Column(String, nullable=True)
    id_usuario_registro = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)


class IsencaoContribuicao(Base):
    """v3.2 - isenção/desconto de contribuição, sempre com motivo de catálogo, aprovador e
    vigência - nunca "desconto que ninguém sabe por quê" (mesmo espírito da FASE 3 inteira:
    quem registra é rastreável). `id_plano=NULL` = isenção vale para qualquer plano do
    associado."""
    __tablename__ = "isencoes_contribuicao"
    id_isencao = Column(Integer, primary_key=True, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"), nullable=False)
    id_plano = Column(Integer, ForeignKey("planos_contribuicao.id_plano"), nullable=True)
    motivo = Column(String, nullable=False)  # catálogo `motivo_isencao_contribuicao`
    percentual_desconto = Column(Numeric(5, 2), nullable=False)  # 0-100 (100 = isenção total)
    data_inicio = Column(DateTime, nullable=False, default=datetime.utcnow)
    data_fim = Column(DateTime, nullable=True)
    id_usuario_aprovador = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)


class CampanhaDescontoAntecipado(Base):
    """v3.2.3 - desconto configurável por pagamento antecipado em bloco (semestral, anual, ou
    outra periodicidade) - decisão de assembleia. Versionado como `ValorPlanoContribuicao`:
    mudar percentual/meses NUNCA edita a campanha anterior, sempre encerra a vigência
    (`data_vigencia_fim`) e cria uma linha nova - quem já pagou um bloco fica com a regra que
    valia na hora, mesmo que a diretoria mude depois (ver
    app/services/contribuicoes.py::campanha_vigente). `meses_gatilho` guarda os meses do
    calendário (1-12) que abrem a janela, separados por vírgula (ex.: "1,7") - lista simples, sem
    tabela associativa, porque não precisa de integridade referencial nenhuma.
    `id_conta_contabil_receita_diferida` é sempre uma conta de Passivo: é pra lá que o dinheiro
    do bloco vai na baixa (a Receita real só é reconhecida depois, mês a mês)."""
    __tablename__ = "campanhas_desconto_antecipado"
    id_campanha = Column(Integer, primary_key=True, index=True)
    percentual_desconto = Column(Numeric(5, 2), nullable=False)  # 0-100
    quantidade_meses = Column(Integer, nullable=False)  # ex.: 6 (semestral) ou 12 (anual)
    meses_gatilho = Column(String, nullable=False)  # "1,7" - meses 1-12 separados por vírgula
    id_conta_contabil_receita_diferida = Column(Integer, ForeignKey("plano_de_contas.id_conta"), nullable=False)
    motivo = Column(String, nullable=True)  # ex.: "Ata da assembleia de 2026-09-17"
    data_vigencia_inicio = Column(DateTime, nullable=False, default=datetime.utcnow)
    data_vigencia_fim = Column(DateTime, nullable=True)
    ativo = Column(Boolean, default=True, nullable=False)
    id_usuario_registro = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    data_criacao = Column(DateTime, default=datetime.utcnow)


class ReconhecimentoReceitaDiferida(Base):
    """v3.2.3 - rastreia qual competência de um título-bloco já teve sua fatia de receita
    reclassificada da conta de Passivo (receita diferida) pra Receita de verdade - a
    `UniqueConstraint` abaixo garante no banco que a mesma competência do mesmo título nunca é
    reconhecida duas vezes, mesmo que a rotina mensal rode de novo (ver
    app/services/contribuicoes.py::reconhecer_receita_diferida_do_mes). `valor` é a fatia
    reconhecida NAQUELE mês (a soma de todas as linhas de um título bate exatamente com o
    `valor_original` dele - o último mês do bloco absorve o arredondamento)."""
    __tablename__ = "reconhecimentos_receita_diferida"
    __table_args__ = (
        UniqueConstraint("id_titulo", "competencia", name="uq_reconhecimento_por_competencia"),
    )
    id_reconhecimento = Column(Integer, primary_key=True, index=True)
    id_titulo = Column(Integer, ForeignKey("titulos_financeiros.id_titulo"), nullable=False)
    competencia = Column(String(7), nullable=False)  # "AAAA-MM"
    valor = Column(Numeric(14, 2), nullable=False)
    id_lancamento = Column(Integer, ForeignKey("lancamentos_contabeis.id_lancamento"), nullable=False)
    data_criacao = Column(DateTime, default=datetime.utcnow)


class LembreteMensalidadeEnviado(Base):
    """v3.2.1 (adaptado, 2026-09-17) - Pix Automático de verdade (Resolução BCB 402/506) exige
    integração com um banco/PSP parceiro pago, que a associação não tem orçamento pra contratar
    (achado confirmado com o usuário). Adaptação: lembrete automático por e-mail com o Pix já
    pronto (copia e cola), disparado pela mesma rotina mensal que gera a cobrança
    (`app/services/lembretes.py`) - nunca debita nada sozinho, só reduz ao máximo a fricção de
    "esquecer de pagar". A `UniqueConstraint` abaixo garante que o MESMO tipo de lembrete nunca é
    enviado duas vezes pro mesmo título, mesmo se a rotina rodar mais de uma vez no mesmo dia."""
    __tablename__ = "lembretes_mensalidade_enviados"
    __table_args__ = (
        UniqueConstraint("id_titulo", "tipo_lembrete", name="uq_lembrete_por_titulo_e_tipo"),
    )
    id_lembrete = Column(Integer, primary_key=True, index=True)
    id_titulo = Column(Integer, ForeignKey("titulos_financeiros.id_titulo"), nullable=False)
    tipo_lembrete = Column(String, nullable=False)  # "ANTES_VENCIMENTO" | "NO_VENCIMENTO"
    data_envio = Column(DateTime, default=datetime.utcnow)


class NegociacaoDivida(Base):
    """v3.2.2 - negociação/parcelamento de débito em atraso, com termo de confissão de dívida em
    TEXTO (assinatura eletrônica de verdade fica pra FASE 20, ainda não existe no sistema - até
    lá, `termo` registra as condições acordadas, com autoria e data, e o aceite do associado é um
    processo humano/presencial fora do sistema). O(s) título(s) original(is) NUNCA são
    editados/apagados - ganham status "Renegociado" (excluído do cálculo de inadimplência, ver
    app/services/categoria_associado.py) e as parcelas novas nascem como títulos "A Receber"
    normais, sempre rastreáveis até aqui via `TituloFinanceiro.id_negociacao_origem`/
    `id_negociacao_parcela`."""
    __tablename__ = "negociacoes_divida"
    id_negociacao = Column(Integer, primary_key=True, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"), nullable=False)
    valor_total = Column(Numeric(14, 2), nullable=False)
    quantidade_parcelas = Column(Integer, nullable=False)
    termo = Column(Text, nullable=False)
    id_usuario_registro = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    data_negociacao = Column(DateTime, default=datetime.utcnow)


class CreditoAssociado(Base):
    """v3.2 - "pagamento a maior (crédito em conta do associado) tratado explicitamente":
    excedente de uma baixa vira crédito aqui (nunca perdido, nunca devolvido em dinheiro sem
    decisão) - consumível em títulos futuros do mesmo associado
    (`app/services/contribuicoes.py::aplicar_credito`). `valor` é o saldo RESTANTE do crédito
    (decresce a cada aplicação); `valor_original` nunca muda, é o histórico de quanto nasceu."""
    __tablename__ = "creditos_associado"
    id_credito = Column(Integer, primary_key=True, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"), nullable=False)
    valor = Column(Numeric(14, 2), nullable=False)
    valor_original = Column(Numeric(14, 2), nullable=False)
    origem = Column(String, nullable=False)
    id_titulo_origem = Column(Integer, ForeignKey("titulos_financeiros.id_titulo"), nullable=True)
    data_criacao = Column(DateTime, default=datetime.utcnow)

class LancamentoContabil(Base):
    """v3.0 - lançamento do razão contábil em partida dobrada real: um cabeçalho com N
    `PartidaContabil` (linhas de débito/crédito), sempre balanceado (soma dos débitos = soma dos
    créditos - garantido em app/services/contabilidade.py::criar_lancamento, nunca confiar em
    entrada direta). Numerado sequencialmente por exercício (nunca reaproveitado, nunca
    reordenado). Imutável: nunca editado nem apagado - correção é sempre estorno (novo
    lançamento com débito/crédito invertidos) + o original marcado `estornado`, nunca removido -
    ambos ficam visíveis no razão (ver `estornar_lancamento` em app/services/contabilidade.py)."""
    __tablename__ = "lancamentos_contabeis"
    id_lancamento = Column(Integer, primary_key=True, index=True)
    id_exercicio = Column(Integer, ForeignKey("exercicios_contabeis.id_exercicio"), nullable=False)
    numero_sequencial = Column(Integer, nullable=False)
    id_titulo = Column(Integer, ForeignKey("titulos_financeiros.id_titulo"), nullable=True)
    historico = Column(String, nullable=False)
    tipo_origem = Column(String, nullable=False)
    forma_pagamento = Column(String, nullable=True)
    id_usuario_lancamento = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    data_lancamento = Column(DateTime, default=datetime.utcnow)
    # v3.1 - `data_lancamento` (acima) passa a ser a data de CAIXA (quando o dinheiro efetivamente
    # entrou/saiu); `data_competencia` é a data a que o fato contábil pertence (regime de
    # competência) - distinção que a contabilidade exige e que sistemas amadores ignoram. Nula em
    # lançamentos antigos (pré-v3.1), tratada nesse caso como igual à data de caixa (ver a
    # migração desta versão, que faz o backfill).
    data_competencia = Column(DateTime, nullable=True)
    # v3.1 - comprovante anexado (caminho `/uploads/comprovantes/...`, ver
    # app/routers/financeiro.py::enviar_comprovante) - obrigatoriedade por tipo de conta é
    # configurável via o catálogo `tipo_conta_contabil` (`metadados.exige_comprovante`), checada
    # em `baixar_titulo`/transferência, nunca hardcoded.
    comprovante = Column(String, nullable=True)
    estornado = Column(Boolean, default=False, nullable=False)
    motivo_estorno = Column(String, nullable=True)
    id_lancamento_estorno = Column(Integer, ForeignKey("lancamentos_contabeis.id_lancamento"), nullable=True)

    partidas = relationship("PartidaContabil", back_populates="lancamento", order_by="PartidaContabil.id_partida")

    __table_args__ = (
        UniqueConstraint("id_exercicio", "numero_sequencial", name="uq_lancamento_numero_por_exercicio"),
    )

class PartidaContabil(Base):
    """v3.0 - uma linha de débito ou crédito de um `LancamentoContabil`. Nunca existe sozinha:
    todo lançamento tem no mínimo uma partida de débito e uma de crédito, com a mesma soma dos
    dois lados (validado em app/services/contabilidade.py, nunca confiar em entrada direta)."""
    __tablename__ = "partidas_contabeis"
    id_partida = Column(Integer, primary_key=True, index=True)
    id_lancamento = Column(Integer, ForeignKey("lancamentos_contabeis.id_lancamento"), nullable=False)
    id_conta = Column(Integer, ForeignKey("plano_de_contas.id_conta"), nullable=False)
    tipo_partida = Column(String, nullable=False)  # "Debito" | "Credito" - ver app/services/contabilidade.py
    valor = Column(Numeric(14, 2), nullable=False)
    # v3.1 - opcional: "quanto custou o projeto X" sem planilha paralela (ver `CentroDeCusto`
    # acima). Nunca obrigatório - nem todo lançamento pertence a um projeto/centro específico.
    id_centro_custo = Column(Integer, ForeignKey("centros_de_custo.id_centro_custo"), nullable=True)

    lancamento = relationship("LancamentoContabil", back_populates="partidas")
