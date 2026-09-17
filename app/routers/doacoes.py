"""v3.4 (FASE 3) - doações, captação e recibos. Segue o mesmo padrão de autenticação/auditoria de
todo o financeiro (`exigir_permissao("financeiro")`, `registrar_auditoria` em toda escrita)."""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.doacoes import CampanhaArrecadacao, Doacao, RemanejamentoDestinacao
from app.models.financeiro import CentroDeCusto
from app.schemas.doacoes import CampanhaArrecadacaoCriar, DoacaoCriar, RemanejamentoDestinacaoCriar
from app.security import exigir_permissao
from app.services import doacoes

router = APIRouter()
_permissao_financeiro = exigir_permissao("financeiro")


def _ip_origem(request: Request) -> str:
    return request.client.host if request.client else None


# ==========================================
# CAMPANHAS DE ARRECADAÇÃO
# ==========================================
@router.get("/api/campanhas-arrecadacao/", summary="Listar Campanhas de Arrecadação")
def listar_campanhas(db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    campanhas = db.query(CampanhaArrecadacao).order_by(CampanhaArrecadacao.criado_em.desc()).all()
    resultado = []
    for c in campanhas:
        arrecadado = sum((d.valor for d in db.query(Doacao).filter(Doacao.id_campanha == c.id_campanha).all()), 0)
        resultado.append({
            "id_campanha": c.id_campanha, "titulo": c.titulo, "descricao": c.descricao,
            "meta_valor": c.meta_valor, "prazo": c.prazo, "id_centro_custo": c.id_centro_custo,
            "ativa": c.ativa, "valor_arrecadado": arrecadado,
        })
    return resultado


@router.post("/api/campanhas-arrecadacao/", summary="Cadastrar Campanha de Arrecadação")
def cadastrar_campanha(dados: CampanhaArrecadacaoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    if dados.id_centro_custo and not db.query(CentroDeCusto).filter(CentroDeCusto.id_centro_custo == dados.id_centro_custo).first():
        raise HTTPException(status_code=404, detail="Centro de custo não encontrado.")
    nova = CampanhaArrecadacao(
        titulo=dados.titulo, descricao=dados.descricao, meta_valor=dados.meta_valor, prazo=dados.prazo,
        id_centro_custo=dados.id_centro_custo, id_usuario_criacao=usuario.id_usuario,
    )
    db.add(nova)
    db.commit()
    db.refresh(nova)
    registrar_auditoria(
        db, usuario, "campanhas_arrecadacao", "CREATE", id_registro_afetado=nova.id_campanha,
        dados_depois={"titulo": nova.titulo, "meta_valor": str(nova.meta_valor)}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Campanha cadastrada.", "id_campanha": nova.id_campanha}


@router.put("/api/campanhas-arrecadacao/{id_campanha}/ativa", summary="Ativar/Encerrar Campanha de Arrecadação")
def alternar_campanha(id_campanha: int, ativa: bool, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    campanha = db.query(CampanhaArrecadacao).filter(CampanhaArrecadacao.id_campanha == id_campanha).first()
    if not campanha:
        raise HTTPException(status_code=404, detail="Campanha não encontrada.")
    dados_antes = {"ativa": campanha.ativa}
    campanha.ativa = ativa
    db.commit()
    registrar_auditoria(
        db, usuario, "campanhas_arrecadacao", "UPDATE", id_registro_afetado=campanha.id_campanha,
        dados_antes=dados_antes, dados_depois={"ativa": campanha.ativa}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Campanha atualizada."}


# ==========================================
# DOAÇÕES
# ==========================================
@router.get("/api/doacoes/", summary="Listar Doações")
def listar_doacoes(id_campanha: int = None, db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    consulta = db.query(Doacao)
    if id_campanha:
        consulta = consulta.filter(Doacao.id_campanha == id_campanha)
    doacoes_lista = consulta.order_by(Doacao.data_doacao.desc()).all()
    return [
        {
            "id_doacao": d.id_doacao, "anonima": d.anonima, "nome_doador": d.nome_doador,
            "documento_doador": d.documento_doador, "id_associado": d.id_associado,
            "tipo_doacao": d.tipo_doacao, "recorrente": d.recorrente, "valor": d.valor,
            "descricao_bem": d.descricao_bem, "id_campanha": d.id_campanha,
            "id_centro_custo_destinacao": d.id_centro_custo_destinacao,
            "numero_recibo": d.numero_recibo, "id_titulo": d.id_titulo,
            "data_doacao": d.data_doacao.date().isoformat() if d.data_doacao else None,
        }
        for d in doacoes_lista
    ]


@router.post("/api/doacoes/", summary="Registrar Doação")
def registrar_doacao_endpoint(dados: DoacaoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    doacao = doacoes.registrar_doacao(
        db, anonima=dados.anonima, nome_doador=dados.nome_doador, documento_doador=dados.documento_doador,
        id_associado=dados.id_associado, tipo_doacao=dados.tipo_doacao, recorrente=dados.recorrente,
        valor=dados.valor, descricao_bem=dados.descricao_bem, id_campanha=dados.id_campanha,
        id_centro_custo_destinacao=dados.id_centro_custo_destinacao, id_conta_contabil=dados.id_conta_contabil,
        id_conta_contabil_caixa=str(dados.id_conta_contabil_caixa) if dados.id_conta_contabil_caixa else None,
        id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "doacoes", "CREATE", id_registro_afetado=doacao.id_doacao,
        dados_depois={"tipo_doacao": doacao.tipo_doacao, "valor": str(doacao.valor), "numero_recibo": doacao.numero_recibo},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Doação registrada.", "id_doacao": doacao.id_doacao, "numero_recibo": doacao.numero_recibo}


@router.get("/api/doacoes/{id_doacao}/recibo", summary="Gerar texto do Recibo de Doação")
def obter_recibo(id_doacao: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    doacao = db.query(Doacao).filter(Doacao.id_doacao == id_doacao).first()
    if not doacao:
        raise HTTPException(status_code=404, detail="Doação não encontrada.")
    return {"texto": doacoes.gerar_texto_recibo(db, doacao)}


# ==========================================
# REMANEJAMENTO DE DESTINAÇÃO (saldo restrito)
# ==========================================
@router.put("/api/centros-custo/{id_centro_custo}/saldo-restrito", summary="Marcar/desmarcar centro de custo como destinação restrita")
def alternar_saldo_restrito(id_centro_custo: int, saldo_restrito: bool, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    """v3.4 - liga a checagem de saldo restrito neste centro de custo (bloqueia aprovação de
    compra, v3.3, se o saldo de doações não cobrir) - centro de custo comum nunca precisa disso."""
    centro = db.query(CentroDeCusto).filter(CentroDeCusto.id_centro_custo == id_centro_custo).first()
    if not centro:
        raise HTTPException(status_code=404, detail="Centro de custo não encontrado.")
    dados_antes = {"saldo_restrito": centro.saldo_restrito}
    centro.saldo_restrito = saldo_restrito
    db.commit()
    registrar_auditoria(
        db, usuario, "centros_de_custo", "UPDATE", id_registro_afetado=centro.id_centro_custo,
        dados_antes=dados_antes, dados_depois={"saldo_restrito": centro.saldo_restrito}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Centro de custo atualizado."}


@router.get("/api/centros-custo/{id_centro_custo}/saldo-restrito", summary="Saldo disponível de um centro de custo com destinação restrita")
def obter_saldo_restrito(id_centro_custo: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    if not db.query(CentroDeCusto).filter(CentroDeCusto.id_centro_custo == id_centro_custo).first():
        raise HTTPException(status_code=404, detail="Centro de custo não encontrado.")
    return {"saldo_disponivel": doacoes.saldo_disponivel_centro_custo(db, id_centro_custo)}


@router.get("/api/remanejamentos-destinacao/", summary="Listar Remanejamentos de Destinação")
def listar_remanejamentos(db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    remanejamentos = db.query(RemanejamentoDestinacao).order_by(RemanejamentoDestinacao.data_remanejamento.desc()).all()
    return [
        {
            "id_remanejamento": r.id_remanejamento, "id_centro_custo_origem": r.id_centro_custo_origem,
            "id_centro_custo_destino": r.id_centro_custo_destino, "valor": r.valor, "motivo": r.motivo,
            "data_remanejamento": r.data_remanejamento.date().isoformat() if r.data_remanejamento else None,
        }
        for r in remanejamentos
    ]


@router.post("/api/remanejamentos-destinacao/", summary="Registrar Remanejamento de Destinação")
def registrar_remanejamento_endpoint(dados: RemanejamentoDestinacaoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    remanejamento = doacoes.registrar_remanejamento(
        db, id_centro_custo_origem=dados.id_centro_custo_origem, id_centro_custo_destino=dados.id_centro_custo_destino,
        valor=dados.valor, motivo=dados.motivo, id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "remanejamentos_destinacao", "CREATE", id_registro_afetado=remanejamento.id_remanejamento,
        dados_depois={
            "id_centro_custo_origem": remanejamento.id_centro_custo_origem,
            "id_centro_custo_destino": remanejamento.id_centro_custo_destino, "valor": str(remanejamento.valor),
            "motivo": remanejamento.motivo,
        },
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Remanejamento registrado.", "id_remanejamento": remanejamento.id_remanejamento}
