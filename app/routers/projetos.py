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
    TrocaTurnoCriar,
    VagaEscalaCriar,
    VoluntarioAlocar,
)
from app.schemas.voluntariado import HorasVoluntariadoCriar
from app.security import exigir_permissao, get_current_user
from app.services import orcamento as servico_orcamento
from app.services import projetos
from app.services import voluntariado as servico_voluntariado

router = APIRouter()
_permissao_projetos = exigir_permissao("projetos")


def _serializar_alocacao(a) -> dict:
    return {
        "id_alocacao": a.id_alocacao, "id_projeto": a.id_projeto, "id_associado": a.id_associado,
        "funcao_desempenhada": a.funcao_desempenhada, "id_vaga": a.id_vaga,
        "turno_data_hora_inicio": a.turno_data_hora_inicio, "turno_data_hora_fim": a.turno_data_hora_fim,
        "habilidades_exigidas": a.habilidades_exigidas, "horas_previstas": a.horas_previstas,
        "horas_realizadas": a.horas_realizadas, "status": a.status,
    }


def _serializar_vaga(v) -> dict:
    return {
        "id_vaga": v.id_vaga, "id_projeto": v.id_projeto, "funcao_desempenhada": v.funcao_desempenhada,
        "habilidades_exigidas": v.habilidades_exigidas, "turno_data_hora_inicio": v.turno_data_hora_inicio,
        "turno_data_hora_fim": v.turno_data_hora_fim, "vagas_disponiveis": v.vagas_disponiveis,
        "horas_previstas": v.horas_previstas,
    }


def _serializar_troca(t) -> dict:
    return {
        "id_troca": t.id_troca, "id_alocacao": t.id_alocacao, "id_associado_substituto": t.id_associado_substituto,
        "status": t.status, "motivo": t.motivo, "criado_em": t.criado_em, "resolvido_em": t.resolvido_em,
    }


def _serializar_registro_horas(r) -> dict:
    return {
        "id_registro": r.id_registro, "id_termo": r.id_termo, "data": r.data, "horas": r.horas,
        "descricao_atividade": r.descricao_atividade, "id_projeto": r.id_projeto, "id_alocacao": r.id_alocacao,
        "status": r.status,
    }


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
    alocacao = projetos.alocar_voluntario(
        db, id_projeto=dados.id_projeto, id_associado=dados.id_associado, funcao_desempenhada=dados.funcao_desempenhada,
        turno_data_hora_inicio=dados.turno_data_hora_inicio, turno_data_hora_fim=dados.turno_data_hora_fim,
        habilidades_exigidas=dados.habilidades_exigidas, horas_previstas=dados.horas_previstas, id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "alocacoes_voluntarios", "CREATE", id_registro_afetado=alocacao.id_alocacao,
        dados_depois={"id_projeto": alocacao.id_projeto, "id_associado": alocacao.id_associado, "funcao_desempenhada": alocacao.funcao_desempenhada},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Voluntário escalado com sucesso!"}


# ==========================================
# ESCALA DE VOLUNTARIADO (v4.4) - vagas de turno, candidaturas, confirmação/recusa do
# coordenador, troca entre voluntários e aprovação de horas.
# ==========================================
@router.post("/api/projetos/{id_projeto}/vagas-escala", summary="Publicar vaga de turno na escala de voluntariado")
def criar_vaga_escala_endpoint(id_projeto: int, dados: VagaEscalaCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    vaga = projetos.criar_vaga_escala(
        db, id_projeto=id_projeto, funcao_desempenhada=dados.funcao_desempenhada, habilidades_exigidas=dados.habilidades_exigidas,
        turno_data_hora_inicio=dados.turno_data_hora_inicio, turno_data_hora_fim=dados.turno_data_hora_fim,
        vagas_disponiveis=dados.vagas_disponiveis, horas_previstas=dados.horas_previstas, id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "vagas_escala_voluntario", "CREATE", id_registro_afetado=vaga.id_vaga,
        dados_depois={"id_projeto": vaga.id_projeto, "funcao_desempenhada": vaga.funcao_desempenhada}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Vaga de escala publicada.", "id_vaga": vaga.id_vaga}


@router.get("/api/projetos/{id_projeto}/vagas-escala", summary="Listar vagas de escala do projeto")
def listar_vagas_escala_endpoint(id_projeto: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [_serializar_vaga(v) for v in projetos.listar_vagas_escala(db, id_projeto=id_projeto)]


@router.get("/api/projetos/{id_projeto}/candidaturas-pendentes", summary="Listar candidaturas de voluntário pendentes do projeto")
def listar_candidaturas_pendentes_endpoint(id_projeto: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [_serializar_alocacao(a) for a in projetos.listar_candidaturas_pendentes(db, id_projeto=id_projeto)]


@router.post("/api/alocacoes/{id_alocacao}/confirmar", summary="Coordenador confirma candidatura de voluntário")
def confirmar_alocacao_endpoint(id_alocacao: int, request: Request, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    alocacao = projetos.confirmar_alocacao(db, id_alocacao=id_alocacao, usuario=usuario)
    registrar_auditoria(db, usuario, "alocacoes_voluntarios", "CONFIRMACAO", id_registro_afetado=alocacao.id_alocacao, ip_origem=_ip_origem(request))
    return {"mensagem": "Candidatura confirmada.", "status": alocacao.status}


@router.post("/api/alocacoes/{id_alocacao}/recusar", summary="Coordenador recusa candidatura de voluntário")
def recusar_alocacao_endpoint(id_alocacao: int, request: Request, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    alocacao = projetos.recusar_alocacao(db, id_alocacao=id_alocacao, usuario=usuario)
    registrar_auditoria(db, usuario, "alocacoes_voluntarios", "RECUSA", id_registro_afetado=alocacao.id_alocacao, ip_origem=_ip_origem(request))
    return {"mensagem": "Candidatura recusada.", "status": alocacao.status}


@router.post("/api/alocacoes/{id_alocacao}/cancelar", summary="Cancela uma alocação (o próprio voluntário ou o coordenador do projeto)")
def cancelar_alocacao_endpoint(id_alocacao: int, request: Request, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    alocacao = projetos.cancelar_alocacao(db, id_alocacao=id_alocacao, usuario=usuario)
    registrar_auditoria(db, usuario, "alocacoes_voluntarios", "CANCELAMENTO", id_registro_afetado=alocacao.id_alocacao, ip_origem=_ip_origem(request))
    return {"mensagem": "Alocação cancelada.", "status": alocacao.status}


@router.post("/api/alocacoes/{id_alocacao}/trocas", summary="Solicitar troca de turno com outro voluntário")
def solicitar_troca_endpoint(id_alocacao: int, dados: TrocaTurnoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    troca = projetos.solicitar_troca_turno(
        db, id_alocacao=id_alocacao, id_associado_substituto=dados.id_associado_substituto, motivo=dados.motivo, usuario=usuario,
    )
    registrar_auditoria(db, usuario, "trocas_turno_voluntario", "CREATE", id_registro_afetado=troca.id_troca, ip_origem=_ip_origem(request))
    return {"mensagem": "Troca de turno solicitada.", "id_troca": troca.id_troca}


@router.get("/api/projetos/{id_projeto}/trocas-turno", summary="Listar trocas de turno do projeto")
def listar_trocas_endpoint(id_projeto: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [_serializar_troca(t) for t in projetos.listar_trocas_do_projeto(db, id_projeto=id_projeto)]


@router.post("/api/trocas-turno/{id_troca}/confirmar", summary="Coordenador confirma troca de turno")
def confirmar_troca_endpoint(id_troca: int, request: Request, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    troca = projetos.confirmar_troca_turno(db, id_troca=id_troca, usuario=usuario)
    registrar_auditoria(db, usuario, "trocas_turno_voluntario", "CONFIRMACAO", id_registro_afetado=troca.id_troca, ip_origem=_ip_origem(request))
    return {"mensagem": "Troca de turno confirmada.", "status": troca.status}


@router.post("/api/trocas-turno/{id_troca}/recusar", summary="Coordenador recusa troca de turno")
def recusar_troca_endpoint(id_troca: int, request: Request, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    troca = projetos.recusar_troca_turno(db, id_troca=id_troca, usuario=usuario)
    registrar_auditoria(db, usuario, "trocas_turno_voluntario", "RECUSA", id_registro_afetado=troca.id_troca, ip_origem=_ip_origem(request))
    return {"mensagem": "Troca de turno recusada.", "status": troca.status}


@router.get("/api/projetos/{id_projeto}/horas-pendentes", summary="Listar horas de voluntariado pendentes de aprovação do projeto")
def listar_horas_pendentes_endpoint(id_projeto: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [_serializar_registro_horas(r) for r in projetos.listar_horas_pendentes_do_projeto(db, id_projeto=id_projeto)]


@router.post("/api/horas-voluntariado/{id_registro}/aprovar", summary="Coordenador aprova horas de voluntariado")
def aprovar_horas_endpoint(id_registro: int, request: Request, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    registro = projetos.aprovar_horas_voluntariado(db, id_registro=id_registro, usuario=usuario)
    registrar_auditoria(db, usuario, "registros_horas_voluntariado", "APROVACAO", id_registro_afetado=registro.id_registro, ip_origem=_ip_origem(request))
    return {"mensagem": "Horas aprovadas.", "status": registro.status}


@router.post("/api/horas-voluntariado/{id_registro}/recusar", summary="Coordenador recusa horas de voluntariado")
def recusar_horas_endpoint(id_registro: int, request: Request, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    registro = projetos.recusar_horas_voluntariado(db, id_registro=id_registro, usuario=usuario)
    registrar_auditoria(db, usuario, "registros_horas_voluntariado", "RECUSA", id_registro_afetado=registro.id_registro, ip_origem=_ip_origem(request))
    return {"mensagem": "Horas recusadas.", "status": registro.status}


# ==========================================
# AUTOATENDIMENTO DO VOLUNTÁRIO (v4.4) - qualquer usuário autenticado vinculado a um associado,
# SEM exigir permissão "projetos"/"associados" (nível "Voluntário Externo" não tem nenhuma
# permissão de módulo, ver seed_niveis_e_permissoes) - visibilidade sempre restrita ao próprio
# associado, nunca aceita id_associado vindo do cliente.
# ==========================================
@router.get("/api/voluntariado/vagas-abertas", summary="Vagas de escala com posição livre, para autocandidatura")
def vagas_abertas_endpoint(db: Session = Depends(get_db), _usuario=Depends(get_current_user)):
    return projetos.vagas_abertas(db)


@router.post("/api/voluntariado/vagas/{id_vaga}/candidatar", summary="Candidatar-se a uma vaga de turno (aguarda confirmação do coordenador)")
def candidatar_se_endpoint(id_vaga: int, request: Request, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    alocacao = projetos.candidatar_se_a_vaga(db, id_vaga=id_vaga, usuario=usuario)
    registrar_auditoria(db, usuario, "alocacoes_voluntarios", "CANDIDATURA", id_registro_afetado=alocacao.id_alocacao, ip_origem=_ip_origem(request))
    return {"mensagem": "Candidatura registrada - aguardando confirmação do coordenador.", "id_alocacao": alocacao.id_alocacao}


@router.get("/api/voluntariado/minha-escala", summary="Minha escala de voluntariado (alocações do próprio usuário)")
def minha_escala_endpoint(db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    return [_serializar_alocacao(a) for a in projetos.minha_escala(db, usuario=usuario)]


@router.get("/api/voluntariado/meu-historico-horas", summary="Meu histórico de horas de voluntariado (pendentes, aprovadas e recusadas)")
def meu_historico_horas_endpoint(db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    return [_serializar_registro_horas(r) for r in projetos.meu_historico_horas_voluntariado(db, usuario=usuario)]


@router.post("/api/voluntariado/horas", summary="Registrar minhas próprias horas de voluntariado (exige termo vigente; aprovação do coordenador se amarrada a uma alocação)")
def registrar_minhas_horas_endpoint(dados: HorasVoluntariadoCriar, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    from datetime import datetime as _datetime

    associado = projetos.associado_do_usuario_ou_403(db, usuario)
    registro = servico_voluntariado.registrar_horas_voluntariado(
        db, id_pessoa=associado.id_pessoa, data=_datetime.combine(dados.data, _datetime.min.time()), horas=dados.horas,
        descricao_atividade=dados.descricao_atividade, id_projeto=dados.id_projeto, id_alocacao=dados.id_alocacao,
        id_usuario=usuario.id_usuario,
    )
    return {"mensagem": "Horas registradas.", "id_registro": registro.id_registro, "status": registro.status}


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
