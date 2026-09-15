from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from datetime import datetime, date, timezone
import os
import re

import httpx

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.associados import Associado, Endereco, DependenteFamiliar, DocumentoAnexo, HistoricoCargo
from app.models.core import NivelAcesso, Usuario
from app.models.pessoas import Papel, Pessoa
from app.models.financeiro import TituloFinanceiro
from app.schemas.associados import (
    AssociadoMasterCriar,
    AssociadoAdminUpdate,
    AssociadoPerfilUpdate,
    ConcederAcessoCriar,
    DependenteAtualizar,
    DependenteCriar,
    DependentePessoaCriar,
    HistoricoCargoCriar,
    HistoricoCargoEncerrar,
)
from app.security import criar_token_carteirinha, decodificar_token_carteirinha, exigir_permissao, get_current_user_opcional, hash_senha, usuario_tem_permissao, validar_senha_forte
from app.services.categoria_associado import calcular_categoria
from app.services.catalogos import validar_codigo_em_catalogo
from app.services.duplicidade import detectar_cadastro_duplicado
from app.services.linha_do_tempo import publicar_evento_linha_do_tempo
from app.services.matricula import proximo_numero_matricula

router = APIRouter()
_permissao_associados = exigir_permissao("associados")

@router.post("/associados-master/", summary="Cadastrar Ficha Master")
def cadastrar_ficha_master(
    dados: AssociadoMasterCriar, db: Session = Depends(get_db),
    usuario_opcional: Usuario = Depends(get_current_user_opcional),
):
    if db.query(Associado).filter(Associado.cpf == dados.cpf).first():
        raise HTTPException(status_code=400, detail="Este CPF já está arrolado.")

    # v1.8 - CPF nunca bate por erro de digitação (por isso o bloqueio acima não pega o caso
    # real). Nome + pelo menos outro dado pessoal batendo é bloqueio, não sinal - decisão do
    # usuário de não deixar cadastrar em vez de mesclar depois. Só quem tem a permissão
    # `forcar_cadastro_duplicado` (Presidente, por padrão) pode passar por cima, de propósito.
    parecido = detectar_cadastro_duplicado(
        db, dados.nome_completo, data_nascimento=(
            datetime.combine(dados.data_nascimento, datetime.min.time()) if dados.data_nascimento else None
        ),
        telefone_whatsapp=dados.telefone_whatsapp, email_contato=dados.email_contato,
    )
    if parecido:
        pode_forcar = dados.forcar and usuario_opcional and usuario_tem_permissao(db, usuario_opcional, "forcar_cadastro_duplicado")
        if not pode_forcar:
            raise HTTPException(
                status_code=409,
                detail=f"Já existe um cadastro parecido: '{parecido.nome_completo}' - confirme que não é a mesma "
                       "pessoa antes de continuar. Só um Presidente pode forçar este cadastro mesmo assim.",
            )
        registrar_auditoria(
            db, usuario_opcional, "associados", "CADASTRO_DUPLICADO_FORCADO",
            dados_depois={"nome_completo": dados.nome_completo, "id_pessoa_parecida": parecido.id_pessoa},
        )

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


@router.get("/api/associados/", summary="Listar associados")
def listar_associados(db: Session = Depends(get_db), _usuario: Usuario = Depends(_permissao_associados)):
    """v3.0.2 (achado 2026-09-15) - o painel React só tinha `/api/associados/busca-simples`
    (id+nome, pra seletor); a página HTML `/admin/secretaria` (removida no mesmo dia - protótipo
    pré-plano) nunca devolvia JSON. Esta é a listagem de verdade que alimenta a tela
    `/associados` do painel único."""
    associados = db.query(Associado).join(Pessoa).order_by(Pessoa.nome_completo).all()
    return [
        {
            "id_associado": a.id_associado,
            "nome_completo": a.nome_completo,
            "cpf": a.cpf,
            "categoria": a.categoria,
            "status_arrolamento": a.status_arrolamento,
            "email_contato": a.email_contato,
            "telefone_whatsapp": a.telefone_whatsapp,
            "numero_matricula": a.numero_matricula,
            "tem_acesso": a.id_usuario is not None,
        }
        for a in associados
    ]


@router.post("/api/associados/{id_associado}/conceder-acesso", summary="Conceder acesso (usuário/senha) a um associado")
def conceder_acesso(id_associado: int, dados: ConcederAcessoCriar, db: Session = Depends(get_db), usuario_secretaria: Usuario = Depends(_permissao_associados)):
    """v3.0 (achado 2026-09-15) - cadastrar a ficha (`/associados-master/`) nunca criou login
    pra a pessoa; isso aqui fecha esse buraco. A secretaria define uma senha provisória
    (`Usuario.senha_provisoria=True`) que o associado É OBRIGADO a trocar - `POST /auth/login`
    devolve a flag pro front-end forçar a troca antes de deixar usar o resto do sistema."""
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    if not associado:
        raise HTTPException(status_code=404, detail="Associado não encontrado.")
    if associado.id_usuario is not None:
        raise HTTPException(status_code=400, detail="Este associado já tem acesso concedido.")

    erro = validar_senha_forte(dados.senha_provisoria)
    if erro:
        raise HTTPException(status_code=400, detail=erro)

    id_nivel = dados.id_nivel
    if id_nivel is None:
        nivel_padrao = db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == "Associado").first()
        if not nivel_padrao:
            raise HTTPException(status_code=500, detail="Catálogo de níveis de acesso não foi semeado ainda - reinicie o servidor.")
        id_nivel = nivel_padrao.id_nivel
    elif not db.query(NivelAcesso).filter(NivelAcesso.id_nivel == id_nivel).first():
        raise HTTPException(status_code=404, detail="Nível de acesso não encontrado.")

    novo_usuario = Usuario(email=dados.email, senha_hash=hash_senha(dados.senha_provisoria), id_nivel=id_nivel, senha_provisoria=True)
    db.add(novo_usuario)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Já existe um usuário com esse e-mail.")
    associado.id_usuario = novo_usuario.id_usuario
    db.commit()
    registrar_auditoria(
        db, usuario_secretaria, "usuarios", "CONCESSAO_ACESSO", id_registro_afetado=novo_usuario.id_usuario,
        dados_depois={"id_associado": id_associado, "id_nivel": id_nivel},
    )
    return {"mensagem": "Acesso concedido. Entregue a senha provisória ao associado - ele será obrigado a trocá-la no primeiro login.", "id_usuario": novo_usuario.id_usuario}


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


# ==========================================
# DEPENDENTES/FAMÍLIA (v1.7 - vínculo entre Pessoas, não mais entre Associados)
#
# As duas rotas legadas abaixo (/api/associados/.../dependentes) continuam funcionando
# exatamente como antes - mesmo contrato JSON, sem autenticação (protótipo antigo ainda em
# produção, mesmo padrão de compatibilidade já usado desde a v0.3.1 pros catálogos) - só que
# por baixo já usam a tabela reformada (`id_pessoa_titular`/`id_pessoa_vinculada`). As rotas
# novas (/api/pessoas/.../dependentes), com autenticação e permissão de verdade, são o caminho
# que permite o caso que a v1.7 existe pra resolver: um dependente que ainda NÃO é associado.
# ==========================================
@router.get("/api/associados/{id_associado}/dependentes", summary="Listar dependentes de um associado (legado)")
def listar_dependentes(id_associado: int, db: Session = Depends(get_db)):
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    if not associado:
        return []
    deps = db.query(DependenteFamiliar).filter(DependenteFamiliar.id_pessoa_titular == associado.id_pessoa).all()
    resultado = []
    for d in deps:
        vinculado = db.query(Associado).filter(Associado.id_pessoa == d.id_pessoa_vinculada).first()
        resultado.append({
            "id_dependente": d.id_dependente,
            "grau_parentesco": d.grau_parentesco,
            "id_associado_vinculado": vinculado.id_associado if vinculado else None,
            "nome_completo": vinculado.nome_completo if vinculado else "(pessoa sem cadastro de associado)",
            "foto": vinculado.foto if vinculado else None,
            "data_nascimento": vinculado.data_nascimento.date().isoformat() if vinculado and vinculado.data_nascimento else None
        })
    return resultado


@router.post("/api/associados/{id_associado}/dependentes", summary="Adicionar vínculo familiar entre dois associados (legado)")
def criar_dependente(id_associado: int, dados: DependenteCriar, db: Session = Depends(get_db)):
    titular = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    if not titular:
        raise HTTPException(status_code=404, detail="Associado titular não encontrado.")
    if dados.id_associado_vinculado == id_associado:
        raise HTTPException(status_code=400, detail="Um associado não pode ser familiar de si mesmo.")
    vinculado = db.query(Associado).filter(Associado.id_associado == dados.id_associado_vinculado).first()
    if not vinculado:
        raise HTTPException(status_code=404, detail="O associado indicado como familiar não está cadastrado no sistema.")
    validar_codigo_em_catalogo(db, "grau_parentesco", dados.grau_parentesco, "Grau de parentesco")

    novo = DependenteFamiliar(
        id_pessoa_titular=titular.id_pessoa,
        id_pessoa_vinculada=vinculado.id_pessoa,
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


@router.get("/api/pessoas/{id_pessoa_titular}/dependentes", summary="Listar dependentes de uma pessoa (v1.7)")
def listar_dependentes_pessoa(
    id_pessoa_titular: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_associados),
):
    if not db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa_titular).first():
        raise HTTPException(status_code=404, detail="Pessoa titular não encontrada.")
    deps = db.query(DependenteFamiliar).filter(DependenteFamiliar.id_pessoa_titular == id_pessoa_titular).all()
    resultado = []
    for d in deps:
        vinculada = db.query(Pessoa).filter(Pessoa.id_pessoa == d.id_pessoa_vinculada).first()
        associado_vinculado = db.query(Associado).filter(Associado.id_pessoa == d.id_pessoa_vinculada).first()
        resultado.append({
            "id_dependente": d.id_dependente,
            "grau_parentesco": d.grau_parentesco,
            "id_pessoa_vinculada": d.id_pessoa_vinculada,
            "nome_completo": vinculada.nome_completo if vinculada else None,
            "data_nascimento": vinculada.data_nascimento.date().isoformat() if vinculada and vinculada.data_nascimento else None,
            "e_associado": associado_vinculado is not None,
        })
    return resultado


@router.post("/api/pessoas/{id_pessoa_titular}/dependentes", summary="Adicionar dependente (pessoa existente ou nova) - v1.7")
def criar_dependente_pessoa(
    id_pessoa_titular: int, dados: DependentePessoaCriar,
    db: Session = Depends(get_db), _usuario=Depends(_permissao_associados),
):
    if not db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa_titular).first():
        raise HTTPException(status_code=404, detail="Pessoa titular não encontrada.")
    validar_codigo_em_catalogo(db, "grau_parentesco", dados.grau_parentesco, "Grau de parentesco")

    if dados.id_pessoa_vinculada:
        vinculada = db.query(Pessoa).filter(Pessoa.id_pessoa == dados.id_pessoa_vinculada).first()
        if not vinculada:
            raise HTTPException(status_code=404, detail="Pessoa indicada como dependente não encontrada.")
        if vinculada.id_pessoa == id_pessoa_titular:
            raise HTTPException(status_code=400, detail="Uma pessoa não pode ser familiar de si mesma.")
    else:
        # Dependente que ainda não tem NENHUM cadastro no sistema (ex.: filho menor) - cria a
        # Pessoa agora, sem Papel nenhum ainda; se um dia ela virar associada, o cadastro já
        # existe, só ganha o Papel "associado" (mesma regra da v1.0), sem recadastro.
        vinculada = Pessoa(nome_completo=dados.nome_completo, data_nascimento=(
            datetime.combine(dados.data_nascimento, datetime.min.time()) if dados.data_nascimento else None
        ))
        db.add(vinculada)
        db.flush()

    novo = DependenteFamiliar(
        id_pessoa_titular=id_pessoa_titular, id_pessoa_vinculada=vinculada.id_pessoa,
        grau_parentesco=dados.grau_parentesco,
    )
    db.add(novo)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Esse vínculo familiar já foi cadastrado.")
    db.refresh(novo)
    return {"mensagem": "Dependente adicionado.", "id_dependente": novo.id_dependente, "id_pessoa_vinculada": vinculada.id_pessoa}


@router.put("/api/dependentes/{id_dependente}", summary="Editar grau de parentesco")
def editar_dependente(id_dependente: int, dados: DependenteAtualizar, db: Session = Depends(get_db)):
    dep = db.query(DependenteFamiliar).filter(DependenteFamiliar.id_dependente == id_dependente).first()
    if not dep:
        raise HTTPException(status_code=404, detail="Vínculo familiar não encontrado.")
    validar_codigo_em_catalogo(db, "grau_parentesco", dados.grau_parentesco, "Grau de parentesco")
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


