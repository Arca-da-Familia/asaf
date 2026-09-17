"""v3.0 (FASE 3) - fundamentos contábeis do módulo: partida dobrada real (todo lançamento é um
cabeçalho `LancamentoContabil` com N `PartidaContabil` de débito/crédito, sempre balanceado -
soma dos débitos = soma dos créditos, nunca confiar em entrada direta, ver
app/services/contabilidade.py), Exercício contábil com abertura/fechamento formal, valor
monetário sempre `Numeric`/`Decimal`, imutabilidade do lançamento (correção = estorno + novo
lançamento) e `AuditLog` em toda operação.

Corrige também a pendência crítica registrada pela v1.1 (2026-09-13): este router inteiro
(plano de contas, fornecedores, títulos, baixa de título, livro-caixa) nunca teve autenticação
nem auditoria - é o "item 0" que o cabeçalho da FASE 3 exige antes de qualquer v3.x. Segue o
mesmo padrão já usado em app/routers/conselho_fiscal.py (`exigir_permissao("financeiro")`,
`registrar_auditoria` em toda escrita).

As páginas HTML `/admin/...` que existiam aqui (protótipo pré-plano, com abas numeradas em vez
de módulo) foram removidas em 2026-09-15 - o painel único (painel.asaf.org.br, decisão congelada
4.1) é a única interface administrativa deste sistema daqui em diante. Só ficam as rotas
`/api/...` (e as de escrita sem prefixo, mantidas por compatibilidade de URL) que o painel
consome."""
import os
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.associados import Associado
from app.models.financeiro import (
    CentroDeCusto, ContaFinanceira, Exercicio, LancamentoContabil, PartidaContabil,
    PlanoDeContas, Fornecedor, TituloFinanceiro,
)
from app.schemas.financeiro import (
    CentroDeCustoCriar, ContaFinanceiraCriar, EstornoCriar, ExercicioAbrir, PlanoContaCriar,
    FornecedorCriar, TituloCriar, BaixarTitulo, TransferenciaCriar,
)
from app.security import exigir_permissao
from app.services import contabilidade
from app.services.categoria_associado import recalcular_categoria_associado

router = APIRouter()
_permissao_financeiro = exigir_permissao("financeiro")


def _ip_origem(request: Request) -> str:
    return request.client.host if request.client else None


# ==========================================
# EXERCÍCIO CONTÁBIL
# ==========================================
@router.get("/api/exercicios/", summary="Listar Exercícios Contábeis")
def listar_exercicios(db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    exercicios = db.query(Exercicio).order_by(Exercicio.ano.desc()).all()
    return [
        {
            "id_exercicio": e.id_exercicio, "ano": e.ano, "status": e.status,
            "data_abertura": e.data_abertura, "data_fechamento": e.data_fechamento,
        }
        for e in exercicios
    ]


@router.post("/api/exercicios/", summary="Abrir Exercício Contábil")
def abrir_exercicio(dados: ExercicioAbrir, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    if db.query(Exercicio).filter(Exercicio.status == "Aberto").first():
        raise HTTPException(status_code=400, detail="Já existe um exercício aberto. Feche-o antes de abrir outro.")
    if db.query(Exercicio).filter(Exercicio.ano == dados.ano).first():
        raise HTTPException(status_code=400, detail="Já existe um exercício cadastrado para este ano.")
    exercicio = Exercicio(ano=dados.ano, status="Aberto", id_usuario_abertura=usuario.id_usuario)
    db.add(exercicio)
    db.commit()
    db.refresh(exercicio)
    registrar_auditoria(
        db, usuario, "exercicios_contabeis", "ABERTURA", id_registro_afetado=exercicio.id_exercicio,
        dados_depois={"ano": exercicio.ano}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Exercício aberto.", "id_exercicio": exercicio.id_exercicio}


@router.post("/api/exercicios/{id_exercicio}/fechar", summary="Fechar Exercício Contábil")
def fechar_exercicio(id_exercicio: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    exercicio = db.query(Exercicio).filter(Exercicio.id_exercicio == id_exercicio).first()
    if not exercicio:
        raise HTTPException(status_code=404, detail="Exercício não encontrado.")
    if exercicio.status != "Aberto":
        raise HTTPException(status_code=400, detail="Este exercício já está fechado.")
    from datetime import datetime
    exercicio.status = "Fechado"
    exercicio.data_fechamento = datetime.utcnow()
    exercicio.id_usuario_fechamento = usuario.id_usuario
    db.commit()
    registrar_auditoria(
        db, usuario, "exercicios_contabeis", "FECHAMENTO", id_registro_afetado=exercicio.id_exercicio,
        dados_depois={"ano": exercicio.ano}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Exercício fechado."}


# ==========================================
# PLANO DE CONTAS
# ==========================================
def _validar_pai(db: Session, codigo_contabil_pai: str, codigo_contabil_propria: str = None) -> None:
    if codigo_contabil_pai is None:
        return
    if codigo_contabil_pai == codigo_contabil_propria:
        raise HTTPException(status_code=400, detail="Uma conta não pode ser pai de si mesma.")
    if not db.query(PlanoDeContas).filter(PlanoDeContas.codigo_contabil == codigo_contabil_pai).first():
        raise HTTPException(status_code=404, detail=f"Conta pai '{codigo_contabil_pai}' não encontrada.")


@router.get("/api/plano-contas/", summary="Listar Plano de Contas")
def listar_plano_contas(db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    contas = db.query(PlanoDeContas).order_by(PlanoDeContas.codigo_contabil).all()
    codigos_com_filha = {c.codigo_contabil_pai for c in contas if c.codigo_contabil_pai}
    return [
        {
            "id_conta": c.id_conta, "codigo_contabil": c.codigo_contabil, "descricao_conta": c.descricao_conta,
            "tipo": c.tipo, "codigo_contabil_pai": c.codigo_contabil_pai,
            "sintetica": c.codigo_contabil in codigos_com_filha,
        }
        for c in contas
    ]


@router.post("/plano-contas/", summary="Cadastrar Plano de Contas")
def cadastrar_plano_contas(dados: PlanoContaCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    contabilidade.natureza_da_conta(dados.tipo)  # 400 se o tipo não for um dos cinco tipos contábeis reais
    _validar_pai(db, dados.codigo_contabil_pai)
    nova_conta = PlanoDeContas(
        codigo_contabil=dados.codigo_contabil, descricao_conta=dados.descricao_conta, tipo=dados.tipo,
        codigo_contabil_pai=dados.codigo_contabil_pai,
    )
    db.add(nova_conta)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Já existe uma conta com esse código contábil.")
    db.refresh(nova_conta)
    registrar_auditoria(
        db, usuario, "plano_de_contas", "CREATE", id_registro_afetado=nova_conta.id_conta,
        dados_depois={
            "codigo_contabil": nova_conta.codigo_contabil, "descricao_conta": nova_conta.descricao_conta,
            "tipo": nova_conta.tipo, "codigo_contabil_pai": nova_conta.codigo_contabil_pai,
        },
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Conta contábil cadastrada.", "id_conta": nova_conta.id_conta}


@router.put("/api/plano-contas/{id_conta}", summary="Editar Plano de Contas")
def editar_plano_contas(id_conta: int, dados: PlanoContaCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    conta = db.query(PlanoDeContas).filter(PlanoDeContas.id_conta == id_conta).first()
    if not conta:
        raise HTTPException(status_code=404, detail="Conta contábil não encontrada.")
    contabilidade.natureza_da_conta(dados.tipo)  # 400 se o tipo não for um dos cinco tipos contábeis reais
    _validar_pai(db, dados.codigo_contabil_pai, codigo_contabil_propria=conta.codigo_contabil)
    dados_antes = {"codigo_contabil": conta.codigo_contabil, "descricao_conta": conta.descricao_conta, "tipo": conta.tipo, "codigo_contabil_pai": conta.codigo_contabil_pai}
    conta.codigo_contabil = dados.codigo_contabil
    conta.descricao_conta = dados.descricao_conta
    conta.tipo = dados.tipo
    conta.codigo_contabil_pai = dados.codigo_contabil_pai
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Já existe uma conta com esse código contábil.")
    registrar_auditoria(
        db, usuario, "plano_de_contas", "UPDATE", id_registro_afetado=conta.id_conta,
        dados_antes=dados_antes,
        dados_depois={"codigo_contabil": conta.codigo_contabil, "descricao_conta": conta.descricao_conta, "tipo": conta.tipo, "codigo_contabil_pai": conta.codigo_contabil_pai},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Conta contábil atualizada."}


@router.delete("/api/plano-contas/{id_conta}", summary="Excluir Plano de Contas")
def excluir_plano_contas(id_conta: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    """v3.1 - bloqueio de exclusão de conta com movimento: nunca se apaga uma conta que já
    recebeu lançamento, título, ou que é uma `ContaFinanceira`/conta pai de outra - a única
    correção possível pra conta com movimento é estorno + reclassificação, nunca remoção."""
    conta = db.query(PlanoDeContas).filter(PlanoDeContas.id_conta == id_conta).first()
    if not conta:
        raise HTTPException(status_code=404, detail="Conta contábil não encontrada.")
    if db.query(PlanoDeContas.id_conta).filter(PlanoDeContas.codigo_contabil_pai == conta.codigo_contabil).first():
        raise HTTPException(status_code=400, detail="Esta conta tem contas filhas - remova ou realoque as filhas antes de excluir.")
    if db.query(PartidaContabil.id_partida).filter(PartidaContabil.id_conta == id_conta).first():
        raise HTTPException(status_code=400, detail="Esta conta já tem movimento no razão contábil e não pode ser excluída.")
    if db.query(TituloFinanceiro.id_titulo).filter(TituloFinanceiro.id_conta_contabil == id_conta).first():
        raise HTTPException(status_code=400, detail="Esta conta está referenciada por título financeiro e não pode ser excluída.")
    if db.query(ContaFinanceira.id_conta_financeira).filter(ContaFinanceira.id_conta == id_conta).first():
        raise HTTPException(status_code=400, detail="Esta conta é uma Conta Financeira cadastrada - remova o cadastro de Conta Financeira antes.")
    dados_antes = {"codigo_contabil": conta.codigo_contabil, "descricao_conta": conta.descricao_conta, "tipo": conta.tipo}
    db.delete(conta)
    db.commit()
    registrar_auditoria(
        db, usuario, "plano_de_contas", "DELETE", id_registro_afetado=id_conta,
        dados_antes=dados_antes, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Conta contábil excluída."}


# ==========================================
# CENTROS DE CUSTO
# ==========================================
@router.get("/api/centros-custo/", summary="Listar Centros de Custo")
def listar_centros_custo(db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    centros = db.query(CentroDeCusto).order_by(CentroDeCusto.codigo).all()
    return [
        {"id_centro_custo": c.id_centro_custo, "codigo": c.codigo, "nome": c.nome, "id_projeto": c.id_projeto, "ativo": c.ativo}
        for c in centros
    ]


@router.post("/api/centros-custo/", summary="Cadastrar Centro de Custo")
def cadastrar_centro_custo(dados: CentroDeCustoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    novo = CentroDeCusto(codigo=dados.codigo, nome=dados.nome, id_projeto=dados.id_projeto)
    db.add(novo)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Já existe um centro de custo com esse código.")
    db.refresh(novo)
    registrar_auditoria(
        db, usuario, "centros_de_custo", "CREATE", id_registro_afetado=novo.id_centro_custo,
        dados_depois={"codigo": novo.codigo, "nome": novo.nome, "id_projeto": novo.id_projeto},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Centro de custo cadastrado.", "id_centro_custo": novo.id_centro_custo}


@router.put("/api/centros-custo/{id_centro_custo}/ativo", summary="Ativar/Inativar Centro de Custo")
def alternar_centro_custo(id_centro_custo: int, ativo: bool, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    centro = db.query(CentroDeCusto).filter(CentroDeCusto.id_centro_custo == id_centro_custo).first()
    if not centro:
        raise HTTPException(status_code=404, detail="Centro de custo não encontrado.")
    dados_antes = {"ativo": centro.ativo}
    centro.ativo = ativo
    db.commit()
    registrar_auditoria(
        db, usuario, "centros_de_custo", "UPDATE", id_registro_afetado=centro.id_centro_custo,
        dados_antes=dados_antes, dados_depois={"ativo": centro.ativo}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Centro de custo atualizado."}


# ==========================================
# CONTAS FINANCEIRAS (Caixa/Banco)
# ==========================================
@router.get("/api/contas-financeiras/", summary="Listar Contas Financeiras (com saldo)")
def listar_contas_financeiras(db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    contas_financeiras = db.query(ContaFinanceira).order_by(ContaFinanceira.id_conta_financeira).all()
    planos = {c.id_conta: c for c in db.query(PlanoDeContas).all()}
    resultado = []
    for cf in contas_financeiras:
        plano = planos.get(cf.id_conta)
        resultado.append({
            "id_conta_financeira": cf.id_conta_financeira,
            "id_conta": cf.id_conta,
            "codigo_contabil": plano.codigo_contabil if plano else None,
            "descricao_conta": plano.descricao_conta if plano else None,
            "tipo_conta_financeira": cf.tipo_conta_financeira,
            "banco": cf.banco, "agencia": cf.agencia, "numero_conta": cf.numero_conta,
            "ativo": cf.ativo,
            "saldo": contabilidade.saldo_conta(db, cf.id_conta),
        })
    return resultado


@router.post("/api/contas-financeiras/", summary="Cadastrar Conta Financeira")
def cadastrar_conta_financeira(dados: ContaFinanceiraCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    conta = db.query(PlanoDeContas).filter(PlanoDeContas.id_conta == dados.id_conta).first()
    if not conta:
        raise HTTPException(status_code=404, detail="Conta contábil não encontrada.")
    contabilidade.exigir_tipo_conta(conta, ["Ativo"], "Uma Conta Financeira")
    nova = ContaFinanceira(
        id_conta=dados.id_conta, tipo_conta_financeira=dados.tipo_conta_financeira,
        banco=dados.banco, agencia=dados.agencia, numero_conta=dados.numero_conta,
    )
    db.add(nova)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Esta conta contábil já é uma Conta Financeira.")
    db.refresh(nova)
    registrar_auditoria(
        db, usuario, "contas_financeiras", "CREATE", id_registro_afetado=nova.id_conta_financeira,
        dados_depois={"id_conta": nova.id_conta, "tipo_conta_financeira": nova.tipo_conta_financeira},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Conta financeira cadastrada.", "id_conta_financeira": nova.id_conta_financeira}


# ==========================================
# COMPROVANTES (anexo de lançamento/baixa/transferência)
# ==========================================
_EXTENSOES_COMPROVANTE_PERMITIDAS = {".pdf", ".jpg", ".jpeg", ".png"}
_TAMANHO_MAXIMO_COMPROVANTE = 15 * 1024 * 1024


@router.post("/api/comprovantes/", summary="Enviar comprovante financeiro")
async def enviar_comprovante(request: Request, arquivo: UploadFile = File(...), db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    extensao = os.path.splitext(arquivo.filename or "")[1].lower()
    if extensao not in _EXTENSOES_COMPROVANTE_PERMITIDAS:
        raise HTTPException(status_code=400, detail="Formato não suportado. Use PDF, JPG ou PNG.")
    conteudo = await arquivo.read()
    if len(conteudo) > _TAMANHO_MAXIMO_COMPROVANTE:
        raise HTTPException(status_code=400, detail="Arquivo muito grande (máximo 15MB).")
    nome_arquivo = f"{uuid.uuid4().hex}{extensao}"
    os.makedirs(os.path.join("uploads", "comprovantes"), exist_ok=True)
    with open(os.path.join("uploads", "comprovantes", nome_arquivo), "wb") as f:
        f.write(conteudo)
    caminho = f"/uploads/comprovantes/{nome_arquivo}"
    registrar_auditoria(
        db, usuario, "comprovantes_financeiros", "UPLOAD",
        dados_depois={"comprovante": caminho}, ip_origem=_ip_origem(request),
    )
    return {"comprovante": caminho}


# ==========================================
# FORNECEDORES
# ==========================================
@router.get("/api/fornecedores/", summary="Listar Fornecedores")
def listar_fornecedores(db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    fornecedores = db.query(Fornecedor).order_by(Fornecedor.razao_social).all()
    return [{"id_fornecedor": f.id_fornecedor, "razao_social": f.razao_social, "cnpj": f.cnpj, "categoria_servico": f.categoria_servico, "telefone": f.telefone} for f in fornecedores]


@router.post("/fornecedores/", summary="Cadastrar Fornecedor")
def cadastrar_fornecedor(dados: FornecedorCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    novo_fornecedor = Fornecedor(razao_social=dados.razao_social, cnpj=dados.cnpj, categoria_servico=dados.categoria_servico, telefone=dados.telefone)
    db.add(novo_fornecedor)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Já existe um fornecedor com esse CNPJ.")
    db.refresh(novo_fornecedor)
    registrar_auditoria(
        db, usuario, "fornecedores", "CREATE", id_registro_afetado=novo_fornecedor.id_fornecedor,
        dados_depois={"razao_social": novo_fornecedor.razao_social, "cnpj": novo_fornecedor.cnpj},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Fornecedor cadastrado.", "id_fornecedor": novo_fornecedor.id_fornecedor}


@router.put("/api/fornecedores/{id_fornecedor}", summary="Editar Fornecedor")
def editar_fornecedor(id_fornecedor: int, dados: FornecedorCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    fornecedor = db.query(Fornecedor).filter(Fornecedor.id_fornecedor == id_fornecedor).first()
    if not fornecedor:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado.")
    dados_antes = {"razao_social": fornecedor.razao_social, "cnpj": fornecedor.cnpj, "categoria_servico": fornecedor.categoria_servico, "telefone": fornecedor.telefone}
    fornecedor.razao_social = dados.razao_social
    fornecedor.cnpj = dados.cnpj
    fornecedor.categoria_servico = dados.categoria_servico
    fornecedor.telefone = dados.telefone
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Já existe um fornecedor com esse CNPJ.")
    registrar_auditoria(
        db, usuario, "fornecedores", "UPDATE", id_registro_afetado=fornecedor.id_fornecedor,
        dados_antes=dados_antes,
        dados_depois={"razao_social": fornecedor.razao_social, "cnpj": fornecedor.cnpj, "categoria_servico": fornecedor.categoria_servico, "telefone": fornecedor.telefone},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Fornecedor atualizado."}


# ==========================================
# TÍTULOS FINANCEIROS (contas a pagar/receber)
# ==========================================
@router.get("/api/titulos/", summary="Listar Títulos Financeiros")
def listar_titulos(status: str = None, tipo_titulo: str = None, db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    consulta = db.query(TituloFinanceiro)
    if status:
        consulta = consulta.filter(TituloFinanceiro.status == status)
    if tipo_titulo:
        consulta = consulta.filter(TituloFinanceiro.tipo_titulo == tipo_titulo)
    titulos = consulta.order_by(TituloFinanceiro.data_vencimento).all()

    contas = {c.id_conta: c for c in db.query(PlanoDeContas).all()}
    associados = {a.id_associado: a for a in db.query(Associado).all()}
    fornecedores = {f.id_fornecedor: f for f in db.query(Fornecedor).all()}

    resultado = []
    for t in titulos:
        conta = contas.get(t.id_conta_contabil)
        beneficiario = None
        if t.id_associado and t.id_associado in associados:
            beneficiario = associados[t.id_associado].nome_completo
        elif t.id_fornecedor and t.id_fornecedor in fornecedores:
            beneficiario = fornecedores[t.id_fornecedor].razao_social
        resultado.append({
            "id_titulo": t.id_titulo,
            "tipo_titulo": t.tipo_titulo,
            "descricao": t.descricao,
            "conta_contabil": conta.descricao_conta if conta else "",
            "beneficiario": beneficiario or "-",
            "valor_original": t.valor_original,
            "saldo_devedor": t.saldo_devedor,
            "data_vencimento": t.data_vencimento.date().isoformat() if t.data_vencimento else None,
            "status": t.status
        })
    return resultado


_TIPO_CONTA_POR_TIPO_TITULO = {"A Pagar": "Despesa", "A Receber": "Receita"}


@router.post("/titulos/", summary="Lançar Título Financeiro")
def lancar_titulo(dados: TituloCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    conta = db.query(PlanoDeContas).filter(PlanoDeContas.id_conta == dados.id_conta_contabil).first()
    if not conta:
        raise HTTPException(status_code=404, detail="Conta contábil não encontrada.")
    tipo_conta_esperado = _TIPO_CONTA_POR_TIPO_TITULO.get(dados.tipo_titulo)
    if tipo_conta_esperado is None:
        raise HTTPException(status_code=400, detail="tipo_titulo precisa ser 'A Pagar' ou 'A Receber'.")
    contabilidade.exigir_tipo_conta(conta, [tipo_conta_esperado], "A conta contábil de um título")
    if dados.id_associado and not db.query(Associado).filter(Associado.id_associado == dados.id_associado).first():
        raise HTTPException(status_code=404, detail="Associado não encontrado.")
    if dados.id_fornecedor and not db.query(Fornecedor).filter(Fornecedor.id_fornecedor == dados.id_fornecedor).first():
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado.")

    novo_titulo = TituloFinanceiro(
        tipo_titulo=dados.tipo_titulo, id_conta_contabil=dados.id_conta_contabil,
        id_associado=dados.id_associado, id_fornecedor=dados.id_fornecedor,
        descricao=dados.descricao, valor_original=dados.valor_original,
        saldo_devedor=dados.valor_original, data_vencimento=dados.data_vencimento
    )
    db.add(novo_titulo)
    db.commit()
    db.refresh(novo_titulo)
    registrar_auditoria(
        db, usuario, "titulos_financeiros", "CREATE", id_registro_afetado=novo_titulo.id_titulo,
        dados_depois={"tipo_titulo": novo_titulo.tipo_titulo, "descricao": novo_titulo.descricao, "valor_original": str(novo_titulo.valor_original)},
        ip_origem=_ip_origem(request),
    )
    if novo_titulo.id_associado:
        # v1.1 - novo título pode já nascer vencido (lançamento retroativo); recalcula na hora
        # em vez de esperar o próximo evento.
        recalcular_categoria_associado(db, novo_titulo.id_associado)
    return {"mensagem": "Título registrado.", "id_titulo": novo_titulo.id_titulo}


# ==========================================
# RAZÃO CONTÁBIL (lançamentos em partida dobrada real, imutáveis)
# ==========================================
def _nome_conta(contas: dict, id_conta: int) -> str:
    conta = contas.get(id_conta)
    return conta.descricao_conta if conta else ""


def _serializar_lancamento(lancamento: LancamentoContabil, contas: dict) -> dict:
    return {
        "id_lancamento": lancamento.id_lancamento,
        "numero_sequencial": lancamento.numero_sequencial,
        "id_exercicio": lancamento.id_exercicio,
        "id_titulo": lancamento.id_titulo,
        "data": lancamento.data_lancamento.date().isoformat() if lancamento.data_lancamento else None,
        "data_competencia": lancamento.data_competencia.date().isoformat() if lancamento.data_competencia else None,
        "historico": lancamento.historico,
        "tipo_origem": lancamento.tipo_origem,
        "forma_pagamento": lancamento.forma_pagamento,
        "comprovante": lancamento.comprovante,
        "estornado": lancamento.estornado,
        "motivo_estorno": lancamento.motivo_estorno,
        "id_lancamento_estorno": lancamento.id_lancamento_estorno,
        "partidas": [
            {
                "id_conta": p.id_conta, "conta_contabil": _nome_conta(contas, p.id_conta),
                "tipo_partida": p.tipo_partida, "valor": p.valor, "id_centro_custo": p.id_centro_custo,
            }
            for p in lancamento.partidas
        ],
    }


@router.get("/api/livro-caixa/", summary="Extrato do Razão Contábil (partida dobrada)")
def listar_livro_caixa(db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    lancamentos = db.query(LancamentoContabil).order_by(LancamentoContabil.id_exercicio, LancamentoContabil.numero_sequencial).all()
    contas = {c.id_conta: c for c in db.query(PlanoDeContas).all()}

    # v3.0 - "saldo em caixa" só tem sentido definido para contas Ativo (Caixa/Banco formal -
    # ContaFinanceira - é v3.1); somamos o efeito líquido (débito aumenta, crédito diminui) de
    # toda partida que toca uma conta Ativo, como indicador enquanto isso não existe.
    saldo_contas_ativo = Decimal("0")
    resultado = []
    for lancamento in lancamentos:
        for p in lancamento.partidas:
            conta = contas.get(p.id_conta)
            if conta and conta.tipo == "Ativo":
                saldo_contas_ativo += p.valor if p.tipo_partida == contabilidade.DEBITO else -p.valor
        resultado.append(_serializar_lancamento(lancamento, contas))
    resultado.reverse()
    return {"lancamentos": resultado, "saldo_contas_ativo": saldo_contas_ativo}


@router.post("/baixar-titulo/", summary="Baixar Título / Razão Contábil")
def baixar_titulo(dados: BaixarTitulo, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    exercicio = contabilidade.exigir_exercicio_aberto(db)
    titulo = db.query(TituloFinanceiro).filter(TituloFinanceiro.id_titulo == dados.id_titulo).first()
    if not titulo:
        raise HTTPException(status_code=404, detail="Título não encontrado.")
    if titulo.status == "Pago":
        raise HTTPException(status_code=400, detail="Este título já está totalmente pago.")
    if dados.valor_pago > titulo.saldo_devedor:
        raise HTTPException(status_code=400, detail=f"Valor pago não pode ser maior que o saldo devedor (R$ {titulo.saldo_devedor:.2f}).")
    contrapartida = db.query(PlanoDeContas).filter(PlanoDeContas.id_conta == dados.id_conta_contabil_contrapartida).first()
    if not contrapartida:
        raise HTTPException(status_code=404, detail="Conta contábil de contrapartida não encontrada.")
    contabilidade.exigir_tipo_conta(contrapartida, ["Ativo"], "A conta de contrapartida de uma baixa (Caixa/Banco)")

    conta_titulo = db.query(PlanoDeContas).filter(PlanoDeContas.id_conta == titulo.id_conta_contabil).first()
    if conta_titulo and contabilidade.exige_comprovante(db, conta_titulo.tipo) and not dados.comprovante:
        raise HTTPException(status_code=400, detail=f"Comprovante obrigatório para lançamento em conta do tipo '{conta_titulo.tipo}'. Envie por POST /api/comprovantes/ e informe o caminho retornado.")

    titulo.saldo_devedor -= dados.valor_pago
    if titulo.saldo_devedor <= 0:
        titulo.status = "Pago"
        titulo.saldo_devedor = Decimal("0")

    # v3.0 - partida dobrada real: "A Pagar" debita a despesa (aumenta) e credita a contrapartida
    # (Caixa/Banco diminui); "A Receber" debita a contrapartida (Caixa/Banco aumenta) e credita a
    # receita (aumenta). Ambos os lados sempre com o mesmo valor - ver contabilidade.criar_lancamento.
    if titulo.tipo_titulo == "A Pagar":
        partidas = [
            (titulo.id_conta_contabil, contabilidade.DEBITO, dados.valor_pago, dados.id_centro_custo),
            (contrapartida.id_conta, contabilidade.CREDITO, dados.valor_pago, dados.id_centro_custo),
        ]
    else:
        partidas = [
            (contrapartida.id_conta, contabilidade.DEBITO, dados.valor_pago, dados.id_centro_custo),
            (titulo.id_conta_contabil, contabilidade.CREDITO, dados.valor_pago, dados.id_centro_custo),
        ]

    lancamento = contabilidade.criar_lancamento(
        db, exercicio=exercicio, historico=f"Baixa do título #{titulo.id_titulo} — {titulo.descricao}",
        tipo_origem="BAIXA_TITULO", partidas=partidas, id_titulo=titulo.id_titulo,
        id_usuario=usuario.id_usuario, forma_pagamento=dados.forma_pagamento,
        data_competencia=dados.data_competencia, comprovante=dados.comprovante,
    )
    db.commit()
    db.refresh(lancamento)
    registrar_auditoria(
        db, usuario, "lancamentos_contabeis", "BAIXA_TITULO", id_registro_afetado=lancamento.id_lancamento,
        dados_depois={
            "id_titulo": titulo.id_titulo, "numero_sequencial": lancamento.numero_sequencial,
            "valor": str(dados.valor_pago), "saldo_devedor_restante": str(titulo.saldo_devedor),
        },
        ip_origem=_ip_origem(request),
    )
    if titulo.id_associado:
        # v1.1 - pagamento é o gatilho principal: pode tirar o associado de Inadimplente.
        recalcular_categoria_associado(db, titulo.id_associado)
    return {
        "mensagem": "Lançamento registrado no razão contábil.", "saldo_restante": titulo.saldo_devedor,
        "id_lancamento": lancamento.id_lancamento, "numero_sequencial": lancamento.numero_sequencial,
    }


@router.post("/api/lancamentos/{id_lancamento}/estornar", summary="Estornar Lançamento Contábil")
def estornar_lancamento_endpoint(id_lancamento: int, dados: EstornoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    """v3.0 - imutabilidade: lançamento registrado nunca é editado nem apagado. Correção é
    estorno motivado (novo lançamento com cada partida invertida, mesmo valor) + o lançamento
    original marcado `estornado`, nunca removido - ambos ficam visíveis no razão contábil."""
    original = db.query(LancamentoContabil).filter(LancamentoContabil.id_lancamento == id_lancamento).first()
    if not original:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado.")

    valor_original = contabilidade.valor_total_lancamento(original)
    estorno = contabilidade.estornar_lancamento(db, original=original, motivo=dados.motivo, id_usuario=usuario.id_usuario)

    titulo = None
    if original.id_titulo:
        titulo = db.query(TituloFinanceiro).filter(TituloFinanceiro.id_titulo == original.id_titulo).first()
        if titulo:
            titulo.saldo_devedor += valor_original
            if titulo.saldo_devedor > titulo.valor_original:
                titulo.saldo_devedor = titulo.valor_original
            titulo.status = "Pendente"
    db.commit()
    db.refresh(estorno)
    registrar_auditoria(
        db, usuario, "lancamentos_contabeis", "ESTORNO", id_registro_afetado=original.id_lancamento,
        dados_antes={"estornado": False},
        dados_depois={"id_lancamento_estorno": estorno.id_lancamento, "numero_sequencial": estorno.numero_sequencial, "motivo": dados.motivo},
        ip_origem=_ip_origem(request),
    )
    if titulo and titulo.id_associado:
        recalcular_categoria_associado(db, titulo.id_associado)
    return {"mensagem": "Lançamento estornado.", "id_lancamento_estorno": estorno.id_lancamento, "numero_sequencial": estorno.numero_sequencial}


# ==========================================
# TRANSFERÊNCIA ENTRE CONTAS FINANCEIRAS
# ==========================================
@router.post("/api/transferencias/", summary="Transferência entre Contas Financeiras")
def criar_transferencia(dados: TransferenciaCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    """v3.1 - transferência entre contas (ex.: Caixa -> Conta Corrente) como operação própria,
    não duas entradas soltas que podem divergir: por baixo, é só mais um caso de uso de
    `contabilidade.criar_lancamento` (débito na conta de destino, crédito na de origem), exposto
    aqui pra quem opera não precisar montar a partida na mão."""
    if dados.id_conta_financeira_origem == dados.id_conta_financeira_destino:
        raise HTTPException(status_code=400, detail="A conta de origem e a de destino não podem ser a mesma.")
    exercicio = contabilidade.exigir_exercicio_aberto(db)
    origem = db.query(ContaFinanceira).filter(ContaFinanceira.id_conta_financeira == dados.id_conta_financeira_origem).first()
    if not origem:
        raise HTTPException(status_code=404, detail="Conta financeira de origem não encontrada.")
    destino = db.query(ContaFinanceira).filter(ContaFinanceira.id_conta_financeira == dados.id_conta_financeira_destino).first()
    if not destino:
        raise HTTPException(status_code=404, detail="Conta financeira de destino não encontrada.")

    partidas = [
        (destino.id_conta, contabilidade.DEBITO, dados.valor, dados.id_centro_custo),
        (origem.id_conta, contabilidade.CREDITO, dados.valor, dados.id_centro_custo),
    ]
    lancamento = contabilidade.criar_lancamento(
        db, exercicio=exercicio, historico=dados.historico, tipo_origem="TRANSFERENCIA",
        partidas=partidas, id_usuario=usuario.id_usuario,
        data_competencia=dados.data_competencia, comprovante=dados.comprovante,
    )
    db.commit()
    db.refresh(lancamento)
    registrar_auditoria(
        db, usuario, "lancamentos_contabeis", "TRANSFERENCIA", id_registro_afetado=lancamento.id_lancamento,
        dados_depois={
            "id_conta_financeira_origem": origem.id_conta_financeira, "id_conta_financeira_destino": destino.id_conta_financeira,
            "valor": str(dados.valor), "numero_sequencial": lancamento.numero_sequencial,
        },
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Transferência registrada.", "id_lancamento": lancamento.id_lancamento, "numero_sequencial": lancamento.numero_sequencial}

