"""v5.5 (FASE 5) - o CONTEXTO público de projetos e eventos, montado só com campos explícitos.

A página de um projeto (ex.: o Despertai) e a de um evento mostram, além dos dados dele, tudo que está ligado a ele no
sistema: as edições, os relatórios e documentos aprovados, as fotos (com autorização de imagem). As notícias vêm do Directus e
são ligadas no build do site pelo número do projeto/evento.

Regras (cada uma tem teste em tests/test_contexto_publico.py):
  - só aparece o que a diretoria JÁ liberou: evento Público, projeto Público, documento Aprovado para o site, foto com
    autorização de imagem;
  - evento ligado a um projeto Interno não revela o projeto (o campo vem vazio): projeto interno responde 404 como sempre;
  - nunca quem enviou/aprovou, termo de autorização, nome do arquivo no armazenamento, responsável, centro de custo ou valores."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.documentos import APROVADO, FORMATO_TEXTO, TIPOS as TIPOS_DE_DOCUMENTO, DocumentoInstitucional
from app.models.eventos import Evento, FotoEvento
from app.models.projetos import ProjetoEvento
from app.services import eventos_fotos

VISIBILIDADE_PUBLICA = "Pública"
FOTOS_NA_PAGINA_DO_PROJETO = 12
_VINCULOS_PUBLICOS = ("evento", "projeto")


def dia_de_belem(valor: Optional[datetime]) -> Optional[str]:
    """Instante gravado em UTC -> dia no relógio de Parauapebas (UTC-3, sem horário de verão): uma aprovação às 22h do dia
    10 está gravada como dia 11 em UTC, e o público tem que ler dia 10."""
    return (valor - timedelta(hours=3)).date().isoformat() if valor else None


# ------------------------------------------------------------------------------------------------ documentos
def documentos_publicos(db: Session) -> list[DocumentoInstitucional]:
    return (
        db.query(DocumentoInstitucional)
        .filter(DocumentoInstitucional.situacao == APROVADO, DocumentoInstitucional.publicar_no_site.is_(True),
                or_(DocumentoInstitucional.publico_nome.isnot(None), DocumentoInstitucional.publico_formato == FORMATO_TEXTO))
        .order_by(DocumentoInstitucional.ano.desc().nullslast(), DocumentoInstitucional.titulo, DocumentoInstitucional.versao.desc())
        .all()
    )


def vinculos_visiveis(db: Session) -> dict[str, set[int]]:
    """Os eventos e projetos que têm página no site. O documento aprovado só mostra a ligação com um deles; ligado a evento ou
    projeto INTERNO ele continua na lista da Transparência (foi aprovado para isso), mas sem revelar que o interno existe."""
    return {
        "evento": {i for (i,) in db.query(Evento.id_evento).filter(Evento.visibilidade == VISIBILIDADE_PUBLICA)},
        "projeto": ids_de_projetos_publicos(db),
    }


def serializar_documento_publico(d: DocumentoInstitucional, visiveis: dict[str, set[int]] | None = None) -> dict:
    ligado = d.vinculo_tipo in _VINCULOS_PUBLICOS and (visiveis is None or d.vinculo_id in visiveis.get(d.vinculo_tipo, ()))
    return {
        "id_documento": d.id_documento, "tipo_codigo": d.tipo, "tipo": TIPOS_DE_DOCUMENTO.get(d.tipo, d.tipo),
        "titulo": d.titulo, "descricao": d.descricao,
        "data_documento": d.data_documento.isoformat() if d.data_documento else None, "ano": d.ano,
        "versao": d.versao, "vigente": bool(d.vigente),
        "paginas": d.publico_paginas, "tamanho": d.publico_tamanho, "sha256": d.publico_sha256,
        "aprovado_em": dia_de_belem(d.aprovado_em),
        # "PDF": o site copia o arquivo; "TEXTO": o site monta uma página com o texto (detalhe abaixo)
        "formato": d.publico_formato or "PDF",
        "arquivo": None if d.publico_formato == FORMATO_TEXTO else f"/api/publico/transparencia/documentos/{d.id_documento}/arquivo",
        # a que evento/projeto o documento pertence (só esses dois: a ligação com ata ou parceria não é do site)
        "vinculo_tipo": d.vinculo_tipo if ligado else None, "vinculo_id": d.vinculo_id if ligado else None,
    }


def documentos_ligados(db: Session, vinculos: list[tuple[str, int]]) -> list[dict]:
    """Documentos aprovados ligados a qualquer um dos (tipo, id) pedidos."""
    if not vinculos:
        return []
    desejados = set(vinculos)
    return [
        serializar_documento_publico(d) for d in documentos_publicos(db)
        if d.vinculo_tipo in _VINCULOS_PUBLICOS and (d.vinculo_tipo, d.vinculo_id) in desejados
    ]


# ------------------------------------------------------------------------------------------------ projetos e eventos
def ids_de_projetos_publicos(db: Session) -> set[int]:
    return {i for (i,) in db.query(ProjetoEvento.id_projeto).filter(ProjetoEvento.visibilidade == VISIBILIDADE_PUBLICA)}


def projeto_publico(db: Session, id_projeto: Optional[int]) -> Optional[ProjetoEvento]:
    if id_projeto is None:
        return None
    return (
        db.query(ProjetoEvento)
        .filter(ProjetoEvento.id_projeto == id_projeto, ProjetoEvento.visibilidade == VISIBILIDADE_PUBLICA).first()
    )


def eventos_publicos_do_projeto(db: Session, id_projeto: int) -> list[Evento]:
    """Edições e eventos do projeto, o mais recente primeiro."""
    return (
        db.query(Evento)
        .filter(Evento.id_projeto == id_projeto, Evento.visibilidade == VISIBILIDADE_PUBLICA)
        .order_by(Evento.data_hora_inicio.desc(), Evento.id_evento.desc()).all()
    )


def resumo_do_evento(e: Evento) -> dict:
    return {
        "id_evento": e.id_evento, "titulo": e.titulo, "categoria": e.categoria,
        "data_hora_inicio": e.data_hora_inicio, "data_hora_fim": e.data_hora_fim, "endereco_avulso": e.endereco_avulso,
    }


def edicoes_publicas(db: Session, evento: Evento) -> list[dict]:
    """A cadeia de edições deste evento (da mais antiga para a mais nova), só as Públicas, marcando a atual."""
    from app.services.eventos import listar_cadeia_edicoes  # import tardio: eventos importa este pacote de serviços

    return [
        {**resumo_do_evento(e), "atual": e.id_evento == evento.id_evento}
        for e in listar_cadeia_edicoes(db, id_evento=evento.id_evento) if e.visibilidade == VISIBILIDADE_PUBLICA
    ]


# ------------------------------------------------------------------------------------------------ fotos
def _foto_com_evento(foto: FotoEvento) -> dict:
    return {**eventos_fotos.para_o_publico(foto), "id_evento": foto.id_evento}


def fotos_publicas_do_evento(db: Session, id_evento: int) -> list[dict]:
    return [
        eventos_fotos.para_o_publico(f)
        for f in db.query(FotoEvento).filter(FotoEvento.id_evento == id_evento, FotoEvento.autorizacao_imagem.is_(True)).order_by(FotoEvento.id_foto)
    ]


def fotos_publicas_do_projeto(db: Session, ids_de_eventos: list[int]) -> list[dict]:
    """As fotos mais recentes dos eventos públicos do projeto (a galeria da página dele)."""
    if not ids_de_eventos:
        return []
    fotos = (
        db.query(FotoEvento)
        .filter(FotoEvento.id_evento.in_(ids_de_eventos), FotoEvento.autorizacao_imagem.is_(True))
        .order_by(FotoEvento.id_foto.desc()).limit(FOTOS_NA_PAGINA_DO_PROJETO).all()
    )
    return [_foto_com_evento(f) for f in fotos]


def foto_publica(db: Session, id_evento: int, id_foto: int) -> Optional[FotoEvento]:
    """A foto, se o evento é Público e a autorização de imagem foi confirmada; senão None (a rota responde 404 igual para tudo)."""
    evento = db.query(Evento).filter(Evento.id_evento == id_evento, Evento.visibilidade == VISIBILIDADE_PUBLICA).first()
    if evento is None:
        return None
    return (
        db.query(FotoEvento)
        .filter(FotoEvento.id_foto == id_foto, FotoEvento.id_evento == id_evento, FotoEvento.autorizacao_imagem.is_(True)).first()
    )


# ------------------------------------------------------------------------------------------------ montagem
def contexto_do_projeto(db: Session, projeto: ProjetoEvento) -> dict:
    eventos = eventos_publicos_do_projeto(db, projeto.id_projeto)
    vinculos = [("projeto", projeto.id_projeto)] + [("evento", e.id_evento) for e in eventos]
    return {
        "eventos": [resumo_do_evento(e) for e in eventos],
        "documentos": documentos_ligados(db, vinculos),
        "fotos": fotos_publicas_do_projeto(db, [e.id_evento for e in eventos]),
    }


def contexto_do_evento(db: Session, evento: Evento) -> dict:
    projeto = projeto_publico(db, evento.id_projeto)
    return {
        "projeto": {"id_projeto": projeto.id_projeto, "nome": projeto.nome_projeto} if projeto else None,
        "edicoes": edicoes_publicas(db, evento),
        "documentos": documentos_ligados(db, [("evento", evento.id_evento)]),
        "fotos": fotos_publicas_do_evento(db, evento.id_evento),
    }
