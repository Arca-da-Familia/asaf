from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from datetime import datetime, date, timezone
import html
import os
import re

import httpx

from app.database import get_db
from app.utils import esc, iniciais, avatar_html
from app.models.associados import Associado, Endereco, DependenteFamiliar, DocumentoAnexo, HistoricoCargo
from app.models.pessoas import Papel, Pessoa
from app.models.financeiro import TituloFinanceiro
from app.schemas.associados import (
    AssociadoMasterCriar,
    AssociadoAdminUpdate,
    AssociadoPerfilUpdate,
    DependenteCriar,
    DependenteAtualizar,
    HistoricoCargoCriar,
    HistoricoCargoEncerrar,
)
from app.security import criar_token_carteirinha, decodificar_token_carteirinha
from app.services.categoria_associado import calcular_categoria
from app.services.linha_do_tempo import publicar_evento_linha_do_tempo
from app.services.matricula import proximo_numero_matricula

router = APIRouter()

@router.post("/associados-master/", summary="2. Cadastrar Ficha Master")
def cadastrar_ficha_master(dados: AssociadoMasterCriar, db: Session = Depends(get_db)):
    if db.query(Associado).filter(Associado.cpf == dados.cpf).first():
        raise HTTPException(status_code=400, detail="Este CPF já está arrolado.")
    try:
        novo_associado = Associado(
            nome_completo=dados.nome_completo, cpf=dados.cpf,
            email_contato=dados.email_contato, telefone_whatsapp=dados.telefone_whatsapp,
            categoria=dados.categoria,
            data_nascimento=datetime.combine(dados.data_nascimento, datetime.min.time()) if dados.data_nascimento else None,
            estado_civil=dados.estado_civil,
            profissao=dados.profissao, naturalidade=dados.naturalidade,
            numero_matricula=proximo_numero_matricula(db),  # v1.2
        )
        db.add(novo_associado)
        db.commit()
        db.refresh(novo_associado)

        # v1.0 - toda Pessoa que vira Associado ganha o papel "associado" marcado (N:N -
        # a mesma pessoa pode acumular outros papéis depois, sem recadastro).
        db.add(Papel(id_pessoa=novo_associado.id_pessoa, tipo_papel="associado"))
        db.commit()

        novo_endereco = Endereco(
            id_associado=novo_associado.id_associado, cep=dados.cep,
            logradouro=dados.logradouro, numero=dados.numero,
            bairro=dados.bairro, cidade=dados.cidade, estado=dados.estado
        )
        db.add(novo_endereco)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Não foi possível cadastrar: CPF já existe ou dado inválido.")
    return {"mensagem": f"Ficha de {novo_associado.nome_completo} criada com sucesso!", "id_associado": novo_associado.id_associado}


@router.get("/api/associados/{id_associado}/cargos", summary="Listar histórico de cargos")
def listar_cargos(id_associado: int, db: Session = Depends(get_db)):
    cargos = db.query(HistoricoCargo).filter(HistoricoCargo.id_associado == id_associado).order_by(HistoricoCargo.data_posse.desc()).all()
    return [{
        "id_historico": c.id_historico,
        "titulo_cargo": c.titulo_cargo,
        "data_posse": c.data_posse.date().isoformat() if c.data_posse else None,
        "data_saida": c.data_saida.date().isoformat() if c.data_saida else None
    } for c in cargos]


@router.post("/api/associados/{id_associado}/cargos", summary="Registrar posse em cargo")
def criar_cargo(id_associado: int, dados: HistoricoCargoCriar, db: Session = Depends(get_db)):
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    if not associado:
        raise HTTPException(status_code=404, detail="Associado não encontrado.")
    novo = HistoricoCargo(
        id_associado=id_associado, titulo_cargo=dados.titulo_cargo,
        data_posse=datetime.combine(dados.data_posse, datetime.min.time())
    )
    db.add(novo)
    db.commit()
    db.refresh(novo)
    publicar_evento_linha_do_tempo(
        db, associado.id_pessoa, "cargos", "CARGO_INICIADO", f"Assumiu o cargo de {dados.titulo_cargo}",
        data_evento=novo.data_posse,
    )
    return {"mensagem": "Posse registrada.", "id_historico": novo.id_historico}


@router.put("/api/cargos/{id_historico}/encerrar", summary="Registrar saída do cargo")
def encerrar_cargo(id_historico: int, dados: HistoricoCargoEncerrar, db: Session = Depends(get_db)):
    cargo = db.query(HistoricoCargo).filter(HistoricoCargo.id_historico == id_historico).first()
    if not cargo:
        raise HTTPException(status_code=404, detail="Registro de cargo não encontrado.")
    associado = db.query(Associado).filter(Associado.id_associado == cargo.id_associado).first()
    cargo.data_saida = datetime.combine(dados.data_saida, datetime.min.time())
    db.commit()
    if associado:
        publicar_evento_linha_do_tempo(
            db, associado.id_pessoa, "cargos", "CARGO_ENCERRADO", f"Deixou o cargo de {cargo.titulo_cargo}",
            data_evento=cargo.data_saida,
        )
    return {"mensagem": "Saída do cargo registrada."}


@router.delete("/api/cargos/{id_historico}", summary="Remover registro de cargo")
def remover_cargo(id_historico: int, db: Session = Depends(get_db)):
    cargo = db.query(HistoricoCargo).filter(HistoricoCargo.id_historico == id_historico).first()
    if not cargo:
        raise HTTPException(status_code=404, detail="Registro de cargo não encontrado.")
    db.delete(cargo)
    db.commit()
    return {"mensagem": "Registro removido."}


@router.get("/meu-portal/{id_associado}", response_class=HTMLResponse, summary="Super Portal do Associado")
def portal_associado_dinamico(id_associado: int, db: Session = Depends(get_db)):
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    if not associado:
        return "<h1 style='text-align:center; margin-top:50px; font-family:sans-serif;'>Erro 404: Ficha Master não encontrada no sistema.</h1>"

    titulos = db.query(TituloFinanceiro).filter(
        TituloFinanceiro.id_associado == id_associado, 
        TituloFinanceiro.status != "Pago"
    ).all()
    divida_total = sum(t.saldo_devedor for t in titulos)
    
    status_financeiro = "Sem pendências" if divida_total == 0 else f"Débito: R$ {divida_total:.2f}"
    cor_financeira = "text-green-600" if divida_total == 0 else "text-red-600"

    # QR Code de identificação — não enviamos o CPF completo a um serviço externo
    dados_qr = f"ASAF-ID:{associado.id_associado}|Status:{associado.status_arrolamento}"
    url_qrcode = f"https://api.qrserver.com/v1/create-qr-code/?size=150x150&data={html.escape(dados_qr)}"

    nome = esc(associado.nome_completo)
    categoria = esc(associado.categoria)
    status = esc(associado.status_arrolamento)
    cpf_mascarado = esc(associado.cpf[-2:])

    html_content = f"""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Portal Corporativo - {nome}</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-100 font-sans antialiased flex h-screen overflow-hidden">
        
        <!-- MEGA MENU LATERAL (Sidebar) -->
        <aside class="w-80 bg-slate-900 text-white flex flex-col shadow-2xl z-10">
            <div class="h-20 flex items-center justify-center border-b border-slate-800">
                <h2 class="text-2xl font-extrabold tracking-widest text-blue-400">ASAF<span class="text-white">PORTAL</span></h2>
            </div>
            <nav class="flex-1 px-4 py-6 space-y-1 overflow-y-auto text-sm font-medium">
                
                <p class="px-4 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 mt-4">Principal</p>
                <a href="#" class="flex items-center px-4 py-2.5 bg-blue-600 rounded-lg text-white shadow-md">Painel de Resumo</a>
                <a href="/meu-perfil/{id_associado}" class="flex items-center px-4 py-2.5 hover:bg-slate-800 rounded-lg text-slate-300">Minha Identidade Digital</a>
                
                <p class="px-4 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 mt-6">Governança & Atas</p>
                <a href="#" class="flex items-center px-4 py-2.5 hover:bg-slate-800 rounded-lg text-slate-300">Assembleias (Votação ICP-Brasil)</a>
                <a href="#" class="flex items-center px-4 py-2.5 hover:bg-slate-800 rounded-lg text-slate-300">Hub de Transparência (D.R.E.)</a>
                <a href="#" class="flex items-center px-4 py-2.5 hover:bg-slate-800 rounded-lg text-slate-300">Propor Emendas Estatutárias</a>

                <p class="px-4 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 mt-6">Ações e PDCA</p>
                <a href="#" class="flex items-center px-4 py-2.5 hover:bg-slate-800 rounded-lg text-slate-300">Projetos de Extensão</a>
                <a href="#" class="flex items-center px-4 py-2.5 hover:bg-slate-800 rounded-lg text-slate-300">Emissão de Certificados</a>
                <a href="#" class="flex items-center px-4 py-2.5 hover:bg-slate-800 rounded-lg text-slate-300">Chamados e Zeladoria</a>
                
                <p class="px-4 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 mt-6">Administrativo</p>
                <a href="#" class="flex items-center px-4 py-2.5 hover:bg-slate-800 rounded-lg text-slate-300">Tesouraria (Pix / Baixas)</a>
                <a href="#" class="flex items-center px-4 py-2.5 hover:bg-slate-800 rounded-lg text-slate-300">Cautela de Patrimônio</a>
                <a href="#" class="flex items-center px-4 py-2.5 hover:bg-slate-800 rounded-lg text-slate-300">Ouvidoria (Canal Blindado)</a>
                <a href="/minha-familia/{id_associado}" class="flex items-center px-4 py-2.5 hover:bg-slate-800 rounded-lg text-slate-300">Atualizar Árvore Familiar</a>
            </nav>
            <div class="p-4 border-t border-slate-800">
                <a href="/" class="flex items-center justify-center w-full px-4 py-2 bg-slate-800 hover:bg-red-600 rounded-lg transition-colors text-sm font-semibold">
                    &larr; Sair
                </a>
            </div>
        </aside>

        <!-- Área Principal -->
        <main class="flex-1 flex flex-col h-screen overflow-y-auto">
            <header class="h-20 bg-white shadow-sm flex items-center justify-between px-10 border-b border-slate-200">
                <div>
                    <h1 class="text-2xl font-bold text-slate-800">{nome}</h1>
                    <p class="text-sm text-slate-500">Associado {categoria}</p>
                </div>
                <span class="px-4 py-1.5 bg-slate-800 text-white text-xs font-bold uppercase rounded-full tracking-wider">
                    {status}
                </span>
            </header>
            
            <div class="p-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                
                <!-- CARTÃO DE IDENTIDADE (COLUNA DUPLA) -->
                <div class="md:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div class="bg-blue-700 p-4 text-white flex justify-between items-center">
                        <h2 class="text-sm font-bold tracking-widest uppercase">ID Institucional de Governança</h2>
                    </div>
                    <div class="p-6 flex items-center space-x-6">
                        {avatar_html(associado, "w-28 h-28 text-3xl")}
                        <div class="p-1 border-2 border-slate-200 rounded-lg bg-white shadow-sm">
                            <img src="{url_qrcode}" alt="QR Code" class="w-28 h-28">
                        </div>
                        <div class="space-y-2 flex-1">
                            <div>
                                <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Titular</p>
                                <p class="text-xl font-extrabold text-slate-800">{nome}</p>
                            </div>
                            <div class="grid grid-cols-2 gap-2 mt-2">
                                <div>
                                    <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Matrícula</p>
                                    <p class="text-sm font-bold text-slate-700">#00{associado.id_associado}</p>
                                </div>
                                <div>
                                    <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">CPF Vinculado</p>
                                    <p class="text-sm font-bold text-slate-700">***.***.{cpf_mascarado}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- EXTRATO FINANCEIRO RÁPIDO -->
                <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between border-t-4 border-t-blue-500">
                    <h3 class="text-slate-500 text-xs font-bold mb-4 uppercase tracking-wider">Tesouraria</h3>
                    <div>
                        <p class="text-3xl font-extrabold {cor_financeira}">{status_financeiro}</p>
                        <p class="text-xs text-slate-400 mt-1">Auditado com Livro-Caixa</p>
                    </div>
                    <button class="w-full mt-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2 rounded-lg text-sm">
                        Gerar Código Pix
                    </button>
                </div>

                <!-- NOTIFICAÇÕES LEGISLATIVAS E PROJETOS -->
                <div class="lg:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-8">
                    
                    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                        <div class="flex items-center mb-4">
                            <span class="w-3 h-3 bg-red-500 rounded-full animate-pulse mr-3"></span>
                            <h3 class="font-bold text-slate-800 uppercase tracking-wide text-sm">Pauta Pendente de Voto</h3>
                        </div>
                        <p class="text-slate-600 text-sm mb-4">A Reforma do Estatuto (Pauta AGE 02/2026) exige aprovação com assinatura eletrônica para averbação.</p>
                        <a href="#" class="text-blue-600 font-bold text-sm hover:underline">Registrar Decisão &rarr;</a>
                    </div>

                    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                        <div class="flex items-center mb-4">
                            <span class="w-3 h-3 bg-green-500 rounded-full mr-3"></span>
                            <h3 class="font-bold text-slate-800 uppercase tracking-wide text-sm">Ações em Fase "DO" (PDCA)</h3>
                        </div>
                        <p class="text-slate-600 text-sm mb-4">O Desfile Social necessita de voluntários para a Logística. Assine o termo e participe.</p>
                        <a href="#" class="text-blue-600 font-bold text-sm hover:underline">Acessar Escala &rarr;</a>
                    </div>

                </div>
            </div>
        </main>
    </body>
    </html>
    """
    return html_content
# ==========================================
# ROTA: MEGA PORTAL ADMINISTRATIVO
# ==========================================

@router.put("/api/associados/{id_associado}", summary="Admin - Editar Associado")
def admin_editar_associado(id_associado: int, dados: AssociadoAdminUpdate, db: Session = Depends(get_db)):
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    if not associado:
        raise HTTPException(status_code=404, detail="Associado não encontrado.")

    associado.nome_completo = dados.nome_completo
    associado.email_contato = dados.email_contato
    associado.telefone_whatsapp = dados.telefone_whatsapp
    associado.categoria = dados.categoria
    # v1.1 - status_arrolamento saiu do schema de propósito: não é mais editável à mão aqui,
    # vira função (app/services/categoria_associado.py), disparada por evento financeiro.
    associado.estado_civil = dados.estado_civil
    associado.profissao = dados.profissao
    associado.naturalidade = dados.naturalidade
    associado.data_nascimento = datetime.combine(dados.data_nascimento, datetime.min.time()) if dados.data_nascimento else None

    endereco = db.query(Endereco).filter(Endereco.id_associado == id_associado).first()
    if not endereco:
        endereco = Endereco(id_associado=id_associado)
        db.add(endereco)
    endereco.cep = dados.cep
    endereco.logradouro = dados.logradouro
    endereco.numero = dados.numero
    endereco.bairro = dados.bairro
    endereco.cidade = dados.cidade
    endereco.estado = dados.estado

    db.commit()
    return {"mensagem": "Ficha master atualizada com sucesso!"}


@router.put("/api/meu-perfil/{id_associado}", summary="Associado - Autoatendimento")
def associado_atualizar_perfil(id_associado: int, dados: AssociadoPerfilUpdate, db: Session = Depends(get_db)):
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    endereco = db.query(Endereco).filter(Endereco.id_associado == id_associado).first()
    
    if not associado:
        raise HTTPException(status_code=404, detail="Ficha não encontrada.")
    
    # Atualiza Contato
    associado.email_contato = dados.email_contato
    associado.telefone_whatsapp = dados.telefone_whatsapp

    # Atualiza dados complementares (nome, CPF, categoria e status continuam só administrativos)
    associado.data_nascimento = datetime.combine(dados.data_nascimento, datetime.min.time()) if dados.data_nascimento else None
    associado.estado_civil = dados.estado_civil
    associado.profissao = dados.profissao
    associado.naturalidade = dados.naturalidade

    # Atualiza Endereço
    if not endereco:
        endereco = Endereco(id_associado=id_associado)
        db.add(endereco)
    endereco.logradouro = dados.logradouro
    endereco.numero = dados.numero
    endereco.bairro = dados.bairro
    endereco.cidade = dados.cidade
    endereco.estado = dados.estado

    db.commit()
    return {"mensagem": "Seus dados foram atualizados com sucesso!"}


# ==========================================
# CATEGORIA CALCULADA E COMPLETUDE DO CADASTRO (v1.1)
# ==========================================
@router.get("/api/associados/{id_associado}/categoria-calculada", summary="Recalcular e comparar a categoria de um associado")
def obter_categoria_calculada(id_associado: int, db: Session = Depends(get_db)):
    """O cálculo (a partir do financeiro) é a fonte da verdade - `status_arrolamento` no banco
    é só um cache atualizado por evento. Este endpoint mostra os dois lado a lado, útil pra
    conferir se o materializado está desatualizado (ex.: passou o prazo de tolerância sem
    nenhum evento financeiro novo acontecer)."""
    if not db.query(Associado).filter(Associado.id_associado == id_associado).first():
        raise HTTPException(status_code=404, detail="Associado não encontrado.")
    materializada = db.query(Associado.status_arrolamento).filter(Associado.id_associado == id_associado).scalar()
    calculada_agora = calcular_categoria(db, id_associado)
    return {
        "status_arrolamento_materializado": materializada,
        "categoria_calculada_agora": calculada_agora,
        "desatualizado": materializada in ("Ativo - Em Dia", "Ativo - Inadimplente", None, "") and materializada != calculada_agora,
    }


@router.get("/api/associados/{id_associado}/completude", summary="Percentual de preenchimento do cadastro")
def obter_completude_cadastro(id_associado: int, db: Session = Depends(get_db)):
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    if not associado:
        raise HTTPException(status_code=404, detail="Associado não encontrado.")
    endereco = db.query(Endereco).filter(Endereco.id_associado == id_associado).first()

    campos = {
        "nome_completo": bool(associado.nome_completo),
        "cpf": bool(associado.cpf),
        "email_contato": bool(associado.email_contato),
        "telefone_whatsapp": bool(associado.telefone_whatsapp),
        "data_nascimento": bool(associado.data_nascimento),
        "estado_civil": bool(associado.estado_civil),
        "profissao": bool(associado.profissao),
        "naturalidade": bool(associado.naturalidade),
        "foto": bool(associado.foto),
        "endereco": bool(endereco and endereco.cep),
    }
    preenchidos = sum(campos.values())
    total = len(campos)
    return {
        "percentual": round(100 * preenchidos / total),
        "campos_faltando": [campo for campo, ok in campos.items() if not ok],
    }


@router.get("/api/cep/{cep}", summary="Consultar endereço por CEP (autopreenchimento)")
def consultar_cep(cep: str):
    """v1.1 - autopreenchimento de endereço e validação de "CEP existente". Serviço externo
    (ViaCEP, gratuito, sem chave) - melhor esforço: se estiver fora do ar, quem chama decide se
    bloqueia ou deixa o usuário preencher manualmente (não trava o cadastro por causa de um
    serviço de terceiro fora do ar)."""
    digitos = re.sub(r"\D", "", cep)
    if len(digitos) != 8:
        raise HTTPException(status_code=422, detail="CEP deve conter 8 dígitos.")
    try:
        resposta = httpx.get(f"https://viacep.com.br/ws/{digitos}/json/", timeout=5.0)
        resposta.raise_for_status()
        dados = resposta.json()
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="Serviço de CEP indisponível no momento - preencha manualmente.")
    if dados.get("erro"):
        raise HTTPException(status_code=404, detail="CEP não encontrado.")
    return {
        "cep": digitos, "logradouro": dados.get("logradouro", ""), "bairro": dados.get("bairro", ""),
        "cidade": dados.get("localidade", ""), "estado": dados.get("uf", ""),
    }


# ==========================================
# LISTAS CONFIGURÁVEIS (categorias, status, estado civil, parentesco...)
# ==========================================

@router.get("/api/associados/busca-simples", summary="Buscar associados para vincular (seletores)")
def buscar_associados_simples(excluir: int = None, db: Session = Depends(get_db)):
    # order_by direto em Associado.nome_completo não funciona - é association_proxy (v1.0), não
    # coluna de verdade; precisa ordenar pela Pessoa via join.
    consulta = db.query(Associado).join(Pessoa)
    if excluir is not None:
        consulta = consulta.filter(Associado.id_associado != excluir)
    associados = consulta.order_by(Pessoa.nome_completo).all()
    return [{
        "id_associado": a.id_associado,
        "nome_completo": a.nome_completo,
        "cpf_final": a.cpf[-2:] if a.cpf else ""
    } for a in associados]


@router.get("/api/associados/{id_associado}/dependentes", summary="Listar dependentes de um associado")
def listar_dependentes(id_associado: int, db: Session = Depends(get_db)):
    deps = db.query(DependenteFamiliar).filter(DependenteFamiliar.id_titular == id_associado).all()
    resultado = []
    for d in deps:
        vinculado = db.query(Associado).filter(Associado.id_associado == d.id_associado_vinculado).first()
        resultado.append({
            "id_dependente": d.id_dependente,
            "grau_parentesco": d.grau_parentesco,
            "id_associado_vinculado": d.id_associado_vinculado,
            "nome_completo": vinculado.nome_completo if vinculado else "(associado removido)",
            "foto": vinculado.foto if vinculado else None,
            "data_nascimento": vinculado.data_nascimento.date().isoformat() if vinculado and vinculado.data_nascimento else None
        })
    return resultado


@router.post("/api/associados/{id_associado}/dependentes", summary="Adicionar vínculo familiar")
def criar_dependente(id_associado: int, dados: DependenteCriar, db: Session = Depends(get_db)):
    if not db.query(Associado).filter(Associado.id_associado == id_associado).first():
        raise HTTPException(status_code=404, detail="Associado titular não encontrado.")
    if dados.id_associado_vinculado == id_associado:
        raise HTTPException(status_code=400, detail="Um associado não pode ser familiar de si mesmo.")
    if not db.query(Associado).filter(Associado.id_associado == dados.id_associado_vinculado).first():
        raise HTTPException(status_code=404, detail="O associado indicado como familiar não está cadastrado no sistema.")

    novo = DependenteFamiliar(
        id_titular=id_associado,
        id_associado_vinculado=dados.id_associado_vinculado,
        grau_parentesco=dados.grau_parentesco
    )
    db.add(novo)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Esse vínculo familiar já foi cadastrado.")
    db.refresh(novo)
    return {"mensagem": "Vínculo familiar adicionado.", "id_dependente": novo.id_dependente}


@router.put("/api/dependentes/{id_dependente}", summary="Editar grau de parentesco")
def editar_dependente(id_dependente: int, dados: DependenteAtualizar, db: Session = Depends(get_db)):
    dep = db.query(DependenteFamiliar).filter(DependenteFamiliar.id_dependente == id_dependente).first()
    if not dep:
        raise HTTPException(status_code=404, detail="Vínculo familiar não encontrado.")
    dep.grau_parentesco = dados.grau_parentesco
    db.commit()
    return {"mensagem": "Vínculo familiar atualizado."}


@router.delete("/api/dependentes/{id_dependente}", summary="Remover vínculo familiar")
def remover_dependente(id_dependente: int, db: Session = Depends(get_db)):
    dep = db.query(DependenteFamiliar).filter(DependenteFamiliar.id_dependente == id_dependente).first()
    if not dep:
        raise HTTPException(status_code=404, detail="Vínculo familiar não encontrado.")
    db.delete(dep)
    db.commit()
    return {"mensagem": "Vínculo familiar removido."}

# ==========================================
# FOTO DO ASSOCIADO
# ==========================================
EXTENSOES_FOTO_PERMITIDAS = {".jpg", ".jpeg", ".png", ".webp"}
TAMANHO_MAXIMO_FOTO = 5 * 1024 * 1024


@router.post("/api/associados/{id_associado}/foto", summary="Enviar foto do associado")
async def enviar_foto_associado(id_associado: int, foto: UploadFile = File(...), db: Session = Depends(get_db)):
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    if not associado:
        raise HTTPException(status_code=404, detail="Associado não encontrado.")

    extensao = os.path.splitext(foto.filename or "")[1].lower()
    if extensao not in EXTENSOES_FOTO_PERMITIDAS:
        raise HTTPException(status_code=400, detail="Formato de imagem não suportado. Use JPG, PNG ou WEBP.")

    conteudo = await foto.read()
    if len(conteudo) > TAMANHO_MAXIMO_FOTO:
        raise HTTPException(status_code=400, detail="Imagem muito grande (máximo 5MB).")

    caminho_relativo = f"fotos/{id_associado}{extensao}"
    with open(os.path.join("uploads", caminho_relativo), "wb") as arquivo:
        arquivo.write(conteudo)

    associado.foto = f"/uploads/{caminho_relativo}"
    db.commit()
    return {"mensagem": "Foto atualizada com sucesso.", "foto": associado.foto}


# ==========================================
# CARTEIRINHA DIGITAL (v1.1) — QR assinado, verificação pública sem dado sensível.
# ==========================================
@router.get("/api/associados/{id_associado}/carteirinha", summary="Gerar token da carteirinha digital")
def gerar_carteirinha(id_associado: int, db: Session = Depends(get_db)):
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    if not associado:
        raise HTTPException(status_code=404, detail="Associado não encontrado.")
    token = criar_token_carteirinha(associado.id_pessoa)
    return {"token": token, "url_verificacao": f"/carteirinha/verificar/{token}"}


@router.get("/carteirinha/verificar/{token}", summary="Verificar carteirinha digital (público)")
def verificar_carteirinha(token: str, db: Session = Depends(get_db)):
    """Endpoint público de propósito (é o que a portaria/parceiro escaneia) - por isso devolve
    só o mínimo pra confirmar identidade visual (nome, foto, categoria, validade). Nunca CPF,
    telefone ou endereço, mesmo que o token seja válido."""
    payload = decodificar_token_carteirinha(token)
    pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == payload["id_pessoa"]).first()
    if not pessoa:
        raise HTTPException(status_code=404, detail="Pessoa não encontrada.")
    papel = db.query(Papel).filter(Papel.id_pessoa == pessoa.id_pessoa, Papel.tipo_papel == "associado", Papel.ativo == True).first()
    if not papel:
        raise HTTPException(status_code=404, detail="Papel de associado inativo ou não encontrado.")
    associado = db.query(Associado).filter(Associado.id_pessoa == pessoa.id_pessoa).first()

    validade = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
    return {
        "nome_completo": pessoa.nome_completo,
        "foto": pessoa.foto,
        "categoria": associado.status_arrolamento if associado else None,
        "valido_ate": validade.isoformat(),
        "valido": validade > datetime.now(timezone.utc),
    }


# ==========================================
# INTEGRAÇÃO 1: SECRETARIA <-> MEU PERFIL
# ==========================================


@router.get("/admin/secretaria", response_class=HTMLResponse, summary="Admin - Gestão Master")
def admin_secretaria(db: Session = Depends(get_db)):
    todos_associados = db.query(Associado).all()
    enderecos_por_associado = {e.id_associado: e for e in db.query(Endereco).all()}

    linhas_tabela = ""
    for a in todos_associados:
        cor_status = "text-green-600 bg-green-100" if "Ativo" in a.status_arrolamento else "text-red-600 bg-red-100"
        end = enderecos_por_associado.get(a.id_associado)

        data_nasc_iso = a.data_nascimento.date().isoformat() if a.data_nascimento else ""

        # Dados passados via atributos data-* (lidos pelo JS), nunca embutidos como literais no onclick
        linhas_tabela += f"""
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
            <td class="p-4"><span class="font-bold text-slate-700">#00{a.id_associado}</span></td>
            <td class="p-4 font-semibold text-slate-800">
                <div class="flex items-center space-x-3">
                    {avatar_html(a)}
                    <span>{esc(a.nome_completo)}</span>
                </div>
            </td>
            <td class="p-4 text-slate-500">{esc(a.cpf)}</td>
            <td class="p-4 text-slate-500">{esc(a.telefone_whatsapp)}</td>
            <td class="p-4">
                <span class="px-3 py-1 rounded-full text-xs font-bold {cor_status}">{esc(a.status_arrolamento)}</span>
            </td>
            <td class="p-4 space-x-2 whitespace-nowrap">
                <button
                    onclick="abrirModal(this)"
                    data-id="{a.id_associado}"
                    data-nome="{esc(a.nome_completo)}"
                    data-email="{esc(a.email_contato)}"
                    data-tel="{esc(a.telefone_whatsapp)}"
                    data-cat="{esc(a.categoria)}"
                    data-status="{esc(a.status_arrolamento)}"
                    data-cep="{esc(end.cep if end else '')}"
                    data-log="{esc(end.logradouro if end else '')}"
                    data-num="{esc(end.numero if end else '')}"
                    data-bairro="{esc(end.bairro if end else '')}"
                    data-cidade="{esc(end.cidade if end else '')}"
                    data-estado="{esc(end.estado if end else '')}"
                    data-nascimento="{data_nasc_iso}"
                    data-estadocivil="{esc(a.estado_civil)}"
                    data-profissao="{esc(a.profissao)}"
                    data-naturalidade="{esc(a.naturalidade)}"
                    data-foto="{esc(a.foto)}"
                    class="bg-slate-100 hover:bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg font-semibold text-sm transition">Modificar</button>
                <button
                    onclick="abrirFamilia(this)"
                    data-id="{a.id_associado}"
                    data-nome="{esc(a.nome_completo)}"
                    class="bg-slate-100 hover:bg-purple-100 text-purple-600 px-3 py-1.5 rounded-lg font-semibold text-sm transition">Família</button>
                <button
                    onclick="abrirCargos(this)"
                    data-id="{a.id_associado}"
                    data-nome="{esc(a.nome_completo)}"
                    class="bg-slate-100 hover:bg-amber-100 text-amber-700 px-3 py-1.5 rounded-lg font-semibold text-sm transition">Cargos</button>
            </td>
        </tr>
        """

    if not todos_associados:
        linhas_tabela = """
        <tr><td colspan="6" class="p-8 text-center text-slate-400">Nenhum associado cadastrado ainda. Clique em "+ Novo Associado" para começar.</td></tr>
        """

    html_secretaria = f"""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>ASAF - Secretaria Geral</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 p-10 font-sans relative">
        <div class="max-w-6xl mx-auto">
            <div class="flex justify-between items-center mb-8">
                <div>
                    <h1 class="text-3xl font-extrabold text-slate-900">Secretaria Geral e Arrolamento</h1>
                    <p class="text-slate-500">Gestão ativa da base social (Fichas Master)</p>
                </div>
                <div class="flex space-x-4">
                    <button onclick="abrirListas()" class="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white font-bold rounded-lg shadow-md transition">⚙ Categorias &amp; Status</button>
                    <button onclick="abrirNovo()" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition">+ Novo Associado</button>
                    <a href="/admin" class="px-4 py-2 bg-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-300 transition">&larr; Voltar ao Comando</a>
                </div>
            </div>

            <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="bg-slate-900 text-white text-xs uppercase tracking-wider">
                            <th class="p-4">Matrícula</th>
                            <th class="p-4">Nome Completo</th>
                            <th class="p-4">CPF (Chave)</th>
                            <th class="p-4">WhatsApp</th>
                            <th class="p-4">Status Diretivo</th>
                            <th class="p-4">Ação</th>
                        </tr>
                    </thead>
                    <tbody>{linhas_tabela}</tbody>
                </table>
            </div>
        </div>

        <!-- MODAL DE CADASTRO (Novo Associado) -->
        <div id="modalNovo" class="fixed inset-0 bg-slate-900 bg-opacity-50 hidden flex items-center justify-center z-50 backdrop-blur-sm transition-opacity p-4">
            <div class="bg-white p-8 rounded-2xl shadow-2xl max-w-2xl w-full mx-4 border-t-4 border-green-600 max-h-[90vh] overflow-y-auto">
                <h2 class="text-2xl font-bold text-slate-800 mb-1">Nova Ficha Master</h2>
                <p class="text-sm text-slate-500 mb-6">Arrolamento de novo associado no sistema</p>
                <form id="formNovo" onsubmit="salvarNovo(event)">
                    <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 mt-2">Identidade</p>
                    <div class="grid grid-cols-2 gap-4 mb-4">
                        <div class="col-span-2">
                            <label class="text-xs font-bold text-slate-500 uppercase">Nome Completo *</label>
                            <input required type="text" id="novo_nome" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">CPF *</label>
                            <input required maxlength="14" oninput="mascararCpf(this)" type="text" id="novo_cpf" placeholder="000.000.000-00" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Categoria</label>
                            <select id="novo_cat" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                                <option value="Efetivo">Efetivo</option>
                                <option value="Contribuinte">Contribuinte</option>
                                <option value="Fundador">Fundador</option>
                            </select>
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">E-mail *</label>
                            <input required type="email" id="novo_email" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">WhatsApp *</label>
                            <input required maxlength="15" oninput="mascararTelefone(this)" type="text" id="novo_tel" placeholder="(00) 00000-0000" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                    </div>

                    <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 mt-6 border-t pt-4">Dados Complementares</p>
                    <div class="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Data de Nascimento</label>
                            <input type="date" id="novo_nascimento" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Estado Civil</label>
                            <select id="novo_estado_civil" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50"></select>
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Profissão</label>
                            <input type="text" id="novo_profissao" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div class="col-span-2">
                            <label class="text-xs font-bold text-slate-500 uppercase">Naturalidade (Cidade de Nascimento)</label>
                            <input type="text" id="novo_naturalidade" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                    </div>

                    <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 mt-6 border-t pt-4">Endereço</p>
                    <div class="grid grid-cols-3 gap-4">
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">CEP *</label>
                            <input required maxlength="9" oninput="mascararCep(this)" onblur="buscarCep(this.value, 'novo_')" type="text" id="novo_cep" placeholder="00000-000" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div class="col-span-2">
                            <label class="text-xs font-bold text-slate-500 uppercase">Logradouro *</label>
                            <input required type="text" id="novo_log" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Número *</label>
                            <input required type="text" id="novo_num" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Bairro *</label>
                            <input required type="text" id="novo_bairro" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Cidade *</label>
                            <input required type="text" id="novo_cidade" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div class="col-span-3">
                            <label class="text-xs font-bold text-slate-500 uppercase">Estado (UF) *</label>
                            <input required maxlength="2" type="text" id="novo_estado" placeholder="PA" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50 uppercase">
                        </div>
                    </div>

                    <p id="novo_erro" class="text-red-600 text-sm font-semibold mt-4 hidden"></p>

                    <div class="flex justify-end space-x-3 mt-8">
                        <button type="button" onclick="fecharNovo()" class="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg transition">Cancelar</button>
                        <button type="submit" class="px-5 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg shadow-md transition">Cadastrar Associado</button>
                    </div>
                </form>
            </div>
        </div>

        <!-- MODAL DE EDIÇÃO -->
        <div id="modalEdicao" class="fixed inset-0 bg-slate-900 bg-opacity-50 hidden flex items-center justify-center z-50 backdrop-blur-sm transition-opacity p-4">
            <div class="bg-white p-8 rounded-2xl shadow-2xl max-w-2xl w-full mx-4 border-t-4 border-blue-600 max-h-[90vh] overflow-y-auto">
                <h2 class="text-2xl font-bold text-slate-800 mb-1">Atualizar Ficha Master</h2>
                <div class="flex items-center space-x-4 mb-6 mt-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <img id="edit_foto_preview" class="w-16 h-16 rounded-full object-cover border border-slate-300 bg-white" src="" style="display:none">
                    <div id="edit_foto_placeholder" class="w-16 h-16 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold border border-slate-300"></div>
                    <div class="flex-1">
                        <label class="text-xs font-bold text-slate-500 uppercase block mb-1">Foto do Associado</label>
                        <input type="file" id="edit_foto_arquivo" accept="image/png,image/jpeg,image/webp" class="text-xs">
                    </div>
                    <button type="button" onclick="enviarFoto()" class="px-3 py-2 bg-slate-700 hover:bg-slate-800 text-white font-semibold text-sm rounded-lg transition">Enviar Foto</button>
                </div>
                <form id="formEditar" onsubmit="salvarEdicao(event)">
                    <input type="hidden" id="edit_id">

                    <div class="grid grid-cols-2 gap-4 mb-4">
                        <div class="col-span-2">
                            <label class="text-xs font-bold text-slate-500 uppercase">Nome Completo</label>
                            <input type="text" id="edit_nome" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">E-mail</label>
                            <input type="email" id="edit_email" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">WhatsApp</label>
                            <input type="text" id="edit_tel" oninput="mascararTelefone(this)" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Categoria</label>
                            <select id="edit_cat" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                                <option value="Efetivo">Efetivo</option>
                                <option value="Contribuinte">Contribuinte</option>
                                <option value="Fundador">Fundador</option>
                            </select>
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Status de Arrolamento</label>
                            <!-- v1.1: deixou de ser editável à mão - é calculado a partir do financeiro
                                 (app/services/categoria_associado.py). Só exibição aqui. -->
                            <input id="edit_status" type="text" disabled
                                   class="w-full p-2 border border-slate-300 rounded-lg bg-slate-100 text-slate-500" />
                        </div>
                    </div>

                    <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 mt-6 border-t pt-4">Dados Complementares</p>
                    <div class="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Data de Nascimento</label>
                            <input type="date" id="edit_nascimento" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Estado Civil</label>
                            <select id="edit_estado_civil" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50"></select>
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Profissão</label>
                            <input type="text" id="edit_profissao" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div class="col-span-2">
                            <label class="text-xs font-bold text-slate-500 uppercase">Naturalidade (Cidade de Nascimento)</label>
                            <input type="text" id="edit_naturalidade" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                    </div>

                    <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 mt-6 border-t pt-4">Endereço</p>
                    <div class="grid grid-cols-3 gap-4">
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">CEP</label>
                            <input maxlength="9" oninput="mascararCep(this)" onblur="buscarCep(this.value, 'edit_')" type="text" id="edit_cep" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div class="col-span-2">
                            <label class="text-xs font-bold text-slate-500 uppercase">Logradouro</label>
                            <input type="text" id="edit_log" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Número</label>
                            <input type="text" id="edit_num" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Bairro</label>
                            <input type="text" id="edit_bairro" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Cidade</label>
                            <input type="text" id="edit_cidade" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div class="col-span-3">
                            <label class="text-xs font-bold text-slate-500 uppercase">Estado (UF)</label>
                            <input maxlength="2" type="text" id="edit_estado" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50 uppercase">
                        </div>
                    </div>

                    <p id="edit_erro" class="text-red-600 text-sm font-semibold mt-4 hidden"></p>

                    <div class="flex justify-end space-x-3 mt-8">
                        <button type="button" onclick="fecharModal()" class="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg transition">Cancelar</button>
                        <button type="submit" class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition">Gravar Alterações</button>
                    </div>
                </form>
            </div>
        </div>

        <!-- MODAL: GERENCIAR LISTAS CONFIGURÁVEIS -->
        <div id="modalListas" class="fixed inset-0 bg-slate-900 bg-opacity-50 hidden flex items-center justify-center z-50 backdrop-blur-sm transition-opacity p-4">
            <div class="bg-white p-8 rounded-2xl shadow-2xl max-w-lg w-full mx-4 border-t-4 border-slate-700 max-h-[90vh] overflow-y-auto">
                <h2 class="text-2xl font-bold text-slate-800 mb-1">Categorias &amp; Status</h2>
                <p class="text-sm text-slate-500 mb-4">Edite os valores usados nos formulários de associado, sem precisar alterar o sistema.</p>

                <label class="text-xs font-bold text-slate-500 uppercase">Lista</label>
                <select id="listas_tipo" onchange="carregarListaAdmin()" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50 mb-4">
                    <option value="categoria_associado">Categoria de Associado</option>
                    <option value="status_arrolamento">Status de Arrolamento</option>
                    <option value="estado_civil">Estado Civil</option>
                    <option value="grau_parentesco">Grau de Parentesco (Família)</option>
                </select>

                <div id="listas_itens" class="space-y-2 mb-4"></div>

                <div class="flex space-x-2 border-t pt-4">
                    <input type="text" id="listas_novo_valor" placeholder="Novo valor" class="flex-1 p-2 border border-slate-300 rounded-lg bg-slate-50">
                    <button type="button" onclick="adicionarOpcaoLista()" class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg transition">Adicionar</button>
                </div>
                <p id="listas_erro" class="text-red-600 text-sm font-semibold mt-3 hidden"></p>

                <div class="flex justify-end mt-6">
                    <button type="button" onclick="fecharListas()" class="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg transition">Fechar</button>
                </div>
            </div>
        </div>

        <!-- MODAL: ÁRVORE FAMILIAR -->
        <div id="modalFamilia" class="fixed inset-0 bg-slate-900 bg-opacity-50 hidden flex items-center justify-center z-50 backdrop-blur-sm transition-opacity p-4">
            <div class="bg-white p-8 rounded-2xl shadow-2xl max-w-2xl w-full mx-4 border-t-4 border-purple-600 max-h-[90vh] overflow-y-auto">
                <h2 class="text-2xl font-bold text-slate-800 mb-1">Árvore Familiar</h2>
                <p class="text-sm text-slate-500 mb-4">Familiares (associados vinculados) de <span id="familia_titular_nome" class="font-semibold"></span></p>
                <p class="text-xs text-slate-400 mb-4 -mt-3">Só é possível vincular pessoas já cadastradas como associado no sistema.</p>
                <input type="hidden" id="familia_id_titular">

                <div id="familia_lista" class="space-y-3 mb-4"></div>

                <div class="border-t pt-4">
                    <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Adicionar Familiar</p>
                    <div class="grid grid-cols-2 gap-3 mb-2">
                        <select id="familia_novo_associado" class="col-span-2 p-2 border border-slate-300 rounded-lg bg-slate-50">
                            <option value="">Selecione o associado...</option>
                        </select>
                        <select id="familia_novo_parentesco" class="col-span-2 p-2 border border-slate-300 rounded-lg bg-slate-50"></select>
                    </div>
                    <button type="button" onclick="adicionarDependente()" class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg transition">Adicionar</button>
                    <p id="familia_erro" class="text-red-600 text-sm font-semibold mt-3 hidden"></p>
                </div>

                <div class="flex justify-end mt-6">
                    <button type="button" onclick="fecharFamilia()" class="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg transition">Fechar</button>
                </div>
            </div>
        </div>

        <!-- MODAL: HISTÓRICO DE CARGOS -->
        <div id="modalCargos" class="fixed inset-0 bg-slate-900 bg-opacity-50 hidden flex items-center justify-center z-50 backdrop-blur-sm transition-opacity p-4">
            <div class="bg-white p-8 rounded-2xl shadow-2xl max-w-2xl w-full mx-4 border-t-4 border-amber-500 max-h-[90vh] overflow-y-auto">
                <h2 class="text-2xl font-bold text-slate-800 mb-1">Histórico de Cargos</h2>
                <p class="text-sm text-slate-500 mb-4">Cargos diretivos de <span id="cargos_titular_nome" class="font-semibold"></span></p>
                <input type="hidden" id="cargos_id_titular">

                <div id="cargos_lista" class="space-y-3 mb-4"></div>

                <div class="border-t pt-4">
                    <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Registrar Posse</p>
                    <div class="grid grid-cols-2 gap-3 mb-2">
                        <select id="cargo_novo_titulo" class="col-span-2 p-2 border border-slate-300 rounded-lg bg-slate-50"></select>
                        <div class="col-span-2">
                            <label class="text-xs font-bold text-slate-500 uppercase">Data de Posse</label>
                            <input type="date" id="cargo_novo_data_posse" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                    </div>
                    <button type="button" onclick="adicionarCargo()" class="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg transition">Registrar</button>
                    <p id="cargos_erro" class="text-red-600 text-sm font-semibold mt-3 hidden"></p>
                </div>

                <div class="flex justify-end mt-6">
                    <button type="button" onclick="fecharCargos()" class="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg transition">Fechar</button>
                </div>
            </div>
        </div>

        <script>
            const SELECTS_POR_TIPO = {{
                categoria_associado: ['novo_cat', 'edit_cat'],
                estado_civil: ['novo_estado_civil', 'edit_estado_civil'],
                grau_parentesco: ['familia_novo_parentesco'],
                titulo_cargo: ['cargo_novo_titulo']
            }};

            function preencherSelect(select, opcoes) {{
                select.innerHTML = '';
                opcoes.forEach(o => {{
                    const opt = document.createElement('option');
                    opt.value = o.valor;
                    opt.textContent = o.valor;
                    select.appendChild(opt);
                }});
            }}

            function definirValorSelect(select, valor) {{
                if (!valor) return;
                const existe = Array.from(select.options).some(o => o.value === valor);
                if (!existe) {{
                    const opt = document.createElement('option');
                    opt.value = valor;
                    opt.textContent = valor + ' (inativo)';
                    select.appendChild(opt);
                }}
                select.value = valor;
            }}

            async function carregarOpcoes(tipoLista) {{
                const resposta = await fetch(`/api/opcoes/${{tipoLista}}`);
                const opcoes = await resposta.json();
                (SELECTS_POR_TIPO[tipoLista] || []).forEach(idSelect => {{
                    const select = document.getElementById(idSelect);
                    if (select) preencherSelect(select, opcoes);
                }});
                return opcoes;
            }}

            window.addEventListener('DOMContentLoaded', () => {{
                Object.keys(SELECTS_POR_TIPO).forEach(tipo => carregarOpcoes(tipo));
            }});

            function mascararCpf(campo) {{
                let v = campo.value.replace(/\\D/g, "").slice(0, 11);
                v = v.replace(/(\\d{{3}})(\\d)/, "$1.$2").replace(/(\\d{{3}})(\\d)/, "$1.$2").replace(/(\\d{{3}})(\\d{{1,2}})$/, "$1-$2");
                campo.value = v;
            }}

            function mascararTelefone(campo) {{
                let v = campo.value.replace(/\\D/g, "").slice(0, 11);
                if (v.length > 10) {{
                    v = v.replace(/(\\d{{2}})(\\d{{5}})(\\d{{4}})/, "($1) $2-$3");
                }} else if (v.length > 5) {{
                    v = v.replace(/(\\d{{2}})(\\d{{4}})(\\d{{0,4}})/, "($1) $2-$3");
                }} else if (v.length > 2) {{
                    v = v.replace(/(\\d{{2}})(\\d{{0,5}})/, "($1) $2");
                }}
                campo.value = v;
            }}

            function mascararCep(campo) {{
                let v = campo.value.replace(/\\D/g, "").slice(0, 8);
                v = v.replace(/(\\d{{5}})(\\d{{1,3}})/, "$1-$2");
                campo.value = v;
            }}

            async function buscarCep(cep, prefixo) {{
                const digitos = cep.replace(/\\D/g, "");
                if (digitos.length !== 8) return;
                try {{
                    const resposta = await fetch(`https://viacep.com.br/ws/${{digitos}}/json/`);
                    const dados = await resposta.json();
                    if (dados.erro) return;
                    document.getElementById(prefixo + 'log').value = dados.logradouro || '';
                    document.getElementById(prefixo + 'bairro').value = dados.bairro || '';
                    document.getElementById(prefixo + 'cidade').value = dados.localidade || '';
                    document.getElementById(prefixo + 'estado').value = dados.uf || '';
                }} catch (erro) {{
                    // Falha na consulta de CEP não impede o preenchimento manual
                }}
            }}

            async function abrirNovo() {{
                document.getElementById('formNovo').reset();
                document.getElementById('novo_erro').classList.add('hidden');
                document.getElementById('modalNovo').classList.remove('hidden');
                await Promise.all([carregarOpcoes('categoria_associado'), carregarOpcoes('estado_civil')]);
            }}

            function fecharNovo() {{
                document.getElementById('modalNovo').classList.add('hidden');
            }}

            async function salvarNovo(event) {{
                event.preventDefault();
                const erroEl = document.getElementById('novo_erro');
                erroEl.classList.add('hidden');

                const dados = {{
                    nome_completo: document.getElementById('novo_nome').value,
                    cpf: document.getElementById('novo_cpf').value,
                    email_contato: document.getElementById('novo_email').value,
                    telefone_whatsapp: document.getElementById('novo_tel').value,
                    categoria: document.getElementById('novo_cat').value,
                    cep: document.getElementById('novo_cep').value,
                    logradouro: document.getElementById('novo_log').value,
                    numero: document.getElementById('novo_num').value,
                    bairro: document.getElementById('novo_bairro').value,
                    cidade: document.getElementById('novo_cidade').value,
                    estado: document.getElementById('novo_estado').value,
                    data_nascimento: document.getElementById('novo_nascimento').value || null,
                    estado_civil: document.getElementById('novo_estado_civil').value || null,
                    profissao: document.getElementById('novo_profissao').value || null,
                    naturalidade: document.getElementById('novo_naturalidade').value || null
                }};

                const resposta = await fetch('/associados-master/', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify(dados)
                }});

                if (resposta.ok) {{
                    alert("Associado cadastrado com sucesso!");
                    window.location.reload();
                }} else {{
                    const erro = await resposta.json();
                    const detalhe = Array.isArray(erro.detail) ? erro.detail.map(d => d.msg).join(", ") : erro.detail;
                    erroEl.textContent = detalhe || "Erro ao cadastrar associado.";
                    erroEl.classList.remove('hidden');
                }}
            }}

            async function abrirModal(botao) {{
                await Promise.all([
                    carregarOpcoes('categoria_associado'),
                    carregarOpcoes('estado_civil')
                ]);
                const d = botao.dataset;
                document.getElementById('edit_id').value = d.id;
                document.getElementById('edit_nome').value = d.nome;
                document.getElementById('edit_email').value = d.email;
                document.getElementById('edit_tel').value = d.tel;
                definirValorSelect(document.getElementById('edit_cat'), d.cat);
                // v1.1 - status_arrolamento é calculado, não editável; só exibição (input desabilitado).
                document.getElementById('edit_status').value = d.status || '';
                document.getElementById('edit_cep').value = d.cep;
                document.getElementById('edit_log').value = d.log;
                document.getElementById('edit_num').value = d.num;
                document.getElementById('edit_bairro').value = d.bairro;
                document.getElementById('edit_cidade').value = d.cidade;
                document.getElementById('edit_estado').value = d.estado;
                document.getElementById('edit_nascimento').value = d.nascimento || '';
                definirValorSelect(document.getElementById('edit_estado_civil'), d.estadocivil);
                document.getElementById('edit_profissao').value = d.profissao || '';
                document.getElementById('edit_naturalidade').value = d.naturalidade || '';
                document.getElementById('edit_foto_arquivo').value = '';

                const preview = document.getElementById('edit_foto_preview');
                const placeholder = document.getElementById('edit_foto_placeholder');
                if (d.foto) {{
                    preview.src = d.foto;
                    preview.style.display = '';
                    placeholder.style.display = 'none';
                }} else {{
                    preview.style.display = 'none';
                    placeholder.style.display = 'flex';
                    placeholder.textContent = (d.nome || '?').trim().split(/\\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
                }}

                document.getElementById('edit_erro').classList.add('hidden');
                document.getElementById('modalEdicao').classList.remove('hidden');
            }}

            async function enviarFoto() {{
                const id = document.getElementById('edit_id').value;
                const arquivo = document.getElementById('edit_foto_arquivo').files[0];
                if (!arquivo) {{
                    alert('Selecione um arquivo de imagem primeiro.');
                    return;
                }}
                const formData = new FormData();
                formData.append('foto', arquivo);
                const resposta = await fetch(`/api/associados/${{id}}/foto`, {{ method: 'POST', body: formData }});
                if (resposta.ok) {{
                    const dados = await resposta.json();
                    const preview = document.getElementById('edit_foto_preview');
                    preview.src = dados.foto + '?t=' + Date.now();
                    preview.style.display = '';
                    document.getElementById('edit_foto_placeholder').style.display = 'none';
                    alert('Foto atualizada! Salve as alterações para concluir.');
                }} else {{
                    const erro = await resposta.json();
                    alert(erro.detail || 'Erro ao enviar a foto.');
                }}
            }}

            function fecharModal() {{
                document.getElementById('modalEdicao').classList.add('hidden');
            }}

            async function salvarEdicao(event) {{
                event.preventDefault();
                const erroEl = document.getElementById('edit_erro');
                erroEl.classList.add('hidden');
                const id = document.getElementById('edit_id').value;
                const dados = {{
                    nome_completo: document.getElementById('edit_nome').value,
                    email_contato: document.getElementById('edit_email').value,
                    telefone_whatsapp: document.getElementById('edit_tel').value,
                    categoria: document.getElementById('edit_cat').value,
                    cep: document.getElementById('edit_cep').value,
                    logradouro: document.getElementById('edit_log').value,
                    numero: document.getElementById('edit_num').value,
                    bairro: document.getElementById('edit_bairro').value,
                    cidade: document.getElementById('edit_cidade').value,
                    estado: document.getElementById('edit_estado').value,
                    data_nascimento: document.getElementById('edit_nascimento').value || null,
                    estado_civil: document.getElementById('edit_estado_civil').value || null,
                    profissao: document.getElementById('edit_profissao').value || null,
                    naturalidade: document.getElementById('edit_naturalidade').value || null
                }};

                const resposta = await fetch(`/api/associados/${{id}}`, {{
                    method: 'PUT',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify(dados)
                }});

                if (resposta.ok) {{
                    alert("Dados do associado atualizados com sucesso!");
                    window.location.reload();
                }} else {{
                    const erro = await resposta.json();
                    const detalhe = Array.isArray(erro.detail) ? erro.detail.map(d => d.msg).join(", ") : erro.detail;
                    erroEl.textContent = detalhe || "Erro ao salvar os dados.";
                    erroEl.classList.remove('hidden');
                }}
            }}

            // ---------- LISTAS CONFIGURÁVEIS ----------
            async function abrirListas() {{
                document.getElementById('modalListas').classList.remove('hidden');
                await carregarListaAdmin();
            }}

            function fecharListas() {{
                document.getElementById('modalListas').classList.add('hidden');
            }}

            async function carregarListaAdmin() {{
                const tipo = document.getElementById('listas_tipo').value;
                const resposta = await fetch(`/api/opcoes/${{tipo}}?incluir_inativos=true`);
                const opcoes = await resposta.json();
                const container = document.getElementById('listas_itens');
                container.innerHTML = '';
                opcoes.forEach(o => {{
                    const linha = document.createElement('div');
                    linha.className = 'flex items-center space-x-2';

                    const input = document.createElement('input');
                    input.type = 'text';
                    input.value = o.valor;
                    input.className = 'flex-1 p-2 border border-slate-300 rounded-lg bg-slate-50 text-sm';

                    const labelAtivo = document.createElement('label');
                    labelAtivo.className = 'flex items-center space-x-1 text-xs font-semibold text-slate-500 whitespace-nowrap';
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.checked = o.ativo;
                    labelAtivo.appendChild(checkbox);
                    labelAtivo.append(' Ativo');

                    const botaoSalvar = document.createElement('button');
                    botaoSalvar.type = 'button';
                    botaoSalvar.textContent = 'Salvar';
                    botaoSalvar.className = 'px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition';
                    botaoSalvar.onclick = () => salvarOpcaoLista(o.id_opcao, input.value, checkbox.checked);

                    linha.appendChild(input);
                    linha.appendChild(labelAtivo);
                    linha.appendChild(botaoSalvar);
                    container.appendChild(linha);
                }});
            }}

            async function salvarOpcaoLista(idOpcao, valor, ativo) {{
                const erroEl = document.getElementById('listas_erro');
                erroEl.classList.add('hidden');
                const resposta = await fetch(`/api/opcoes/${{idOpcao}}`, {{
                    method: 'PUT',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ valor, ativo }})
                }});
                if (resposta.ok) {{
                    await carregarListaAdmin();
                    await carregarOpcoes(document.getElementById('listas_tipo').value);
                }} else {{
                    const erro = await resposta.json();
                    erroEl.textContent = erro.detail || 'Erro ao salvar.';
                    erroEl.classList.remove('hidden');
                }}
            }}

            async function adicionarOpcaoLista() {{
                const tipo = document.getElementById('listas_tipo').value;
                const campoValor = document.getElementById('listas_novo_valor');
                const erroEl = document.getElementById('listas_erro');
                erroEl.classList.add('hidden');
                if (!campoValor.value.trim()) return;

                const resposta = await fetch(`/api/opcoes/${{tipo}}`, {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ valor: campoValor.value }})
                }});
                if (resposta.ok) {{
                    campoValor.value = '';
                    await carregarListaAdmin();
                    await carregarOpcoes(tipo);
                }} else {{
                    const erro = await resposta.json();
                    erroEl.textContent = erro.detail || 'Erro ao adicionar.';
                    erroEl.classList.remove('hidden');
                }}
            }}

            // ---------- ÁRVORE FAMILIAR ----------
            async function abrirFamilia(botao) {{
                const idTitular = botao.dataset.id;
                document.getElementById('familia_id_titular').value = idTitular;
                document.getElementById('familia_titular_nome').textContent = botao.dataset.nome;
                document.getElementById('familia_erro').classList.add('hidden');
                document.getElementById('modalFamilia').classList.remove('hidden');

                const selectAssociado = document.getElementById('familia_novo_associado');
                const resposta = await fetch(`/api/associados/busca-simples?excluir=${{idTitular}}`);
                const associados = await resposta.json();
                selectAssociado.innerHTML = '<option value="">Selecione o associado...</option>';
                associados.forEach(a => {{
                    const opt = document.createElement('option');
                    opt.value = a.id_associado;
                    opt.textContent = `${{a.nome_completo}} (CPF ***${{a.cpf_final}})`;
                    selectAssociado.appendChild(opt);
                }});

                await carregarOpcoes('grau_parentesco');
                await carregarFamilia();
            }}

            function fecharFamilia() {{
                document.getElementById('modalFamilia').classList.add('hidden');
            }}

            async function carregarFamilia() {{
                const idTitular = document.getElementById('familia_id_titular').value;
                const resposta = await fetch(`/api/associados/${{idTitular}}/dependentes`);
                const dependentes = await resposta.json();
                const container = document.getElementById('familia_lista');
                container.innerHTML = '';

                if (dependentes.length === 0) {{
                    container.innerHTML = '<p class="text-sm text-slate-400">Nenhum familiar vinculado ainda.</p>';
                    return;
                }}

                dependentes.forEach(dep => {{
                    const linha = document.createElement('div');
                    linha.className = 'flex items-center space-x-3 p-3 bg-slate-50 rounded-lg border border-slate-200';

                    const avatar = document.createElement('div');
                    if (dep.foto) {{
                        avatar.innerHTML = `<img src="${{dep.foto}}" class="w-9 h-9 rounded-full object-cover border border-slate-200">`;
                    }} else {{
                        avatar.innerHTML = `<div class="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs border border-slate-200">${{(dep.nome_completo || '?').trim().split(/\\s+/).map(p => p[0]).slice(0,2).join('').toUpperCase()}}</div>`;
                    }}

                    const nomeEl = document.createElement('p');
                    nomeEl.className = 'font-semibold text-slate-800 flex-1';
                    nomeEl.textContent = dep.nome_completo;

                    const selectParentesco = document.createElement('select');
                    selectParentesco.className = 'p-2 border border-slate-300 rounded-lg text-sm';

                    const botaoSalvar = document.createElement('button');
                    botaoSalvar.type = 'button';
                    botaoSalvar.textContent = 'Salvar';
                    botaoSalvar.className = 'px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition';
                    botaoSalvar.onclick = () => salvarDependente(dep.id_dependente, selectParentesco.value);

                    const botaoRemover = document.createElement('button');
                    botaoRemover.type = 'button';
                    botaoRemover.textContent = 'Remover';
                    botaoRemover.className = 'px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold rounded-lg transition';
                    botaoRemover.onclick = () => removerDependente(dep.id_dependente);

                    fetch('/api/opcoes/grau_parentesco').then(r => r.json()).then(opcoes => {{
                        preencherSelect(selectParentesco, opcoes);
                        definirValorSelect(selectParentesco, dep.grau_parentesco);
                    }});

                    linha.appendChild(avatar);
                    linha.appendChild(nomeEl);
                    linha.appendChild(selectParentesco);
                    linha.appendChild(botaoSalvar);
                    linha.appendChild(botaoRemover);
                    container.appendChild(linha);
                }});
            }}

            async function adicionarDependente() {{
                const idTitular = document.getElementById('familia_id_titular').value;
                const erroEl = document.getElementById('familia_erro');
                erroEl.classList.add('hidden');

                const idVinculado = document.getElementById('familia_novo_associado').value;
                if (!idVinculado) {{
                    erroEl.textContent = 'Selecione o associado que será vinculado.';
                    erroEl.classList.remove('hidden');
                    return;
                }}

                const resposta = await fetch(`/api/associados/${{idTitular}}/dependentes`, {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{
                        id_associado_vinculado: parseInt(idVinculado, 10),
                        grau_parentesco: document.getElementById('familia_novo_parentesco').value
                    }})
                }});

                if (resposta.ok) {{
                    document.getElementById('familia_novo_associado').value = '';
                    await carregarFamilia();
                }} else {{
                    const erro = await resposta.json();
                    erroEl.textContent = erro.detail || 'Erro ao adicionar vínculo familiar.';
                    erroEl.classList.remove('hidden');
                }}
            }}

            async function salvarDependente(idDependente, parentesco) {{
                await fetch(`/api/dependentes/${{idDependente}}`, {{
                    method: 'PUT',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ grau_parentesco: parentesco }})
                }});
                await carregarFamilia();
            }}

            async function removerDependente(idDependente) {{
                if (!confirm('Remover este vínculo familiar?')) return;
                await fetch(`/api/dependentes/${{idDependente}}`, {{ method: 'DELETE' }});
                await carregarFamilia();
            }}

            // ---------- HISTÓRICO DE CARGOS ----------
            async function abrirCargos(botao) {{
                document.getElementById('cargos_id_titular').value = botao.dataset.id;
                document.getElementById('cargos_titular_nome').textContent = botao.dataset.nome;
                document.getElementById('cargo_novo_data_posse').value = '';
                document.getElementById('cargos_erro').classList.add('hidden');
                document.getElementById('modalCargos').classList.remove('hidden');
                await carregarOpcoes('titulo_cargo');
                await carregarCargos();
            }}

            function fecharCargos() {{
                document.getElementById('modalCargos').classList.add('hidden');
            }}

            async function carregarCargos() {{
                const idTitular = document.getElementById('cargos_id_titular').value;
                const resposta = await fetch(`/api/associados/${{idTitular}}/cargos`);
                const cargos = await resposta.json();
                const container = document.getElementById('cargos_lista');
                container.innerHTML = '';

                if (cargos.length === 0) {{
                    container.innerHTML = '<p class="text-sm text-slate-400">Nenhum cargo registrado ainda.</p>';
                    return;
                }}

                cargos.forEach(c => {{
                    const linha = document.createElement('div');
                    linha.className = 'flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200';

                    const info = document.createElement('div');
                    const tituloEl = document.createElement('p');
                    tituloEl.className = 'font-semibold text-slate-800';
                    tituloEl.textContent = c.titulo_cargo;
                    const periodoEl = document.createElement('p');
                    periodoEl.className = 'text-xs text-slate-500';
                    const posse = c.data_posse ? c.data_posse.split('-').reverse().join('/') : '?';
                    const saida = c.data_saida ? c.data_saida.split('-').reverse().join('/') : null;
                    periodoEl.textContent = saida ? `${{posse}} — ${{saida}}` : `Desde ${{posse}} (atual)`;
                    info.appendChild(tituloEl);
                    info.appendChild(periodoEl);

                    const acoes = document.createElement('div');
                    acoes.className = 'flex items-center space-x-2';

                    if (!c.data_saida) {{
                        const inputSaida = document.createElement('input');
                        inputSaida.type = 'date';
                        inputSaida.className = 'p-1.5 border border-slate-300 rounded-lg text-sm';

                        const botaoEncerrar = document.createElement('button');
                        botaoEncerrar.type = 'button';
                        botaoEncerrar.textContent = 'Encerrar';
                        botaoEncerrar.className = 'px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition';
                        botaoEncerrar.onclick = () => encerrarCargo(c.id_historico, inputSaida.value);

                        acoes.appendChild(inputSaida);
                        acoes.appendChild(botaoEncerrar);
                    }}

                    const botaoRemover = document.createElement('button');
                    botaoRemover.type = 'button';
                    botaoRemover.textContent = 'Remover';
                    botaoRemover.className = 'px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold rounded-lg transition';
                    botaoRemover.onclick = () => removerCargo(c.id_historico);
                    acoes.appendChild(botaoRemover);

                    linha.appendChild(info);
                    linha.appendChild(acoes);
                    container.appendChild(linha);
                }});
            }}

            async function adicionarCargo() {{
                const idTitular = document.getElementById('cargos_id_titular').value;
                const erroEl = document.getElementById('cargos_erro');
                erroEl.classList.add('hidden');
                const dataPosse = document.getElementById('cargo_novo_data_posse').value;
                if (!dataPosse) {{
                    erroEl.textContent = 'Informe a data de posse.';
                    erroEl.classList.remove('hidden');
                    return;
                }}

                const resposta = await fetch(`/api/associados/${{idTitular}}/cargos`, {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{
                        titulo_cargo: document.getElementById('cargo_novo_titulo').value,
                        data_posse: dataPosse
                    }})
                }});

                if (resposta.ok) {{
                    document.getElementById('cargo_novo_data_posse').value = '';
                    await carregarCargos();
                }} else {{
                    const erro = await resposta.json();
                    erroEl.textContent = erro.detail || 'Erro ao registrar posse.';
                    erroEl.classList.remove('hidden');
                }}
            }}

            async function encerrarCargo(idHistorico, dataSaida) {{
                if (!dataSaida) {{
                    alert('Informe a data de saída antes de encerrar.');
                    return;
                }}
                await fetch(`/api/cargos/${{idHistorico}}/encerrar`, {{
                    method: 'PUT',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ data_saida: dataSaida }})
                }});
                await carregarCargos();
            }}

            async function removerCargo(idHistorico) {{
                if (!confirm('Remover este registro de cargo?')) return;
                await fetch(`/api/cargos/${{idHistorico}}`, {{ method: 'DELETE' }});
                await carregarCargos();
            }}
        </script>
    </body>
    </html>
    """
    return html_secretaria


@router.get("/meu-perfil/{id_associado}", response_class=HTMLResponse, summary="Associado - Autoatendimento")
def perfil_associado(id_associado: int, db: Session = Depends(get_db)):
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    endereco = db.query(Endereco).filter(Endereco.id_associado == id_associado).first()
    
    if not associado:
        return "<h1>Erro: Associado não encontrado.</h1>"

    logradouro = esc(endereco.logradouro if endereco else "")
    numero = esc(endereco.numero if endereco else "")
    bairro = esc(endereco.bairro if endereco else "")
    cidade = esc(endereco.cidade if endereco else "")
    estado = esc(endereco.estado if endereco else "")

    nome = esc(associado.nome_completo)
    cpf = esc(associado.cpf)
    telefone_whatsapp = esc(associado.telefone_whatsapp)
    email_contato = esc(associado.email_contato)
    data_nascimento_iso = associado.data_nascimento.date().isoformat() if associado.data_nascimento else ""
    profissao = esc(associado.profissao)
    naturalidade = esc(associado.naturalidade)
    estado_civil_atual = esc(associado.estado_civil)
    foto_atual = esc(associado.foto)

    html_perfil = f"""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>Meu Perfil - ASAF</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 p-10 font-sans">
        <div class="max-w-4xl mx-auto">
            <div class="flex justify-between items-center mb-8">
                <div>
                    <h1 class="text-3xl font-extrabold text-slate-900">Configurações Pessoais</h1>
                    <p class="text-slate-500">Gerencie seus dados de contato e localização</p>
                </div>
                <a href="/meu-portal/{id_associado}" class="px-4 py-2 bg-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-300 transition">&larr; Voltar ao Portal</a>
            </div>

            <!-- FOTO DE PERFIL -->
            <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6 flex items-center space-x-4">
                <img id="perfil_foto_preview" class="w-16 h-16 rounded-full object-cover border border-slate-300" src="{foto_atual}" style="display:{'' if foto_atual else 'none'}">
                <div id="perfil_foto_placeholder" class="w-16 h-16 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold border border-slate-300" style="display:{'none' if foto_atual else 'flex'}">{esc(iniciais(associado.nome_completo))}</div>
                <div class="flex-1">
                    <label class="text-xs font-bold text-slate-500 uppercase block mb-1">Minha Foto</label>
                    <input type="file" id="perfil_foto_arquivo" accept="image/png,image/jpeg,image/webp" class="text-sm">
                </div>
                <button type="button" onclick="enviarFotoPerfil()" class="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white font-semibold text-sm rounded-lg transition">Enviar Foto</button>
            </div>

            <form id="formPerfil" onsubmit="atualizarPerfil(event, {id_associado})">

                <!-- TRAVA DE COMPLIANCE (Campos Bloqueados) -->
                <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
                    <div class="bg-slate-800 p-4 text-white flex justify-between items-center">
                        <h2 class="font-bold tracking-widest uppercase text-sm">Identidade Legal (Inalterável)</h2>
                        <span class="text-xs bg-slate-700 px-2 py-1 rounded">Proteção de Fraude Ativa</span>
                    </div>
                    <div class="p-6 grid grid-cols-2 gap-6 bg-slate-50">
                        <div>
                            <label class="text-xs font-bold text-slate-400 uppercase">Nome na Ata</label>
                            <input type="text" value="{nome}" disabled class="w-full mt-1 p-2 bg-slate-200 text-slate-500 rounded-lg cursor-not-allowed border border-slate-300">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-400 uppercase">CPF Vinculado</label>
                            <input type="text" value="{cpf}" disabled class="w-full mt-1 p-2 bg-slate-200 text-slate-500 rounded-lg cursor-not-allowed border border-slate-300">
                        </div>
                    </div>
                </div>

                <!-- DADOS COMPLEMENTARES (Editáveis) -->
                <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6 border-l-4 border-l-emerald-500">
                    <div class="p-6">
                        <h2 class="font-bold text-slate-800 uppercase tracking-widest text-sm mb-6 border-b pb-2">Dados Complementares</h2>
                        <div class="grid grid-cols-2 gap-6">
                            <div>
                                <label class="text-xs font-bold text-slate-500 uppercase">Data de Nascimento</label>
                                <input type="date" id="perfil_nascimento" value="{data_nascimento_iso}" class="w-full mt-1 p-2 border border-slate-300 rounded-lg">
                            </div>
                            <div>
                                <label class="text-xs font-bold text-slate-500 uppercase">Estado Civil</label>
                                <select id="perfil_estado_civil" data-atual="{estado_civil_atual}" class="w-full mt-1 p-2 border border-slate-300 rounded-lg"></select>
                            </div>
                            <div>
                                <label class="text-xs font-bold text-slate-500 uppercase">Profissão</label>
                                <input type="text" id="perfil_profissao" value="{profissao}" class="w-full mt-1 p-2 border border-slate-300 rounded-lg">
                            </div>
                            <div>
                                <label class="text-xs font-bold text-slate-500 uppercase">Naturalidade (Cidade de Nascimento)</label>
                                <input type="text" id="perfil_naturalidade" value="{naturalidade}" class="w-full mt-1 p-2 border border-slate-300 rounded-lg">
                            </div>
                        </div>
                    </div>
                </div>

                <!-- CONTATO E ENDEREÇO (Editáveis) -->
                <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6 border-l-4 border-l-blue-500">
                    <div class="p-6">
                        <h2 class="font-bold text-slate-800 uppercase tracking-widest text-sm mb-6 border-b pb-2">Atualização de Contato e Localização</h2>
                        
                        <div class="grid grid-cols-2 gap-6 mb-6">
                            <div>
                                <label class="text-xs font-bold text-slate-500 uppercase">WhatsApp</label>
                                <input type="text" id="perfil_tel" value="{telefone_whatsapp}" oninput="mascararTelefonePerfil(this)" class="w-full mt-1 p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                            </div>
                            <div>
                                <label class="text-xs font-bold text-slate-500 uppercase">E-mail Pessoal</label>
                                <input type="email" id="perfil_email" value="{email_contato}" class="w-full mt-1 p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                            </div>
                        </div>

                        <div class="grid grid-cols-3 gap-6">
                            <div class="col-span-2">
                                <label class="text-xs font-bold text-slate-500 uppercase">Logradouro (Rua/Av)</label>
                                <input type="text" id="perfil_log" value="{logradouro}" class="w-full mt-1 p-2 border border-slate-300 rounded-lg">
                            </div>
                            <div>
                                <label class="text-xs font-bold text-slate-500 uppercase">Nº / Apto</label>
                                <input type="text" id="perfil_num" value="{numero}" class="w-full mt-1 p-2 border border-slate-300 rounded-lg">
                            </div>
                            <div>
                                <label class="text-xs font-bold text-slate-500 uppercase">Bairro</label>
                                <input type="text" id="perfil_bairro" value="{bairro}" class="w-full mt-1 p-2 border border-slate-300 rounded-lg">
                            </div>
                            <div>
                                <label class="text-xs font-bold text-slate-500 uppercase">Cidade</label>
                                <input type="text" id="perfil_cidade" value="{cidade}" class="w-full mt-1 p-2 border border-slate-300 rounded-lg">
                            </div>
                            <div>
                                <label class="text-xs font-bold text-slate-500 uppercase">Estado</label>
                                <input type="text" id="perfil_estado" value="{estado}" class="w-full mt-1 p-2 border border-slate-300 rounded-lg">
                            </div>
                        </div>
                    </div>
                </div>

                <div class="flex justify-end">
                    <button type="submit" class="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-xl shadow-lg transition-all">
                        Salvar Minhas Alterações
                    </button>
                </div>
            </form>
        </div>

        <script>
            function preencherSelect(select, opcoes) {{
                select.innerHTML = '';
                opcoes.forEach(o => {{
                    const opt = document.createElement('option');
                    opt.value = o.valor;
                    opt.textContent = o.valor;
                    select.appendChild(opt);
                }});
            }}

            window.addEventListener('DOMContentLoaded', async () => {{
                const select = document.getElementById('perfil_estado_civil');
                const resposta = await fetch('/api/opcoes/estado_civil');
                preencherSelect(select, await resposta.json());
                if (select.dataset.atual) select.value = select.dataset.atual;
            }});

            async function enviarFotoPerfil() {{
                const arquivo = document.getElementById('perfil_foto_arquivo').files[0];
                if (!arquivo) {{
                    alert('Selecione um arquivo de imagem primeiro.');
                    return;
                }}
                const formData = new FormData();
                formData.append('foto', arquivo);
                const resposta = await fetch(`/api/associados/{id_associado}/foto`, {{ method: 'POST', body: formData }});
                if (resposta.ok) {{
                    const dados = await resposta.json();
                    const preview = document.getElementById('perfil_foto_preview');
                    preview.src = dados.foto + '?t=' + Date.now();
                    preview.style.display = '';
                    document.getElementById('perfil_foto_placeholder').style.display = 'none';
                    alert('✅ Foto atualizada com sucesso!');
                }} else {{
                    const erro = await resposta.json();
                    alert(erro.detail || 'Erro ao enviar a foto.');
                }}
            }}

            function mascararTelefonePerfil(campo) {{
                let v = campo.value.replace(/\\D/g, "").slice(0, 11);
                if (v.length > 10) {{
                    v = v.replace(/(\\d{{2}})(\\d{{5}})(\\d{{4}})/, "($1) $2-$3");
                }} else if (v.length > 5) {{
                    v = v.replace(/(\\d{{2}})(\\d{{4}})(\\d{{0,4}})/, "($1) $2-$3");
                }} else if (v.length > 2) {{
                    v = v.replace(/(\\d{{2}})(\\d{{0,5}})/, "($1) $2");
                }}
                campo.value = v;
            }}

            async function atualizarPerfil(event, id) {{
                event.preventDefault();

                const dados = {{
                    email_contato: document.getElementById('perfil_email').value,
                    telefone_whatsapp: document.getElementById('perfil_tel').value,
                    logradouro: document.getElementById('perfil_log').value,
                    numero: document.getElementById('perfil_num').value,
                    bairro: document.getElementById('perfil_bairro').value,
                    cidade: document.getElementById('perfil_cidade').value,
                    estado: document.getElementById('perfil_estado').value,
                    data_nascimento: document.getElementById('perfil_nascimento').value || null,
                    estado_civil: document.getElementById('perfil_estado_civil').value || null,
                    profissao: document.getElementById('perfil_profissao').value || null,
                    naturalidade: document.getElementById('perfil_naturalidade').value || null
                }};

                const resposta = await fetch(`/api/meu-perfil/${{id}}`, {{
                    method: 'PUT',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify(dados)
                }});

                if (resposta.ok) {{
                    alert("✅ Seus dados foram salvos com sucesso na nuvem da ASAF!");
                    window.location.reload();
                }} else {{
                    const erro = await resposta.json();
                    const detalhe = Array.isArray(erro.detail) ? erro.detail.map(d => d.msg).join(", ") : erro.detail;
                    alert("❌ Ocorreu um erro ao salvar: " + (detalhe || "verifique os dados."));
                }}
            }}
        </script>
    </body>
    </html>
    """
    return html_perfil

# ==========================================
# INTEGRAÇÃO 2: PORTAL <-> ÁRVORE FAMILIAR (AUTOATENDIMENTO)
# ==========================================

@router.get("/minha-familia/{id_associado}", response_class=HTMLResponse, summary="Associado - Árvore Familiar")
def minha_familia(id_associado: int, db: Session = Depends(get_db)):
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    if not associado:
        return "<h1>Erro: Associado não encontrado.</h1>"

    nome = esc(associado.nome_completo)

    html_familia = f"""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>Minha Árvore Familiar - ASAF</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 p-10 font-sans">
        <div class="max-w-3xl mx-auto">
            <div class="flex justify-between items-center mb-8">
                <div>
                    <h1 class="text-3xl font-extrabold text-slate-900">Minha Árvore Familiar</h1>
                    <p class="text-slate-500">Familiares (associados vinculados) de {nome}</p>
                </div>
                <a href="/meu-portal/{id_associado}" class="px-4 py-2 bg-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-300 transition">&larr; Voltar ao Portal</a>
            </div>

            <div id="familia_lista" class="space-y-3 mb-6"></div>

            <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h2 class="font-bold text-slate-800 uppercase tracking-widest text-sm mb-1">Adicionar Familiar</h2>
                <p class="text-xs text-slate-400 mb-4">Só é possível vincular pessoas já cadastradas como associado no sistema.</p>
                <div class="grid grid-cols-2 gap-3 mb-3">
                    <select id="familia_novo_associado" class="col-span-2 p-2 border border-slate-300 rounded-lg">
                        <option value="">Selecione o associado...</option>
                    </select>
                    <select id="familia_novo_parentesco" class="col-span-2 p-2 border border-slate-300 rounded-lg"></select>
                </div>
                <button type="button" onclick="adicionarDependente()" class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition">Adicionar</button>
                <p id="familia_erro" class="text-red-600 text-sm font-semibold mt-3 hidden"></p>
            </div>
        </div>

        <script>
            const ID_TITULAR = {id_associado};

            function preencherSelect(select, opcoes) {{
                select.innerHTML = '';
                opcoes.forEach(o => {{
                    const opt = document.createElement('option');
                    opt.value = o.valor;
                    opt.textContent = o.valor;
                    select.appendChild(opt);
                }});
            }}

            async function carregarParentescos() {{
                const resposta = await fetch('/api/opcoes/grau_parentesco');
                return await resposta.json();
            }}

            async function carregarAssociadosParaSelecao() {{
                const select = document.getElementById('familia_novo_associado');
                const resposta = await fetch(`/api/associados/busca-simples?excluir=${{ID_TITULAR}}`);
                const associados = await resposta.json();
                select.innerHTML = '<option value="">Selecione o associado...</option>';
                associados.forEach(a => {{
                    const opt = document.createElement('option');
                    opt.value = a.id_associado;
                    opt.textContent = `${{a.nome_completo}} (CPF ***${{a.cpf_final}})`;
                    select.appendChild(opt);
                }});
            }}

            async function carregarFamilia() {{
                const resposta = await fetch(`/api/associados/${{ID_TITULAR}}/dependentes`);
                const dependentes = await resposta.json();
                const container = document.getElementById('familia_lista');
                container.innerHTML = '';

                if (dependentes.length === 0) {{
                    container.innerHTML = '<div class="bg-white rounded-xl border border-slate-200 p-6 text-center text-slate-400">Nenhum familiar vinculado ainda.</div>';
                    return;
                }}

                dependentes.forEach(dep => {{
                    const card = document.createElement('div');
                    card.className = 'bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex items-center space-x-3';

                    const avatar = document.createElement('div');
                    if (dep.foto) {{
                        avatar.innerHTML = `<img src="${{dep.foto}}" class="w-10 h-10 rounded-full object-cover border border-slate-200">`;
                    }} else {{
                        avatar.innerHTML = `<div class="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs border border-slate-200">${{(dep.nome_completo || '?').trim().split(/\\s+/).map(p => p[0]).slice(0,2).join('').toUpperCase()}}</div>`;
                    }}

                    const info = document.createElement('div');
                    info.className = 'flex-1';
                    const nomeEl = document.createElement('p');
                    nomeEl.className = 'font-bold text-slate-800';
                    nomeEl.textContent = dep.nome_completo;
                    const detalheEl = document.createElement('p');
                    detalheEl.className = 'text-xs text-slate-500';
                    detalheEl.textContent = dep.grau_parentesco;
                    info.appendChild(nomeEl);
                    info.appendChild(detalheEl);

                    const botaoRemover = document.createElement('button');
                    botaoRemover.textContent = 'Remover';
                    botaoRemover.className = 'px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold rounded-lg transition';
                    botaoRemover.onclick = () => removerDependente(dep.id_dependente);

                    card.appendChild(avatar);
                    card.appendChild(info);
                    card.appendChild(botaoRemover);
                    container.appendChild(card);
                }});
            }}

            async function adicionarDependente() {{
                const erroEl = document.getElementById('familia_erro');
                erroEl.classList.add('hidden');
                const idVinculado = document.getElementById('familia_novo_associado').value;
                if (!idVinculado) {{
                    erroEl.textContent = 'Selecione o associado que será vinculado.';
                    erroEl.classList.remove('hidden');
                    return;
                }}

                const resposta = await fetch(`/api/associados/${{ID_TITULAR}}/dependentes`, {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{
                        id_associado_vinculado: parseInt(idVinculado, 10),
                        grau_parentesco: document.getElementById('familia_novo_parentesco').value
                    }})
                }});

                if (resposta.ok) {{
                    document.getElementById('familia_novo_associado').value = '';
                    await carregarFamilia();
                }} else {{
                    const erro = await resposta.json();
                    erroEl.textContent = erro.detail || 'Erro ao adicionar vínculo familiar.';
                    erroEl.classList.remove('hidden');
                }}
            }}

            async function removerDependente(idDependente) {{
                if (!confirm('Remover este vínculo familiar?')) return;
                await fetch(`/api/dependentes/${{idDependente}}`, {{ method: 'DELETE' }});
                await carregarFamilia();
            }}

            window.addEventListener('DOMContentLoaded', async () => {{
                preencherSelect(document.getElementById('familia_novo_parentesco'), await carregarParentescos());
                await carregarAssociadosParaSelecao();
                await carregarFamilia();
            }});
        </script>
    </body>
    </html>
    """
    return html_familia

# ==========================================
# MÓDULO FINANCEIRO — TELAS
# ==========================================
