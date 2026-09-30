"""v4.8 (FASE 4) - elegibilidade ao certificado (calculada, nunca concedida à mão - não existe
parâmetro de override em nenhuma função deste arquivo, de propósito) e emissão de crachá/
certificado em PDF a partir do motor de documento genérico da v4.0
(app/services/documentos.py)."""
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config_cache import obter_configuracao
from app.models.eventos import Evento, SessaoEvento
from app.models.motores import CANCELADO, Inscricao, RegistroPresenca
from app.models.pessoas import Pessoa
from app.services import documentos as servico_documentos
from app.services.eventos import CONTEXTO_EVENTO, CONTEXTO_SESSAO_EVENTO, obter_evento
from app.services.protecao_publica import gerar_codigo_verificacao_documento

_CHAVE_PERCENTUAL_PADRAO = "PERCENTUAL_MINIMO_CERTIFICADO_PADRAO"

NIVEL_CARGA_HORARIA = "carga_horaria"
NIVEL_SESSOES = "sessoes"
NIVEL_INDISPONIVEL = "indisponivel"


def _ids_sessoes_do_evento(db: Session, id_evento: int) -> list[int]:
    return [s.id_sessao for s in db.query(SessaoEvento).filter(SessaoEvento.id_evento == id_evento).all()]


def _horas_presentes(db: Session, *, id_evento: int, id_pessoa: int, ids_sessoes: list[int]) -> Decimal:
    filtros_contexto = [
        (RegistroPresenca.contexto_tipo == CONTEXTO_EVENTO) & (RegistroPresenca.id_contexto == id_evento),
    ]
    if ids_sessoes:
        filtros_contexto.append(
            (RegistroPresenca.contexto_tipo == CONTEXTO_SESSAO_EVENTO) & (RegistroPresenca.id_contexto.in_(ids_sessoes))
        )

    registros = db.query(RegistroPresenca).filter(
        RegistroPresenca.id_pessoa == id_pessoa, RegistroPresenca.hora_saida.isnot(None),
        or_(*filtros_contexto),
    ).all()
    total_segundos = sum((r.hora_saida - r.hora_entrada).total_seconds() for r in registros)
    return Decimal(total_segundos) / Decimal(3600)


def _limite_aplicado(db: Session, evento: Evento) -> Decimal:
    if evento.percentual_minimo_certificado is not None:
        return Decimal(evento.percentual_minimo_certificado)
    return Decimal(obter_configuracao(db, _CHAVE_PERCENTUAL_PADRAO, "75"))


def calcular_elegibilidade(db: Session, *, id_evento: int, id_pessoa: int) -> dict:
    evento = obter_evento(db, id_evento)
    ids_sessoes = _ids_sessoes_do_evento(db, id_evento)
    limite = _limite_aplicado(db, evento)

    if evento.carga_horaria_horas is not None and evento.carga_horaria_horas > 0:
        horas_presentes = _horas_presentes(db, id_evento=id_evento, id_pessoa=id_pessoa, ids_sessoes=ids_sessoes)
        carga_total = Decimal(evento.carga_horaria_horas)
        percentual = min(horas_presentes, carga_total) / carga_total * 100
        nivel = NIVEL_CARGA_HORARIA
    elif ids_sessoes:
        presentes = db.query(RegistroPresenca.id_contexto).filter(
            RegistroPresenca.contexto_tipo == CONTEXTO_SESSAO_EVENTO, RegistroPresenca.id_contexto.in_(ids_sessoes),
            RegistroPresenca.id_pessoa == id_pessoa,
        ).distinct().count()
        percentual = Decimal(presentes) / Decimal(len(ids_sessoes)) * 100
        nivel = NIVEL_SESSOES
    else:
        return {"nivel": NIVEL_INDISPONIVEL, "percentual": None, "limite_aplicado": limite, "elegivel": False}

    percentual = percentual.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return {"nivel": nivel, "percentual": percentual, "limite_aplicado": limite, "elegivel": percentual >= limite}


def listar_elegibilidade_evento(db: Session, *, id_evento: int) -> list[dict]:
    inscricoes = (
        db.query(Inscricao)
        .filter(
            Inscricao.contexto_tipo.in_([CONTEXTO_EVENTO, CONTEXTO_SESSAO_EVENTO]),
            Inscricao.id_contexto.in_([id_evento, *_ids_sessoes_do_evento(db, id_evento)]),
            Inscricao.status != CANCELADO,
        )
        .all()
    )
    ids_pessoas_vistas: set[int] = set()
    resultado = []
    for inscricao_registro in inscricoes:
        if inscricao_registro.id_pessoa in ids_pessoas_vistas:
            continue
        ids_pessoas_vistas.add(inscricao_registro.id_pessoa)
        pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == inscricao_registro.id_pessoa).first()
        elegibilidade = calcular_elegibilidade(db, id_evento=id_evento, id_pessoa=inscricao_registro.id_pessoa)
        resultado.append({
            "id_pessoa": inscricao_registro.id_pessoa,
            "nome_completo": pessoa.nome_completo if pessoa else None,
            **elegibilidade,
        })
    return resultado


def _emitir_documento_de_evento(
    db: Session, *, codigo_template: str, id_evento: int, id_pessoa: int, id_usuario: Optional[int],
    codigo_verificacao: Optional[str], qr_conteudo: Optional[str],
):
    evento = obter_evento(db, id_evento)
    pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa).first()
    if not pessoa:
        raise HTTPException(status_code=404, detail="Pessoa não encontrada.")

    variaveis = {
        "nome_completo": pessoa.nome_completo, "titulo_evento": evento.titulo,
        "data_evento": evento.data_hora_inicio.strftime("%d/%m/%Y"),
        "carga_horaria_horas": str(evento.carga_horaria_horas) if evento.carga_horaria_horas is not None else "",
    }
    return servico_documentos.emitir_documento(
        db, codigo_template=codigo_template, variaveis=variaveis, contexto_tipo=CONTEXTO_EVENTO,
        id_contexto=id_evento, id_pessoa=id_pessoa, id_usuario=id_usuario,
        codigo_verificacao=codigo_verificacao, qr_conteudo=qr_conteudo,
    )


def emitir_cracha(db: Session, *, id_evento: int, id_pessoa: int, id_usuario: Optional[int]):
    """Etiqueta de identificação, emitida perto do check-in - nunca depende de elegibilidade (que
    só existe pra certificado). O QR do crachá reaproveita `Inscricao.codigo_checkin` - o crachá
    impresso vira o crachá reescaneável em qualquer check-in/check-out seguinte."""
    inscricao_registro = db.query(Inscricao).filter(
        Inscricao.contexto_tipo == CONTEXTO_EVENTO, Inscricao.id_contexto == id_evento, Inscricao.id_pessoa == id_pessoa,
    ).first()
    qr_conteudo = inscricao_registro.codigo_checkin if inscricao_registro else None
    return _emitir_documento_de_evento(
        db, codigo_template="CRACHA_EVENTO", id_evento=id_evento, id_pessoa=id_pessoa, id_usuario=id_usuario,
        codigo_verificacao=None, qr_conteudo=qr_conteudo,
    )


def emitir_certificado(db: Session, *, id_evento: int, id_pessoa: int, id_usuario: Optional[int], url_base_verificacao: str):
    elegibilidade = calcular_elegibilidade(db, id_evento=id_evento, id_pessoa=id_pessoa)
    if elegibilidade["nivel"] == NIVEL_INDISPONIVEL:
        raise HTTPException(
            status_code=400,
            detail="Este evento não tem carga horária nem sessões configuradas - não é possível calcular elegibilidade de certificado.",
        )
    if not elegibilidade["elegivel"]:
        raise HTTPException(
            status_code=400,
            detail=f"Percentual de presença ({elegibilidade['percentual']}%) abaixo do mínimo exigido ({elegibilidade['limite_aplicado']}%).",
        )

    codigo_verificacao = gerar_codigo_verificacao_documento()
    qr_conteudo = f"{url_base_verificacao.rstrip('/')}/certificado/verificar/{codigo_verificacao}"
    documento = _emitir_documento_de_evento(
        db, codigo_template="CERTIFICADO_EVENTO", id_evento=id_evento, id_pessoa=id_pessoa, id_usuario=id_usuario,
        codigo_verificacao=codigo_verificacao, qr_conteudo=qr_conteudo,
    )
    return documento
