"""v3.5 (FASE 3) - orçamento anual por conta/centro de custo (aprovado em assembleia, vinculado à
Deliberação), fluxo de caixa projetado e reserva de contingência. Segue o mesmo padrão de
autenticação/auditoria de todo o financeiro (`exigir_permissao("financeiro")`,
`registrar_auditoria` em toda escrita)."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.schemas.orcamento import OrcamentoCriar, ReservaContingenciaCriar
from app.security import exigir_permissao
from app.services import orcamento

router = APIRouter()
_permissao_financeiro = exigir_permissao("financeiro")


def _ip_origem(request: Request) -> str:
    return request.client.host if request.client else None


# ==========================================
# ORÇAMENTO
# ==========================================
@router.get("/api/orcamentos/", summary="Listar Orçamentos (realizado x previsto calculado na hora)")
def listar_orcamentos_endpoint(ano: Optional[int] = None, db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    return orcamento.listar_orcamentos(db, ano=ano)


@router.post("/api/orcamentos/", summary="Cadastrar Orçamento (exige deliberação de assembleia já concluída)")
def cadastrar_orcamento_endpoint(dados: OrcamentoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    novo = orcamento.criar_orcamento(
        db, ano=dados.ano, id_conta_contabil=dados.id_conta_contabil, id_centro_custo=dados.id_centro_custo,
        valor_previsto=dados.valor_previsto, id_deliberacao=dados.id_deliberacao, id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "orcamentos", "CREATE", id_registro_afetado=novo.id_orcamento,
        dados_depois={"ano": novo.ano, "id_conta_contabil": novo.id_conta_contabil, "id_centro_custo": novo.id_centro_custo, "valor_previsto": str(novo.valor_previsto)},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Orçamento cadastrado.", "id_orcamento": novo.id_orcamento}


# ==========================================
# FLUXO DE CAIXA PROJETADO
# ==========================================
@router.get("/api/fluxo-de-caixa/", summary="Fluxo de caixa projetado (horizonte configurável via HORIZONTE_FLUXO_CAIXA_MESES)")
def fluxo_de_caixa_endpoint(
    competencia_inicial: Optional[str] = None, horizonte_meses: Optional[int] = None,
    db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro),
):
    competencia = competencia_inicial or datetime.utcnow().strftime("%Y-%m")
    return orcamento.fluxo_de_caixa_projetado(db, competencia_inicial=competencia, horizonte_meses=horizonte_meses)


# ==========================================
# RESERVA DE CONTINGÊNCIA
# ==========================================
@router.get("/api/reservas-contingencia/", summary="Listar Reservas de Contingência")
def listar_reservas_contingencia_endpoint(db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    return orcamento.listar_reservas_contingencia(db)


@router.post("/api/reservas-contingencia/", summary="Cadastrar Reserva de Contingência")
def cadastrar_reserva_contingencia_endpoint(dados: ReservaContingenciaCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    nova = orcamento.criar_reserva_contingencia(
        db, id_conta_financeira=dados.id_conta_financeira, regra_uso=dados.regra_uso, valor_minimo=dados.valor_minimo,
        id_deliberacao=dados.id_deliberacao, id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "reservas_contingencia", "CREATE", id_registro_afetado=nova.id_reserva,
        dados_depois={"id_conta_financeira": nova.id_conta_financeira, "regra_uso": nova.regra_uso},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Reserva de contingência cadastrada.", "id_reserva": nova.id_reserva}
