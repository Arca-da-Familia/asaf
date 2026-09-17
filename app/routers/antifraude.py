"""v3.7 (FASE 3) - controles antifraude além do mínimo: relatório de exceção mensal de padrões
suspeitos (para o Conselho Fiscal) e fechamento mensal com conciliação obrigatória (divergência
aberta bloqueia o fechamento). Segue o mesmo padrão de autenticação/auditoria do financeiro
(`exigir_permissao("financeiro")`, `registrar_auditoria` na escrita)."""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.schemas.fechamento import FechamentoMensalCriar
from app.security import exigir_permissao
from app.services import antifraude, fechamento

router = APIRouter()
_permissao_financeiro = exigir_permissao("financeiro")


def _ip_origem(request: Request) -> str:
    return request.client.host if request.client else None


@router.get("/api/antifraude/padroes-suspeitos", summary="Relatório de exceção mensal - padrões suspeitos (Conselho Fiscal)")
def padroes_suspeitos_endpoint(competencia: str, db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    return antifraude.relatorio_padroes_suspeitos(db, competencia=competencia)


def _serializar_fechamento(f) -> dict:
    return {
        "id_fechamento": f.id_fechamento, "competencia": f.competencia, "id_conta_financeira": f.id_conta_financeira,
        "saldo_sistema": f.saldo_sistema, "saldo_extrato_bancario": f.saldo_extrato_bancario,
        "divergencia": f.divergencia, "id_usuario_conferencia": f.id_usuario_conferencia, "assinado_em": f.assinado_em,
    }


@router.get("/api/fechamentos-mensais/", summary="Listar Fechamentos Mensais (conciliação assinada)")
def listar_fechamentos_endpoint(competencia: str = None, db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    return [_serializar_fechamento(f) for f in fechamento.listar_fechamentos(db, competencia=competencia)]


@router.post("/api/fechamentos-mensais/", summary="Fechar o mês (exige saldo do sistema = saldo do extrato bancário)")
def fechar_mes_endpoint(dados: FechamentoMensalCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    novo = fechamento.fechar_mes(
        db, competencia=dados.competencia, id_conta_financeira=dados.id_conta_financeira,
        saldo_extrato_bancario=dados.saldo_extrato_bancario, id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "fechamentos_mensais", "CREATE", id_registro_afetado=novo.id_fechamento,
        dados_depois={"competencia": novo.competencia, "id_conta_financeira": novo.id_conta_financeira, "saldo_sistema": str(novo.saldo_sistema)},
        ip_origem=_ip_origem(request),
    )
    return _serializar_fechamento(novo)
