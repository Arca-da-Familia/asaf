"""v4.9 (FASE 4) - fechamento financeiro automático do evento: snapshot versionado (nunca
editado - gerar de novo cria uma linha nova, mesmo raciocínio de `RelatorioFinalProjeto`, v3.6).
`total_arrecadado`/`total_custos`/`resultado` vêm de
`app/services/relatorios.py::receitas_e_despesas_por_centro_custo` - nenhuma soma paralela que
pode divergir do razão contábil real."""
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.eventos import Evento, SessaoEvento
from app.models.financeiro_evento import FechamentoEvento
from app.models.motores import CANCELADO, Inscricao, RegistroPresenca
from app.services import eventos as servico_eventos
from app.services import pesquisa_satisfacao as servico_pesquisa_satisfacao
from app.services import relatorios as servico_relatorios

CONTEXTO_EVENTO = "Evento"
CONTEXTO_SESSAO_EVENTO = "SessaoEvento"
_DATA_MINIMA = datetime(2020, 1, 1)


def _ids_contexto_do_evento(db: Session, id_evento: int) -> list[tuple[str, int]]:
    contextos = [(CONTEXTO_EVENTO, id_evento)]
    for s in db.query(SessaoEvento).filter(SessaoEvento.id_evento == id_evento).all():
        contextos.append((CONTEXTO_SESSAO_EVENTO, s.id_sessao))
    return contextos


def gerar_fechamento_evento(db: Session, *, id_evento: int, id_usuario: Optional[int] = None) -> FechamentoEvento:
    evento = servico_eventos.obter_evento(db, id_evento)
    contextos = _ids_contexto_do_evento(db, id_evento)

    total_inscritos = 0
    ids_pessoas_presentes: set[int] = set()
    for contexto_tipo, id_contexto in contextos:
        total_inscritos += (
            db.query(Inscricao)
            .filter(Inscricao.contexto_tipo == contexto_tipo, Inscricao.id_contexto == id_contexto, Inscricao.status != CANCELADO)
            .count()
        )
        for (id_pessoa,) in db.query(RegistroPresenca.id_pessoa).filter(
            RegistroPresenca.contexto_tipo == contexto_tipo, RegistroPresenca.id_contexto == id_contexto,
        ).distinct():
            ids_pessoas_presentes.add(id_pessoa)

    total_arrecadado = Decimal("0")
    total_custos = Decimal("0")
    if evento.id_centro_custo:
        linhas = servico_relatorios.receitas_e_despesas_por_centro_custo(db, data_inicio=_DATA_MINIMA, data_fim=datetime.utcnow())
        linha = next((l for l in linhas if l["id_centro_custo"] == evento.id_centro_custo), None)
        if linha:
            total_arrecadado = linha["receitas"]
            total_custos = linha["despesas"]

    fechamento = FechamentoEvento(
        id_evento=id_evento, total_inscritos=total_inscritos, total_presentes=len(ids_pessoas_presentes),
        total_arrecadado=total_arrecadado, total_custos=total_custos, resultado=total_arrecadado - total_custos,
        id_usuario_geracao=id_usuario,
    )
    db.add(fechamento)
    db.commit()
    db.refresh(fechamento)
    return fechamento


def listar_fechamentos_evento(db: Session, *, id_evento: int) -> list[FechamentoEvento]:
    return (
        db.query(FechamentoEvento)
        .filter(FechamentoEvento.id_evento == id_evento)
        .order_by(FechamentoEvento.gerado_em.desc())
        .all()
    )


def fechar_eventos_encerrados_sem_fechamento(db: Session) -> list[dict]:
    """v4.9 - varredura periódica (ver scripts/fechar_eventos_encerrados.py e o workflow agendado,
    mesmo padrão de app/services/vagas.py::expirar_promocoes_vencidas): todo evento com
    `data_hora_fim` (ou `data_hora_inicio`, quando o evento não declarou fim) no passado e que
    ainda não tem nenhum `FechamentoEvento` ganha um, automaticamente."""
    agora = datetime.utcnow()
    candidatos = (
        db.query(Evento)
        .filter(
            ((Evento.data_hora_fim.isnot(None)) & (Evento.data_hora_fim < agora))
            | ((Evento.data_hora_fim.is_(None)) & (Evento.data_hora_inicio < agora))
        )
        .all()
    )
    resultado = []
    for evento in candidatos:
        ja_tem = db.query(FechamentoEvento).filter(FechamentoEvento.id_evento == evento.id_evento).first()
        if ja_tem:
            continue
        fechamento = gerar_fechamento_evento(db, id_evento=evento.id_evento, id_usuario=None)
        # v4.10 - o mesmo ciclo diário que fecha o financeiro do evento também convida quem
        # participou a responder a pesquisa de satisfação - nunca um agendamento próprio (é o
        # mesmo "evento encerrado" que dispara os dois).
        servico_pesquisa_satisfacao.gerar_convites(db, id_evento=evento.id_evento)
        resultado.append({"id_evento": evento.id_evento, "id_fechamento": fechamento.id_fechamento, "resultado": fechamento.resultado})
    return resultado
