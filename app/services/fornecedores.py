"""v3.3 (FASE 3) - validação automática de situação cadastral de fornecedor (API pública gratuita
"Minha Receita", que reorganiza dado público da Receita Federal sem CAPTCHA) e dados bancários
versionados com segundo aprovador obrigatório (a alteração de dados bancários de fornecedor é o
golpe mais comum contra organizações - a defesa é processual, não tecnológica)."""
from datetime import datetime
from typing import Optional

import httpx
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.compras import DadosBancariosFornecedor
from app.models.financeiro import Fornecedor

_MINHA_RECEITA_URL = "https://minhareceita.org/{cnpj}"
_TIMEOUT_SEGUNDOS = 8


def validar_situacao_cadastral(db: Session, fornecedor: Fornecedor) -> str:
    """Sem SLA garantido - NUNCA bloqueia o processo se a API estiver fora: registra "Não
    verificado" e segue com aprovação consciente (achado do usuário: fallback pra API oficial de
    dados abertos de CNPJ fica pra quando esse serviço se mostrar instável em uso real - por ora
    "Minha Receita" resolve sem custo nem chave de API)."""
    try:
        resposta = httpx.get(_MINHA_RECEITA_URL.format(cnpj=fornecedor.cnpj), timeout=_TIMEOUT_SEGUNDOS)
        resposta.raise_for_status()
        dados = resposta.json()
        situacao = dados.get("descricao_situacao_cadastral") or "Não verificado"
    except Exception:
        situacao = "Não verificado"

    fornecedor.situacao_cadastral = situacao
    fornecedor.data_ultima_validacao_cadastral = datetime.utcnow()
    db.commit()
    return situacao


def solicitar_troca_dados_bancarios(
    db: Session, *, id_fornecedor: int, banco: str, agencia: str, conta: str, tipo_conta: str,
    titular: str, id_usuario: int,
) -> DadosBancariosFornecedor:
    fornecedor = db.query(Fornecedor).filter(Fornecedor.id_fornecedor == id_fornecedor).first()
    if not fornecedor:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado.")
    novo = DadosBancariosFornecedor(
        id_fornecedor=id_fornecedor, banco=banco, agencia=agencia, conta=conta, tipo_conta=tipo_conta,
        titular=titular, status="Pendente", id_usuario_solicitante=id_usuario,
    )
    db.add(novo)
    db.commit()
    db.refresh(novo)
    return novo


def aprovar_dados_bancarios(db: Session, *, id_dados_bancarios: int, id_usuario_aprovador: int) -> DadosBancariosFornecedor:
    """v3.3 - segundo aprovador SEMPRE diferente de quem solicitou a troca - nunca a mesma pessoa
    pede e aprova a própria mudança de conta bancária de um fornecedor."""
    registro = db.query(DadosBancariosFornecedor).filter(DadosBancariosFornecedor.id_dados_bancarios == id_dados_bancarios).first()
    if not registro:
        raise HTTPException(status_code=404, detail="Solicitação de dados bancários não encontrada.")
    if registro.status != "Pendente":
        raise HTTPException(status_code=400, detail=f"Esta solicitação já está '{registro.status}'.")
    if registro.id_usuario_solicitante == id_usuario_aprovador:
        raise HTTPException(status_code=400, detail="Quem solicitou a troca de dados bancários não pode aprová-la - exige um segundo aprovador.")
    registro.status = "Aprovado"
    registro.id_usuario_aprovador = id_usuario_aprovador
    registro.data_aprovacao = datetime.utcnow()
    db.commit()
    db.refresh(registro)
    return registro


def rejeitar_dados_bancarios(db: Session, *, id_dados_bancarios: int, motivo: str, id_usuario_aprovador: int) -> DadosBancariosFornecedor:
    registro = db.query(DadosBancariosFornecedor).filter(DadosBancariosFornecedor.id_dados_bancarios == id_dados_bancarios).first()
    if not registro:
        raise HTTPException(status_code=404, detail="Solicitação de dados bancários não encontrada.")
    if registro.status != "Pendente":
        raise HTTPException(status_code=400, detail=f"Esta solicitação já está '{registro.status}'.")
    registro.status = "Rejeitado"
    registro.motivo_rejeicao = motivo
    registro.id_usuario_aprovador = id_usuario_aprovador
    registro.data_aprovacao = datetime.utcnow()
    db.commit()
    db.refresh(registro)
    return registro


def dados_bancarios_vigentes(db: Session, id_fornecedor: int) -> Optional[DadosBancariosFornecedor]:
    return (
        db.query(DadosBancariosFornecedor)
        .filter(DadosBancariosFornecedor.id_fornecedor == id_fornecedor, DadosBancariosFornecedor.status == "Aprovado")
        .order_by(DadosBancariosFornecedor.data_aprovacao.desc())
        .first()
    )
