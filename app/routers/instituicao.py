"""Módulo "Instituição": os dados da própria associação, cada campo marcado "vai para o site" ou "só interno" (ver app/services/instituicao.py).
Quem administra (permissão `gerenciar_acesso`, a mesma das demais configurações) lê e edita; a rota pública devolve só o que está marcado."""
from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.core import ConfiguracaoInstitucional
from app.security import exigir_permissao
from app.services import instituicao

router = APIRouter()
_permissao_instituicao = exigir_permissao("gerenciar_acesso")


def _ip_origem(request: Request) -> str:
    return request.client.host if request.client else "desconhecido"


class CampoDaInstituicaoAtualizar(BaseModel):
    valor: Optional[str] = None
    publico: Optional[bool] = None


@router.get("/api/instituicao/", summary="Dados da instituição (cada campo diz se vai para o site)")
def listar_dados_da_instituicao(db: Session = Depends(get_db), _usuario=Depends(_permissao_instituicao)):
    return instituicao.listar_campos(db)


@router.put("/api/instituicao/{chave}", summary="Editar um campo da instituição e/ou a marca 'vai para o site'")
def editar_campo_da_instituicao(
    chave: str, dados: CampoDaInstituicaoAtualizar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_instituicao),
):
    resultado = instituicao.atualizar_campo(db, chave=chave, valor=dados.valor, publico=dados.publico, id_usuario=usuario.id_usuario)
    config = db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao == chave).first()
    registrar_auditoria(
        db, usuario, "configuracoes_institucionais", "UPDATE_INSTITUICAO", id_registro_afetado=config.id_config if config else None,
        dados_antes={"campo": chave, **resultado["antes"]}, dados_depois={"campo": chave, **resultado["depois"]}, ip_origem=_ip_origem(request),
    )
    return {"chave": chave, **resultado["depois"]}


@router.get("/api/publico/instituicao", summary="Dados da instituição que o site pode mostrar (só os marcados 'vai para o site')")
def dados_publicos_da_instituicao(db: Session = Depends(get_db)):
    return instituicao.campos_publicos(db)
