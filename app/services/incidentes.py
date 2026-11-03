"""v7.4b (FASE 7) - o registro de incidentes de segurança e o ensaio anual.

Decisões do Presidente (2026-10-30): comunicar à ANPD e às pessoas atingidas em **3 dias úteis** contados de quando a ASAF soube que o incidente atingiu dado
pessoal (o prazo comum da Resolução CD/ANPD nº 15/2024, mesmo podendo ter o dobro por ser associação pequena); a comunicação só é obrigatória quando há risco
ou dano relevante às pessoas; todo incidente fica registrado por pelo menos 5 anos (aqui: para sempre, não há rota de apagar); as pessoas são avisadas por
e-mail, pelo painel (quem tem conta) e pelo site (quando não der para achar a pessoa); um **ensaio por ano** (incidente de mentira, sem avisar ninguém de fora).

Os dias úteis contam de segunda a sexta, sem os feriados: o prazo fica igual ou mais curto que o da lei (o lado seguro). O dia em que a ASAF soube conta pela
hora de Belém (a sede)."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.core import Usuario
from app.models.privacidade import (
    A_AVALIAR, ABERTO, ENCERRADO, RELEVANTE, RISCOS, SEM_RISCO_RELEVANTE, IncidenteDeSeguranca,
)

DIAS_UTEIS_PARA_COMUNICAR = 3
FUSO_DA_SEDE = ZoneInfo("America/Belem")
DIAS_ENTRE_ENSAIOS = 365
ROTULOS_DO_RISCO = {
    A_AVALIAR: "Risco ainda não avaliado",
    RELEVANTE: "Risco ou dano relevante: comunicar à ANPD e às pessoas",
    SEM_RISCO_RELEVANTE: "Sem risco relevante: fica só no registro",
}
# o que se pode preencher depois de registrar (o número, o tipo, quando foi registrado e QUANDO A ASSOCIAÇÃO SOUBE não mudam: v7.5c, achado do Ponto de
# Revisão 3/3 - o prazo de 3 dias úteis conta dessa data, e mudá-la depois tirava o incidente de "vencido" sem deixar o valor novo na Auditoria)
CAMPOS_EDITAVEIS = (
    "titulo", "descricao", "ocorrido_em", "dados_afetados", "pessoas_afetadas", "quantidade_estimada", "contencao", "risco", "motivo_do_risco",
    "comunicado_anpd_em", "protocolo_anpd", "comunicado_pessoas_em", "como_pessoas", "licao_aprendida", "acao_corretiva",
)


def dia_na_sede(momento: datetime) -> date:
    """O dia (em Belém) de um momento guardado em UTC sem fuso."""
    return momento.replace(tzinfo=ZoneInfo("UTC")).astimezone(FUSO_DA_SEDE).date()


def somar_dias_uteis(inicio: date, dias: int) -> date:
    atual = inicio
    while dias > 0:
        atual += timedelta(days=1)
        if atual.weekday() < 5:
            dias -= 1
    return atual


def prazo_para_comunicar(conhecido_em: datetime) -> date:
    return somar_dias_uteis(dia_na_sede(conhecido_em), DIAS_UTEIS_PARA_COMUNICAR)


def situacao_do_prazo(i: IncidenteDeSeguranca, hoje: date) -> str:
    """`sem_obrigacao` (sem risco relevante), `comunicado` (ANPD e pessoas avisadas), `ensaio`, ou, para o que ainda precisa ou pode precisar comunicar:
    `no_prazo`, `vence_hoje` ou `vencido`."""
    if i.ensaio:
        return "ensaio"
    if i.risco == SEM_RISCO_RELEVANTE:
        return "sem_obrigacao"
    if i.risco == RELEVANTE and i.comunicado_anpd_em and i.comunicado_pessoas_em:
        return "comunicado"
    prazo = prazo_para_comunicar(i.conhecido_em)
    return "vencido" if hoje > prazo else "vence_hoje" if hoje == prazo else "no_prazo"


def comunicado_fora_do_prazo(i: IncidenteDeSeguranca) -> bool:
    """v7.5c: a comunicação (à ANPD ou às pessoas) foi feita depois do prazo de 3 dias úteis? Fica marcada, não escondida."""
    prazo = prazo_para_comunicar(i.conhecido_em)
    return any(quando is not None and dia_na_sede(quando) > prazo for quando in (i.comunicado_anpd_em, i.comunicado_pessoas_em))


def serializar(i: IncidenteDeSeguranca, hoje: date) -> dict:
    return {
        "id_incidente": i.id_incidente, "numero": i.numero, "ensaio": bool(i.ensaio), "titulo": i.titulo, "descricao": i.descricao,
        "ocorrido_em": i.ocorrido_em, "conhecido_em": i.conhecido_em, "dados_afetados": i.dados_afetados, "pessoas_afetadas": i.pessoas_afetadas,
        "quantidade_estimada": i.quantidade_estimada, "contencao": i.contencao, "risco": i.risco, "risco_rotulo": ROTULOS_DO_RISCO.get(i.risco, i.risco),
        "motivo_do_risco": i.motivo_do_risco, "comunicado_anpd_em": i.comunicado_anpd_em, "protocolo_anpd": i.protocolo_anpd,
        "comunicado_pessoas_em": i.comunicado_pessoas_em, "como_pessoas": i.como_pessoas, "licao_aprendida": i.licao_aprendida, "acao_corretiva": i.acao_corretiva,
        "situacao": i.situacao, "encerrado_em": i.encerrado_em, "registrado_em": i.registrado_em, "precedente": i.id_usuario_registro is None,
        "prazo_para_comunicar": prazo_para_comunicar(i.conhecido_em).isoformat(), "situacao_do_prazo": situacao_do_prazo(i, hoje),
        "comunicado_fora_do_prazo": comunicado_fora_do_prazo(i),
    }


def ensaios(db: Session, hoje: date) -> dict:
    """O último ensaio encerrado e até quando fazer o próximo (um por ano). Sem nenhum ensaio ainda, o primeiro está pendente."""
    ultimo = db.query(func.max(IncidenteDeSeguranca.encerrado_em)).filter(IncidenteDeSeguranca.ensaio.is_(True), IncidenteDeSeguranca.situacao == ENCERRADO).scalar()
    if ultimo is None:
        return {"ultimo_ensaio_em": None, "proximo_ate": None, "pendente": True}
    proximo = dia_na_sede(ultimo) + timedelta(days=DIAS_ENTRE_ENSAIOS)
    return {"ultimo_ensaio_em": ultimo, "proximo_ate": proximo.isoformat(), "pendente": hoje > proximo}


def hoje_na_sede(agora: Optional[datetime] = None) -> date:
    return dia_na_sede(agora or datetime.utcnow())


def listar(db: Session, agora: Optional[datetime] = None) -> dict:
    hoje = hoje_na_sede(agora)
    itens = db.query(IncidenteDeSeguranca).order_by(IncidenteDeSeguranca.numero.desc()).all()
    return {"itens": [serializar(i, hoje) for i in itens], "ensaios": ensaios(db, hoje), "hoje": hoje.isoformat(),
            "dias_uteis_para_comunicar": DIAS_UTEIS_PARA_COMUNICAR}


def _texto(valor: Optional[str], minimo: int, nome: str) -> str:
    texto = (valor or "").strip()
    if len(texto) < minimo:
        raise HTTPException(status_code=422, detail=f"Escreva {nome} (pelo menos {minimo} letras).")
    return texto


def _datas_coerentes(conhecido_em: datetime, ocorrido_em: Optional[datetime], agora: datetime) -> None:
    if conhecido_em > agora + timedelta(minutes=5):
        raise HTTPException(status_code=422, detail="A data em que a associação soube do incidente não pode estar no futuro.")
    if ocorrido_em and ocorrido_em > conhecido_em:
        raise HTTPException(status_code=422, detail="O incidente não pode ter acontecido depois de a associação saber dele.")


def registrar(db: Session, usuario: Usuario, *, titulo: str, descricao: str, conhecido_em: datetime, ensaio: bool = False,
              ocorrido_em: Optional[datetime] = None, agora: Optional[datetime] = None) -> IncidenteDeSeguranca:
    agora = agora or datetime.utcnow()
    _datas_coerentes(conhecido_em, ocorrido_em, agora)
    numero = (db.query(func.max(IncidenteDeSeguranca.numero)).scalar() or 0) + 1
    i = IncidenteDeSeguranca(
        numero=numero, ensaio=ensaio, titulo=_texto(titulo, 5, "o título"), descricao=_texto(descricao, 10, "o que aconteceu"), conhecido_em=conhecido_em,
        ocorrido_em=ocorrido_em, risco=A_AVALIAR, situacao=ABERTO, registrado_em=agora, id_usuario_registro=usuario.id_usuario,
    )
    db.add(i)
    db.flush()
    return i


def _aberto(db: Session, id_incidente: int) -> IncidenteDeSeguranca:
    i = db.get(IncidenteDeSeguranca, id_incidente)
    if i is None:
        raise HTTPException(status_code=404, detail="Incidente não encontrado.")
    if i.situacao == ENCERRADO:
        raise HTTPException(status_code=409, detail="Este registro já está encerrado: o que foi registrado fica como está.")
    return i


def atualizar(db: Session, usuario: Usuario, id_incidente: int, dados: dict, agora: Optional[datetime] = None) -> tuple[IncidenteDeSeguranca, list[str]]:
    """Devolve o incidente e os campos que MUDARAM de verdade (o painel manda todos; a Auditoria guarda só os que mudaram)."""
    agora = agora or datetime.utcnow()
    i = _aberto(db, id_incidente)
    if "conhecido_em" in dados and dados["conhecido_em"] != i.conhecido_em:
        raise HTTPException(status_code=422, detail="A data em que a associação soube não muda depois do registro: o prazo de comunicação conta dela.")
    mudaram = []
    for campo, valor in dados.items():
        if campo not in CAMPOS_EDITAVEIS:
            continue
        if isinstance(valor, str):
            valor = valor.strip() or None
        if getattr(i, campo) != valor:
            mudaram.append(campo)
        setattr(i, campo, valor)
    if i.risco not in RISCOS:
        raise HTTPException(status_code=422, detail="Escolha a avaliação do risco da lista.")
    _texto(i.titulo, 5, "o título")
    _texto(i.descricao, 10, "o que aconteceu")
    _datas_coerentes(i.conhecido_em, i.ocorrido_em, agora)
    for quando, nome in ((i.comunicado_anpd_em, "comunicação à ANPD"), (i.comunicado_pessoas_em, "comunicação às pessoas")):
        if quando and (quando < i.conhecido_em or quando > agora + timedelta(minutes=5)):
            raise HTTPException(status_code=422, detail=f"A data da {nome} tem de ser entre o dia em que a associação soube e hoje.")
    if i.ensaio and (i.comunicado_anpd_em or i.protocolo_anpd):
        raise HTTPException(status_code=422, detail="Ensaio não se comunica à ANPD: é um incidente de mentira, para treinar.")
    i.atualizado_em, i.id_usuario_atualizacao = agora, usuario.id_usuario
    db.flush()
    return i, sorted(mudaram)


def o_que_falta_para_encerrar(i: IncidenteDeSeguranca) -> list[str]:
    falta = []
    if i.risco == A_AVALIAR:
        falta.append("avaliar o risco")
    if not (i.motivo_do_risco or "").strip():
        falta.append("o motivo da avaliação do risco")
    if not (i.contencao or "").strip():
        falta.append("o que foi feito para conter")
    if i.risco == RELEVANTE and not i.ensaio:
        if not i.comunicado_anpd_em:
            falta.append("a data da comunicação à ANPD")
        if not i.comunicado_pessoas_em or not (i.como_pessoas or "").strip():
            falta.append("a data e o meio da comunicação às pessoas atingidas")
    if not (i.licao_aprendida or "").strip():
        falta.append("a lição aprendida")
    return falta


def encerrar(db: Session, usuario: Usuario, id_incidente: int, agora: Optional[datetime] = None) -> IncidenteDeSeguranca:
    agora = agora or datetime.utcnow()
    i = _aberto(db, id_incidente)
    falta = o_que_falta_para_encerrar(i)
    if falta:
        raise HTTPException(status_code=422, detail="Para encerrar falta: " + "; ".join(falta) + ".")
    i.situacao, i.encerrado_em = ENCERRADO, agora
    i.atualizado_em, i.id_usuario_atualizacao = agora, usuario.id_usuario
    db.flush()
    return i
