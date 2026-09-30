"""v4.9 (FASE 4) - financeiro de projeto/evento: cobrança de inscrição/uso de espaço integrada à
FASE 3 (faixa de preço por categoria/data, cupom, isenção justificada), reembolso por
cancelamento e fechamento financeiro automático ao encerrar.

`CupomDesconto`/`IsencaoTaxaContexto` nascem genéricos (`contexto_tipo`/`id_contexto`, mesmo
raciocínio de `app/models/motores.py` desde a v4.0) porque a própria v4.9 pede os dois
consumidores ao mesmo tempo - "inscrição" (Evento) e "uso de espaço" (Reserva) - ao contrário de
`TituloFinanceiro` (legado, FK explícita por módulo, anterior à decisão polimórfica).
`FaixaPrecoEvento` fica só para `Evento` de propósito: `Reserva` mantém seu `Espaco.valor_reserva`
simples (v4.3, já testado, sem faixa por categoria/data) e ganha só cupom/isenção/reembolso por
cima, sem mexer no preço-base que já funciona."""
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint

from app.database import Base


class FaixaPrecoEvento(Base):
    """Preço por categoria (catálogo `categoria_cota_inscricao`, reaproveitado - "estudante" é só
    mais uma opção que a diretoria adiciona ao catálogo, nunca um enum novo hardcoded) e por
    janela de vigência (mesmo padrão versionado de `ValorPlanoContribuicao`/
    `CampanhaDescontoAntecipado`, v3.2/v3.2.3 - lote promocional por data é isto: uma linha com
    `data_vigencia_fim` no fim da promoção, outra assumindo depois)."""
    __tablename__ = "faixas_preco_evento"
    __table_args__ = (
        UniqueConstraint("id_evento", "categoria", "data_vigencia_inicio", name="uq_faixa_preco_evento_categoria_vigencia"),
    )
    id_faixa = Column(Integer, primary_key=True, index=True)
    id_evento = Column(Integer, ForeignKey("eventos.id_evento"), nullable=False, index=True)
    categoria = Column(String, nullable=False)  # catálogo `categoria_cota_inscricao`
    valor = Column(Numeric(10, 2), nullable=False)
    data_vigencia_inicio = Column(DateTime, nullable=False, default=datetime.utcnow)
    data_vigencia_fim = Column(DateTime, nullable=True)
    id_usuario_registro = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


TIPO_DESCONTO_PERCENTUAL = "percentual"
TIPO_DESCONTO_VALOR_FIXO = "valor_fixo"


class CupomDesconto(Base):
    """Cupom de desconto - conceito 100% novo neste projeto (nenhum precedente em código antes
    da v4.9). Sempre escopado a um contexto (`contexto_tipo`/`id_contexto` - "Evento" ou
    "Reserva"/"Espaco"), nunca global "vale pra qualquer coisa" - cada evento/espaço define seus
    próprios cupons. `usos_atuais` incrementado atomicamente em
    `app/services/cupons.py::validar_e_aplicar_cupom` (mesmo espírito de UPDATE condicionado da
    v4.7 - `WHERE usos_atuais < limite_uso`, nunca SELECT-conta-depois-UPDATE)."""
    __tablename__ = "cupons_desconto"
    id_cupom = Column(Integer, primary_key=True, index=True)
    codigo = Column(String, nullable=False, unique=True, index=True)
    contexto_tipo = Column(String, nullable=False, index=True)
    id_contexto = Column(Integer, nullable=False, index=True)
    tipo_desconto = Column(String, nullable=False)  # "percentual" | "valor_fixo"
    valor_desconto = Column(Numeric(10, 2), nullable=False)
    limite_uso = Column(Integer, nullable=True)  # nulo = sem limite de uso
    usos_atuais = Column(Integer, nullable=False, default=0)
    data_vigencia_inicio = Column(DateTime, nullable=True)
    data_vigencia_fim = Column(DateTime, nullable=True)
    ativo = Column(Boolean, nullable=False, default=True)
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class IsencaoTaxaContexto(Base):
    """Isenção justificada de cobrança de inscrição/uso de espaço - mesmo raciocínio de
    `IsencaoContribuicao` (v3.2: motivo de catálogo + aprovador + percentual), generalizado por
    `contexto_tipo`/`id_contexto` em vez de amarrado só a mensalidade. `percentual_isencao=100`
    é isenção total; entre 0 e 100 é desconto parcial."""
    __tablename__ = "isencoes_taxa_contexto"
    id_isencao = Column(Integer, primary_key=True, index=True)
    contexto_tipo = Column(String, nullable=False, index=True)
    id_contexto = Column(Integer, nullable=False, index=True)
    id_pessoa = Column(Integer, ForeignKey("pessoas.id_pessoa"), nullable=False)
    motivo = Column(String, nullable=False)  # catálogo `motivo_isencao_taxa_evento`
    percentual_isencao = Column(Numeric(5, 2), nullable=False)  # 0-100
    id_usuario_aprovador = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class FechamentoEvento(Base):
    """Encerramento financeiro do evento - snapshot versionado (nunca editado; gerar de novo cria
    uma linha nova, mesmo raciocínio de `RelatorioFinalProjeto`, v3.6). `total_arrecadado`/
    `total_custos`/`resultado` vêm de `app/services/relatorios.py::
    receitas_e_despesas_por_centro_custo` filtrado pelo `Evento.id_centro_custo` - nenhuma soma
    paralela que pode divergir do razão contábil real. Gerado automaticamente pela tarefa
    periódica (`id_usuario_geracao=None`) quando o evento encerra, ou sob demanda por quem tiver
    permissão."""
    __tablename__ = "fechamentos_evento"
    id_fechamento = Column(Integer, primary_key=True, index=True)
    id_evento = Column(Integer, ForeignKey("eventos.id_evento"), nullable=False, index=True)
    gerado_em = Column(DateTime, default=datetime.utcnow)
    total_inscritos = Column(Integer, nullable=False, default=0)
    total_presentes = Column(Integer, nullable=False, default=0)
    total_arrecadado = Column(Numeric(14, 2), nullable=False, default=Decimal("0"))
    total_custos = Column(Numeric(14, 2), nullable=False, default=Decimal("0"))
    resultado = Column(Numeric(14, 2), nullable=False, default=Decimal("0"))
    id_usuario_geracao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
