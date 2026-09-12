import re
import unicodedata
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.database import get_db
from app.models.associados import Associado
from app.models.core import ConfiguracaoInstitucional, OpcaoLista, Catalogo, OpcaoCatalogo, NivelAcesso, PermissaoSistema, perfil_permissao, AuditLog, Usuario
from app.schemas.core import (
    OpcaoCriar,
    OpcaoAtualizar,
    NivelAcessoCriar,
    NivelAcessoAtualizar,
    PermissaoCriar,
    CatalogoCriar,
    OpcaoCatalogoCriar,
    OpcaoCatalogoAtualizar,
)
from app.security import exigir_permissao

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
# /api/opcoes/* — v0.1/v0.2, mantida por COMPATIBILIDADE com o protótipo antigo
# (app/routers/associados.py: /admin/secretaria, /meu-portal, /meu-perfil, /minha-familia ainda
# chamam esta rota). Migrado para ler/escrever em Catalogo/OpcaoCatalogo (v0.3.1) por baixo -
# nenhum dado novo entra mais em `opcoes_lista`, que fica só como histórico da migração.
# Uso novo deve chamar /api/catalogos/ diretamente, não esta rota.
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
def criar_opcao(tipo_lista: str, dados: OpcaoCriar, db: Session = Depends(get_db)):
    catalogo = _obter_ou_criar_catalogo(db, tipo_lista)
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
def atualizar_opcao(id_opcao: int, dados: OpcaoAtualizar, db: Session = Depends(get_db)):
    opcao = db.query(OpcaoCatalogo).filter(OpcaoCatalogo.id_opcao == id_opcao).first()
    if not opcao:
        raise HTTPException(status_code=404, detail="Opção não encontrada.")
    if dados.valor is not None:
        opcao.rotulo = dados.valor
    if dados.ativo is not None:
        opcao.ativo = dados.ativo
    db.commit()
    return {"mensagem": "Opção atualizada."}


# ==========================================
# CATÁLOGO GENÉRICO (v0.3.1) — motor de verdade, usado por código novo daqui pra frente.
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


@router.get("/api/catalogos/", summary="Listar catálogos configuráveis")
def listar_catalogos(db: Session = Depends(get_db), _=Depends(_permissao_gerenciar_catalogos)):
    catalogos = db.query(Catalogo).order_by(Catalogo.nome_exibido).all()
    return [
        {
            "id_catalogo": c.id_catalogo, "chave": c.chave, "nome_exibido": c.nome_exibido,
            "descricao": c.descricao, "editavel_pelo_usuario": c.editavel_pelo_usuario,
        }
        for c in catalogos
    ]


@router.post("/api/catalogos/", summary="Criar um catálogo novo")
def criar_catalogo(dados: CatalogoCriar, db: Session = Depends(get_db), _=Depends(_permissao_gerenciar_catalogos)):
    if db.query(Catalogo).filter(Catalogo.chave == dados.chave).first():
        raise HTTPException(status_code=400, detail="Já existe um catálogo com essa chave.")
    novo = Catalogo(**dados.model_dump())
    db.add(novo)
    db.commit()
    db.refresh(novo)
    return {"id_catalogo": novo.id_catalogo, "chave": novo.chave}


@router.get("/api/catalogos/{chave}/opcoes", summary="Listar opções de um catálogo")
def listar_opcoes_catalogo(
    chave: str, incluir_inativos: bool = False, db: Session = Depends(get_db), _=Depends(_permissao_gerenciar_catalogos)
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
    chave: str, dados: OpcaoCatalogoCriar, db: Session = Depends(get_db), _=Depends(_permissao_gerenciar_catalogos)
):
    catalogo = db.query(Catalogo).filter(Catalogo.chave == chave).first()
    if not catalogo:
        raise HTTPException(status_code=404, detail="Catálogo não encontrado.")
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
    return {"id_opcao": nova.id_opcao, "codigo": nova.codigo}


@router.put("/api/opcoes-catalogo/{id_opcao}", summary="Editar rótulo/ordem/ativo de uma opção (nunca o código)")
def atualizar_opcao_catalogo(
    id_opcao: int, dados: OpcaoCatalogoAtualizar, db: Session = Depends(get_db), _=Depends(_permissao_gerenciar_catalogos)
):
    opcao = db.query(OpcaoCatalogo).filter(OpcaoCatalogo.id_opcao == id_opcao).first()
    if not opcao:
        raise HTTPException(status_code=404, detail="Opção não encontrada.")
    for campo, valor in dados.model_dump(exclude_unset=True).items():
        setattr(opcao, campo, valor)
    db.commit()
    return {"mensagem": "Opção atualizada."}


@router.delete("/api/opcoes-catalogo/{id_opcao}", summary="Excluir opção (só se já inativa e sem uso)")
def excluir_opcao_catalogo(id_opcao: int, db: Session = Depends(get_db), _=Depends(_permissao_gerenciar_catalogos)):
    opcao = db.query(OpcaoCatalogo).filter(OpcaoCatalogo.id_opcao == id_opcao).first()
    if not opcao:
        raise HTTPException(status_code=404, detail="Opção não encontrada.")
    if opcao.ativo:
        raise HTTPException(status_code=400, detail="Desative a opção antes de excluir (nunca exclui opção ativa).")
    catalogo = db.query(Catalogo).filter(Catalogo.id_catalogo == opcao.id_catalogo).first()
    if catalogo and _opcao_em_uso(db, catalogo.chave, opcao.rotulo):
        raise HTTPException(status_code=409, detail="Opção em uso por registros existentes — não pode ser excluída.")
    db.delete(opcao)
    db.commit()
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
