"""v1.7 - extraído de app/routers/situacao.py (onde vivia como `_validar_motivo_em_catalogo`,
privado e usado só ali) para ser reaproveitado por qualquer módulo que precise validar um código
contra um catálogo de sistema/usuário (v0.3.1), em vez de duplicar a mesma consulta."""
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.core import Catalogo, OpcaoCatalogo


def validar_codigo_em_catalogo(db: Session, chave_catalogo: str, codigo: str, rotulo_erro: str) -> None:
    """Levanta HTTPException 422 se `codigo` não for uma opção ativa do catálogo `chave_catalogo`."""
    catalogo = db.query(Catalogo).filter(Catalogo.chave == chave_catalogo).first()
    valido = (
        catalogo
        and db.query(OpcaoCatalogo)
        .filter(OpcaoCatalogo.id_catalogo == catalogo.id_catalogo, OpcaoCatalogo.codigo == codigo, OpcaoCatalogo.ativo == True)
        .first()
    )
    if not valido:
        raise HTTPException(status_code=422, detail=f"{rotulo_erro} inválido: '{codigo}'.")
