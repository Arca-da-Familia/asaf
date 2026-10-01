"""v4.10 (FASE 4) - pesquisa de satisfação pós-evento: convite por link único (mesmo gerador de
token de `app/services/protecao_publica.py::gerar_token_cancelamento`), resposta pública sem
login e resultado agregado sempre anônimo na exibição (nunca `id_inscricao`/nome de quem
respondeu) - alimenta um Indicador CALCULADO (nunca preenchido à mão) por evento."""
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.motores import CANCELADO, Indicador, Inscricao, MedicaoIndicador
from app.models.pesquisa_satisfacao import RespostaPesquisaSatisfacao
from app.services import eventos as servico_eventos
from app.services.protecao_publica import gerar_token_cancelamento

CONTEXTO_EVENTO = "Evento"
NOME_INDICADOR_SATISFACAO = "Satisfação pós-evento"
UNIDADE_INDICADOR_SATISFACAO = "NOTA_0_A_10"
PERIODICIDADE_INDICADOR_SATISFACAO = "POR_EVENTO"


def gerar_convites(db: Session, *, id_evento: int) -> list[RespostaPesquisaSatisfacao]:
    """Um convite por inscrito não-cancelado que ainda não tinha nenhum - chamada tanto pelo
    disparo manual quanto pela tarefa diária de fechamento de evento (v4.9), nunca duplica quem já
    foi convidado antes (`UniqueConstraint` em (id_evento, id_inscricao) garante isso no banco)."""
    servico_eventos.obter_evento(db, id_evento)
    inscritos = (
        db.query(Inscricao)
        .filter(Inscricao.contexto_tipo == CONTEXTO_EVENTO, Inscricao.id_contexto == id_evento, Inscricao.status != CANCELADO)
        .all()
    )
    ja_convidados = {
        id_inscricao for (id_inscricao,) in
        db.query(RespostaPesquisaSatisfacao.id_inscricao).filter(RespostaPesquisaSatisfacao.id_evento == id_evento).all()
    }
    novos = []
    for inscricao_pessoa in inscritos:
        if inscricao_pessoa.id_inscricao in ja_convidados:
            continue
        convite = RespostaPesquisaSatisfacao(
            id_evento=id_evento, id_inscricao=inscricao_pessoa.id_inscricao, token=gerar_token_cancelamento(),
        )
        db.add(convite)
        novos.append(convite)
    db.commit()
    for convite in novos:
        db.refresh(convite)
    return novos


def obter_por_token(db: Session, *, token: str) -> RespostaPesquisaSatisfacao:
    convite = db.query(RespostaPesquisaSatisfacao).filter(RespostaPesquisaSatisfacao.token == token).first()
    if not convite:
        raise HTTPException(status_code=404, detail="Link de pesquisa de satisfação inválido.")
    return convite


def responder(db: Session, *, token: str, nota: int, comentario: Optional[str]) -> RespostaPesquisaSatisfacao:
    convite = obter_por_token(db, token=token)
    if convite.respondido_em is not None:
        raise HTTPException(status_code=400, detail="Esta pesquisa já foi respondida.")
    convite.nota = nota
    convite.comentario = comentario
    convite.respondido_em = datetime.utcnow()
    db.commit()
    db.refresh(convite)
    calcular_resultado(db, id_evento=convite.id_evento)
    return convite


def calcular_resultado(db: Session, *, id_evento: int) -> dict:
    """Agregação anônima - nunca devolve `id_inscricao` nem qualquer coisa que ligue uma nota a
    uma pessoa específica. Recalcula (e sobrescreve) o indicador de qualidade toda vez que roda,
    porque a nota média muda conforme mais gente responde."""
    convites = db.query(RespostaPesquisaSatisfacao).filter(RespostaPesquisaSatisfacao.id_evento == id_evento).all()
    respondidos = [c for c in convites if c.respondido_em is not None]
    nota_media = None
    if respondidos:
        nota_media = (sum(Decimal(c.nota) for c in respondidos) / len(respondidos)).quantize(Decimal("0.01"))
        _registrar_indicador(db, id_evento=id_evento, nota_media=nota_media)
    return {
        "total_convidados": len(convites),
        "total_respondidos": len(respondidos),
        "nota_media": nota_media,
        "comentarios": [c.comentario for c in respondidos if c.comentario],
    }


def _registrar_indicador(db: Session, *, id_evento: int, nota_media: Decimal) -> None:
    """Indicador CALCULADO, nunca preenchido à mão - por isso não passa por
    `app/services/indicadores.py::registrar_medicao` (que recusa, de propósito, sobrescrever a
    medição de um período já existente - certo pra entrada manual, errado aqui: a nota muda
    conforme mais gente responde, então recalcular tem que ATUALIZAR a medição existente do
    evento, nunca empilhar uma nova a cada resposta)."""
    indicador = (
        db.query(Indicador)
        .filter(Indicador.contexto_tipo == CONTEXTO_EVENTO, Indicador.id_contexto == id_evento, Indicador.nome == NOME_INDICADOR_SATISFACAO)
        .first()
    )
    if not indicador:
        indicador = Indicador(
            nome=NOME_INDICADOR_SATISFACAO, unidade=UNIDADE_INDICADOR_SATISFACAO, meta=None,
            periodicidade=PERIODICIDADE_INDICADOR_SATISFACAO, contexto_tipo=CONTEXTO_EVENTO, id_contexto=id_evento,
        )
        db.add(indicador)
        db.flush()

    periodo = str(id_evento)
    medicao = db.query(MedicaoIndicador).filter(MedicaoIndicador.id_indicador == indicador.id_indicador, MedicaoIndicador.periodo == periodo).first()
    if medicao:
        medicao.valor = nota_media
        medicao.fonte = "Pesquisa de satisfação (calculado)"
    else:
        db.add(MedicaoIndicador(id_indicador=indicador.id_indicador, valor=nota_media, periodo=periodo, fonte="Pesquisa de satisfação (calculado)"))
    db.commit()
