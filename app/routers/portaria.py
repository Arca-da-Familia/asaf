"""v4.8 (FASE 4) - portaria de evento: check-in/check-out sem login, autenticado só pelo token de
operação escopado a um evento (`exigir_token_portaria`, ver app/services/portaria.py). Rotas fora
de `/api/` (mesmo estilo de `/carteirinha/verificar/{token}`) porque isto é a superfície pensada
pra ser chamada por um dispositivo sem sessão de painel - inclusive, no futuro, pelo site
institucional (Astro, outro repositório), não só por este painel."""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.portaria import TokenPortaria
from app.schemas.portaria import CheckinPortariaCriar, CheckoutPortariaCriar
from app.services import checkin as servico_checkin
from app.services.eventos import obter_evento
from app.services.portaria import exigir_token_portaria
from app.services.protecao_publica import ip_publico as _ip_publico

router = APIRouter()


@router.get("/portaria/evento", summary="Dados mínimos do evento para o cabeçalho da tela da portaria (sem login)")
def obter_evento_da_portaria_endpoint(db: Session = Depends(get_db), token: TokenPortaria = Depends(exigir_token_portaria)):
    evento = obter_evento(db, token.id_evento)
    return {
        "id_evento": evento.id_evento, "titulo": evento.titulo,
        "data_hora_inicio": evento.data_hora_inicio, "data_hora_fim": evento.data_hora_fim,
    }


@router.post("/portaria/checkin", summary="Registrar check-in na portaria (sem login)")
def checkin_endpoint(
    dados: CheckinPortariaCriar, request: Request, db: Session = Depends(get_db),
    token: TokenPortaria = Depends(exigir_token_portaria),
):
    registro = servico_checkin.realizar_checkin(
        db, id_evento=token.id_evento, id_sessao=dados.id_sessao, metodo=dados.metodo, codigo=dados.codigo,
        token_carteirinha=dados.token_carteirinha, chave_idempotencia=dados.chave_idempotencia,
    )
    registrar_auditoria(
        db, None, "registros_presenca", "CHECKIN_PORTARIA", id_registro_afetado=registro.id_registro,
        dados_depois={
            "id_evento": token.id_evento, "id_token_portaria": token.id_token_portaria,
            "contexto_tipo": registro.contexto_tipo, "id_contexto": registro.id_contexto, "meio_registro": registro.meio_registro,
        },
        ip_origem=_ip_publico(request),
    )
    return {
        "mensagem": "Check-in registrado.", "id_registro": registro.id_registro,
        "contexto_tipo": registro.contexto_tipo, "id_contexto": registro.id_contexto, "hora_entrada": registro.hora_entrada,
    }


@router.post("/portaria/checkout", summary="Registrar check-out na portaria (sem login)")
def checkout_endpoint(
    dados: CheckoutPortariaCriar, request: Request, db: Session = Depends(get_db),
    token: TokenPortaria = Depends(exigir_token_portaria),
):
    registro = servico_checkin.realizar_checkout(
        db, id_evento=token.id_evento, id_sessao=dados.id_sessao, metodo=dados.metodo, codigo=dados.codigo,
        token_carteirinha=dados.token_carteirinha, chave_idempotencia=dados.chave_idempotencia,
    )
    registrar_auditoria(
        db, None, "registros_presenca", "CHECKOUT_PORTARIA", id_registro_afetado=registro.id_registro,
        dados_depois={"id_evento": token.id_evento, "id_token_portaria": token.id_token_portaria},
        ip_origem=_ip_publico(request),
    )
    return {"mensagem": "Check-out registrado.", "id_registro": registro.id_registro, "hora_saida": registro.hora_saida}
