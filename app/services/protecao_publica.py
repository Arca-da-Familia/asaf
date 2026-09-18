"""v4.6 (FASE 4) - proteção de endpoint público (rate limiting por IP, sem CAPTCHA comercial
pago) e geração de código de check-in/token de cancelamento para inscrição pública em evento."""
import secrets
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.protecao_publica import TentativaAcessoPublico


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
