"""v3.3 (FASE 3) - fornecedores (dados bancários versionados + segundo aprovador, situação
cadastral), alçadas de aprovação, delegação temporária, fluxo de compras
(solicitação→cotação→aprovação→pagamento) e reembolso de despesa. Segue o mesmo padrão de
autenticação/auditoria de todo o financeiro (`exigir_permissao("financeiro")`,
`registrar_auditoria` em toda escrita)."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.compras import AlcadaAprovacao, AprovacaoCompra, CotacaoCompra, DadosBancariosFornecedor, DelegacaoAprovacao, ReembolsoDespesa, SolicitacaoCompra, ContaAPagarRecorrente
from app.models.financeiro import Fornecedor
from app.schemas.compras import (
    AlcadaAprovacaoCriar, ContaAPagarRecorrenteCriar, CotacaoCompraCriar, DadosBancariosFornecedorCriar,
    DelegacaoAprovacaoCriar, GerarContasAPagarRequest, RejeitarDadosBancariosRequest, ReembolsoDespesaCriar,
    ReprovarSolicitacaoRequest, SolicitacaoCompraCriar,
)
from app.security import exigir_permissao
from app.services import compras, contas_a_pagar, fornecedores, reembolso

router = APIRouter()
_permissao_financeiro = exigir_permissao("financeiro")


def _ip_origem(request: Request) -> str:
    return request.client.host if request.client else None


# ==========================================
# FORNECEDORES: SITUAÇÃO CADASTRAL + DADOS BANCÁRIOS VERSIONADOS
# ==========================================
@router.post("/api/fornecedores/{id_fornecedor}/validar-situacao-cadastral", summary="Validar situação cadastral do fornecedor (Minha Receita)")
def validar_situacao_cadastral_endpoint(id_fornecedor: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    fornecedor = db.query(Fornecedor).filter(Fornecedor.id_fornecedor == id_fornecedor).first()
    if not fornecedor:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado.")
    situacao = fornecedores.validar_situacao_cadastral(db, fornecedor)
    return {"situacao_cadastral": situacao, "data_ultima_validacao_cadastral": fornecedor.data_ultima_validacao_cadastral}


@router.get("/api/fornecedores/{id_fornecedor}/dados-bancarios", summary="Listar histórico de dados bancários do fornecedor")
def listar_dados_bancarios(id_fornecedor: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    registros = db.query(DadosBancariosFornecedor).filter(DadosBancariosFornecedor.id_fornecedor == id_fornecedor).order_by(DadosBancariosFornecedor.data_solicitacao.desc()).all()
    return [
        {
            "id_dados_bancarios": r.id_dados_bancarios, "banco": r.banco, "agencia": r.agencia, "conta": r.conta,
            "tipo_conta": r.tipo_conta, "titular": r.titular, "status": r.status,
            "id_usuario_solicitante": r.id_usuario_solicitante, "id_usuario_aprovador": r.id_usuario_aprovador,
            "motivo_rejeicao": r.motivo_rejeicao, "data_solicitacao": r.data_solicitacao, "data_aprovacao": r.data_aprovacao,
        }
        for r in registros
    ]


@router.post("/api/fornecedores/dados-bancarios", summary="Solicitar troca de dados bancários de fornecedor")
def solicitar_dados_bancarios_endpoint(dados: DadosBancariosFornecedorCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    registro = fornecedores.solicitar_troca_dados_bancarios(
        db, id_fornecedor=dados.id_fornecedor, banco=dados.banco, agencia=dados.agencia, conta=dados.conta,
        tipo_conta=dados.tipo_conta, titular=dados.titular, id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "dados_bancarios_fornecedor", "CREATE", id_registro_afetado=registro.id_dados_bancarios,
        dados_depois={"id_fornecedor": registro.id_fornecedor, "banco": registro.banco, "agencia": registro.agencia},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Troca de dados bancários solicitada - aguardando segundo aprovador.", "id_dados_bancarios": registro.id_dados_bancarios}


@router.post("/api/fornecedores/dados-bancarios/{id_dados_bancarios}/aprovar", summary="Aprovar troca de dados bancários de fornecedor")
def aprovar_dados_bancarios_endpoint(id_dados_bancarios: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    registro = fornecedores.aprovar_dados_bancarios(db, id_dados_bancarios=id_dados_bancarios, id_usuario_aprovador=usuario.id_usuario)
    registrar_auditoria(
        db, usuario, "dados_bancarios_fornecedor", "APROVACAO", id_registro_afetado=registro.id_dados_bancarios,
        dados_depois={"status": registro.status}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Dados bancários aprovados."}


@router.post("/api/fornecedores/dados-bancarios/{id_dados_bancarios}/rejeitar", summary="Rejeitar troca de dados bancários de fornecedor")
def rejeitar_dados_bancarios_endpoint(id_dados_bancarios: int, dados: RejeitarDadosBancariosRequest, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    registro = fornecedores.rejeitar_dados_bancarios(db, id_dados_bancarios=id_dados_bancarios, motivo=dados.motivo, id_usuario_aprovador=usuario.id_usuario)
    registrar_auditoria(
        db, usuario, "dados_bancarios_fornecedor", "REJEICAO", id_registro_afetado=registro.id_dados_bancarios,
        dados_depois={"status": registro.status, "motivo": registro.motivo_rejeicao}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Dados bancários rejeitados."}


# ==========================================
# ALÇADAS DE APROVAÇÃO
# ==========================================
@router.get("/api/alcadas-aprovacao/", summary="Listar Alçadas de Aprovação")
def listar_alcadas(db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    alcadas = db.query(AlcadaAprovacao).order_by(AlcadaAprovacao.valor_minimo).all()
    return [
        {
            "id_alcada": a.id_alcada, "valor_minimo": a.valor_minimo, "valor_maximo": a.valor_maximo,
            "cargos_autorizados": a.cargos_autorizados.split(","), "exige_dupla_assinatura": a.exige_dupla_assinatura,
            "ativo": a.ativo,
        }
        for a in alcadas
    ]


@router.post("/api/alcadas-aprovacao/", summary="Cadastrar Alçada de Aprovação")
def cadastrar_alcada(dados: AlcadaAprovacaoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    nova = AlcadaAprovacao(
        valor_minimo=dados.valor_minimo, valor_maximo=dados.valor_maximo,
        cargos_autorizados=",".join(dados.cargos_autorizados), exige_dupla_assinatura=dados.exige_dupla_assinatura,
    )
    db.add(nova)
    db.commit()
    db.refresh(nova)
    registrar_auditoria(
        db, usuario, "alcadas_aprovacao", "CREATE", id_registro_afetado=nova.id_alcada,
        dados_depois={"valor_minimo": str(nova.valor_minimo), "valor_maximo": str(nova.valor_maximo) if nova.valor_maximo else None, "cargos_autorizados": nova.cargos_autorizados},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Alçada cadastrada.", "id_alcada": nova.id_alcada}


@router.put("/api/alcadas-aprovacao/{id_alcada}/ativo", summary="Ativar/Inativar Alçada de Aprovação")
def alternar_alcada(id_alcada: int, ativo: bool, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    alcada = db.query(AlcadaAprovacao).filter(AlcadaAprovacao.id_alcada == id_alcada).first()
    if not alcada:
        raise HTTPException(status_code=404, detail="Alçada não encontrada.")
    dados_antes = {"ativo": alcada.ativo}
    alcada.ativo = ativo
    db.commit()
    registrar_auditoria(
        db, usuario, "alcadas_aprovacao", "UPDATE", id_registro_afetado=alcada.id_alcada,
        dados_antes=dados_antes, dados_depois={"ativo": alcada.ativo}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Alçada atualizada."}


# ==========================================
# DELEGAÇÃO TEMPORÁRIA DE APROVAÇÃO
# ==========================================
@router.get("/api/delegacoes-aprovacao/", summary="Listar Delegações de Aprovação")
def listar_delegacoes(db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    delegacoes = db.query(DelegacaoAprovacao).order_by(DelegacaoAprovacao.data_inicio.desc()).all()
    return [
        {
            "id_delegacao": d.id_delegacao, "id_associado_delegante": d.id_associado_delegante,
            "id_associado_delegado": d.id_associado_delegado, "data_inicio": d.data_inicio,
            "data_fim": d.data_fim, "motivo": d.motivo,
        }
        for d in delegacoes
    ]


@router.post("/api/delegacoes-aprovacao/", summary="Registrar Delegação Temporária de Aprovação")
def registrar_delegacao(dados: DelegacaoAprovacaoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    data_fim = datetime.fromisoformat(dados.data_fim)
    data_inicio = datetime.fromisoformat(dados.data_inicio) if dados.data_inicio else datetime.utcnow()
    if data_fim <= data_inicio:
        raise HTTPException(status_code=400, detail="Data de fim deve ser depois da data de início.")
    nova = DelegacaoAprovacao(
        id_associado_delegante=dados.id_associado_delegante, id_associado_delegado=dados.id_associado_delegado,
        data_inicio=data_inicio, data_fim=data_fim, motivo=dados.motivo, id_usuario_registro=usuario.id_usuario,
    )
    db.add(nova)
    db.commit()
    db.refresh(nova)
    registrar_auditoria(
        db, usuario, "delegacoes_aprovacao", "CREATE", id_registro_afetado=nova.id_delegacao,
        dados_depois={"id_associado_delegante": nova.id_associado_delegante, "id_associado_delegado": nova.id_associado_delegado, "motivo": nova.motivo},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Delegação registrada.", "id_delegacao": nova.id_delegacao}


# ==========================================
# SOLICITAÇÃO DE COMPRA (solicitação → cotação → aprovação → pagamento)
# ==========================================
@router.get("/api/solicitacoes-compra/", summary="Listar Solicitações de Compra")
def listar_solicitacoes(status: str = None, db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    consulta = db.query(SolicitacaoCompra)
    if status:
        consulta = consulta.filter(SolicitacaoCompra.status == status)
    solicitacoes = consulta.order_by(SolicitacaoCompra.data_solicitacao.desc()).all()
    return [
        {
            "id_solicitacao": s.id_solicitacao, "descricao": s.descricao, "justificativa": s.justificativa,
            "id_fornecedor": s.id_fornecedor, "valor_estimado": s.valor_estimado, "id_conta_contabil": s.id_conta_contabil,
            "id_centro_custo": s.id_centro_custo, "status": s.status, "id_usuario_solicitante": s.id_usuario_solicitante,
            "motivo_reprovacao": s.motivo_reprovacao, "id_titulo_gerado": s.id_titulo_gerado, "data_solicitacao": s.data_solicitacao,
        }
        for s in solicitacoes
    ]


@router.post("/api/solicitacoes-compra/", summary="Criar Solicitação de Compra")
def criar_solicitacao_endpoint(dados: SolicitacaoCompraCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    solicitacao = compras.criar_solicitacao(
        db, descricao=dados.descricao, justificativa=dados.justificativa, id_fornecedor=dados.id_fornecedor,
        valor_estimado=dados.valor_estimado, id_conta_contabil=dados.id_conta_contabil, id_centro_custo=dados.id_centro_custo,
        id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "solicitacoes_compra", "CREATE", id_registro_afetado=solicitacao.id_solicitacao,
        dados_depois={"descricao": solicitacao.descricao, "valor_estimado": str(solicitacao.valor_estimado)},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Solicitação de compra criada.", "id_solicitacao": solicitacao.id_solicitacao}


@router.post("/api/solicitacoes-compra/{id_solicitacao}/cotacoes", summary="Registrar Cotação de uma Solicitação de Compra")
def registrar_cotacao_endpoint(id_solicitacao: int, dados: CotacaoCompraCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    cotacao = compras.registrar_cotacao(
        db, id_solicitacao=id_solicitacao, id_fornecedor=dados.id_fornecedor, valor=dados.valor, anexo=dados.anexo, id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "cotacoes_compra", "CREATE", id_registro_afetado=cotacao.id_cotacao,
        dados_depois={"id_solicitacao": cotacao.id_solicitacao, "id_fornecedor": cotacao.id_fornecedor, "valor": str(cotacao.valor)},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Cotação registrada.", "id_cotacao": cotacao.id_cotacao}


@router.get("/api/solicitacoes-compra/{id_solicitacao}/cotacoes", summary="Listar Cotações de uma Solicitação de Compra")
def listar_cotacoes(id_solicitacao: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    cotacoes = db.query(CotacaoCompra).filter(CotacaoCompra.id_solicitacao == id_solicitacao).order_by(CotacaoCompra.valor).all()
    return [
        {"id_cotacao": c.id_cotacao, "id_fornecedor": c.id_fornecedor, "valor": c.valor, "anexo": c.anexo, "data_cotacao": c.data_cotacao}
        for c in cotacoes
    ]


@router.post("/api/solicitacoes-compra/{id_solicitacao}/aprovar", summary="Aprovar Solicitação de Compra")
def aprovar_solicitacao_endpoint(id_solicitacao: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    resultado = compras.aprovar_solicitacao(db, id_solicitacao=id_solicitacao, id_usuario_aprovador=usuario.id_usuario)
    registrar_auditoria(
        db, usuario, "solicitacoes_compra", "APROVACAO", id_registro_afetado=id_solicitacao,
        dados_depois=resultado, ip_origem=_ip_origem(request),
    )
    return resultado


@router.post("/api/solicitacoes-compra/{id_solicitacao}/reprovar", summary="Reprovar Solicitação de Compra")
def reprovar_solicitacao_endpoint(id_solicitacao: int, dados: ReprovarSolicitacaoRequest, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    solicitacao = compras.reprovar_solicitacao(db, id_solicitacao=id_solicitacao, motivo=dados.motivo)
    registrar_auditoria(
        db, usuario, "solicitacoes_compra", "REPROVACAO", id_registro_afetado=solicitacao.id_solicitacao,
        dados_depois={"motivo": solicitacao.motivo_reprovacao}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Solicitação reprovada."}


@router.get("/api/solicitacoes-compra/{id_solicitacao}/aprovacoes", summary="Listar Aprovações de uma Solicitação de Compra")
def listar_aprovacoes(id_solicitacao: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    aprovacoes = db.query(AprovacaoCompra).filter(AprovacaoCompra.id_solicitacao == id_solicitacao).order_by(AprovacaoCompra.data_aprovacao).all()
    return [
        {"id_aprovacao": a.id_aprovacao, "id_usuario_aprovador": a.id_usuario_aprovador, "id_delegacao_usada": a.id_delegacao_usada, "data_aprovacao": a.data_aprovacao}
        for a in aprovacoes
    ]


# ==========================================
# REEMBOLSO DE DESPESA
# ==========================================
@router.get("/api/reembolsos-despesa/", summary="Listar Reembolsos de Despesa")
def listar_reembolsos(id_associado: int = None, db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    consulta = db.query(ReembolsoDespesa)
    if id_associado:
        consulta = consulta.filter(ReembolsoDespesa.id_associado == id_associado)
    reembolsos = consulta.order_by(ReembolsoDespesa.data_solicitacao.desc()).all()
    return [
        {
            "id_reembolso": r.id_reembolso, "id_associado": r.id_associado, "descricao": r.descricao,
            "valor": r.valor, "comprovante": r.comprovante, "status": r.status,
            "id_usuario_solicitante": r.id_usuario_solicitante, "id_usuario_aprovador": r.id_usuario_aprovador,
            "motivo_reprovacao": r.motivo_reprovacao, "id_titulo_gerado": r.id_titulo_gerado, "data_solicitacao": r.data_solicitacao,
        }
        for r in reembolsos
    ]


@router.post("/api/reembolsos-despesa/", summary="Solicitar Reembolso de Despesa")
def solicitar_reembolso_endpoint(dados: ReembolsoDespesaCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    reembolso_criado = reembolso.solicitar_reembolso(
        db, id_associado=dados.id_associado, descricao=dados.descricao, valor=dados.valor,
        comprovante=dados.comprovante, id_conta_contabil=dados.id_conta_contabil, id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "reembolsos_despesa", "CREATE", id_registro_afetado=reembolso_criado.id_reembolso,
        dados_depois={"id_associado": reembolso_criado.id_associado, "valor": str(reembolso_criado.valor)},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Reembolso solicitado.", "id_reembolso": reembolso_criado.id_reembolso}


@router.post("/api/reembolsos-despesa/{id_reembolso}/aprovar", summary="Aprovar Reembolso de Despesa")
def aprovar_reembolso_endpoint(id_reembolso: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    reembolso_aprovado = reembolso.aprovar_reembolso(db, id_reembolso=id_reembolso, id_usuario_aprovador=usuario.id_usuario)
    registrar_auditoria(
        db, usuario, "reembolsos_despesa", "APROVACAO", id_registro_afetado=reembolso_aprovado.id_reembolso,
        dados_depois={"status": reembolso_aprovado.status, "id_titulo_gerado": reembolso_aprovado.id_titulo_gerado},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Reembolso aprovado - título gerado.", "id_titulo_gerado": reembolso_aprovado.id_titulo_gerado}


@router.post("/api/reembolsos-despesa/{id_reembolso}/reprovar", summary="Reprovar Reembolso de Despesa")
def reprovar_reembolso_endpoint(id_reembolso: int, dados: ReprovarSolicitacaoRequest, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    reembolso_reprovado = reembolso.reprovar_reembolso(db, id_reembolso=id_reembolso, motivo=dados.motivo, id_usuario_aprovador=usuario.id_usuario)
    registrar_auditoria(
        db, usuario, "reembolsos_despesa", "REPROVACAO", id_registro_afetado=reembolso_reprovado.id_reembolso,
        dados_depois={"motivo": reembolso_reprovado.motivo_reprovacao}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Reembolso reprovado."}


# ==========================================
# CONTAS A PAGAR RECORRENTES
# ==========================================
@router.get("/api/contas-a-pagar-recorrentes/", summary="Listar Contas a Pagar Recorrentes")
def listar_contas_a_pagar_recorrentes(db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    contas = db.query(ContaAPagarRecorrente).order_by(ContaAPagarRecorrente.descricao).all()
    return [
        {
            "id_conta_recorrente": c.id_conta_recorrente, "descricao": c.descricao, "valor": c.valor,
            "id_conta_contabil": c.id_conta_contabil, "id_fornecedor": c.id_fornecedor,
            "dia_vencimento": c.dia_vencimento, "ativo": c.ativo,
        }
        for c in contas
    ]


@router.post("/api/contas-a-pagar-recorrentes/", summary="Cadastrar Conta a Pagar Recorrente")
def cadastrar_conta_a_pagar_recorrente(dados: ContaAPagarRecorrenteCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    nova = ContaAPagarRecorrente(
        descricao=dados.descricao, valor=dados.valor, id_conta_contabil=dados.id_conta_contabil,
        id_fornecedor=dados.id_fornecedor, dia_vencimento=dados.dia_vencimento,
    )
    db.add(nova)
    db.commit()
    db.refresh(nova)
    registrar_auditoria(
        db, usuario, "contas_a_pagar_recorrentes", "CREATE", id_registro_afetado=nova.id_conta_recorrente,
        dados_depois={"descricao": nova.descricao, "valor": str(nova.valor)}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Conta a pagar recorrente cadastrada.", "id_conta_recorrente": nova.id_conta_recorrente}


@router.put("/api/contas-a-pagar-recorrentes/{id_conta_recorrente}/ativo", summary="Ativar/Inativar Conta a Pagar Recorrente")
def alternar_conta_a_pagar_recorrente(id_conta_recorrente: int, ativo: bool, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    conta = db.query(ContaAPagarRecorrente).filter(ContaAPagarRecorrente.id_conta_recorrente == id_conta_recorrente).first()
    if not conta:
        raise HTTPException(status_code=404, detail="Conta a pagar recorrente não encontrada.")
    dados_antes = {"ativo": conta.ativo}
    conta.ativo = ativo
    db.commit()
    registrar_auditoria(
        db, usuario, "contas_a_pagar_recorrentes", "UPDATE", id_registro_afetado=conta.id_conta_recorrente,
        dados_antes=dados_antes, dados_depois={"ativo": conta.ativo}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Conta a pagar recorrente atualizada."}


@router.post("/api/contas-a-pagar-recorrentes/gerar/", summary="Gerar Contas a Pagar Recorrentes do mês (com prévia)")
def gerar_contas_a_pagar_endpoint(dados: GerarContasAPagarRequest, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    resultado = contas_a_pagar.gerar_contas_a_pagar(db, competencia=dados.competencia, confirmar=dados.confirmar, id_usuario=usuario.id_usuario)
    if dados.confirmar:
        registrar_auditoria(
            db, usuario, "titulos_financeiros", "GERACAO_CONTAS_A_PAGAR_RECORRENTES",
            dados_depois={"competencia": dados.competencia, "total_gerados": resultado["total_gerados"], "valor_total": str(resultado["valor_total"])},
            ip_origem=_ip_origem(request),
        )
    return resultado
