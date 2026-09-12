from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.database import get_db
from app.models.associados import Associado
from app.models.core import ConfiguracaoInstitucional, OpcaoLista, NivelAcesso, PermissaoSistema, perfil_permissao, AuditLog, Usuario
from app.schemas.core import OpcaoCriar, OpcaoAtualizar, NivelAcessoCriar, NivelAcessoAtualizar, PermissaoCriar
from app.security import exigir_permissao

router = APIRouter()

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


@router.get("/api/opcoes/{tipo_lista}", summary="Listar valores de uma lista configurável")
def listar_opcoes(tipo_lista: str, incluir_inativos: bool = False, db: Session = Depends(get_db)):
    consulta = db.query(OpcaoLista).filter(OpcaoLista.tipo_lista == tipo_lista)
    if not incluir_inativos:
        consulta = consulta.filter(OpcaoLista.ativo == True)
    opcoes = consulta.order_by(OpcaoLista.ordem, OpcaoLista.id_opcao).all()
    return [{"id_opcao": o.id_opcao, "valor": o.valor, "ativo": o.ativo} for o in opcoes]


@router.post("/api/opcoes/{tipo_lista}", summary="Adicionar valor a uma lista configurável")
def criar_opcao(tipo_lista: str, dados: OpcaoCriar, db: Session = Depends(get_db)):
    if db.query(OpcaoLista).filter(OpcaoLista.tipo_lista == tipo_lista, OpcaoLista.valor == dados.valor).first():
        raise HTTPException(status_code=400, detail="Esse valor já existe nessa lista.")
    maior_ordem = db.query(OpcaoLista).filter(OpcaoLista.tipo_lista == tipo_lista).count()
    nova = OpcaoLista(tipo_lista=tipo_lista, valor=dados.valor, ordem=maior_ordem, ativo=True)
    db.add(nova)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Esse valor já existe nessa lista.")
    db.refresh(nova)
    return {"id_opcao": nova.id_opcao, "valor": nova.valor, "ativo": nova.ativo}


@router.put("/api/opcoes/{id_opcao}", summary="Renomear/ativar/desativar valor de lista")
def atualizar_opcao(id_opcao: int, dados: OpcaoAtualizar, db: Session = Depends(get_db)):
    opcao = db.query(OpcaoLista).filter(OpcaoLista.id_opcao == id_opcao).first()
    if not opcao:
        raise HTTPException(status_code=404, detail="Opção não encontrada.")
    if dados.valor is not None:
        opcao.valor = dados.valor
    if dados.ativo is not None:
        opcao.ativo = dados.ativo
    db.commit()
    return {"mensagem": "Opção atualizada."}

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
def criar_nivel_acesso(dados: NivelAcessoCriar, db: Session = Depends(get_db), _=Depends(_permissao_gerenciar_acesso)):
    if db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == dados.nome_nivel).first():
        raise HTTPException(status_code=400, detail="Já existe um nível de acesso com esse nome.")
    novo = NivelAcesso(**dados.model_dump())
    db.add(novo)
    db.commit()
    db.refresh(novo)
    return {"id_nivel": novo.id_nivel, "nome_nivel": novo.nome_nivel}


@router.put("/api/niveis-acesso/{id_nivel}", summary="Editar nível de acesso")
def atualizar_nivel_acesso(id_nivel: int, dados: NivelAcessoAtualizar, db: Session = Depends(get_db), _=Depends(_permissao_gerenciar_acesso)):
    nivel = db.query(NivelAcesso).filter(NivelAcesso.id_nivel == id_nivel).first()
    if not nivel:
        raise HTTPException(status_code=404, detail="Nível de acesso não encontrado.")
    for campo, valor in dados.model_dump(exclude_unset=True).items():
        setattr(nivel, campo, valor)
    db.commit()
    return {"mensagem": "Nível de acesso atualizado."}


@router.get("/api/permissoes/", summary="Listar permissões do sistema")
def listar_permissoes(db: Session = Depends(get_db), _=Depends(_permissao_gerenciar_acesso)):
    permissoes = db.query(PermissaoSistema).order_by(PermissaoSistema.modulo, PermissaoSistema.codigo_permissao).all()
    return [
        {"id_permissao": p.id_permissao, "modulo": p.modulo, "codigo_permissao": p.codigo_permissao, "descricao": p.descricao}
        for p in permissoes
    ]


@router.post("/api/permissoes/", summary="Criar permissão do sistema")
def criar_permissao(dados: PermissaoCriar, db: Session = Depends(get_db), _=Depends(_permissao_gerenciar_acesso)):
    if db.query(PermissaoSistema).filter(PermissaoSistema.codigo_permissao == dados.codigo_permissao).first():
        raise HTTPException(status_code=400, detail="Já existe uma permissão com esse código.")
    nova = PermissaoSistema(**dados.model_dump())
    db.add(nova)
    db.commit()
    db.refresh(nova)
    return {"id_permissao": nova.id_permissao, "codigo_permissao": nova.codigo_permissao}


@router.post("/api/niveis-acesso/{id_nivel}/permissoes/{id_permissao}", summary="Atribuir permissão a um nível")
def atribuir_permissao(id_nivel: int, id_permissao: int, db: Session = Depends(get_db), _=Depends(_permissao_gerenciar_acesso)):
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
    return {"mensagem": "Permissão atribuída."}


@router.delete("/api/niveis-acesso/{id_nivel}/permissoes/{id_permissao}", summary="Remover permissão de um nível")
def remover_permissao(id_nivel: int, id_permissao: int, db: Session = Depends(get_db), _=Depends(_permissao_gerenciar_acesso)):
    db.execute(
        perfil_permissao.delete().where(
            perfil_permissao.c.id_nivel == id_nivel, perfil_permissao.c.id_permissao == id_permissao
        )
    )
    db.commit()
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
        for id_u, nome in (
            db.query(Associado.id_usuario, Associado.nome_completo)
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
# ÁRVORE FAMILIAR (DEPENDENTES)
# ==========================================
