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
`registrar_auditoria` em toda escrita). As páginas HTML `/admin/...` deste router permanecem
sem Depends de autenticação de propósito, mesmo padrão já usado em `admin_secretaria`
(app/routers/associados.py) - são a UI legada, substituída pelo painel React (v0.2), que não
tem como anexar um Bearer token a uma navegação de página; a proteção real está nas rotas
`/api/...` que essas páginas chamam via fetch."""
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from datetime import date

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.utils import esc
from app.models.associados import Associado
from app.models.financeiro import Exercicio, LancamentoContabil, PlanoDeContas, Fornecedor, TituloFinanceiro
from app.schemas.financeiro import (
    EstornoCriar, ExercicioAbrir, PlanoContaCriar, FornecedorCriar, TituloCriar, BaixarTitulo,
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
@router.get("/api/plano-contas/", summary="Listar Plano de Contas")
def listar_plano_contas(db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    contas = db.query(PlanoDeContas).order_by(PlanoDeContas.codigo_contabil).all()
    return [{"id_conta": c.id_conta, "codigo_contabil": c.codigo_contabil, "descricao_conta": c.descricao_conta, "tipo": c.tipo} for c in contas]


@router.post("/plano-contas/", summary="3. Cadastrar Plano de Contas")
def cadastrar_plano_contas(dados: PlanoContaCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    contabilidade.natureza_da_conta(dados.tipo)  # 400 se o tipo não for um dos cinco tipos contábeis reais
    nova_conta = PlanoDeContas(codigo_contabil=dados.codigo_contabil, descricao_conta=dados.descricao_conta, tipo=dados.tipo)
    db.add(nova_conta)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Já existe uma conta com esse código contábil.")
    db.refresh(nova_conta)
    registrar_auditoria(
        db, usuario, "plano_de_contas", "CREATE", id_registro_afetado=nova_conta.id_conta,
        dados_depois={"codigo_contabil": nova_conta.codigo_contabil, "descricao_conta": nova_conta.descricao_conta, "tipo": nova_conta.tipo},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Conta contábil cadastrada.", "id_conta": nova_conta.id_conta}


@router.put("/api/plano-contas/{id_conta}", summary="Editar Plano de Contas")
def editar_plano_contas(id_conta: int, dados: PlanoContaCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    conta = db.query(PlanoDeContas).filter(PlanoDeContas.id_conta == id_conta).first()
    if not conta:
        raise HTTPException(status_code=404, detail="Conta contábil não encontrada.")
    contabilidade.natureza_da_conta(dados.tipo)  # 400 se o tipo não for um dos cinco tipos contábeis reais
    dados_antes = {"codigo_contabil": conta.codigo_contabil, "descricao_conta": conta.descricao_conta, "tipo": conta.tipo}
    conta.codigo_contabil = dados.codigo_contabil
    conta.descricao_conta = dados.descricao_conta
    conta.tipo = dados.tipo
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Já existe uma conta com esse código contábil.")
    registrar_auditoria(
        db, usuario, "plano_de_contas", "UPDATE", id_registro_afetado=conta.id_conta,
        dados_antes=dados_antes,
        dados_depois={"codigo_contabil": conta.codigo_contabil, "descricao_conta": conta.descricao_conta, "tipo": conta.tipo},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Conta contábil atualizada."}


# ==========================================
# FORNECEDORES
# ==========================================
@router.get("/api/fornecedores/", summary="Listar Fornecedores")
def listar_fornecedores(db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    fornecedores = db.query(Fornecedor).order_by(Fornecedor.razao_social).all()
    return [{"id_fornecedor": f.id_fornecedor, "razao_social": f.razao_social, "cnpj": f.cnpj, "categoria_servico": f.categoria_servico, "telefone": f.telefone} for f in fornecedores]


@router.post("/fornecedores/", summary="4. Cadastrar Fornecedor")
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


@router.post("/titulos/", summary="5. Lançar Título Financeiro")
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
        "historico": lancamento.historico,
        "tipo_origem": lancamento.tipo_origem,
        "forma_pagamento": lancamento.forma_pagamento,
        "estornado": lancamento.estornado,
        "motivo_estorno": lancamento.motivo_estorno,
        "id_lancamento_estorno": lancamento.id_lancamento_estorno,
        "partidas": [
            {
                "id_conta": p.id_conta, "conta_contabil": _nome_conta(contas, p.id_conta),
                "tipo_partida": p.tipo_partida, "valor": p.valor,
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


@router.post("/baixar-titulo/", summary="6. Baixar Título / Razão Contábil")
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

    titulo.saldo_devedor -= dados.valor_pago
    if titulo.saldo_devedor <= 0:
        titulo.status = "Pago"
        titulo.saldo_devedor = Decimal("0")

    # v3.0 - partida dobrada real: "A Pagar" debita a despesa (aumenta) e credita a contrapartida
    # (Caixa/Banco diminui); "A Receber" debita a contrapartida (Caixa/Banco aumenta) e credita a
    # receita (aumenta). Ambos os lados sempre com o mesmo valor - ver contabilidade.criar_lancamento.
    if titulo.tipo_titulo == "A Pagar":
        partidas = [
            (titulo.id_conta_contabil, contabilidade.DEBITO, dados.valor_pago),
            (contrapartida.id_conta, contabilidade.CREDITO, dados.valor_pago),
        ]
    else:
        partidas = [
            (contrapartida.id_conta, contabilidade.DEBITO, dados.valor_pago),
            (titulo.id_conta_contabil, contabilidade.CREDITO, dados.valor_pago),
        ]

    lancamento = contabilidade.criar_lancamento(
        db, exercicio=exercicio, historico=f"Baixa do título #{titulo.id_titulo} — {titulo.descricao}",
        tipo_origem="BAIXA_TITULO", partidas=partidas, id_titulo=titulo.id_titulo,
        id_usuario=usuario.id_usuario, forma_pagamento=dados.forma_pagamento,
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
# HTML ADMIN (UI legada, ver nota de topo do arquivo)
# ==========================================

@router.get("/admin/fornecedores", response_class=HTMLResponse, summary="Admin - Fornecedores")
def admin_fornecedores(db: Session = Depends(get_db)):
    fornecedores = db.query(Fornecedor).order_by(Fornecedor.razao_social).all()
    linhas = ""
    for f in fornecedores:
        linhas += f"""
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
            <td class="p-4 font-semibold text-slate-800">{esc(f.razao_social)}</td>
            <td class="p-4 text-slate-500">{esc(f.cnpj)}</td>
            <td class="p-4 text-slate-500">{esc(f.categoria_servico)}</td>
            <td class="p-4 text-slate-500">{esc(f.telefone)}</td>
            <td class="p-4">
                <button onclick="abrirEditar(this)"
                    data-id="{f.id_fornecedor}" data-razao="{esc(f.razao_social)}" data-cnpj="{esc(f.cnpj)}"
                    data-categoria="{esc(f.categoria_servico)}" data-telefone="{esc(f.telefone)}"
                    class="bg-slate-100 hover:bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg font-semibold text-sm transition">Editar</button>
            </td>
        </tr>
        """
    if not fornecedores:
        linhas = '<tr><td colspan="5" class="p-8 text-center text-slate-400">Nenhum fornecedor cadastrado ainda.</td></tr>'

    html_fornecedores = f"""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>ASAF - Fornecedores</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 p-10 font-sans relative">
        <div class="max-w-5xl mx-auto">
            <div class="flex justify-between items-center mb-8">
                <div>
                    <h1 class="text-3xl font-extrabold text-slate-900">Fornecedores</h1>
                    <p class="text-slate-500">Cadastro de fornecedores e prestadores de serviço</p>
                </div>
                <div class="flex space-x-4">
                    <button onclick="abrirNovo()" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition">+ Novo Fornecedor</button>
                    <a href="/admin" class="px-4 py-2 bg-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-300 transition">&larr; Voltar ao Comando</a>
                </div>
            </div>

            <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="bg-slate-900 text-white text-xs uppercase tracking-wider">
                            <th class="p-4">Razão Social</th>
                            <th class="p-4">CNPJ</th>
                            <th class="p-4">Categoria</th>
                            <th class="p-4">Telefone</th>
                            <th class="p-4">Ação</th>
                        </tr>
                    </thead>
                    <tbody>{linhas}</tbody>
                </table>
            </div>
        </div>

        <div id="modalForm" class="fixed inset-0 bg-slate-900 bg-opacity-50 hidden flex items-center justify-center z-50 backdrop-blur-sm transition-opacity p-4">
            <div class="bg-white p-8 rounded-2xl shadow-2xl max-w-lg w-full mx-4 border-t-4 border-blue-600">
                <h2 id="form_titulo" class="text-2xl font-bold text-slate-800 mb-6">Novo Fornecedor</h2>
                <form id="form" onsubmit="salvar(event)">
                    <input type="hidden" id="f_id">
                    <div class="space-y-4">
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Razão Social *</label>
                            <input required type="text" id="f_razao" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">CNPJ *</label>
                            <input required maxlength="18" oninput="mascararCnpj(this)" type="text" id="f_cnpj" placeholder="00.000.000/0000-00" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Categoria</label>
                            <select id="f_categoria" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50"></select>
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Telefone *</label>
                            <input required maxlength="15" oninput="mascararTelefone(this)" type="text" id="f_telefone" placeholder="(00) 00000-0000" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                    </div>
                    <p id="form_erro" class="text-red-600 text-sm font-semibold mt-4 hidden"></p>
                    <div class="flex justify-end space-x-3 mt-8">
                        <button type="button" onclick="fecharModal()" class="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg transition">Cancelar</button>
                        <button type="submit" class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition">Salvar</button>
                    </div>
                </form>
            </div>
        </div>

        <script>
            function mascararCnpj(campo) {{
                let v = campo.value.replace(/\\D/g, "").slice(0, 14);
                v = v.replace(/(\\d{{2}})(\\d)/, "$1.$2").replace(/(\\d{{3}})(\\d)/, "$1.$2").replace(/(\\d{{3}})(\\d)/, "$1/$2").replace(/(\\d{{4}})(\\d{{1,2}})$/, "$1-$2");
                campo.value = v;
            }}
            function mascararTelefone(campo) {{
                let v = campo.value.replace(/\\D/g, "").slice(0, 11);
                if (v.length > 10) v = v.replace(/(\\d{{2}})(\\d{{5}})(\\d{{4}})/, "($1) $2-$3");
                else if (v.length > 5) v = v.replace(/(\\d{{2}})(\\d{{4}})(\\d{{0,4}})/, "($1) $2-$3");
                else if (v.length > 2) v = v.replace(/(\\d{{2}})(\\d{{0,5}})/, "($1) $2");
                campo.value = v;
            }}
            function preencherSelect(select, opcoes) {{
                select.innerHTML = '';
                opcoes.forEach(o => {{
                    const opt = document.createElement('option');
                    opt.value = o.valor; opt.textContent = o.valor;
                    select.appendChild(opt);
                }});
            }}

            async function abrirNovo() {{
                document.getElementById('form').reset();
                document.getElementById('f_id').value = '';
                document.getElementById('form_titulo').textContent = 'Novo Fornecedor';
                document.getElementById('form_erro').classList.add('hidden');
                const resposta = await fetch('/api/opcoes/categoria_fornecedor');
                preencherSelect(document.getElementById('f_categoria'), await resposta.json());
                document.getElementById('modalForm').classList.remove('hidden');
            }}

            async function abrirEditar(botao) {{
                const d = botao.dataset;
                document.getElementById('form_titulo').textContent = 'Editar Fornecedor';
                document.getElementById('form_erro').classList.add('hidden');
                const resposta = await fetch('/api/opcoes/categoria_fornecedor');
                preencherSelect(document.getElementById('f_categoria'), await resposta.json());
                document.getElementById('f_id').value = d.id;
                document.getElementById('f_razao').value = d.razao;
                document.getElementById('f_cnpj').value = d.cnpj;
                document.getElementById('f_categoria').value = d.categoria;
                document.getElementById('f_telefone').value = d.telefone;
                document.getElementById('modalForm').classList.remove('hidden');
            }}

            function fecharModal() {{
                document.getElementById('modalForm').classList.add('hidden');
            }}

            async function salvar(event) {{
                event.preventDefault();
                const erroEl = document.getElementById('form_erro');
                erroEl.classList.add('hidden');
                const id = document.getElementById('f_id').value;
                const dados = {{
                    razao_social: document.getElementById('f_razao').value,
                    cnpj: document.getElementById('f_cnpj').value,
                    categoria_servico: document.getElementById('f_categoria').value,
                    telefone: document.getElementById('f_telefone').value
                }};
                const url = id ? `/api/fornecedores/${{id}}` : '/fornecedores/';
                const resposta = await fetch(url, {{
                    method: id ? 'PUT' : 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify(dados)
                }});
                if (resposta.ok) {{
                    window.location.reload();
                }} else {{
                    const erro = await resposta.json();
                    const detalhe = Array.isArray(erro.detail) ? erro.detail.map(d => d.msg).join(", ") : erro.detail;
                    erroEl.textContent = detalhe || 'Erro ao salvar.';
                    erroEl.classList.remove('hidden');
                }}
            }}
        </script>
    </body>
    </html>
    """
    return html_fornecedores


@router.get("/admin/plano-contas", response_class=HTMLResponse, summary="Admin - Plano de Contas")
def admin_plano_contas(db: Session = Depends(get_db)):
    contas = db.query(PlanoDeContas).order_by(PlanoDeContas.codigo_contabil).all()
    linhas = ""
    for c in contas:
        cor = "text-green-600 bg-green-100" if c.tipo == "Receita" else "text-red-600 bg-red-100"
        linhas += f"""
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
            <td class="p-4 font-bold text-slate-700">{esc(c.codigo_contabil)}</td>
            <td class="p-4 font-semibold text-slate-800">{esc(c.descricao_conta)}</td>
            <td class="p-4"><span class="px-3 py-1 rounded-full text-xs font-bold {cor}">{esc(c.tipo)}</span></td>
            <td class="p-4">
                <button onclick="abrirEditar(this)"
                    data-id="{c.id_conta}" data-codigo="{esc(c.codigo_contabil)}" data-descricao="{esc(c.descricao_conta)}" data-tipo="{esc(c.tipo)}"
                    class="bg-slate-100 hover:bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg font-semibold text-sm transition">Editar</button>
            </td>
        </tr>
        """
    if not contas:
        linhas = '<tr><td colspan="4" class="p-8 text-center text-slate-400">Nenhuma conta contábil cadastrada ainda.</td></tr>'

    html_plano_contas = f"""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>ASAF - Plano de Contas</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 p-10 font-sans relative">
        <div class="max-w-4xl mx-auto">
            <div class="flex justify-between items-center mb-8">
                <div>
                    <h1 class="text-3xl font-extrabold text-slate-900">Plano de Contas</h1>
                    <p class="text-slate-500">Estrutura contábil de receitas e despesas</p>
                </div>
                <div class="flex space-x-4">
                    <button onclick="abrirNovo()" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition">+ Nova Conta</button>
                    <a href="/admin" class="px-4 py-2 bg-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-300 transition">&larr; Voltar ao Comando</a>
                </div>
            </div>

            <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="bg-slate-900 text-white text-xs uppercase tracking-wider">
                            <th class="p-4">Código</th>
                            <th class="p-4">Descrição</th>
                            <th class="p-4">Tipo</th>
                            <th class="p-4">Ação</th>
                        </tr>
                    </thead>
                    <tbody>{linhas}</tbody>
                </table>
            </div>
        </div>

        <div id="modalForm" class="fixed inset-0 bg-slate-900 bg-opacity-50 hidden flex items-center justify-center z-50 backdrop-blur-sm transition-opacity p-4">
            <div class="bg-white p-8 rounded-2xl shadow-2xl max-w-lg w-full mx-4 border-t-4 border-blue-600">
                <h2 id="form_titulo" class="text-2xl font-bold text-slate-800 mb-6">Nova Conta Contábil</h2>
                <form id="form" onsubmit="salvar(event)">
                    <input type="hidden" id="f_id">
                    <div class="space-y-4">
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Código Contábil *</label>
                            <input required type="text" id="f_codigo" placeholder="Ex: 3.1.001" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Descrição *</label>
                            <input required type="text" id="f_descricao" placeholder="Ex: Doações de Associados" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Tipo</label>
                            <select id="f_tipo" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50"></select>
                        </div>
                    </div>
                    <p id="form_erro" class="text-red-600 text-sm font-semibold mt-4 hidden"></p>
                    <div class="flex justify-end space-x-3 mt-8">
                        <button type="button" onclick="fecharModal()" class="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg transition">Cancelar</button>
                        <button type="submit" class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition">Salvar</button>
                    </div>
                </form>
            </div>
        </div>

        <script>
            function preencherSelect(select, opcoes) {{
                select.innerHTML = '';
                opcoes.forEach(o => {{
                    const opt = document.createElement('option');
                    opt.value = o.valor; opt.textContent = o.valor;
                    select.appendChild(opt);
                }});
            }}

            async function abrirNovo() {{
                document.getElementById('form').reset();
                document.getElementById('f_id').value = '';
                document.getElementById('form_titulo').textContent = 'Nova Conta Contábil';
                document.getElementById('form_erro').classList.add('hidden');
                const resposta = await fetch('/api/opcoes/tipo_conta_contabil');
                preencherSelect(document.getElementById('f_tipo'), await resposta.json());
                document.getElementById('modalForm').classList.remove('hidden');
            }}

            async function abrirEditar(botao) {{
                const d = botao.dataset;
                document.getElementById('form_titulo').textContent = 'Editar Conta Contábil';
                document.getElementById('form_erro').classList.add('hidden');
                const resposta = await fetch('/api/opcoes/tipo_conta_contabil');
                preencherSelect(document.getElementById('f_tipo'), await resposta.json());
                document.getElementById('f_id').value = d.id;
                document.getElementById('f_codigo').value = d.codigo;
                document.getElementById('f_descricao').value = d.descricao;
                document.getElementById('f_tipo').value = d.tipo;
                document.getElementById('modalForm').classList.remove('hidden');
            }}

            function fecharModal() {{
                document.getElementById('modalForm').classList.add('hidden');
            }}

            async function salvar(event) {{
                event.preventDefault();
                const erroEl = document.getElementById('form_erro');
                erroEl.classList.add('hidden');
                const id = document.getElementById('f_id').value;
                const dados = {{
                    codigo_contabil: document.getElementById('f_codigo').value,
                    descricao_conta: document.getElementById('f_descricao').value,
                    tipo: document.getElementById('f_tipo').value
                }};
                const url = id ? `/api/plano-contas/${{id}}` : '/plano-contas/';
                const resposta = await fetch(url, {{
                    method: id ? 'PUT' : 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify(dados)
                }});
                if (resposta.ok) {{
                    window.location.reload();
                }} else {{
                    const erro = await resposta.json();
                    const detalhe = Array.isArray(erro.detail) ? erro.detail.map(d => d.msg).join(", ") : erro.detail;
                    erroEl.textContent = detalhe || 'Erro ao salvar.';
                    erroEl.classList.remove('hidden');
                }}
            }}
        </script>
    </body>
    </html>
    """
    return html_plano_contas


@router.get("/admin/titulos", response_class=HTMLResponse, summary="Admin - Títulos Financeiros")
def admin_titulos(status: str = None, tipo_titulo: str = None, db: Session = Depends(get_db)):
    consulta = db.query(TituloFinanceiro)
    if status:
        consulta = consulta.filter(TituloFinanceiro.status == status)
    if tipo_titulo:
        consulta = consulta.filter(TituloFinanceiro.tipo_titulo == tipo_titulo)
    titulos = consulta.order_by(TituloFinanceiro.data_vencimento).all()

    contas = {c.id_conta: c for c in db.query(PlanoDeContas).all()}
    associados = {a.id_associado: a for a in db.query(Associado).all()}
    fornecedores = {f.id_fornecedor: f for f in db.query(Fornecedor).all()}

    linhas = ""
    for t in titulos:
        conta = contas.get(t.id_conta_contabil)
        beneficiario = "-"
        if t.id_associado and t.id_associado in associados:
            beneficiario = associados[t.id_associado].nome_completo
        elif t.id_fornecedor and t.id_fornecedor in fornecedores:
            beneficiario = fornecedores[t.id_fornecedor].razao_social
        cor_status = "text-green-600 bg-green-100" if t.status == "Pago" else "text-amber-700 bg-amber-100"
        vencimento = t.data_vencimento.strftime("%d/%m/%Y") if t.data_vencimento else "-"
        acao = "-"
        if t.status != "Pago":
            acao = f"""<button onclick="abrirBaixa({t.id_titulo}, {t.saldo_devedor})" class="bg-slate-100 hover:bg-green-100 text-green-700 px-3 py-1.5 rounded-lg font-semibold text-sm transition">Baixar</button>"""
        linhas += f"""
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
            <td class="p-4 font-semibold text-slate-800">{esc(t.descricao)}</td>
            <td class="p-4 text-slate-500">{esc(t.tipo_titulo)}</td>
            <td class="p-4 text-slate-500">{esc(conta.descricao_conta if conta else '')}</td>
            <td class="p-4 text-slate-500">{esc(beneficiario)}</td>
            <td class="p-4 text-slate-700">R$ {t.valor_original:.2f}</td>
            <td class="p-4 font-bold text-slate-800">R$ {t.saldo_devedor:.2f}</td>
            <td class="p-4 text-slate-500">{vencimento}</td>
            <td class="p-4"><span class="px-3 py-1 rounded-full text-xs font-bold {cor_status}">{esc(t.status)}</span></td>
            <td class="p-4">{acao}</td>
        </tr>
        """
    if not titulos:
        linhas = '<tr><td colspan="9" class="p-8 text-center text-slate-400">Nenhum título encontrado para este filtro.</td></tr>'

    html_titulos = f"""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>ASAF - Títulos Financeiros</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 p-10 font-sans relative">
        <div class="max-w-7xl mx-auto">
            <div class="flex justify-between items-center mb-8">
                <div>
                    <h1 class="text-3xl font-extrabold text-slate-900">Tesouraria — Títulos</h1>
                    <p class="text-slate-500">Contas a pagar e a receber</p>
                </div>
                <div class="flex space-x-4">
                    <button onclick="abrirNovo()" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition">+ Lançar Título</button>
                    <a href="/admin" class="px-4 py-2 bg-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-300 transition">&larr; Voltar ao Comando</a>
                </div>
            </div>

            <form method="get" class="flex space-x-4 mb-6">
                <select name="tipo_titulo" onchange="this.form.submit()" class="p-2 border border-slate-300 rounded-lg bg-white">
                    <option value="" {"selected" if not tipo_titulo else ""}>Todos os Tipos</option>
                    <option value="A Pagar" {"selected" if tipo_titulo == "A Pagar" else ""}>A Pagar</option>
                    <option value="A Receber" {"selected" if tipo_titulo == "A Receber" else ""}>A Receber</option>
                </select>
                <select name="status" onchange="this.form.submit()" class="p-2 border border-slate-300 rounded-lg bg-white">
                    <option value="" {"selected" if not status else ""}>Todos os Status</option>
                    <option value="Pendente" {"selected" if status == "Pendente" else ""}>Pendente</option>
                    <option value="Pago" {"selected" if status == "Pago" else ""}>Pago</option>
                </select>
            </form>

            <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table class="w-full text-left border-collapse text-sm">
                    <thead>
                        <tr class="bg-slate-900 text-white text-xs uppercase tracking-wider">
                            <th class="p-4">Descrição</th>
                            <th class="p-4">Tipo</th>
                            <th class="p-4">Conta</th>
                            <th class="p-4">Beneficiário</th>
                            <th class="p-4">Valor Original</th>
                            <th class="p-4">Saldo</th>
                            <th class="p-4">Vencimento</th>
                            <th class="p-4">Status</th>
                            <th class="p-4">Ação</th>
                        </tr>
                    </thead>
                    <tbody>{linhas}</tbody>
                </table>
            </div>
        </div>

        <!-- MODAL: NOVO TÍTULO -->
        <div id="modalNovo" class="fixed inset-0 bg-slate-900 bg-opacity-50 hidden flex items-center justify-center z-50 backdrop-blur-sm transition-opacity p-4">
            <div class="bg-white p-8 rounded-2xl shadow-2xl max-w-lg w-full mx-4 border-t-4 border-blue-600 max-h-[90vh] overflow-y-auto">
                <h2 class="text-2xl font-bold text-slate-800 mb-6">Lançar Título Financeiro</h2>
                <form id="form" onsubmit="salvar(event)">
                    <div class="space-y-4">
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Tipo *</label>
                            <select id="f_tipo" onchange="alternarBeneficiario()" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                                <option value="A Pagar">A Pagar (Fornecedor)</option>
                                <option value="A Receber">A Receber (Associado)</option>
                            </select>
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Conta Contábil *</label>
                            <select id="f_conta" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50"></select>
                        </div>
                        <div id="bloco_fornecedor">
                            <label class="text-xs font-bold text-slate-500 uppercase">Fornecedor *</label>
                            <select id="f_fornecedor" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50"></select>
                        </div>
                        <div id="bloco_associado" style="display:none">
                            <label class="text-xs font-bold text-slate-500 uppercase">Associado *</label>
                            <select id="f_associado" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50"></select>
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Descrição *</label>
                            <input required type="text" id="f_descricao" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="text-xs font-bold text-slate-500 uppercase">Valor (R$) *</label>
                                <input required type="number" step="0.01" min="0.01" id="f_valor" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                            </div>
                            <div>
                                <label class="text-xs font-bold text-slate-500 uppercase">Vencimento *</label>
                                <input required type="date" id="f_vencimento" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                            </div>
                        </div>
                    </div>
                    <p id="form_erro" class="text-red-600 text-sm font-semibold mt-4 hidden"></p>
                    <div class="flex justify-end space-x-3 mt-8">
                        <button type="button" onclick="fecharModal('modalNovo')" class="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg transition">Cancelar</button>
                        <button type="submit" class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition">Lançar</button>
                    </div>
                </form>
            </div>
        </div>

        <!-- MODAL: BAIXAR TÍTULO -->
        <div id="modalBaixa" class="fixed inset-0 bg-slate-900 bg-opacity-50 hidden flex items-center justify-center z-50 backdrop-blur-sm transition-opacity p-4">
            <div class="bg-white p-8 rounded-2xl shadow-2xl max-w-md w-full mx-4 border-t-4 border-green-600">
                <h2 class="text-2xl font-bold text-slate-800 mb-6">Baixar Título</h2>
                <form id="formBaixa" onsubmit="salvarBaixa(event)">
                    <input type="hidden" id="b_id">
                    <div class="space-y-4">
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Valor a Pagar/Receber (R$) *</label>
                            <input required type="number" step="0.01" min="0.01" id="b_valor" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Forma de Pagamento</label>
                            <select id="b_forma" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50"></select>
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Conta de Contrapartida (Caixa/Banco) *</label>
                            <select id="b_contrapartida" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50"></select>
                        </div>
                    </div>
                    <p id="baixa_erro" class="text-red-600 text-sm font-semibold mt-4 hidden"></p>
                    <div class="flex justify-end space-x-3 mt-8">
                        <button type="button" onclick="fecharModal('modalBaixa')" class="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg transition">Cancelar</button>
                        <button type="submit" class="px-5 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg shadow-md transition">Confirmar Baixa</button>
                    </div>
                </form>
            </div>
        </div>

        <script>
            function preencherSelect(select, opcoes, valorField, textoFn) {{
                select.innerHTML = '';
                opcoes.forEach(o => {{
                    const opt = document.createElement('option');
                    opt.value = valorField ? o[valorField] : o.valor;
                    opt.textContent = textoFn ? textoFn(o) : o.valor;
                    select.appendChild(opt);
                }});
            }}

            function alternarBeneficiario() {{
                const tipo = document.getElementById('f_tipo').value;
                document.getElementById('bloco_fornecedor').style.display = tipo === 'A Pagar' ? '' : 'none';
                document.getElementById('bloco_associado').style.display = tipo === 'A Receber' ? '' : 'none';
            }}

            async function abrirNovo() {{
                document.getElementById('form').reset();
                document.getElementById('form_erro').classList.add('hidden');
                const contas = await (await fetch('/api/plano-contas/')).json();
                preencherSelect(document.getElementById('f_conta'), contas, 'id_conta', c => `${{c.codigo_contabil}} — ${{c.descricao_conta}}`);
                const fornecedores = await (await fetch('/api/fornecedores/')).json();
                preencherSelect(document.getElementById('f_fornecedor'), fornecedores, 'id_fornecedor', f => f.razao_social);
                const associados = await (await fetch('/api/associados/busca-simples')).json();
                preencherSelect(document.getElementById('f_associado'), associados, 'id_associado', a => a.nome_completo);
                alternarBeneficiario();
                document.getElementById('modalNovo').classList.remove('hidden');
            }}

            function fecharModal(id) {{
                document.getElementById(id).classList.add('hidden');
            }}

            async function salvar(event) {{
                event.preventDefault();
                const erroEl = document.getElementById('form_erro');
                erroEl.classList.add('hidden');
                const tipo = document.getElementById('f_tipo').value;
                const dados = {{
                    tipo_titulo: tipo,
                    id_conta_contabil: parseInt(document.getElementById('f_conta').value, 10),
                    id_fornecedor: tipo === 'A Pagar' ? parseInt(document.getElementById('f_fornecedor').value, 10) : null,
                    id_associado: tipo === 'A Receber' ? parseInt(document.getElementById('f_associado').value, 10) : null,
                    descricao: document.getElementById('f_descricao').value,
                    valor_original: parseFloat(document.getElementById('f_valor').value),
                    data_vencimento: document.getElementById('f_vencimento').value
                }};
                const resposta = await fetch('/titulos/', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify(dados)
                }});
                if (resposta.ok) {{
                    window.location.reload();
                }} else {{
                    const erro = await resposta.json();
                    const detalhe = Array.isArray(erro.detail) ? erro.detail.map(d => d.msg).join(", ") : erro.detail;
                    erroEl.textContent = detalhe || 'Erro ao lançar título.';
                    erroEl.classList.remove('hidden');
                }}
            }}

            async function abrirBaixa(idTitulo, saldoDevedor) {{
                document.getElementById('b_id').value = idTitulo;
                document.getElementById('b_valor').value = saldoDevedor.toFixed(2);
                document.getElementById('baixa_erro').classList.add('hidden');
                const formas = await (await fetch('/api/opcoes/forma_pagamento')).json();
                preencherSelect(document.getElementById('b_forma'), formas);
                const contas = await (await fetch('/api/plano-contas/')).json();
                const contasAtivo = contas.filter(c => c.tipo === 'Ativo');
                preencherSelect(document.getElementById('b_contrapartida'), contasAtivo, 'id_conta', c => `${{c.codigo_contabil}} — ${{c.descricao_conta}}`);
                document.getElementById('modalBaixa').classList.remove('hidden');
            }}

            async function salvarBaixa(event) {{
                event.preventDefault();
                const erroEl = document.getElementById('baixa_erro');
                erroEl.classList.add('hidden');
                const dados = {{
                    id_titulo: parseInt(document.getElementById('b_id').value, 10),
                    valor_pago: parseFloat(document.getElementById('b_valor').value),
                    forma_pagamento: document.getElementById('b_forma').value,
                    id_conta_contabil_contrapartida: parseInt(document.getElementById('b_contrapartida').value, 10)
                }};
                const resposta = await fetch('/baixar-titulo/', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify(dados)
                }});
                if (resposta.ok) {{
                    window.location.reload();
                }} else {{
                    const erro = await resposta.json();
                    const detalhe = Array.isArray(erro.detail) ? erro.detail.map(d => d.msg).join(", ") : erro.detail;
                    erroEl.textContent = detalhe || 'Erro ao baixar título.';
                    erroEl.classList.remove('hidden');
                }}
            }}
        </script>
    </body>
    </html>
    """
    return html_titulos


@router.get("/admin/livro-caixa", response_class=HTMLResponse, summary="Admin - Razão Contábil")
def admin_livro_caixa(db: Session = Depends(get_db)):
    lancamentos = db.query(LancamentoContabil).order_by(LancamentoContabil.id_exercicio, LancamentoContabil.numero_sequencial).all()
    contas = {c.id_conta: c for c in db.query(PlanoDeContas).all()}

    saldo_contas_ativo = Decimal("0")
    linhas_lista = []
    for l in lancamentos:
        partes_partida = []
        for p in l.partidas:
            if contas.get(p.id_conta) and contas[p.id_conta].tipo == "Ativo":
                saldo_contas_ativo += p.valor if p.tipo_partida == contabilidade.DEBITO else -p.valor
            sigla = "D" if p.tipo_partida == contabilidade.DEBITO else "C"
            cor_sigla = "text-blue-600" if p.tipo_partida == contabilidade.DEBITO else "text-amber-700"
            partes_partida.append(
                f'<span class="{cor_sigla} font-bold">{sigla}</span> {esc(_nome_conta(contas, p.id_conta))} '
                f'<span class="text-slate-400">R$ {p.valor:.2f}</span>'
            )
        partidas_html = "<br>".join(partes_partida)
        data_fmt = l.data_lancamento.strftime("%d/%m/%Y %H:%M") if l.data_lancamento else "-"
        estorno_tag = ' <span class="text-xs font-bold text-red-500">(ESTORNADO)</span>' if l.estornado else ""
        acao_estorno = "" if l.estornado else f"""<button onclick="estornar({l.id_lancamento})" class="bg-slate-100 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg font-semibold text-xs transition">Estornar</button>"""
        linhas_lista.append(f"""
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors align-top">
            <td class="p-4 text-slate-500 font-mono">#{l.numero_sequencial}</td>
            <td class="p-4 text-slate-500">{data_fmt}</td>
            <td class="p-4 text-slate-700">{esc(l.historico)}{estorno_tag}</td>
            <td class="p-4 text-slate-700 text-xs leading-relaxed">{partidas_html}</td>
            <td class="p-4 text-slate-500">{esc(l.forma_pagamento or '-')}</td>
            <td class="p-4">{acao_estorno}</td>
        </tr>
        """)
    linhas = "".join(reversed(linhas_lista))
    if not lancamentos:
        linhas = '<tr><td colspan="6" class="p-8 text-center text-slate-400">Nenhum lançamento registrado ainda.</td></tr>'

    cor_saldo = "text-emerald-600" if saldo_contas_ativo >= 0 else "text-red-600"

    html_livro_caixa = f"""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>ASAF - Razão Contábil</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 p-10 font-sans">
        <div class="max-w-6xl mx-auto">
            <div class="flex justify-between items-center mb-8">
                <div>
                    <h1 class="text-3xl font-extrabold text-slate-900">Razão Contábil</h1>
                    <p class="text-slate-500">Lançamentos em partida dobrada (débito/crédito) — cada linha soma zero</p>
                </div>
                <div class="flex items-center space-x-4">
                    <div class="bg-white rounded-xl border border-slate-200 px-6 py-3 shadow-sm text-right">
                        <p class="text-xs font-bold text-slate-400 uppercase">Saldo em Contas Ativo</p>
                        <p class="text-2xl font-black {cor_saldo}">R$ {saldo_contas_ativo:.2f}</p>
                    </div>
                    <a href="/admin" class="px-4 py-2 bg-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-300 transition">&larr; Voltar ao Comando</a>
                </div>
            </div>

            <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table class="w-full text-left border-collapse text-sm">
                    <thead>
                        <tr class="bg-slate-900 text-white text-xs uppercase tracking-wider">
                            <th class="p-4">Nº</th>
                            <th class="p-4">Data</th>
                            <th class="p-4">Histórico</th>
                            <th class="p-4">Partidas (D/C)</th>
                            <th class="p-4">Forma de Pagamento</th>
                            <th class="p-4">Ação</th>
                        </tr>
                    </thead>
                    <tbody>{linhas}</tbody>
                </table>
            </div>
        </div>

        <script>
            async function estornar(idLancamento) {{
                const motivo = prompt('Motivo do estorno (mínimo 5 caracteres):');
                if (!motivo) return;
                const resposta = await fetch(`/api/lancamentos/${{idLancamento}}/estornar`, {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ motivo }})
                }});
                if (resposta.ok) {{
                    window.location.reload();
                }} else {{
                    const erro = await resposta.json();
                    const detalhe = Array.isArray(erro.detail) ? erro.detail.map(d => d.msg).join(", ") : erro.detail;
                    alert(detalhe || 'Erro ao estornar.');
                }}
            }}
        </script>
    </body>
    </html>
    """
    return html_livro_caixa
