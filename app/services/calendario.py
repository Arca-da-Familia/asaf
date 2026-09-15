"""v2.9 (FASE 2) - calendário institucional: agrega, na leitura, o que já é data real em outro
módulo (Assembleia, Mandato, Deliberacao, ProjetoEvento) - nunca duplica nada, só calcula as
obrigações estatutárias recorrentes que não têm registro próprio (AGO semestral - Art. 5º, I;
eleição quadrienal - Art. 25). É a base tanto para as obrigações de governança quanto para as
ações/eventos reais que a associação for realizar (ProjetoEvento, FASE 4) - "descobrir em
dezembro que devia ter feito algo em abril" vale tanto pra assembleia quanto pra projeto."""
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.models.ata import PENDENTE, Deliberacao
from app.models.calendario import EventoCalendario
from app.models.governanca import CANCELADA, REALIZADA, Assembleia
from app.models.mandatos import Mandato
from app.models.projetos import ProjetoEvento
from app.services.estatuto import obter_regra_vigente
from app.services.mandatos import mandatos_vencendo


def _janela_quinzena(ano: int, mes: int) -> tuple[date, date]:
    return date(ano, mes, 1), date(ano, mes, 15)


_NOMES_MES = {
    1: "janeiro", 2: "fevereiro", 3: "março", 4: "abril", 5: "maio", 6: "junho",
    7: "julho", 8: "agosto", 9: "setembro", 10: "outubro", 11: "novembro", 12: "dezembro",
}


def proximas_ago(db: Session, hoje: date) -> list[dict]:
    """Art. 5º, I - AGO semestral, primeira quinzena dos meses definidos em
    `MESES_AGO_ESTATUTARIA` (`RegraEstatutaria`, v2.0) - nunca fixo em código, mesmo princípio já
    aplicado a quórum/prazo/mandato: uma reforma futura do Art. 5º muda o parâmetro, não o deploy.
    Devolve a próxima ocorrência de cada uma a partir de hoje (nunca a do passado)."""
    meses_csv = obter_regra_vigente(db, "MESES_AGO_ESTATUTARIA", "2,8") or "2,8"
    meses = [int(m.strip()) for m in meses_csv.split(",")]
    resultado = []
    for mes in meses:
        ano = hoje.year
        inicio, fim = _janela_quinzena(ano, mes)
        if fim < hoje:
            ano += 1
            inicio, fim = _janela_quinzena(ano, mes)
        resultado.append({
            "tipo": "AGO_ESTATUTARIA",
            "titulo": f"Assembleia Geral Ordinária ({_NOMES_MES.get(mes, mes)})",
            "data": inicio, "janela_fim": fim, "artigo_origem": "Art. 5º, I",
        })
    return resultado


def proxima_eleicao(db: Session, hoje: date) -> Optional[dict]:
    """Art. 25 - eleição a cada `DURACAO_MANDATO_ANOS` (v2.0), primeira quinzena de fevereiro,
    contada a partir do último mandato de Presidente registrado. Sem nenhum mandato de Presidente
    ainda registrado, não há base real pra calcular - devolve None em vez de inventar uma data."""
    ultimo_presidente = (
        db.query(Mandato)
        .filter(Mandato.cargo_codigo == "PRESIDENTE", Mandato.orgao_codigo == "DIRETORIA_EXECUTIVA")
        .order_by(Mandato.data_inicio.desc())
        .first()
    )
    if not ultimo_presidente:
        return None
    anos = int(obter_regra_vigente(db, "DURACAO_MANDATO_ANOS", "4") or "4")
    ano_eleicao = ultimo_presidente.data_inicio.year + anos
    while date(ano_eleicao, 2, 15) < hoje:
        ano_eleicao += anos
    inicio, fim = _janela_quinzena(ano_eleicao, 2)
    return {
        "tipo": "ELEICAO_DIRETORIA", "titulo": "Eleição da Diretoria Executiva e do Conselho Fiscal",
        "data": inicio, "janela_fim": fim, "artigo_origem": "Art. 25",
    }


def montar_calendario(db: Session, dias_antecedencia: int = 90) -> list[dict]:
    hoje = datetime.utcnow().date()
    limite = hoje + timedelta(days=dias_antecedencia)
    itens: list[dict] = []

    for ago in proximas_ago(db, hoje):
        if ago["data"] <= limite:
            itens.append({**ago, "dias_restantes": (ago["data"] - hoje).days})

    eleicao = proxima_eleicao(db, hoje)
    if eleicao and eleicao["data"] <= limite:
        itens.append({**eleicao, "dias_restantes": (eleicao["data"] - hoje).days})

    for a in db.query(Assembleia).filter(Assembleia.status.notin_([CANCELADA, REALIZADA])).all():
        data = a.data_hora_convocacao.date()
        if hoje <= data <= limite:
            itens.append({
                "tipo": "ASSEMBLEIA_CONVOCADA", "titulo": f"Assembleia {a.tipo}: {a.pauta[:60]}",
                "data": data, "dias_restantes": (data - hoje).days, "artigo_origem": None,
            })

    for m in mandatos_vencendo(db, dias_antecedencia):
        mandato = m["mandato"]
        itens.append({
            "tipo": "MANDATO_VENCENDO", "titulo": f"Fim de mandato: {mandato.cargo_codigo} ({mandato.orgao_codigo})",
            "data": mandato.data_fim_previsto.date(), "dias_restantes": m["dias_restantes"], "artigo_origem": None,
        })

    for d in db.query(Deliberacao).filter(Deliberacao.status_execucao == PENDENTE, Deliberacao.prazo_execucao.isnot(None)).all():
        data = d.prazo_execucao.date()
        if hoje <= data <= limite:
            itens.append({
                "tipo": "DELIBERACAO_PRAZO", "titulo": f"Prazo de execução: {d.texto[:60]}",
                "data": data, "dias_restantes": (data - hoje).days, "artigo_origem": None,
            })

    for p in db.query(ProjetoEvento).filter(ProjetoEvento.data_inicio.isnot(None)).all():
        data = p.data_inicio.date()
        if hoje <= data <= limite:
            itens.append({
                "tipo": "PROJETO_EVENTO", "titulo": p.nome_projeto, "data": data,
                "dias_restantes": (data - hoje).days, "artigo_origem": None,
            })

    for e in db.query(EventoCalendario).filter(EventoCalendario.data_inicio.isnot(None)).all():
        data = e.data_inicio.date()
        if hoje <= data <= limite:
            itens.append({
                "tipo": "EVENTO_INSTITUCIONAL", "titulo": e.titulo, "data": data,
                "dias_restantes": (data - hoje).days, "artigo_origem": None, "categoria": e.categoria,
            })

    itens.sort(key=lambda i: i["data"])
    return itens
