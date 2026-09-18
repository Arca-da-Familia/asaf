"""v4.3 (FASE 4) - reserva de espaço. Conflito de horário reaproveita o motor de agenda (v4.0,
`CompromissoAgenda`/`app/services/agenda.py`) - `Reserva.id_compromisso_agenda` é o vínculo, e
`BloqueioEspaco` também vira um `CompromissoAgenda` (recurso "Espaco") na hora de criar, pra uma
reserva nunca poder cair em cima de um bloqueio de manutenção sem precisar reimplementar a
checagem de sobreposição. **A checagem em Python (`verificar_conflito`) não garante nada sob
concorrência real** (duas requisições simultâneas podem passar pelo SELECT antes de qualquer uma
fazer o INSERT) - a garantia de verdade é a `EXCLUDE USING gist` que a migração `b4d6f8a0c2e3`
acrescenta em `compromissos_agenda` no Postgres (SQLite não tem gist/range, então o ambiente de
teste depende só da checagem em aplicação - documentado, não escondido)."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text

from app.database import Base


class Espaco(Base):
    __tablename__ = "espacos"
    id_espaco = Column(Integer, primary_key=True, index=True)
    nome = Column(String, nullable=False)
    tipo = Column(String, nullable=False)  # catálogo `tipo_espaco`
    capacidade = Column(Integer, nullable=True)
    recursos_disponiveis = Column(Text, nullable=True)
    regras_uso = Column(Text, nullable=True)
    horario_funcionamento_inicio = Column(String(5), nullable=True)  # "HH:MM"
    horario_funcionamento_fim = Column(String(5), nullable=True)
    # v4.3 - "dois fluxos configuráveis por espaço, confirmado por pesquisa como padrão de
    # mercado": instantânea (False) ou solicitação + aprovação manual (True).
    exige_aprovacao = Column(Boolean, default=False, nullable=False)
    valor_reserva = Column(Numeric(14, 2), nullable=True)  # nulo/zero = sempre gratuito
    isento_para_associado_adimplente = Column(Boolean, default=True, nullable=False)
    id_conta_contabil_receita = Column(Integer, ForeignKey("plano_de_contas.id_conta"), nullable=True)
    prazo_cancelamento_horas = Column(Integer, default=24, nullable=False)
    taxa_cancelamento_tardio = Column(Numeric(14, 2), nullable=True)
    limite_no_show_bloqueio = Column(Integer, nullable=True)  # nulo = nunca bloqueia por reincidência
    ativo = Column(Boolean, default=True, nullable=False)


class BloqueioEspaco(Base):
    __tablename__ = "bloqueios_espaco"
    id_bloqueio = Column(Integer, primary_key=True, index=True)
    id_espaco = Column(Integer, ForeignKey("espacos.id_espaco"), nullable=False, index=True)
    data_hora_inicio = Column(DateTime, nullable=False)
    data_hora_fim = Column(DateTime, nullable=False)
    motivo = Column(String, nullable=False)  # catálogo `motivo_bloqueio_espaco`
    descricao = Column(String, nullable=True)
    id_compromisso_agenda = Column(Integer, ForeignKey("compromissos_agenda.id_compromisso"), nullable=True)
    id_usuario_registro = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class Reserva(Base):
    __tablename__ = "reservas_espaco"
    id_reserva = Column(Integer, primary_key=True, index=True)
    id_espaco = Column(Integer, ForeignKey("espacos.id_espaco"), nullable=False, index=True)
    id_associado_solicitante = Column(Integer, ForeignKey("associados.id_associado"), nullable=False, index=True)
    data_hora_inicio = Column(DateTime, nullable=False)
    data_hora_fim = Column(DateTime, nullable=False)
    finalidade = Column(String, nullable=False)
    status = Column(String, nullable=False, default="SOLICITADA")  # catálogo `status_reserva`
    motivo_status = Column(Text, nullable=True)  # motivo de recusa/cancelamento
    id_titulo_cobranca = Column(Integer, ForeignKey("titulos_financeiros.id_titulo"), nullable=True)
    id_compromisso_agenda = Column(Integer, ForeignKey("compromissos_agenda.id_compromisso"), nullable=True)
    # v4.3 - reserva recorrente: cada ocorrência é uma `Reserva` de verdade, independente,
    # cancelável/alterável sozinha ("tratamento individual de exceções" é isto - nunca uma regra
    # de recorrência à parte que precisa de um mecanismo de "exceção" pra ser furada).
    identificador_serie = Column(String, nullable=True, index=True)
    id_usuario_registro = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class ChecklistDevolucaoEspaco(Base):
    """Evita a discussão "quem quebrou" sem prova - condição registrada na retirada E na
    devolução, cada uma com autor e data próprios."""
    __tablename__ = "checklists_devolucao_espaco"
    id_checklist = Column(Integer, primary_key=True, index=True)
    id_reserva = Column(Integer, ForeignKey("reservas_espaco.id_reserva"), nullable=False, unique=True, index=True)
    condicao_retirada = Column(Text, nullable=True)
    data_retirada = Column(DateTime, nullable=True)
    id_usuario_retirada = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    condicao_devolucao = Column(Text, nullable=True)
    houve_avaria = Column(Boolean, nullable=True)
    descricao_avaria = Column(Text, nullable=True)
    data_devolucao = Column(DateTime, nullable=True)
    id_usuario_devolucao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
