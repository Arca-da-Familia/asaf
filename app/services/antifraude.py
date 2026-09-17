"""v3.7 (FASE 3) - controles antifraude além do mínimo: relatório de exceção mensal para o
Conselho Fiscal (v2.6), com os cinco padrões suspeitos pedidos pela pesquisa de mercado (seção 6):
lançamento fora do horário habitual, valor logo abaixo do teto de alçada (fracionamento),
fornecedor novo com pagamento alto na primeira operação, sequência de estornos pelo mesmo
usuário, pagamento a conta bancária alterada recentemente. Nenhum padrão aqui BLOQUEIA nada
sozinho - isto é um relatório de EXCEÇÃO pra revisão humana (Conselho Fiscal), nunca uma trava
automática que impediria uma operação legítima só porque bateu num padrão estatístico."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.config_cache import obter_configuracao
from app.models.compras import AlcadaAprovacao, DadosBancariosFornecedor, SolicitacaoCompra
from app.models.financeiro import Fornecedor, LancamentoContabil, TituloFinanceiro


def _mes_ano(competencia: str) -> tuple[int, int]:
    ano_str, mes_str = competencia.split("-")
    return int(ano_str), int(mes_str)


def _intervalo_da_competencia(competencia: str) -> tuple[datetime, datetime]:
    import calendar

    ano, mes = _mes_ano(competencia)
    ultimo_dia = calendar.monthrange(ano, mes)[1]
    return datetime(ano, mes, 1), datetime(ano, mes, ultimo_dia, 23, 59, 59)


def _hora_local(dt: datetime, fuso: str) -> int:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    try:
        return dt.astimezone(ZoneInfo(fuso)).hour
    except Exception:
        return dt.hour


def _lancamentos_fora_do_horario(db: Session, *, inicio: datetime, fim: datetime) -> list[dict]:
    fuso = obter_configuracao(db, "FUSO_HORARIO", "America/Sao_Paulo") or "America/Sao_Paulo"
    hora_inicio = int(obter_configuracao(db, "HORA_INICIO_EXPEDIENTE", "7") or "7")
    hora_fim = int(obter_configuracao(db, "HORA_FIM_EXPEDIENTE", "20") or "20")

    lancamentos = db.query(LancamentoContabil).filter(
        LancamentoContabil.data_lancamento >= inicio, LancamentoContabil.data_lancamento <= fim,
    ).all()

    achados = []
    for l in lancamentos:
        hora = _hora_local(l.data_lancamento, fuso)
        if hora < hora_inicio or hora >= hora_fim:
            achados.append({
                "tipo": "LANCAMENTO_FORA_DO_HORARIO",
                "descricao": f"Lançamento #{l.numero_sequencial} ({l.historico}) registrado às {hora:02d}h, fora do expediente ({hora_inicio:02d}h-{hora_fim:02d}h).",
                "id_lancamento": l.id_lancamento,
            })
    return achados


def _valores_proximos_do_teto_de_alcada(db: Session, *, inicio: datetime, fim: datetime) -> list[dict]:
    percentual = Decimal(obter_configuracao(db, "PERCENTUAL_ALERTA_FRACIONAMENTO", "10") or "10")
    alcadas = db.query(AlcadaAprovacao).filter(AlcadaAprovacao.ativo.is_(True), AlcadaAprovacao.valor_maximo.isnot(None)).all()
    solicitacoes = db.query(SolicitacaoCompra).filter(
        SolicitacaoCompra.data_solicitacao >= inicio, SolicitacaoCompra.data_solicitacao <= fim,
    ).all()

    achados = []
    for s in solicitacoes:
        for alcada in alcadas:
            limite_inferior = alcada.valor_maximo * (1 - percentual / 100)
            if limite_inferior <= s.valor_estimado <= alcada.valor_maximo:
                achados.append({
                    "tipo": "VALOR_PROXIMO_DO_TETO_DE_ALCADA",
                    "descricao": f"Solicitação de compra #{s.id_solicitacao} (R$ {s.valor_estimado:.2f}) está a menos de {percentual}% do teto de alçada (R$ {alcada.valor_maximo:.2f}) - possível fracionamento.",
                    "id_solicitacao": s.id_solicitacao,
                })
                break
    return achados


def _fornecedor_novo_com_pagamento_alto(db: Session, *, inicio: datetime, fim: datetime) -> list[dict]:
    valor_alerta = Decimal(obter_configuracao(db, "VALOR_ALERTA_FORNECEDOR_NOVO", "1000") or "1000")
    titulos_do_mes = db.query(TituloFinanceiro).filter(
        TituloFinanceiro.tipo_titulo == "A Pagar", TituloFinanceiro.id_fornecedor.isnot(None),
        TituloFinanceiro.data_emissao >= inicio, TituloFinanceiro.data_emissao <= fim,
        TituloFinanceiro.valor_original >= valor_alerta,
    ).all()

    achados = []
    for titulo in titulos_do_mes:
        titulo_anterior = db.query(TituloFinanceiro).filter(
            TituloFinanceiro.id_fornecedor == titulo.id_fornecedor, TituloFinanceiro.tipo_titulo == "A Pagar",
            TituloFinanceiro.data_emissao < titulo.data_emissao,
        ).first()
        if titulo_anterior is None:
            fornecedor = db.query(Fornecedor).filter(Fornecedor.id_fornecedor == titulo.id_fornecedor).first()
            achados.append({
                "tipo": "FORNECEDOR_NOVO_PAGAMENTO_ALTO",
                "descricao": f"Primeira operação com o fornecedor '{fornecedor.razao_social if fornecedor else titulo.id_fornecedor}' já é de R$ {titulo.valor_original:.2f}.",
                "id_titulo": titulo.id_titulo, "id_fornecedor": titulo.id_fornecedor,
            })
    return achados


def _sequencia_de_estornos_pelo_mesmo_usuario(db: Session, *, inicio: datetime, fim: datetime) -> list[dict]:
    limite = int(obter_configuracao(db, "QUANTIDADE_ALERTA_ESTORNOS_MESMO_USUARIO", "3") or "3")
    estornos = db.query(LancamentoContabil).filter(
        LancamentoContabil.tipo_origem == "ESTORNO", LancamentoContabil.data_lancamento >= inicio, LancamentoContabil.data_lancamento <= fim,
    ).all()

    por_usuario: dict[Optional[int], list[LancamentoContabil]] = {}
    for l in estornos:
        por_usuario.setdefault(l.id_usuario_lancamento, []).append(l)

    achados = []
    for id_usuario, lista in por_usuario.items():
        if id_usuario is not None and len(lista) >= limite:
            achados.append({
                "tipo": "SEQUENCIA_DE_ESTORNOS_MESMO_USUARIO",
                "descricao": f"Usuário #{id_usuario} fez {len(lista)} estornos no período (limite de atenção: {limite}).",
                "id_usuario": id_usuario, "quantidade": len(lista),
            })
    return achados


def _pagamento_apos_troca_de_dados_bancarios(db: Session, *, inicio: datetime, fim: datetime) -> list[dict]:
    dias_janela = int(obter_configuracao(db, "DIAS_ALERTA_TROCA_DADOS_BANCARIOS", "30") or "30")
    trocas_aprovadas = db.query(DadosBancariosFornecedor).filter(DadosBancariosFornecedor.status == "Aprovado").all()

    achados = []
    for troca in trocas_aprovadas:
        if not troca.data_aprovacao:
            continue
        janela_fim = troca.data_aprovacao + timedelta(days=dias_janela)
        pagamentos = (
            db.query(LancamentoContabil)
            .join(TituloFinanceiro, TituloFinanceiro.id_titulo == LancamentoContabil.id_titulo)
            .filter(
                LancamentoContabil.tipo_origem == "BAIXA_TITULO", TituloFinanceiro.id_fornecedor == troca.id_fornecedor,
                LancamentoContabil.data_lancamento >= troca.data_aprovacao, LancamentoContabil.data_lancamento <= janela_fim,
                LancamentoContabil.data_lancamento >= inicio, LancamentoContabil.data_lancamento <= fim,
            )
            .all()
        )
        for pagamento in pagamentos:
            achados.append({
                "tipo": "PAGAMENTO_APOS_TROCA_DE_DADOS_BANCARIOS",
                "descricao": f"Pagamento (lançamento #{pagamento.numero_sequencial}) ao fornecedor #{troca.id_fornecedor} {(pagamento.data_lancamento - troca.data_aprovacao).days} dia(s) após a troca de dados bancários ser aprovada.",
                "id_lancamento": pagamento.id_lancamento, "id_fornecedor": troca.id_fornecedor,
            })
    return achados


def relatorio_padroes_suspeitos(db: Session, *, competencia: str) -> list[dict]:
    inicio, fim = _intervalo_da_competencia(competencia)
    return (
        _lancamentos_fora_do_horario(db, inicio=inicio, fim=fim)
        + _valores_proximos_do_teto_de_alcada(db, inicio=inicio, fim=fim)
        + _fornecedor_novo_com_pagamento_alto(db, inicio=inicio, fim=fim)
        + _sequencia_de_estornos_pelo_mesmo_usuario(db, inicio=inicio, fim=fim)
        + _pagamento_apos_troca_de_dados_bancarios(db, inicio=inicio, fim=fim)
    )
