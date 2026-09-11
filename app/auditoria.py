"""Registro de auditoria - v0.1 do plano (base para LGPD/FASE 7 e segregação de
funções do Financeiro/FASE 3)."""
import json
from typing import Optional

from sqlalchemy.orm import Session

from app.models.core import AuditLog, Usuario


def _serializar(dados) -> Optional[str]:
    if dados is None:
        return None
    if isinstance(dados, str):
        return dados
    try:
        return json.dumps(dados, default=str, ensure_ascii=False)
    except TypeError:
        return str(dados)


def registrar_auditoria(
    db: Session,
    usuario: Optional[Usuario],
    tabela_afetada: str,
    acao: str,
    id_registro_afetado: Optional[int] = None,
    dados_antes=None,
    dados_depois=None,
    ip_origem: Optional[str] = None,
):
    entrada = AuditLog(
        id_usuario=usuario.id_usuario if usuario else None,
        tabela_afetada=tabela_afetada,
        id_registro_afetado=id_registro_afetado,
        acao=acao,
        dados_antes=_serializar(dados_antes),
        dados_depois=_serializar(dados_depois),
        ip_origem=ip_origem,
    )
    db.add(entrada)
    db.commit()
