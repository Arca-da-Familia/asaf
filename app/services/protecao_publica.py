"""v4.6 (FASE 4) - proteção de endpoint público (rate limiting por IP, sem CAPTCHA comercial
pago) e geração de código de check-in/token de cancelamento para inscrição pública em evento."""
import os
import secrets
from datetime import datetime, timedelta

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from app.models.protecao_publica import TentativaAcessoPublico


def ip_publico(request: Request) -> str:
    """O IP de quem está do outro lado de verdade (limite por IP, auditoria da inscrição e do pedido de filiação).

    Atrás do ingress do Container App o `X-Forwarded-For` chega como `<o que o cliente mandou>, <IP que o ingress viu>`: o ÚLTIMO item é o que a
    infraestrutura anotou e não pode ser inventado por quem chama; o PRIMEIRO é do cliente (qualquer um manda `X-Forwarded-For: 1.2.3.4` e vira "outra
    pessoa" para o limite). Achado pelo teste de carga da homologação (2026-10-08): 400 pessoas de uma máquina só, com um primeiro item diferente em cada
    chamada, nunca foram barradas. Por isso vale o último.

    Só a API de TESTE liga `CONFIAR_NO_PRIMEIRO_IP=1`: o teste de carga simula centenas de pessoas a partir de uma máquina só e precisa que o primeiro item
    conte. A produção nunca define essa variável (tem teste que garante)."""
    encaminhado = request.headers.get("x-forwarded-for", "")
    itens = [i.strip() for i in encaminhado.split(",") if i.strip()]
    if itens:
        return itens[0] if os.environ.get("CONFIAR_NO_PRIMEIRO_IP") == "1" else itens[-1]
    return (request.client.host if request.client else None) or "desconhecido"


def limitar_taxa_por_ip(db: Session, *, ip: str, rota: str, limite: int, janela_minutos: int) -> None:
    """Levanta 429 se este IP já fez `limite` tentativas nesta `rota` na janela recente. Registra
    a tentativa ATUAL também (mesmo quando ainda dentro do limite) - contar só as anteriores
    deixaria o limite valer `limite + 1` de fato."""
    desde = datetime.utcnow() - timedelta(minutes=janela_minutos)
    total_recente = (
        db.query(TentativaAcessoPublico)
        .filter(TentativaAcessoPublico.ip == ip, TentativaAcessoPublico.rota == rota, TentativaAcessoPublico.criado_em >= desde)
        .count()
    )
    if total_recente >= limite:
        raise HTTPException(
            status_code=429,
            detail=f"Muitas tentativas - aguarde {janela_minutos} minutos antes de tentar novamente.",
        )
    db.add(TentativaAcessoPublico(ip=ip, rota=rota))
    db.commit()


def gerar_codigo_checkin() -> str:
    """8 caracteres hex maiúsculos - curto o bastante pra digitar na portaria (v4.8, quando
    existir), longo o bastante pra não colidir por acaso."""
    return secrets.token_hex(4).upper()


def gerar_token_cancelamento() -> str:
    return secrets.token_urlsafe(24)


def gerar_codigo_verificacao_documento() -> str:
    """v4.8 - código opaco de verificação pública de documento (crachá/certificado de evento,
    `/certificado/verificar/{codigo}`). Mais longo que `gerar_codigo_checkin` (16 vs 8 chars) -
    este precisa sobreviver anos num documento impresso/guardado, não só algumas horas digitado
    na portaria."""
    return secrets.token_hex(8).upper()
