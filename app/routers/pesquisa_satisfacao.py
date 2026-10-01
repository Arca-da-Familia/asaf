"""v4.10 (FASE 4) - resposta pública (sem login) da pesquisa de satisfação pós-evento, autenticada
só pelo token opaco do convite (mesmo estilo de `/carteirinha/verificar/{token}`,
`/portaria/*`) - rate limitado por IP, mesmo mecanismo já usado pelas demais rotas públicas de
evento (`app/services/protecao_publica.py`)."""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.schemas.pesquisa_satisfacao import PesquisaSatisfacaoResponder
from app.services import eventos as servico_eventos
from app.services import pesquisa_satisfacao as servico_pesquisa_satisfacao
from app.services.protecao_publica import limitar_taxa_por_ip

router = APIRouter()


def _ip_publico(request: Request) -> str:
    encaminhado = request.headers.get("x-forwarded-for")
    if encaminhado:
        return encaminhado.split(",")[0].strip()
    return (request.client.host if request.client else None) or "desconhecido"


@router.get("/pesquisa-satisfacao/{token}", summary="Dados mínimos da pesquisa de satisfação (sem login)")
def obter_pesquisa_satisfacao_endpoint(token: str, request: Request, db: Session = Depends(get_db)):
    limitar_taxa_por_ip(db, ip=_ip_publico(request), rota="obter-pesquisa-satisfacao", limite=20, janela_minutos=10)
    convite = servico_pesquisa_satisfacao.obter_por_token(db, token=token)
    evento = servico_eventos.obter_evento(db, convite.id_evento)
    return {
        "titulo_evento": evento.titulo,
        "ja_respondido": convite.respondido_em is not None,
    }


@router.post("/pesquisa-satisfacao/{token}/responder", summary="Responder a pesquisa de satisfação (sem login)")
def responder_pesquisa_satisfacao_endpoint(token: str, dados: PesquisaSatisfacaoResponder, request: Request, db: Session = Depends(get_db)):
    limitar_taxa_por_ip(db, ip=_ip_publico(request), rota="responder-pesquisa-satisfacao", limite=10, janela_minutos=10)
    convite = servico_pesquisa_satisfacao.responder(db, token=token, nota=dados.nota, comentario=dados.comentario)
    registrar_auditoria(
        db, None, "respostas_pesquisa_satisfacao", "RESPONDER_PUBLICO", id_registro_afetado=convite.id_resposta,
        dados_depois={"id_evento": convite.id_evento}, ip_origem=_ip_publico(request),
    )
    return {"mensagem": "Obrigado pela resposta!"}
