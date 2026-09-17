"""v3.6 (FASE 3) - demonstrativos financeiros e prestação de contas do exercício. Segue o mesmo
padrão de autenticação/auditoria de todo o financeiro (`exigir_permissao("financeiro")`,
`registrar_auditoria` na geração da prestação de contas - os demais relatórios são só leitura)."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.schemas.relatorios import PrestacaoDeContasCriar
from app.security import exigir_permissao
from app.services import relatorios

router = APIRouter()
_permissao_financeiro = exigir_permissao("financeiro")


def _ip_origem(request: Request) -> str:
    return request.client.host if request.client else None


def _parse_data(valor: str, nome_campo: str) -> datetime:
    try:
        return datetime.fromisoformat(valor)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"'{nome_campo}' inválido - use o formato AAAA-MM-DD.")


@router.get("/api/relatorios/balancete", summary="Balancete por período (saldo anterior + movimento do período + saldo atual, por conta)")
def balancete_endpoint(data_inicio: str, data_fim: str, db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    return relatorios.balancete_por_periodo(db, data_inicio=_parse_data(data_inicio, "data_inicio"), data_fim=_parse_data(data_fim, "data_fim"))


@router.get("/api/relatorios/receitas-despesas", summary="Receitas x despesas do período, por conta")
def receitas_despesas_endpoint(data_inicio: str, data_fim: str, db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    return relatorios.receitas_e_despesas_por_conta(db, data_inicio=_parse_data(data_inicio, "data_inicio"), data_fim=_parse_data(data_fim, "data_fim"))


@router.get("/api/relatorios/receitas-despesas-por-centro-custo", summary="Receitas x despesas do período, por centro de custo")
def receitas_despesas_por_centro_custo_endpoint(data_inicio: str, data_fim: str, db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    return relatorios.receitas_e_despesas_por_centro_custo(db, data_inicio=_parse_data(data_inicio, "data_inicio"), data_fim=_parse_data(data_fim, "data_fim"))


@router.get("/api/relatorios/inadimplencia", summary="Relatório de inadimplência (associados com título vencido)")
def inadimplencia_endpoint(db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    return relatorios.relatorio_inadimplencia(db)


@router.get("/api/relatorios/extrato-conta-financeira/{id_conta_financeira}", summary="Extrato de uma Conta Financeira (movimentos + saldo corrente)")
def extrato_conta_financeira_endpoint(
    id_conta_financeira: int, data_inicio: Optional[str] = None, data_fim: Optional[str] = None,
    db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro),
):
    return relatorios.extrato_conta_financeira(
        db, id_conta_financeira=id_conta_financeira,
        data_inicio=_parse_data(data_inicio, "data_inicio") if data_inicio else None,
        data_fim=_parse_data(data_fim, "data_fim") if data_fim else None,
    )


@router.get("/api/relatorios/por-projeto", summary="Receitas x despesas do período, por projeto (via centro de custo vinculado)")
def relatorio_por_projeto_endpoint(data_inicio: str, data_fim: str, db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    return relatorios.relatorio_por_projeto(db, data_inicio=_parse_data(data_inicio, "data_inicio"), data_fim=_parse_data(data_fim, "data_fim"))


def _serializar_prestacao(p) -> dict:
    return {
        "id_prestacao": p.id_prestacao, "ano_exercicio": p.ano_exercicio, "versao": p.versao,
        "conteudo": p.conteudo, "id_parecer": p.id_parecer, "gerada_em": p.gerada_em,
    }


@router.get("/api/prestacoes-de-contas/", summary="Listar Prestações de Contas (histórico de versões por exercício)")
def listar_prestacoes_endpoint(ano_exercicio: Optional[int] = None, db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    return [_serializar_prestacao(p) for p in relatorios.listar_prestacoes_de_contas(db, ano_exercicio=ano_exercicio)]


@router.post("/api/prestacoes-de-contas/", summary="Gerar nova versão da Prestação de Contas de um exercício")
def gerar_prestacao_endpoint(dados: PrestacaoDeContasCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    prestacao = relatorios.gerar_prestacao_de_contas(db, ano_exercicio=dados.ano_exercicio, id_usuario=usuario.id_usuario)
    registrar_auditoria(
        db, usuario, "prestacoes_de_contas", "CREATE", id_registro_afetado=prestacao.id_prestacao,
        dados_depois={"ano_exercicio": prestacao.ano_exercicio, "versao": prestacao.versao},
        ip_origem=_ip_origem(request),
    )
    return _serializar_prestacao(prestacao)
