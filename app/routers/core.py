import re
import unicodedata
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.auditoria import registrar_auditoria
from app.config_cache import invalidar_cache_configuracao
from app.database import get_db
from app.models.associados import Associado
from app.models.pessoas import Pessoa
from app.models.core import ConfiguracaoInstitucional, OpcaoLista, Catalogo, OpcaoCatalogo, DefinicaoCampo, ValorCampo, NivelAcesso, PermissaoSistema, perfil_permissao, AuditLog, Usuario
from app.schemas.core import (
    ConfiguracaoAtualizar,
    ImportarConfiguracaoRequest,
    OpcaoCriar,
    OpcaoAtualizar,
    NivelAcessoCriar,
    NivelAcessoAtualizar,
    PermissaoCriar,
    CatalogoCriar,
    OpcaoCatalogoCriar,
    OpcaoCatalogoAtualizar,
    DefinicaoCampoCriar,
    DefinicaoCampoAtualizar,
    ValoresCampoDefinir,
)
from app.security import exigir_permissao, get_current_user, nivel_efetivo_id, usuario_tem_permissao

router = APIRouter()


def _slug(valor: str) -> str:
    """Deriva um código técnico estável a partir de texto livre - mesma lógica da migração
    d2e3f4a5b6c7 (v0.3.1), usada aqui só quando o chamador não informa `codigo` explicitamente
    (compatibilidade com a rota legada /api/opcoes/, que só conhecia "valor")."""
    sem_acento = unicodedata.normalize("NFKD", valor).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"_+", "_", re.sub(r"[^A-Za-z0-9]+", "_", sem_acento)).strip("_").upper()


def _obter_ou_criar_catalogo(db: Session, chave: str) -> Catalogo:
    catalogo = db.query(Catalogo).filter(Catalogo.chave == chave).first()
    if catalogo is None:
        catalogo = Catalogo(chave=chave, nome_exibido=chave.replace("_", " ").capitalize(), editavel_pelo_usuario=True)
        db.add(catalogo)
        db.flush()
    return catalogo

@router.post("/setup-cerebro/", summary="1. Inicializar Cérebro")
def setup_cerebro(db: Session = Depends(get_db)):
    configs = [
        {"chave": "NOME_INSTITUICAO", "valor": "ASAF - Associação Arca da Família"},
        {"chave": "STATUS_ARROLAMENTO_PADRAO", "valor": "Ativo - Em Dia"},
        {"chave": "MODELO_GESTAO", "valor": "Governança Terceiro Setor"}
    ]
    for c in configs:
        if not db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao == c["chave"]).first():
            db.add(ConfiguracaoInstitucional(chave_configuracao=c["chave"], valor_configuracao=c["valor"]))
    db.commit()
    return {"mensagem": "Cérebro inicializado com sucesso!"}


# ==========================================
# /api/opcoes/* — v0.1/v0.2. As páginas HTML do protótipo antigo que chamavam esta rota
# (/admin/secretaria, /meu-portal, /meu-perfil, /minha-familia) foram removidas em 2026-09-15
# (ver PLANO_PROJETO.md - painel único é a única interface daqui em diante), mas a rota
# continua viva: é a única fonte do RÓTULO de campos que gravam o rótulo como valor (ex.:
# `Associado.categoria`/`estado_civil`, ver painel/src/lib/api.ts::listarOpcoesLegado) - migrado
# para ler/escrever em Catalogo/OpcaoCatalogo (v0.3.1) por baixo, nenhum dado novo entra mais em
# `opcoes_lista`, que fica só como histórico da migração. Uso novo que precisa do CÓDIGO (não do
# rótulo) deve chamar /api/catalogos/ diretamente, não esta rota.
# ==========================================
@router.get("/api/opcoes/{tipo_lista}", summary="Listar valores de uma lista configurável (compat v0.1/v0.2)")
def listar_opcoes(tipo_lista: str, incluir_inativos: bool = False, db: Session = Depends(get_db)):
    catalogo = db.query(Catalogo).filter(Catalogo.chave == tipo_lista).first()
    if catalogo is None:
        return []
    consulta = db.query(OpcaoCatalogo).filter(OpcaoCatalogo.id_catalogo == catalogo.id_catalogo)
    if not incluir_inativos:
        consulta = consulta.filter(OpcaoCatalogo.ativo == True)
    opcoes = consulta.order_by(OpcaoCatalogo.ordem, OpcaoCatalogo.id_opcao).all()
    return [{"id_opcao": o.id_opcao, "valor": o.rotulo, "ativo": o.ativo} for o in opcoes]


@router.post("/api/opcoes/{tipo_lista}", summary="Adicionar valor a uma lista configurável (compat v0.1/v0.2)")
def criar_opcao(
    tipo_lista: str, dados: OpcaoCriar, request: Request, db: Session = Depends(get_db),
    usuario: Usuario = Depends(get_current_user),
):
    # v2.5.8 (achado do usuário, correção de segurança) - esta rota nunca teve NENHUMA checagem
    # de autenticação/permissão (só `Depends(get_db)`) - qualquer requisição não autenticada
    # conseguia gravar/alterar opção real de catálogo em produção. Corrigido pra exigir login e a
    # mesma permissão por módulo do motor novo (_exigir_permissao_catalogo), nunca deixado como
    # estava só porque "ninguém usa mais essa rota" - ela continuava live e gravando de verdade.
    catalogo = _obter_ou_criar_catalogo(db, tipo_lista)
    _exigir_permissao_catalogo(db, usuario, catalogo)
    if db.query(OpcaoCatalogo).filter(OpcaoCatalogo.id_catalogo == catalogo.id_catalogo, OpcaoCatalogo.rotulo == dados.valor).first():
        raise HTTPException(status_code=400, detail="Esse valor já existe nessa lista.")
    maior_ordem = db.query(OpcaoCatalogo).filter(OpcaoCatalogo.id_catalogo == catalogo.id_catalogo).count()
    codigo_base = _slug(dados.valor) or f"OPCAO_{maior_ordem + 1}"
    codigo, sufixo = codigo_base, 2
    while db.query(OpcaoCatalogo).filter(OpcaoCatalogo.id_catalogo == catalogo.id_catalogo, OpcaoCatalogo.codigo == codigo).first():
        codigo = f"{codigo_base}_{sufixo}"
        sufixo += 1
    nova = OpcaoCatalogo(id_catalogo=catalogo.id_catalogo, codigo=codigo, rotulo=dados.valor, ordem=maior_ordem, ativo=True)
    db.add(nova)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Esse valor já existe nessa lista.")
    db.refresh(nova)
    return {"id_opcao": nova.id_opcao, "valor": nova.rotulo, "ativo": nova.ativo}


@router.put("/api/opcoes/{id_opcao}", summary="Renomear/ativar/desativar valor de lista (compat v0.1/v0.2)")
def atualizar_opcao(
    id_opcao: int, dados: OpcaoAtualizar, request: Request, db: Session = Depends(get_db),
    usuario: Usuario = Depends(get_current_user),
):
    # v2.5.8 - mesma correção de segurança do POST acima: esta rota também não tinha NENHUMA
    # checagem de autenticação.
    opcao = db.query(OpcaoCatalogo).filter(OpcaoCatalogo.id_opcao == id_opcao).first()
    if not opcao:
        raise HTTPException(status_code=404, detail="Opção não encontrada.")
    catalogo = db.query(Catalogo).filter(Catalogo.id_catalogo == opcao.id_catalogo).first()
    if catalogo:
        _exigir_permissao_catalogo(db, usuario, catalogo)
    if dados.valor is not None:
        opcao.rotulo = dados.valor
    if dados.ativo is not None:
        opcao.ativo = dados.ativo
    db.commit()
    return {"mensagem": "Opção atualizada."}


# ==========================================
# CATÁLOGO GENÉRICO (v0.3.1) — motor de verdade, usado por código novo daqui pra frente.
# Leitura (listar catálogos/opções) é liberada a qualquer usuário autenticado — v0.3.3 precisa
# disso pra renderizar um campo personalizado do tipo "seleção" pra qualquer usuário preenchendo
# um formulário, não só admin (achado ao construir o consumidor real desta API). Só CRIAR/EDITAR
# catálogo e opção continua exigindo gerenciar_acesso.
# ==========================================
_permissao_gerenciar_catalogos = exigir_permissao("gerenciar_acesso")

# Catálogos cujo código o sistema hoje depende de existir com valor específico (ver migração
# d2e3f4a5b6c7) - além do que `editavel_pelo_usuario=False` já sinaliza, nenhuma coluna de
# negócio ainda referencia OpcaoCatalogo por FK (as tabelas de FASE 1+ usam string solta), então
# a checagem de "opção em uso" abaixo é honesta sobre isso: só sabe checar o que já existe hoje.
_CONSULTAS_USO: dict[str, list] = {
    "categoria_associado": [(Associado, "categoria")],
    "status_arrolamento": [(Associado, "status_arrolamento")],
}


def _opcao_em_uso(db: Session, chave_catalogo: str, rotulo: str) -> bool:
    for modelo, coluna in _CONSULTAS_USO.get(chave_catalogo, []):
        if db.query(modelo).filter(getattr(modelo, coluna) == rotulo).first():
            return True
    return False


def _exigir_permissao_catalogo(db: Session, usuario: Usuario, catalogo: Catalogo) -> None:
    """v2.5.8 (achado do usuário) - antes disso, gerenciar opção de QUALQUER catálogo exigia
    sempre `gerenciar_acesso` (a mesma permissão da tela de Níveis e permissões) - um secretário
    (permissão `associados`) precisava de acesso bem mais amplo do que o necessário só pra
    editar a categoria de associado. Agora cada catálogo declara o dono (`permissao_
    gerenciamento`); quem tem essa permissão específica OU `gerenciar_acesso` (sempre, como
    reforço - nunca como único caminho) pode gerenciar. Catálogo sem dono declarado continua
    exigindo só `gerenciar_acesso` (comportamento antigo, preservado de propósito)."""
    if usuario_tem_permissao(db, usuario, "gerenciar_acesso"):
        return
    if catalogo.permissao_gerenciamento and usuario_tem_permissao(db, usuario, catalogo.permissao_gerenciamento):
        return
    exigido = catalogo.permissao_gerenciamento or "gerenciar_acesso"
    raise HTTPException(status_code=403, detail=f"Sem permissão para gerenciar o catálogo '{catalogo.nome_exibido}' (exige '{exigido}').")


@router.get("/api/catalogos/", summary="Listar catálogos configuráveis")
def listar_catalogos(db: Session = Depends(get_db), _usuario: Usuario = Depends(get_current_user)):
    catalogos = db.query(Catalogo).order_by(Catalogo.nome_exibido).all()
    return [
        {
            "id_catalogo": c.id_catalogo, "chave": c.chave, "nome_exibido": c.nome_exibido,
            "descricao": c.descricao, "editavel_pelo_usuario": c.editavel_pelo_usuario,
            "permissao_gerenciamento": c.permissao_gerenciamento,
        }
        for c in catalogos
    ]


@router.post("/api/catalogos/", summary="Criar um catálogo novo")
def criar_catalogo(
    dados: CatalogoCriar, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_gerenciar_catalogos)
):
    if db.query(Catalogo).filter(Catalogo.chave == dados.chave).first():
        raise HTTPException(status_code=400, detail="Já existe um catálogo com essa chave.")
    novo = Catalogo(**dados.model_dump())
    db.add(novo)
    db.commit()
    db.refresh(novo)
    registrar_auditoria(
        db, usuario, "catalogos", "CREATE", id_registro_afetado=novo.id_catalogo,
        dados_depois=dados.model_dump(), ip_origem=request.client.host if request.client else None,
    )
    return {"id_catalogo": novo.id_catalogo, "chave": novo.chave}


@router.get("/api/catalogos/{chave}/opcoes", summary="Listar opções de um catálogo")
def listar_opcoes_catalogo(
    chave: str, incluir_inativos: bool = False, db: Session = Depends(get_db), _usuario: Usuario = Depends(get_current_user)
):
    catalogo = db.query(Catalogo).filter(Catalogo.chave == chave).first()
    if not catalogo:
        raise HTTPException(status_code=404, detail="Catálogo não encontrado.")
    consulta = db.query(OpcaoCatalogo).filter(OpcaoCatalogo.id_catalogo == catalogo.id_catalogo)
    if not incluir_inativos:
        consulta = consulta.filter(OpcaoCatalogo.ativo == True)
    opcoes = consulta.order_by(OpcaoCatalogo.ordem, OpcaoCatalogo.id_opcao).all()
    return [
        {
            "id_opcao": o.id_opcao, "id_pai": o.id_pai, "codigo": o.codigo, "rotulo": o.rotulo,
            "ordem": o.ordem, "ativo": o.ativo, "cor": o.cor, "icone": o.icone, "metadados": o.metadados,
        }
        for o in opcoes
    ]


@router.post("/api/catalogos/{chave}/opcoes", summary="Adicionar opção a um catálogo")
def criar_opcao_catalogo(
    chave: str, dados: OpcaoCatalogoCriar, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)
):
    catalogo = db.query(Catalogo).filter(Catalogo.chave == chave).first()
    if not catalogo:
        raise HTTPException(status_code=404, detail="Catálogo não encontrado.")
    _exigir_permissao_catalogo(db, usuario, catalogo)
    if not catalogo.editavel_pelo_usuario:
        raise HTTPException(status_code=403, detail="Catálogo de sistema — não aceita opção nova por aqui.")
    if db.query(OpcaoCatalogo).filter(OpcaoCatalogo.id_catalogo == catalogo.id_catalogo, OpcaoCatalogo.codigo == dados.codigo).first():
        raise HTTPException(status_code=400, detail="Já existe uma opção com esse código neste catálogo.")
    nova = OpcaoCatalogo(id_catalogo=catalogo.id_catalogo, **dados.model_dump())
    db.add(nova)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Já existe uma opção com esse código neste catálogo.")
    db.refresh(nova)
    registrar_auditoria(
        db, usuario, "opcoes_catalogo", "CREATE", id_registro_afetado=nova.id_opcao,
        dados_depois=dados.model_dump(), ip_origem=request.client.host if request.client else None,
    )
    return {"id_opcao": nova.id_opcao, "codigo": nova.codigo}


@router.put("/api/opcoes-catalogo/{id_opcao}", summary="Editar rótulo/ordem/ativo de uma opção (nunca o código)")
def atualizar_opcao_catalogo(
    id_opcao: int, dados: OpcaoCatalogoAtualizar, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)
):
    opcao = db.query(OpcaoCatalogo).filter(OpcaoCatalogo.id_opcao == id_opcao).first()
    if not opcao:
        raise HTTPException(status_code=404, detail="Opção não encontrada.")
    catalogo = db.query(Catalogo).filter(Catalogo.id_catalogo == opcao.id_catalogo).first()
    if catalogo:
        _exigir_permissao_catalogo(db, usuario, catalogo)
    antes = {"rotulo": opcao.rotulo, "ordem": opcao.ordem, "ativo": opcao.ativo, "cor": opcao.cor, "icone": opcao.icone}
    dados_alterados = dados.model_dump(exclude_unset=True)
    for campo, valor in dados_alterados.items():
        setattr(opcao, campo, valor)
    db.commit()
    registrar_auditoria(
        db, usuario, "opcoes_catalogo", "UPDATE", id_registro_afetado=id_opcao,
        dados_antes=antes, dados_depois=dados_alterados, ip_origem=request.client.host if request.client else None,
    )
    return {"mensagem": "Opção atualizada."}


@router.delete("/api/opcoes-catalogo/{id_opcao}", summary="Excluir opção (só se já inativa e sem uso)")
def excluir_opcao_catalogo(
    id_opcao: int, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)
):
    opcao = db.query(OpcaoCatalogo).filter(OpcaoCatalogo.id_opcao == id_opcao).first()
    if not opcao:
        raise HTTPException(status_code=404, detail="Opção não encontrada.")
    catalogo = db.query(Catalogo).filter(Catalogo.id_catalogo == opcao.id_catalogo).first()
    if catalogo:
        _exigir_permissao_catalogo(db, usuario, catalogo)
    if opcao.ativo:
        raise HTTPException(status_code=400, detail="Desative a opção antes de excluir (nunca exclui opção ativa).")
    if catalogo and _opcao_em_uso(db, catalogo.chave, opcao.rotulo):
        raise HTTPException(status_code=409, detail="Opção em uso por registros existentes — não pode ser excluída.")
    dados_antes = {"codigo": opcao.codigo, "rotulo": opcao.rotulo}
    db.delete(opcao)
    db.commit()
    registrar_auditoria(
        db, usuario, "opcoes_catalogo", "DELETE", id_registro_afetado=id_opcao,
        dados_antes=dados_antes, ip_origem=request.client.host if request.client else None,
    )
    return {"mensagem": "Opção excluída."}

# ==========================================
# NÍVEIS DE ACESSO E PERMISSÕES (v0.1.5 do plano - catálogo configurável, nada fixo em código)
# ==========================================
_permissao_gerenciar_acesso = exigir_permissao("gerenciar_acesso")


@router.get("/api/niveis-acesso/", summary="Listar níveis de acesso (com a matriz de permissões atribuídas)")
def listar_niveis_acesso(db: Session = Depends(get_db), _=Depends(_permissao_gerenciar_acesso)):
    niveis = db.query(NivelAcesso).order_by(NivelAcesso.id_nivel).all()
    # v0.2.9 - a tela de administração é uma MATRIZ nível × permissão: sem os ids de permissão
    # já atribuídos, o front teria que fazer uma chamada por nível para montar a grade.
    atribuicoes = db.execute(perfil_permissao.select()).all()
    permissoes_por_nivel: dict[int, list[int]] = {}
    for linha in atribuicoes:
        permissoes_por_nivel.setdefault(linha.id_nivel, []).append(linha.id_permissao)
    return [
        {"id_nivel": n.id_nivel, "nome_nivel": n.nome_nivel, "descricao": n.descricao,
         "is_conselho_fiscal": n.is_conselho_fiscal, "exige_mfa": n.exige_mfa,
         "permissoes": permissoes_por_nivel.get(n.id_nivel, [])}
        for n in niveis
    ]


@router.post("/api/niveis-acesso/", summary="Criar nível de acesso")
def criar_nivel_acesso(
    dados: NivelAcessoCriar, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_gerenciar_acesso)
):
    if db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == dados.nome_nivel).first():
        raise HTTPException(status_code=400, detail="Já existe um nível de acesso com esse nome.")
    novo = NivelAcesso(**dados.model_dump())
    db.add(novo)
    db.commit()
    db.refresh(novo)
    registrar_auditoria(
        db, usuario, "niveis_acesso", "CREATE", id_registro_afetado=novo.id_nivel,
        dados_depois=dados.model_dump(), ip_origem=request.client.host if request.client else None,
    )
    return {"id_nivel": novo.id_nivel, "nome_nivel": novo.nome_nivel}


@router.put("/api/niveis-acesso/{id_nivel}", summary="Editar nível de acesso")
def atualizar_nivel_acesso(
    id_nivel: int, dados: NivelAcessoAtualizar, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_gerenciar_acesso)
):
    nivel = db.query(NivelAcesso).filter(NivelAcesso.id_nivel == id_nivel).first()
    if not nivel:
        raise HTTPException(status_code=404, detail="Nível de acesso não encontrado.")
    antes = {"nome_nivel": nivel.nome_nivel, "descricao": nivel.descricao, "is_conselho_fiscal": nivel.is_conselho_fiscal, "exige_mfa": nivel.exige_mfa}
    dados_alterados = dados.model_dump(exclude_unset=True)
    for campo, valor in dados_alterados.items():
        setattr(nivel, campo, valor)
    db.commit()
    registrar_auditoria(
        db, usuario, "niveis_acesso", "UPDATE", id_registro_afetado=id_nivel,
        dados_antes=antes, dados_depois=dados_alterados, ip_origem=request.client.host if request.client else None,
    )
    return {"mensagem": "Nível de acesso atualizado."}


@router.get("/api/permissoes/", summary="Listar permissões do sistema")
def listar_permissoes(db: Session = Depends(get_db), _=Depends(_permissao_gerenciar_acesso)):
    permissoes = db.query(PermissaoSistema).order_by(PermissaoSistema.modulo, PermissaoSistema.codigo_permissao).all()
    return [
        {"id_permissao": p.id_permissao, "modulo": p.modulo, "codigo_permissao": p.codigo_permissao, "descricao": p.descricao}
        for p in permissoes
    ]


@router.post("/api/permissoes/", summary="Criar permissão do sistema")
def criar_permissao(
    dados: PermissaoCriar, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_gerenciar_acesso)
):
    if db.query(PermissaoSistema).filter(PermissaoSistema.codigo_permissao == dados.codigo_permissao).first():
        raise HTTPException(status_code=400, detail="Já existe uma permissão com esse código.")
    nova = PermissaoSistema(**dados.model_dump())
    db.add(nova)
    db.commit()
    db.refresh(nova)
    registrar_auditoria(
        db, usuario, "permissoes_sistema", "CREATE", id_registro_afetado=nova.id_permissao,
        dados_depois=dados.model_dump(), ip_origem=request.client.host if request.client else None,
    )
    return {"id_permissao": nova.id_permissao, "codigo_permissao": nova.codigo_permissao}


@router.post("/api/niveis-acesso/{id_nivel}/permissoes/{id_permissao}", summary="Atribuir permissão a um nível")
def atribuir_permissao(
    id_nivel: int, id_permissao: int, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_gerenciar_acesso)
):
    if not db.query(NivelAcesso).filter(NivelAcesso.id_nivel == id_nivel).first():
        raise HTTPException(status_code=404, detail="Nível de acesso não encontrado.")
    if not db.query(PermissaoSistema).filter(PermissaoSistema.id_permissao == id_permissao).first():
        raise HTTPException(status_code=404, detail="Permissão não encontrada.")
    ja_existe = db.execute(
        perfil_permissao.select().where(
            perfil_permissao.c.id_nivel == id_nivel, perfil_permissao.c.id_permissao == id_permissao
        )
    ).first()
    if not ja_existe:
        db.execute(perfil_permissao.insert().values(id_nivel=id_nivel, id_permissao=id_permissao))
        db.commit()
        registrar_auditoria(
            db, usuario, "perfil_permissao", "CREATE", id_registro_afetado=id_nivel,
            dados_depois={"id_nivel": id_nivel, "id_permissao": id_permissao},
            ip_origem=request.client.host if request.client else None,
        )
    return {"mensagem": "Permissão atribuída."}


@router.delete("/api/niveis-acesso/{id_nivel}/permissoes/{id_permissao}", summary="Remover permissão de um nível")
def remover_permissao(
    id_nivel: int, id_permissao: int, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_gerenciar_acesso)
):
    db.execute(
        perfil_permissao.delete().where(
            perfil_permissao.c.id_nivel == id_nivel, perfil_permissao.c.id_permissao == id_permissao
        )
    )
    db.commit()
    registrar_auditoria(
        db, usuario, "perfil_permissao", "DELETE", id_registro_afetado=id_nivel,
        dados_antes={"id_nivel": id_nivel, "id_permissao": id_permissao},
        ip_origem=request.client.host if request.client else None,
    )
    return {"mensagem": "Permissão removida."}


# ==========================================
# VISUALIZADOR DE AUDITORIA (v0.2.9 - somente leitura, nunca exclusão pela interface)
# ==========================================
_permissao_auditoria = exigir_permissao("auditoria")


@router.get("/api/auditoria/", summary="Consultar trilha de auditoria (filtros: usuário, tabela, ação, período)")
def listar_auditoria(
    db: Session = Depends(get_db),
    _=Depends(_permissao_auditoria),
    id_usuario: Optional[int] = None,
    tabela_afetada: Optional[str] = None,
    acao: Optional[str] = None,
    desde: Optional[datetime] = None,
    ate: Optional[datetime] = None,
    pagina: int = Query(1, ge=1),
    por_pagina: int = Query(50, ge=1, le=200),
):
    consulta = db.query(AuditLog)
    if id_usuario is not None:
        consulta = consulta.filter(AuditLog.id_usuario == id_usuario)
    if tabela_afetada:
        consulta = consulta.filter(AuditLog.tabela_afetada == tabela_afetada)
    if acao:
        consulta = consulta.filter(AuditLog.acao == acao)
    if desde:
        consulta = consulta.filter(AuditLog.timestamp >= desde)
    if ate:
        consulta = consulta.filter(AuditLog.timestamp <= ate)

    total = consulta.count()
    entradas = (
        consulta.order_by(AuditLog.timestamp.desc())
        .offset((pagina - 1) * por_pagina)
        .limit(por_pagina)
        .all()
    )

    ids_usuarios = {e.id_usuario for e in entradas if e.id_usuario is not None}
    nomes_por_usuario: dict[int, str] = {}
    if ids_usuarios:
        # Associado.nome_completo é association_proxy (v1.0) - não dá pra selecionar como
        # coluna direto, precisa de join com Pessoa (fonte real do dado agora).
        for id_u, nome in (
            db.query(Associado.id_usuario, Pessoa.nome_completo)
            .join(Pessoa, Associado.id_pessoa == Pessoa.id_pessoa)
            .filter(Associado.id_usuario.in_(ids_usuarios))
            .all()
        ):
            nomes_por_usuario[id_u] = nome

    return {
        "total": total,
        "pagina": pagina,
        "por_pagina": por_pagina,
        "entradas": [
            {
                "id_log": e.id_log,
                "id_usuario": e.id_usuario,
                "nome_usuario": nomes_por_usuario.get(e.id_usuario),
                "tabela_afetada": e.tabela_afetada,
                "id_registro_afetado": e.id_registro_afetado,
                "acao": e.acao,
                "dados_antes": e.dados_antes,
                "dados_depois": e.dados_depois,
                "ip_origem": e.ip_origem,
                "timestamp": e.timestamp,
            }
            for e in entradas
        ],
    }


@router.get("/api/auditoria/acoes", summary="Lista de ações distintas já registradas (para o filtro)")
def listar_acoes_auditoria(db: Session = Depends(get_db), _=Depends(_permissao_auditoria)):
    linhas = db.query(AuditLog.acao).distinct().order_by(AuditLog.acao).all()
    return [l.acao for l in linhas]


# ==========================================
# CAMPOS PERSONALIZADOS (v0.3.3) — sem deploy, renderizado automaticamente pelo FormShell.
# Nunca entra em regra de negócio automatizada (ver docstring de DefinicaoCampo).
# ==========================================
_permissao_gerenciar_campos = exigir_permissao("gerenciar_acesso")


def _campo_visivel_para(definicao: DefinicaoCampo, usuario: Usuario) -> bool:
    if not definicao.niveis_visiveis:
        return True
    return nivel_efetivo_id(usuario) in definicao.niveis_visiveis


def _validar_valor(definicao: DefinicaoCampo, valor: Optional[str], db: Session) -> None:
    if valor is None or valor == "":
        if definicao.obrigatorio:
            raise HTTPException(status_code=422, detail=f"Campo '{definicao.rotulo}' é obrigatório.")
        return
    if definicao.tipo == "numero":
        try:
            float(valor)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Campo '{definicao.rotulo}' precisa ser um número.")
    elif definicao.tipo == "data":
        try:
            datetime.strptime(valor, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Campo '{definicao.rotulo}' precisa ser uma data (AAAA-MM-DD).")
    elif definicao.tipo == "booleano":
        if valor not in ("true", "false"):
            raise HTTPException(status_code=422, detail=f"Campo '{definicao.rotulo}' precisa ser verdadeiro ou falso.")
    elif definicao.tipo == "selecao":
        existe = db.query(OpcaoCatalogo).filter(
            OpcaoCatalogo.id_catalogo == definicao.id_catalogo,
            OpcaoCatalogo.codigo == valor,
            OpcaoCatalogo.ativo == True,
        ).first()
        if not existe:
            raise HTTPException(status_code=422, detail=f"Valor inválido para o campo '{definicao.rotulo}'.")


@router.get("/api/campos-personalizados/{entidade}", summary="Listar definições de campo de uma entidade")
def listar_definicoes_campo(
    entidade: str, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)
):
    definicoes = (
        db.query(DefinicaoCampo)
        .filter(DefinicaoCampo.entidade == entidade, DefinicaoCampo.ativo == True)
        .order_by(DefinicaoCampo.ordem, DefinicaoCampo.id_definicao)
        .all()
    )
    # Mapa id_catalogo -> chave: o front usa GET /api/catalogos/{chave}/opcoes pra buscar as
    # opções de um campo tipo "seleção" - devolver a chave junto evita um round-trip extra
    # (listar todos os catálogos só pra achar o nome de um).
    ids_catalogo = {d.id_catalogo for d in definicoes if d.id_catalogo}
    chave_por_id = {}
    if ids_catalogo:
        for c in db.query(Catalogo).filter(Catalogo.id_catalogo.in_(ids_catalogo)).all():
            chave_por_id[c.id_catalogo] = c.chave
    return [
        {
            "id_definicao": d.id_definicao, "entidade": d.entidade, "rotulo": d.rotulo, "tipo": d.tipo,
            "id_catalogo": d.id_catalogo, "catalogo_chave": chave_por_id.get(d.id_catalogo),
            "obrigatorio": d.obrigatorio, "ordem": d.ordem,
        }
        for d in definicoes
        if _campo_visivel_para(d, usuario)
    ]


@router.post("/api/campos-personalizados/", summary="Criar definição de campo personalizado")
def criar_definicao_campo(
    dados: DefinicaoCampoCriar, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_gerenciar_campos)
):
    if dados.tipo == "selecao" and not dados.id_catalogo:
        raise HTTPException(status_code=422, detail="Campo do tipo 'seleção' precisa de um catálogo.")
    nova = DefinicaoCampo(**dados.model_dump())
    db.add(nova)
    db.commit()
    db.refresh(nova)
    registrar_auditoria(
        db, usuario, "definicoes_campo", "CREATE", id_registro_afetado=nova.id_definicao,
        dados_depois=dados.model_dump(), ip_origem=request.client.host if request.client else None,
    )
    return {"id_definicao": nova.id_definicao}


@router.put("/api/campos-personalizados/{id_definicao}", summary="Editar definição de campo (nunca tipo/entidade)")
def atualizar_definicao_campo(
    id_definicao: int, dados: DefinicaoCampoAtualizar, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_gerenciar_campos)
):
    definicao = db.query(DefinicaoCampo).filter(DefinicaoCampo.id_definicao == id_definicao).first()
    if not definicao:
        raise HTTPException(status_code=404, detail="Definição de campo não encontrada.")
    antes = {"rotulo": definicao.rotulo, "obrigatorio": definicao.obrigatorio, "ordem": definicao.ordem, "ativo": definicao.ativo}
    dados_alterados = dados.model_dump(exclude_unset=True)
    for campo, valor in dados_alterados.items():
        setattr(definicao, campo, valor)
    db.commit()
    registrar_auditoria(
        db, usuario, "definicoes_campo", "UPDATE", id_registro_afetado=id_definicao,
        dados_antes=antes, dados_depois=dados_alterados, ip_origem=request.client.host if request.client else None,
    )
    return {"mensagem": "Definição atualizada."}


@router.delete("/api/campos-personalizados/{id_definicao}", summary="Excluir definição (só se já inativa e sem valor gravado)")
def excluir_definicao_campo(
    id_definicao: int, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_gerenciar_campos)
):
    definicao = db.query(DefinicaoCampo).filter(DefinicaoCampo.id_definicao == id_definicao).first()
    if not definicao:
        raise HTTPException(status_code=404, detail="Definição de campo não encontrada.")
    if definicao.ativo:
        raise HTTPException(status_code=400, detail="Desative o campo antes de excluir.")
    if db.query(ValorCampo).filter(ValorCampo.id_definicao == id_definicao).first():
        raise HTTPException(status_code=409, detail="Campo tem valor gravado em algum registro — não pode ser excluído.")
    dados_antes = {"entidade": definicao.entidade, "rotulo": definicao.rotulo, "tipo": definicao.tipo}
    db.delete(definicao)
    db.commit()
    registrar_auditoria(
        db, usuario, "definicoes_campo", "DELETE", id_registro_afetado=id_definicao,
        dados_antes=dados_antes, ip_origem=request.client.host if request.client else None,
    )
    return {"mensagem": "Definição excluída."}


@router.get(
    "/api/campos-personalizados/{entidade}/{id_registro}/valores",
    summary="Ler os valores de campo personalizado de um registro",
)
def obter_valores_campo(
    entidade: str, id_registro: int, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)
):
    definicoes = (
        db.query(DefinicaoCampo)
        .filter(DefinicaoCampo.entidade == entidade, DefinicaoCampo.ativo == True)
        .all()
    )
    ids_visiveis = {d.id_definicao for d in definicoes if _campo_visivel_para(d, usuario)}
    valores = (
        db.query(ValorCampo)
        .filter(ValorCampo.id_registro == id_registro, ValorCampo.id_definicao.in_(ids_visiveis))
        .all()
        if ids_visiveis
        else []
    )
    return {v.id_definicao: v.valor for v in valores}


@router.put(
    "/api/campos-personalizados/{entidade}/{id_registro}/valores",
    summary="Gravar os valores de campo personalizado de um registro (upsert em lote)",
)
def definir_valores_campo(
    entidade: str, id_registro: int, dados: ValoresCampoDefinir, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)
):
    definicoes = {
        d.id_definicao: d
        for d in db.query(DefinicaoCampo).filter(DefinicaoCampo.entidade == entidade, DefinicaoCampo.ativo == True).all()
    }
    for item in dados.valores:
        definicao = definicoes.get(item.id_definicao)
        if not definicao:
            raise HTTPException(status_code=404, detail=f"Definição de campo {item.id_definicao} não encontrada em '{entidade}'.")
        _validar_valor(definicao, item.valor, db)

    for item in dados.valores:
        existente = db.query(ValorCampo).filter(
            ValorCampo.id_definicao == item.id_definicao, ValorCampo.id_registro == id_registro
        ).first()
        if existente:
            existente.valor = item.valor
        else:
            db.add(ValorCampo(id_definicao=item.id_definicao, id_registro=id_registro, valor=item.valor))
    db.commit()
    registrar_auditoria(
        db, usuario, "valores_campo", "UPDATE", id_registro_afetado=id_registro,
        dados_depois={"entidade": entidade, "valores": {v.id_definicao: v.valor for v in dados.valores}},
        ip_origem=request.client.host if request.client else None,
    )
    return {"mensagem": "Valores gravados."}


# ==========================================
# CONFIGURAÇÃO INSTITUCIONAL (v0.3.4) — chave/valor tipado. Chaves são fixas (semeadas em
# seed_configuracoes_institucionais); esta API só lê e atualiza valor, nunca cria/exclui chave.
# ==========================================
_permissao_gerenciar_configuracoes = exigir_permissao("gerenciar_acesso")


def _validar_valor_configuracao(config: ConfiguracaoInstitucional, valor: Optional[str]) -> None:
    if valor is None or valor == "":
        return
    if config.tipo == "numero":
        try:
            float(valor)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"'{config.chave_configuracao}' precisa ser um número.")
    elif config.tipo == "booleano":
        if valor not in ("true", "false"):
            raise HTTPException(status_code=422, detail=f"'{config.chave_configuracao}' precisa ser verdadeiro ou falso.")
    elif config.tipo == "email":
        if "@" not in valor or "." not in valor.split("@")[-1]:
            raise HTTPException(status_code=422, detail=f"'{config.chave_configuracao}' precisa ser um e-mail válido.")
    elif config.tipo == "cor":
        if not re.fullmatch(r"#[0-9A-Fa-f]{6}", valor):
            raise HTTPException(status_code=422, detail=f"'{config.chave_configuracao}' precisa ser uma cor hexadecimal (#RRGGBB).")
    elif config.tipo == "data":
        try:
            datetime.strptime(valor, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=422, detail=f"'{config.chave_configuracao}' precisa ser uma data (AAAA-MM-DD).")


@router.get("/api/configuracoes/", summary="Listar configurações institucionais")
def listar_configuracoes(db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    configs = db.query(ConfiguracaoInstitucional).order_by(
        ConfiguracaoInstitucional.categoria, ConfiguracaoInstitucional.chave_configuracao
    ).all()
    return [
        {
            "chave": c.chave_configuracao, "valor": c.valor_configuracao, "tipo": c.tipo,
            "categoria": c.categoria, "descricao": c.descricao, "atualizado_em": c.atualizado_em,
        }
        for c in configs
    ]


# v0.3.5 - importação/exportação de catálogos e configurações. Registradas ANTES das rotas
# `/api/configuracoes/{chave}` de propósito: "exportar"/"importar" são segmentos literais que
# `{chave}` casaria primeiro se viessem depois (FastAPI resolve rota por ordem de registro).
@router.get("/api/configuracoes/exportar", summary="Exportar todos os catálogos e configurações em JSON")
def exportar_configuracao(db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_gerenciar_configuracoes)):
    catalogos = db.query(Catalogo).order_by(Catalogo.chave).all()
    opcoes_por_catalogo: dict[int, list] = {}
    for o in db.query(OpcaoCatalogo).order_by(OpcaoCatalogo.id_catalogo, OpcaoCatalogo.ordem).all():
        opcoes_por_catalogo.setdefault(o.id_catalogo, []).append(
            {"codigo": o.codigo, "rotulo": o.rotulo, "ordem": o.ordem, "ativo": o.ativo}
        )
    configs = db.query(ConfiguracaoInstitucional).order_by(ConfiguracaoInstitucional.chave_configuracao).all()

    return {
        "catalogos": [
            {
                "chave": c.chave, "nome_exibido": c.nome_exibido, "descricao": c.descricao,
                "editavel_pelo_usuario": c.editavel_pelo_usuario,
                "opcoes": opcoes_por_catalogo.get(c.id_catalogo, []),
            }
            for c in catalogos
        ],
        "configuracoes": [
            {
                "chave": cfg.chave_configuracao, "valor": cfg.valor_configuracao, "tipo": cfg.tipo,
                "categoria": cfg.categoria, "descricao": cfg.descricao,
            }
            for cfg in configs
        ],
    }


@router.post("/api/configuracoes/importar", summary="Importar catálogos e configurações de um JSON exportado")
def importar_configuracao(
    dados: ImportarConfiguracaoRequest, request: Request,
    db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_gerenciar_configuracoes),
):
    # Upsert por chave/código estável - nunca apaga o que já existe e não está no arquivo (mesmo
    # raciocínio dos seeds: importar de homologação não pode destruir ajuste feito só em
    # produção). Configuração institucional nunca cria chave nova (só as 13 canônicas da v0.3.4)
    # - chave desconhecida no arquivo é ignorada e contada à parte, nunca vira erro que trava o
    # resto da importação.
    catalogos_criados = catalogos_atualizados = 0
    opcoes_criadas = opcoes_atualizadas = 0
    configs_atualizadas = 0
    configs_ignoradas: list[str] = []

    for c_in in dados.catalogos:
        catalogo = db.query(Catalogo).filter(Catalogo.chave == c_in.chave).first()
        if catalogo is None:
            catalogo = Catalogo(
                chave=c_in.chave, nome_exibido=c_in.nome_exibido, descricao=c_in.descricao,
                editavel_pelo_usuario=c_in.editavel_pelo_usuario,
            )
            db.add(catalogo)
            db.flush()
            catalogos_criados += 1
        else:
            catalogo.nome_exibido = c_in.nome_exibido
            catalogo.descricao = c_in.descricao
            catalogo.editavel_pelo_usuario = c_in.editavel_pelo_usuario
            catalogos_atualizados += 1

        for o_in in c_in.opcoes:
            opcao = db.query(OpcaoCatalogo).filter(
                OpcaoCatalogo.id_catalogo == catalogo.id_catalogo, OpcaoCatalogo.codigo == o_in.codigo
            ).first()
            if opcao is None:
                db.add(OpcaoCatalogo(
                    id_catalogo=catalogo.id_catalogo, codigo=o_in.codigo, rotulo=o_in.rotulo,
                    ordem=o_in.ordem, ativo=o_in.ativo,
                ))
                opcoes_criadas += 1
            else:
                opcao.rotulo = o_in.rotulo
                opcao.ordem = o_in.ordem
                opcao.ativo = o_in.ativo
                opcoes_atualizadas += 1

    for cfg_in in dados.configuracoes:
        config = db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao == cfg_in.chave).first()
        if config is None:
            configs_ignoradas.append(cfg_in.chave)
            continue
        _validar_valor_configuracao(config, cfg_in.valor)
        config.valor_configuracao = cfg_in.valor
        config.atualizado_em = datetime.utcnow()
        config.id_usuario_atualizacao = usuario.id_usuario
        configs_atualizadas += 1
        invalidar_cache_configuracao(cfg_in.chave)

    db.commit()

    resumo = {
        "catalogos_criados": catalogos_criados, "catalogos_atualizados": catalogos_atualizados,
        "opcoes_criadas": opcoes_criadas, "opcoes_atualizadas": opcoes_atualizadas,
        "configuracoes_atualizadas": configs_atualizadas, "configuracoes_ignoradas": configs_ignoradas,
    }
    registrar_auditoria(
        db, usuario, "catalogos_e_configuracoes", "IMPORT", dados_depois=resumo,
        ip_origem=request.client.host if request.client else None,
    )
    return resumo


@router.get("/api/configuracoes/{chave}", summary="Ler uma configuração institucional")
def obter_configuracao_por_chave(chave: str, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    config = db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao == chave).first()
    if not config:
        raise HTTPException(status_code=404, detail="Configuração não encontrada.")
    return {
        "chave": config.chave_configuracao, "valor": config.valor_configuracao, "tipo": config.tipo,
        "categoria": config.categoria, "descricao": config.descricao, "atualizado_em": config.atualizado_em,
    }


@router.put("/api/configuracoes/{chave}", summary="Atualizar o valor de uma configuração institucional")
def atualizar_configuracao(
    chave: str, dados: ConfiguracaoAtualizar, request: Request,
    db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_gerenciar_configuracoes),
):
    config = db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao == chave).first()
    if not config:
        raise HTTPException(status_code=404, detail="Configuração não encontrada.")
    _validar_valor_configuracao(config, dados.valor)

    valor_antes = config.valor_configuracao
    config.valor_configuracao = dados.valor
    config.atualizado_em = datetime.utcnow()
    config.id_usuario_atualizacao = usuario.id_usuario
    db.commit()
    invalidar_cache_configuracao(chave)

    registrar_auditoria(
        db, usuario, "configuracoes_institucionais", "UPDATE", id_registro_afetado=config.id_config,
        dados_antes={"valor": valor_antes}, dados_depois={"valor": dados.valor},
        ip_origem=request.client.host if request.client else None,
    )
    return {"chave": config.chave_configuracao, "valor": config.valor_configuracao}


# ==========================================
# ÁRVORE FAMILIAR (DEPENDENTES)
# ==========================================
