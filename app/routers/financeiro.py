from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from datetime import date

from app.database import get_db
from app.utils import esc
from app.models.associados import Associado
from app.models.financeiro import PlanoDeContas, Fornecedor, TituloFinanceiro, TransacaoCaixa
from app.schemas.financeiro import PlanoContaCriar, FornecedorCriar, TituloCriar, BaixarTitulo
from app.services.categoria_associado import recalcular_categoria_associado

router = APIRouter()

@router.get("/api/plano-contas/", summary="Listar Plano de Contas")
def listar_plano_contas(db: Session = Depends(get_db)):
    contas = db.query(PlanoDeContas).order_by(PlanoDeContas.codigo_contabil).all()
    return [{"id_conta": c.id_conta, "codigo_contabil": c.codigo_contabil, "descricao_conta": c.descricao_conta, "tipo": c.tipo} for c in contas]


@router.post("/plano-contas/", summary="3. Cadastrar Plano de Contas")
def cadastrar_plano_contas(dados: PlanoContaCriar, db: Session = Depends(get_db)):
    nova_conta = PlanoDeContas(codigo_contabil=dados.codigo_contabil, descricao_conta=dados.descricao_conta, tipo=dados.tipo)
    db.add(nova_conta)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Já existe uma conta com esse código contábil.")
    db.refresh(nova_conta)
    return {"mensagem": "Conta contábil cadastrada.", "id_conta": nova_conta.id_conta}


@router.put("/api/plano-contas/{id_conta}", summary="Editar Plano de Contas")
def editar_plano_contas(id_conta: int, dados: PlanoContaCriar, db: Session = Depends(get_db)):
    conta = db.query(PlanoDeContas).filter(PlanoDeContas.id_conta == id_conta).first()
    if not conta:
        raise HTTPException(status_code=404, detail="Conta contábil não encontrada.")
    conta.codigo_contabil = dados.codigo_contabil
    conta.descricao_conta = dados.descricao_conta
    conta.tipo = dados.tipo
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Já existe uma conta com esse código contábil.")
    return {"mensagem": "Conta contábil atualizada."}


@router.get("/api/fornecedores/", summary="Listar Fornecedores")
def listar_fornecedores(db: Session = Depends(get_db)):
    fornecedores = db.query(Fornecedor).order_by(Fornecedor.razao_social).all()
    return [{"id_fornecedor": f.id_fornecedor, "razao_social": f.razao_social, "cnpj": f.cnpj, "categoria_servico": f.categoria_servico, "telefone": f.telefone} for f in fornecedores]


@router.post("/fornecedores/", summary="4. Cadastrar Fornecedor")
def cadastrar_fornecedor(dados: FornecedorCriar, db: Session = Depends(get_db)):
    novo_fornecedor = Fornecedor(razao_social=dados.razao_social, cnpj=dados.cnpj, categoria_servico=dados.categoria_servico, telefone=dados.telefone)
    db.add(novo_fornecedor)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Já existe um fornecedor com esse CNPJ.")
    db.refresh(novo_fornecedor)
    return {"mensagem": "Fornecedor cadastrado.", "id_fornecedor": novo_fornecedor.id_fornecedor}


@router.put("/api/fornecedores/{id_fornecedor}", summary="Editar Fornecedor")
def editar_fornecedor(id_fornecedor: int, dados: FornecedorCriar, db: Session = Depends(get_db)):
    fornecedor = db.query(Fornecedor).filter(Fornecedor.id_fornecedor == id_fornecedor).first()
    if not fornecedor:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado.")
    fornecedor.razao_social = dados.razao_social
    fornecedor.cnpj = dados.cnpj
    fornecedor.categoria_servico = dados.categoria_servico
    fornecedor.telefone = dados.telefone
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Já existe um fornecedor com esse CNPJ.")
    return {"mensagem": "Fornecedor atualizado."}


@router.get("/api/titulos/", summary="Listar Títulos Financeiros")
def listar_titulos(status: str = None, tipo_titulo: str = None, db: Session = Depends(get_db)):
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


@router.post("/titulos/", summary="5. Lançar Título Financeiro")
def lancar_titulo(dados: TituloCriar, db: Session = Depends(get_db)):
    if not db.query(PlanoDeContas).filter(PlanoDeContas.id_conta == dados.id_conta_contabil).first():
        raise HTTPException(status_code=404, detail="Conta contábil não encontrada.")
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
    if novo_titulo.id_associado:
        # v1.1 - novo título pode já nascer vencido (lançamento retroativo); recalcula na hora
        # em vez de esperar o próximo evento.
        recalcular_categoria_associado(db, novo_titulo.id_associado)
    return {"mensagem": "Título registrado.", "id_titulo": novo_titulo.id_titulo}


@router.get("/api/livro-caixa/", summary="Extrato do Livro-Caixa")
def listar_livro_caixa(db: Session = Depends(get_db)):
    transacoes = db.query(TransacaoCaixa).order_by(TransacaoCaixa.data_registro_servidor).all()
    contas = {c.id_conta: c for c in db.query(PlanoDeContas).all()}

    saldo = 0.0
    resultado = []
    for t in transacoes:
        saldo += t.valor_efetivado if t.tipo_movimento == "Entrada" else -t.valor_efetivado
        conta = contas.get(t.id_conta_contabil)
        resultado.append({
            "id_transacao": t.id_transacao,
            "data": t.data_registro_servidor.date().isoformat() if t.data_registro_servidor else None,
            "conta_contabil": conta.descricao_conta if conta else "",
            "tipo_movimento": t.tipo_movimento,
            "valor_efetivado": t.valor_efetivado,
            "forma_pagamento": t.forma_pagamento,
            "status_auditoria": t.status_auditoria,
            "saldo_apos": round(saldo, 2)
        })
    resultado.reverse()
    return {"transacoes": resultado, "saldo_atual": round(saldo, 2)}


@router.post("/baixar-titulo/", summary="6. Baixar Título / Livro-Caixa")
def baixar_titulo(dados: BaixarTitulo, db: Session = Depends(get_db)):
    titulo = db.query(TituloFinanceiro).filter(TituloFinanceiro.id_titulo == dados.id_titulo).first()
    if not titulo:
        raise HTTPException(status_code=404, detail="Título não encontrado.")
    if titulo.status == "Pago":
        raise HTTPException(status_code=400, detail="Este título já está totalmente pago.")
    if dados.valor_pago > titulo.saldo_devedor:
        raise HTTPException(status_code=400, detail=f"Valor pago não pode ser maior que o saldo devedor (R$ {titulo.saldo_devedor:.2f}).")
    titulo.saldo_devedor -= dados.valor_pago
    if titulo.saldo_devedor <= 0:
        titulo.status = "Pago"
        titulo.saldo_devedor = 0.0
    tipo_mov = "Saída" if titulo.tipo_titulo == "A Pagar" else "Entrada"
    transacao = TransacaoCaixa(
        id_titulo=titulo.id_titulo, id_conta_contabil=titulo.id_conta_contabil,
        tipo_movimento=tipo_mov, valor_efetivado=dados.valor_pago, forma_pagamento=dados.forma_pagamento
    )
    db.add(transacao)
    db.commit()
    if titulo.id_associado:
        # v1.1 - pagamento é o gatilho principal: pode tirar o associado de Inadimplente.
        recalcular_categoria_associado(db, titulo.id_associado)
    return {"mensagem": "Transação registrada no Livro-Caixa.", "saldo_restante": titulo.saldo_devedor}

# ==========================================
# HISTÓRICO DE CARGOS
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
                document.getElementById('modalBaixa').classList.remove('hidden');
            }}

            async function salvarBaixa(event) {{
                event.preventDefault();
                const erroEl = document.getElementById('baixa_erro');
                erroEl.classList.add('hidden');
                const dados = {{
                    id_titulo: parseInt(document.getElementById('b_id').value, 10),
                    valor_pago: parseFloat(document.getElementById('b_valor').value),
                    forma_pagamento: document.getElementById('b_forma').value
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


@router.get("/admin/livro-caixa", response_class=HTMLResponse, summary="Admin - Livro-Caixa")
def admin_livro_caixa(db: Session = Depends(get_db)):
    transacoes = db.query(TransacaoCaixa).order_by(TransacaoCaixa.data_registro_servidor).all()
    contas = {c.id_conta: c for c in db.query(PlanoDeContas).all()}

    saldo = 0.0
    linhas_lista = []
    for t in transacoes:
        saldo += t.valor_efetivado if t.tipo_movimento == "Entrada" else -t.valor_efetivado
        conta = contas.get(t.id_conta_contabil)
        cor = "text-green-600" if t.tipo_movimento == "Entrada" else "text-red-600"
        sinal = "+" if t.tipo_movimento == "Entrada" else "-"
        data_fmt = t.data_registro_servidor.strftime("%d/%m/%Y %H:%M") if t.data_registro_servidor else "-"
        linhas_lista.append(f"""
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
            <td class="p-4 text-slate-500">{data_fmt}</td>
            <td class="p-4 text-slate-700">{esc(conta.descricao_conta if conta else '')}</td>
            <td class="p-4 font-semibold {cor}">{esc(t.tipo_movimento)}</td>
            <td class="p-4 font-bold {cor}">{sinal} R$ {t.valor_efetivado:.2f}</td>
            <td class="p-4 text-slate-500">{esc(t.forma_pagamento)}</td>
            <td class="p-4 text-slate-500">{esc(t.status_auditoria)}</td>
            <td class="p-4 font-bold text-slate-800">R$ {saldo:.2f}</td>
        </tr>
        """)
    linhas = "".join(reversed(linhas_lista))
    if not transacoes:
        linhas = '<tr><td colspan="7" class="p-8 text-center text-slate-400">Nenhuma transação registrada ainda.</td></tr>'

    cor_saldo = "text-emerald-600" if saldo >= 0 else "text-red-600"

    html_livro_caixa = f"""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>ASAF - Livro-Caixa</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 p-10 font-sans">
        <div class="max-w-6xl mx-auto">
            <div class="flex justify-between items-center mb-8">
                <div>
                    <h1 class="text-3xl font-extrabold text-slate-900">Livro-Caixa</h1>
                    <p class="text-slate-500">Extrato de todas as movimentações financeiras</p>
                </div>
                <div class="flex items-center space-x-4">
                    <div class="bg-white rounded-xl border border-slate-200 px-6 py-3 shadow-sm text-right">
                        <p class="text-xs font-bold text-slate-400 uppercase">Saldo Atual</p>
                        <p class="text-2xl font-black {cor_saldo}">R$ {saldo:.2f}</p>
                    </div>
                    <a href="/admin" class="px-4 py-2 bg-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-300 transition">&larr; Voltar ao Comando</a>
                </div>
            </div>

            <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table class="w-full text-left border-collapse text-sm">
                    <thead>
                        <tr class="bg-slate-900 text-white text-xs uppercase tracking-wider">
                            <th class="p-4">Data</th>
                            <th class="p-4">Conta</th>
                            <th class="p-4">Movimento</th>
                            <th class="p-4">Valor</th>
                            <th class="p-4">Forma de Pagamento</th>
                            <th class="p-4">Auditoria</th>
                            <th class="p-4">Saldo Após</th>
                        </tr>
                    </thead>
                    <tbody>{linhas}</tbody>
                </table>
            </div>
        </div>
    </body>
    </html>
    """
    return html_livro_caixa