"""v4.8 (FASE 4) - emissão/verificação/revogação do token de operação da portaria. Ver
`app/models/portaria.py` pro porquê de ser um token persistido (revogável no meio do evento),
não um JWT puro como a carteirinha."""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.portaria import TokenPortaria
from app.security import _bearer_scheme, criar_token_portaria, decodificar_token_portaria
from app.services.eventos import obter_evento


def emitir_token_portaria(
    db: Session, *, id_evento: int, descricao: Optional[str], horas_validade: int, id_usuario: Optional[int],
) -> tuple[TokenPortaria, str]:
    obter_evento(db, id_evento)
    if horas_validade < 1 or horas_validade > 24 * 30:
        raise HTTPException(status_code=422, detail="Validade do token deve ser entre 1 hora e 30 dias.")

    registro = TokenPortaria(
        id_evento=id_evento, descricao=descricao,
        expira_em=datetime.utcnow() + timedelta(hours=horas_validade), id_usuario_criacao=id_usuario,
    )
    db.add(registro)
    db.commit()
    db.refresh(registro)

    token = criar_token_portaria(registro.id_token_portaria, id_evento, horas_validade=horas_validade)
    return registro, token


def listar_tokens_portaria(db: Session, *, id_evento: int) -> list[TokenPortaria]:
    return (
        db.query(TokenPortaria)
        .filter(TokenPortaria.id_evento == id_evento)
        .order_by(TokenPortaria.criado_em.desc())
        .all()
    )


def revogar_token_portaria(db: Session, *, id_evento: int, id_token_portaria: int, id_usuario: Optional[int]) -> TokenPortaria:
    registro = db.query(TokenPortaria).filter(
        TokenPortaria.id_token_portaria == id_token_portaria, TokenPortaria.id_evento == id_evento,
    ).first()
    if not registro:
        raise HTTPException(status_code=404, detail="Token de portaria não encontrado para este evento.")
    if registro.revogado_em is not None:
        raise HTTPException(status_code=400, detail="Este token já estava revogado.")
    registro.revogado_em = datetime.utcnow()
    registro.id_usuario_revogacao = id_usuario
    db.commit()
    db.refresh(registro)
    return registro


def verificar_token_portaria(db: Session, token: str) -> TokenPortaria:
    """Decodifica o JWT (prova posse) e confere a linha persistida (prova que não foi revogado) -
    as duas checagens juntas, nunca só uma. Expiração pura já é tratada pelo `jwt.decode` dentro
    de `decodificar_token_portaria`."""
    payload = decodificar_token_portaria(token)
    registro = db.query(TokenPortaria).filter(TokenPortaria.id_token_portaria == payload["id_token_portaria"]).first()
    if not registro:
        raise HTTPException(status_code=401, detail="Token de portaria inválido.")
    if registro.revogado_em is not None:
        raise HTTPException(status_code=401, detail="Este token de portaria foi revogado.")
    return registro


def exigir_token_portaria(
    credenciais: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
    db: Session = Depends(get_db),
) -> TokenPortaria:
    """Dependency da portaria - equivalente a `exigir_permissao`, mas sem exigir usuário logado
    (é o ponto central do requisito "sem login de quem opera a portaria")."""
    if credenciais is None:
        raise HTTPException(status_code=401, detail="Token de portaria ausente.")
    return verificar_token_portaria(db, credenciais.credentials)
