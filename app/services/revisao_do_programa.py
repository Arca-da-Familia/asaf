"""v7.5b (FASE 7) - a revisão anual do programa de privacidade, com relatório à Diretoria.

Decisão do Presidente (2026-11-02): uma revisão por ano, **em janeiro**; a primeira assim que a função estiver pronta. O sistema monta o retrato do dia e o
guarda como foi montado (a prova do que se revisou): o inventário de dados (atividades e o que falta), os prazos de guarda em vigor, quem tem acesso a quê,
os incidentes e os ensaios, os pedidos de titular, o treinamento e o encarregado. O encarregado (o Presidente) escreve as observações e aprova; quem tem o
módulo Privacidade lê. Passado janeiro sem a revisão do ano, aparece o aviso."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.core import NivelAcesso, Usuario
from app.models.privacidade import ENCERRADO, REVISAO_APROVADA, REVISAO_RASCUNHO, IncidenteDeSeguranca, RevisaoDoPrograma

MES_DA_REVISAO = 1  # janeiro


def _incidentes(db: Session, inicio: datetime, fim: datetime) -> dict:
    do_periodo = db.query(IncidenteDeSeguranca).filter(IncidenteDeSeguranca.conhecido_em >= inicio, IncidenteDeSeguranca.conhecido_em < fim).all()
    reais = [i for i in do_periodo if not i.ensaio]
    return {
        "registrados": len(reais), "com_risco_relevante": sum(1 for i in reais if i.risco == "RELEVANTE"),
        "comunicados_a_anpd": sum(1 for i in reais if i.comunicado_anpd_em), "abertos": sum(1 for i in reais if i.situacao != ENCERRADO),
        "ensaios": sum(1 for i in do_periodo if i.ensaio),
    }


def _acessos(db: Session) -> list[dict]:
    """Quem tem acesso a dado de outras pessoas e por quê (as permissões do nível mais as dos cargos em mandato vigente)."""
    from app.models.associados import Associado
    from app.services.treinamento_de_privacidade import permissoes_efetivas

    linhas = []
    for u in db.query(Usuario).filter(Usuario.ativo.is_(True)).order_by(Usuario.id_usuario).all():
        permissoes = sorted(permissoes_efetivas(db, u))
        if not permissoes:
            continue
        associado = db.query(Associado).filter(Associado.id_usuario == u.id_usuario).first()
        nivel = db.get(NivelAcesso, u.id_nivel) if u.id_nivel else None
        linhas.append({"nome": (associado.nome_completo if associado else None) or u.email, "nivel": nivel.nome_nivel if nivel else None,
                       "permissoes": permissoes})
    return sorted(linhas, key=lambda x: (x["nome"] or "").lower())


def montar_retrato(db: Session, agora: Optional[datetime] = None) -> dict:
    """O retrato do programa no dia: o que vale agora e o que aconteceu nos últimos 12 meses."""
    from app.services import encarregado, incidentes, inventario, relatorio_de_atendimento_do_titular, retencao, treinamento_de_privacidade

    agora = agora or datetime.utcnow()
    um_ano_antes = agora - timedelta(days=365)  # v7.5c: `replace(year=...)` quebrava em 29 de fevereiro
    inv = inventario.listar(db)
    sit = encarregado.situacao(db, agora)
    quadro = treinamento_de_privacidade.quadro(db, agora)
    pedidos = relatorio_de_atendimento_do_titular.resumo(db, um_ano_antes, agora, agora)
    return {
        "periodo": {"de": um_ano_antes.isoformat(), "ate": agora.isoformat()},
        "encarregado": {"nome": sit["encarregado"]["nome"] if sit["encarregado"] else None, "ato_vigente": sit["ato_vigente"]["numero"] if sit["ato_vigente"] else None,
                        "avisos": [a["texto"] for a in sit["avisos"]]},
        "inventario": {"atividades": len(inv["atividades"]), "base_legal_a_conferir": len(inv["base_legal_a_conferir"]),
                       "tabelas_sem_atividade": inv["tabelas_sem_atividade"]},
        "prazos_de_guarda": [{"rotulo": r.rotulo, "dias": retencao.dias_da_regra(db, r)} for r in retencao.REGRAS],
        "acessos": _acessos(db),
        "incidentes": _incidentes(db, um_ano_antes, agora),
        "ensaios": {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in incidentes.ensaios(db, incidentes.hoje_na_sede(agora)).items()},
        "pedidos_de_titular": {"total": pedidos["total"], "respondidos": pedidos["respondidos"], "respondidos_no_prazo": pedidos["respondidos_no_prazo"],
                               "em_andamento_vencidos": pedidos["em_andamento_vencidos"]},
        "treinamento": {"precisam": len(quadro), "feitos": sum(1 for q in quadro if not q["pendente"]),
                        "pendentes": sum(1 for q in quadro if q["pendente"] and not q["atrasado"]), "atrasados": sum(1 for q in quadro if q["atrasado"])},
    }


def _serializar(r: RevisaoDoPrograma) -> dict:
    return {"id_revisao": r.id_revisao, "situacao": r.situacao, "retrato": r.retrato, "observacoes": r.observacoes, "montada_em": r.montada_em,
            "aprovada_em": r.aprovada_em}


def situacao(db: Session, hoje: Optional[date] = None) -> dict:
    """A revisão deste ano está feita? Fica pendente a partir de janeiro, até a revisão ser aprovada no ano. Sem nenhuma aprovada ainda, a primeira está
    pendente."""
    from app.services.incidentes import hoje_na_sede

    hoje = hoje or hoje_na_sede()
    aprovadas = db.query(RevisaoDoPrograma).filter(RevisaoDoPrograma.situacao == REVISAO_APROVADA).order_by(RevisaoDoPrograma.aprovada_em.desc()).all()
    ultima = aprovadas[0].aprovada_em if aprovadas else None
    from app.services.incidentes import dia_na_sede

    # v7.5c: o ano da aprovação pela hora de Belém (uma aprovação em 31/12 às 22h não conta para o ano seguinte)
    pendente = ultima is None or dia_na_sede(ultima).year < hoje.year
    return {"ultima_aprovada_em": ultima, "pendente": pendente, "atrasada": pendente and (ultima is None or hoje.month > MES_DA_REVISAO),
            "proxima_em": f"janeiro de {hoje.year + 1 if not pendente else hoje.year}"}


def listar(db: Session, hoje: Optional[date] = None) -> dict:
    revisoes = db.query(RevisaoDoPrograma).order_by(RevisaoDoPrograma.montada_em.desc()).all()
    return {"situacao": situacao(db, hoje), "revisoes": [_serializar(r) for r in revisoes]}


def montar(db: Session, usuario: Usuario, agora: Optional[datetime] = None) -> RevisaoDoPrograma:
    """Monta (ou remonta) o rascunho com o retrato de agora; o rascunho anterior é substituído (só a aprovada fica para sempre)."""
    agora = agora or datetime.utcnow()
    rascunho = db.query(RevisaoDoPrograma).filter(RevisaoDoPrograma.situacao == REVISAO_RASCUNHO).first()
    retrato = montar_retrato(db, agora)
    if rascunho is None:
        rascunho = RevisaoDoPrograma(situacao=REVISAO_RASCUNHO, retrato=retrato, montada_em=agora, id_usuario_montagem=usuario.id_usuario)
        db.add(rascunho)
    else:
        rascunho.retrato, rascunho.montada_em, rascunho.id_usuario_montagem = retrato, agora, usuario.id_usuario
    db.flush()
    return rascunho


def _rascunho(db: Session, id_revisao: int) -> RevisaoDoPrograma:
    r = db.get(RevisaoDoPrograma, id_revisao)
    if r is None:
        raise HTTPException(status_code=404, detail="Revisão não encontrada.")
    if r.situacao != REVISAO_RASCUNHO:
        raise HTTPException(status_code=409, detail="Esta revisão já foi aprovada: fica como está.")
    return r


def anotar(db: Session, id_revisao: int, observacoes: Optional[str]) -> RevisaoDoPrograma:
    r = _rascunho(db, id_revisao)
    r.observacoes = (observacoes or "").strip() or None
    db.flush()
    return r


def aprovar(db: Session, usuario: Usuario, id_revisao: int, agora: Optional[datetime] = None) -> RevisaoDoPrograma:
    from app.services.incidentes import dia_na_sede

    agora = agora or datetime.utcnow()
    r = _rascunho(db, id_revisao)
    # v7.5c: o retrato montado num ano não vale como a revisão do ano seguinte
    if dia_na_sede(r.montada_em).year != dia_na_sede(agora).year:
        raise HTTPException(status_code=409, detail="Este retrato é de outro ano: monte o retrato de hoje antes de aprovar.")
    if len((r.observacoes or "").strip()) < 10:
        raise HTTPException(status_code=422, detail="Escreva as observações da revisão (o que está bom e o que melhorar) antes de aprovar.")
    r.situacao, r.aprovada_em, r.id_usuario_aprovacao = REVISAO_APROVADA, agora, usuario.id_usuario
    db.flush()
    return r
