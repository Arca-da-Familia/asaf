"""v5.7d - o QR da carteirinha NÃO vale por tempo indeterminado (decisão do Presidente, 2026-10-15: "não existe isso; pode ser 10 dias, 20 dias").

A verificação pública (`GET /carteirinha/verificar/{token}`) devolve o nome, a foto do cadastro e a situação de quem o QR identifica, sem login: quem tem o link vê isso enquanto o token valer. Antes
o token valia 365 dias. Agora a validade vem de Configurações > Regras do sistema (`DIAS_VALIDADE_CARTEIRINHA`, padrão 15) e é aplicada na EMISSÃO e na LEITURA: um token emitido com validade maior (os
de 365 dias que já existam) também deixa de valer assim que passam os dias da regra contados da emissão (`iat`). Vale igual para a portaria e para o credenciamento de assembleia, que usam o mesmo QR."""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.config_cache import obter_configuracao
from app.security import criar_token_carteirinha, decodificar_token_carteirinha

CHAVE_DA_VALIDADE = "DIAS_VALIDADE_CARTEIRINHA"
DIAS_PADRAO = 15
# o Presidente falou em "10 dias, 20 dias": a regra não passa de 20, mesmo que alguém grave um número maior em Configurações
DIAS_MAXIMO = 20


def dias_de_validade(db: Session) -> int:
    valor = obter_configuracao(db, CHAVE_DA_VALIDADE, str(DIAS_PADRAO))
    try:
        dias = int(float(str(valor).strip()))
    except (TypeError, ValueError, OverflowError):
        return DIAS_PADRAO
    return min(dias, DIAS_MAXIMO) if dias >= 1 else DIAS_PADRAO


def emitir(db: Session, id_pessoa: int) -> str:
    return criar_token_carteirinha(id_pessoa, dias_validade=dias_de_validade(db))


def decodificar(db: Session, token: str) -> dict:
    """O que `decodificar_token_carteirinha` já confere (assinatura, tipo, `exp`) mais a regra dos dias contados da emissão. O `exp` devolvido é o MENOR entre o do token e o da regra: é o que a
    verificação pública mostra como "válido até"."""
    payload = decodificar_token_carteirinha(token)
    emitida = payload.get("iat")
    if not isinstance(emitida, (int, float)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Carteirinha inválida ou expirada.")
    limite = datetime.fromtimestamp(emitida, tz=timezone.utc) + timedelta(days=dias_de_validade(db))
    if datetime.now(timezone.utc) > limite:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Carteirinha inválida ou expirada.")
    payload["exp"] = min(int(payload["exp"]), int(limite.timestamp()))
    return payload
