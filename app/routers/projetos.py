"""v4.1 (FASE 4) - Projeto como entidade única e configurável, com cronograma, equipe e
encerramento formal. Corrige o achado registrado pela v2.9: `criar_projeto`/`alocar_voluntario`
eram protótipo v0.1/v0.2 sem `exigir_permissao`/`registrar_auditoria` - agora seguem o mesmo
padrão do resto do sistema."""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.schemas.projetos import (
    EquipeProjetoCriar,
    ItemCronogramaCriar,
    ProjetoAlterarStatus,
    ProjetoCriar,
    VoluntarioAlocar,
)
from app.security import exigir_permissao
from app.services import orcamento as servico_orcamento
from app.services import projetos

router = APIRouter()
_permissao_projetos = exigir_permissao("projetos")


def _ip_origem(request: Request) -> str:
    return request.client.host if request.client else None


def _serializar_projeto(p) -> dict:
    return {
        "id_projeto": p.id_projeto, "nome_projeto": p.nome_projeto, "descricao": p.descricao,
        "tipo_projeto": p.tipo_projeto, "tipo_foco": p.tipo_foco, "status": p.status,
        "id_associado_responsavel": p.id_associado_responsavel, "publico_alvo": p.publico_alvo,
        "data_inicio": p.data_inicio, "data_fim_prevista": p.data_fim_prevista,
        "id_centro_custo": p.id_centro_custo, "visibilidade": p.visibilidade,
        "necessita_alvara_bombeiros": p.necessita_alvara_bombeiros, "status_liberacao": p.status_liberacao,
    }


@router.post("/projetos/", summary="Criar Projeto")
def criar_projeto(dados: ProjetoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    projeto = projetos.criar_projeto(
        db, nome_projeto=dados.nome_projeto, tipo_foco=dados.tipo_foco, necessita_alvara_bombeiros=dados.necessita_alvara_bombeiros,
        data_inicio=dados.data_inicio, data_fim_prevista=dados.data_fim_prevista, descricao=dados.descricao,
        tipo_projeto=dados.tipo_projeto, id_associado_responsavel=dados.id_associado_responsavel,
        publico_alvo=dados.publico_alvo, id_centro_custo=dados.id_centro_custo, visibilidade=dados.visibilidade,
        id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "projetos_eventos", "CREATE", id_registro_afetado=projeto.id_projeto,
        dados_depois={"nome_projeto": projeto.nome_projeto, "tipo_projeto": projeto.tipo_projeto},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Projeto criado.", "id_projeto": projeto.id_projeto}


@router.get("/api/projetos/", summary="Listar Projetos")
def listar_projetos_endpoint(db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [_serializar_projeto(p) for p in projetos.listar_projetos(db)]


@router.get("/api/projetos/{id_projeto}", summary="Detalhe de um Projeto")
def obter_projeto_endpoint(id_projeto: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return _serializar_projeto(projetos.obter_projeto(db, id_projeto))


@router.put("/api/projetos/{id_projeto}/status", summary="Alterar status do Projeto")
def alterar_status_endpoint(id_projeto: int, dados: ProjetoAlterarStatus, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    projeto = projetos.alterar_status_projeto(db, id_projeto=id_projeto, novo_status=dados.status)
    registrar_auditoria(
        db, usuario, "projetos_eventos", "UPDATE", id_registro_afetado=projeto.id_projeto,
        dados_depois={"status": projeto.status}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Status atualizado.", "status": projeto.status}


@router.post("/projetos/alocar/", summary="Alocar Voluntário")
def alocar_voluntario(dados: VoluntarioAlocar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    alocacao = projetos.alocar_voluntario(db, id_projeto=dados.id_projeto, id_associado=dados.id_associado, funcao_desempenhada=dados.funcao_desempenhada)
    registrar_auditoria(
        db, usuario, "alocacoes_voluntarios", "CREATE", id_registro_afetado=alocacao.id_alocacao,
        dados_depois={"id_projeto": alocacao.id_projeto, "id_associado": alocacao.id_associado, "funcao_desempenhada": alocacao.funcao_desempenhada},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Voluntário escalado com sucesso!"}


# ==========================================
# CRONOGRAMA (marcos e tarefas - status sempre derivado)
# ==========================================
@router.post("/api/projetos/{id_projeto}/cronograma", summary="Cadastrar item de cronograma (marco ou tarefa)")
def criar_item_cronograma_endpoint(id_projeto: int, dados: ItemCronogramaCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    item = projetos.criar_item_cronograma(
        db, id_projeto=id_projeto, tipo=dados.tipo, titulo=dados.titulo, prazo=dados.prazo,
        id_associado_responsavel=dados.id_associado_responsavel, id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "itens_cronograma_projeto", "CREATE", id_registro_afetado=item.id_item,
        dados_depois={"id_projeto": item.id_projeto, "tipo": item.tipo, "titulo": item.titulo},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Item de cronograma cadastrado.", "id_item": item.id_item}


@router.post("/api/cronograma/{id_item}/concluir", summary="Marcar item de cronograma como concluído")
def concluir_item_cronograma_endpoint(id_item: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    item = projetos.concluir_item_cronograma(db, id_item=id_item)
    registrar_auditoria(db, usuario, "itens_cronograma_projeto", "CONCLUSAO", id_registro_afetado=item.id_item, ip_origem=_ip_origem(request))
    return {"mensagem": "Item marcado como concluído."}


@router.get("/api/projetos/{id_projeto}/cronograma", summary="Listar cronograma do projeto")
def listar_cronograma_endpoint(id_projeto: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return projetos.listar_cronograma(db, id_projeto=id_projeto)


# ==========================================
# EQUIPE DO PROJETO
# ==========================================
@router.post("/api/projetos/{id_projeto}/equipe", summary="Adicionar membro à equipe do projeto")
def adicionar_membro_equipe_endpoint(id_projeto: int, dados: EquipeProjetoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    membro = projetos.adicionar_membro_equipe(db, id_projeto=id_projeto, id_associado=dados.id_associado, papel=dados.papel)
    registrar_auditoria(
        db, usuario, "equipe_projeto", "CREATE", id_registro_afetado=membro.id_membro,
        dados_depois={"id_projeto": membro.id_projeto, "id_associado": membro.id_associado, "papel": membro.papel},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Membro adicionado à equipe.", "id_membro": membro.id_membro}


@router.post("/api/equipe-projeto/{id_membro}/encerrar", summary="Encerrar participação de um membro na equipe")
def encerrar_participacao_endpoint(id_membro: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    membro = projetos.encerrar_participacao_equipe(db, id_membro=id_membro)
    registrar_auditoria(db, usuario, "equipe_projeto", "ENCERRAMENTO", id_registro_afetado=membro.id_membro, ip_origem=_ip_origem(request))
    return {"mensagem": "Participação encerrada."}


@router.get("/api/projetos/{id_projeto}/equipe", summary="Listar equipe do projeto")
def listar_equipe_endpoint(id_projeto: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [
        {"id_membro": m.id_membro, "id_associado": m.id_associado, "papel": m.papel, "data_inicio": m.data_inicio, "data_fim": m.data_fim}
        for m in projetos.listar_equipe(db, id_projeto=id_projeto)
    ]


# ==========================================
# ORÇAMENTO DO PROJETO (reaproveita Orcamento/realizado_do_orcamento, v3.5)
# ==========================================
@router.get("/api/projetos/{id_projeto}/orcamento", summary="Orçamento do projeto (via centro de custo vinculado)")
def orcamento_do_projeto_endpoint(id_projeto: int, ano: int = None, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    projeto = projetos.obter_projeto(db, id_projeto)
    if projeto.id_centro_custo is None:
        return []
    todos = servico_orcamento.listar_orcamentos(db, ano=ano)
    return [o for o in todos if o["id_centro_custo"] == projeto.id_centro_custo]


# ==========================================
# ENCERRAMENTO FORMAL (relatório final versionado)
# ==========================================
@router.post("/api/projetos/{id_projeto}/relatorio-final", summary="Gerar Relatório Final do projeto (versionado)")
def gerar_relatorio_final_endpoint(id_projeto: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    relatorio = projetos.gerar_relatorio_final(db, id_projeto=id_projeto, id_usuario=usuario.id_usuario)
    registrar_auditoria(
        db, usuario, "relatorios_finais_projeto", "CREATE", id_registro_afetado=relatorio.id_relatorio,
        dados_depois={"id_projeto": relatorio.id_projeto, "versao": relatorio.versao}, ip_origem=_ip_origem(request),
    )
    return {"id_relatorio": relatorio.id_relatorio, "versao": relatorio.versao, "conteudo": relatorio.conteudo}


@router.get("/api/projetos/{id_projeto}/relatorio-final", summary="Listar versões do Relatório Final do projeto")
def listar_relatorios_finais_endpoint(id_projeto: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [
        {"id_relatorio": r.id_relatorio, "versao": r.versao, "conteudo": r.conteudo, "gerado_em": r.gerado_em}
        for r in projetos.listar_relatorios_finais(db, id_projeto=id_projeto)
    ]
