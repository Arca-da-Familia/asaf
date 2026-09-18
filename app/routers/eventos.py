"""v4.5 (FASE 4) - Evento como entidade única (pontual, com sessões e edições recorrentes).
Inscrição reaproveita o motor genérico da v4.0 (`/api/inscricoes/`, já existente em
`app/routers/motores.py`, permissão "projetos") pro lado da gestão; aqui só o autoatendimento
(o próprio associado se inscrevendo) e a leitura pública pro site institucional."""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.config_cache import obter_configuracao
from app.database import get_db
from app.schemas.eventos import EventoCriar, InscricaoPublicaCriar, NovaEdicaoEventoCriar, PerguntaEventoCriar, SessaoEventoCriar
from app.security import exigir_permissao, get_current_user
from app.services import eventos
from app.services import inscricao as servico_inscricao
from app.services.protecao_publica import limitar_taxa_por_ip

router = APIRouter()
_permissao_projetos = exigir_permissao("projetos")


def _ip_origem(request: Request):
    return request.client.host if request.client else None


def _ip_publico(request: Request) -> str:
    """v4.6 - IP de quem está do outro lado de verdade, não do proxy - o Container App entrega a
    requisição por trás de um ingress, então `request.client.host` seria o IP interno do
    ingress/load balancer (o mesmo pra todo mundo), inutilizando o rate limiting por IP. Usa o
    primeiro IP de `X-Forwarded-For` quando presente (padrão do Azure Container Apps), cai pro
    `request.client.host` só quando não tem proxy no meio (dev local)."""
    encaminhado = request.headers.get("x-forwarded-for")
    if encaminhado:
        return encaminhado.split(",")[0].strip()
    return _ip_origem(request) or "desconhecido"


def _serializar_evento(e) -> dict:
    return {
        "id_evento": e.id_evento, "titulo": e.titulo, "descricao": e.descricao, "categoria": e.categoria,
        "data_hora_inicio": e.data_hora_inicio, "data_hora_fim": e.data_hora_fim, "id_espaco": e.id_espaco,
        "endereco_avulso": e.endereco_avulso, "id_associado_responsavel": e.id_associado_responsavel,
        "vagas": e.vagas, "gratuito": e.gratuito, "visibilidade": e.visibilidade,
        "id_edicao_anterior": e.id_edicao_anterior,
    }


def _serializar_evento_publico(e) -> dict:
    # v4.5 - só o que o site institucional precisa - nunca campos de gestão interna
    # (id_usuario_criacao, etc.).
    return {
        "id_evento": e.id_evento, "titulo": e.titulo, "descricao": e.descricao, "categoria": e.categoria,
        "data_hora_inicio": e.data_hora_inicio, "data_hora_fim": e.data_hora_fim, "id_espaco": e.id_espaco,
        "endereco_avulso": e.endereco_avulso, "vagas": e.vagas, "gratuito": e.gratuito,
    }


def _serializar_sessao(s) -> dict:
    return {
        "id_sessao": s.id_sessao, "id_evento": s.id_evento, "titulo": s.titulo, "descricao": s.descricao,
        "data_hora_inicio": s.data_hora_inicio, "data_hora_fim": s.data_hora_fim, "vagas": s.vagas,
    }


def _serializar_pergunta(p) -> dict:
    return {
        "id_pergunta": p.id_pergunta, "id_evento": p.id_evento, "enunciado": p.enunciado, "tipo": p.tipo,
        "opcoes": p.opcoes, "obrigatoria": p.obrigatoria, "ordem": p.ordem,
    }


@router.post("/api/eventos/", summary="Criar Evento")
def criar_evento_endpoint(dados: EventoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    evento = eventos.criar_evento(
        db, titulo=dados.titulo, descricao=dados.descricao, categoria=dados.categoria,
        data_hora_inicio=dados.data_hora_inicio, data_hora_fim=dados.data_hora_fim, id_espaco=dados.id_espaco,
        endereco_avulso=dados.endereco_avulso, id_associado_responsavel=dados.id_associado_responsavel,
        vagas=dados.vagas, gratuito=dados.gratuito, visibilidade=dados.visibilidade, id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "eventos", "CREATE", id_registro_afetado=evento.id_evento,
        dados_depois={"titulo": evento.titulo, "categoria": evento.categoria}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Evento criado.", "id_evento": evento.id_evento}


@router.get("/api/eventos/", summary="Listar Eventos (visão de gestão)")
def listar_eventos_endpoint(db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [_serializar_evento(e) for e in eventos.listar_eventos(db)]


@router.get("/api/eventos/minhas-inscricoes", summary="Minhas inscrições em eventos/sessões (autoatendimento)")
def minhas_inscricoes_endpoint(db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    return [
        {
            "id_inscricao": i.id_inscricao, "contexto_tipo": i.contexto_tipo, "id_contexto": i.id_contexto,
            "status": i.status, "data_inscricao": i.data_inscricao,
        }
        for i in eventos.minhas_inscricoes_em_eventos(db, usuario=usuario)
    ]


@router.get("/api/eventos/{id_evento}", summary="Detalhe de um Evento")
def obter_evento_endpoint(id_evento: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return _serializar_evento(eventos.obter_evento(db, id_evento))


@router.post("/api/eventos/{id_evento}/sessoes", summary="Cadastrar sessão/atividade do evento (programação)")
def criar_sessao_endpoint(id_evento: int, dados: SessaoEventoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    sessao = eventos.criar_sessao(
        db, id_evento=id_evento, titulo=dados.titulo, descricao=dados.descricao,
        data_hora_inicio=dados.data_hora_inicio, data_hora_fim=dados.data_hora_fim, vagas=dados.vagas,
        id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "sessoes_evento", "CREATE", id_registro_afetado=sessao.id_sessao,
        dados_depois={"id_evento": sessao.id_evento, "titulo": sessao.titulo}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Sessão cadastrada.", "id_sessao": sessao.id_sessao}


@router.get("/api/eventos/{id_evento}/sessoes", summary="Listar sessões/atividades do evento")
def listar_sessoes_endpoint(id_evento: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [_serializar_sessao(s) for s in eventos.listar_sessoes(db, id_evento=id_evento)]


@router.post("/api/eventos/{id_evento}/nova-edicao", summary="Criar nova edição deste evento (recorrência ligada)")
def criar_nova_edicao_endpoint(id_evento: int, dados: NovaEdicaoEventoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    nova_edicao = eventos.criar_nova_edicao(
        db, id_evento_anterior=id_evento, data_hora_inicio=dados.data_hora_inicio, data_hora_fim=dados.data_hora_fim,
        titulo=dados.titulo, id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "eventos", "NOVA_EDICAO", id_registro_afetado=nova_edicao.id_evento,
        dados_depois={"id_edicao_anterior": id_evento}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Nova edição criada.", "id_evento": nova_edicao.id_evento}


@router.get("/api/eventos/{id_evento}/edicoes", summary="Listar toda a cadeia de edições deste evento")
def listar_edicoes_endpoint(id_evento: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [_serializar_evento(e) for e in eventos.listar_cadeia_edicoes(db, id_evento=id_evento)]


# ==========================================
# PERGUNTAS PERSONALIZADAS DO FORMULÁRIO DE INSCRIÇÃO (v4.6)
# ==========================================
@router.post("/api/eventos/{id_evento}/perguntas", summary="Cadastrar pergunta personalizada do formulário de inscrição")
def criar_pergunta_endpoint(id_evento: int, dados: PerguntaEventoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    pergunta = eventos.criar_pergunta(
        db, id_evento=id_evento, enunciado=dados.enunciado, tipo=dados.tipo, opcoes=dados.opcoes,
        obrigatoria=dados.obrigatoria, ordem=dados.ordem,
    )
    registrar_auditoria(
        db, usuario, "perguntas_evento", "CREATE", id_registro_afetado=pergunta.id_pergunta,
        dados_depois={"id_evento": pergunta.id_evento, "enunciado": pergunta.enunciado}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Pergunta cadastrada.", "id_pergunta": pergunta.id_pergunta}


@router.get("/api/eventos/{id_evento}/perguntas", summary="Listar perguntas do formulário de inscrição (visão de gestão)")
def listar_perguntas_endpoint(id_evento: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [_serializar_pergunta(p) for p in eventos.listar_perguntas(db, id_evento=id_evento)]


# ==========================================
# AUTOATENDIMENTO - o próprio associado se inscrevendo (gestão de inscrição de terceiros
# continua em /api/inscricoes/, app/routers/motores.py, permissão "projetos")
# ==========================================
@router.post("/api/eventos/{id_evento}/inscricao", summary="Inscrever-se neste evento (autoatendimento)")
def inscrever_no_evento_endpoint(id_evento: int, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    inscricao_criada = eventos.inscrever_no_evento(db, id_evento=id_evento, usuario=usuario)
    return {"mensagem": "Inscrição registrada.", "id_inscricao": inscricao_criada.id_inscricao, "status": inscricao_criada.status}


@router.post("/api/eventos/sessoes/{id_sessao}/inscricao", summary="Inscrever-se nesta sessão do evento (autoatendimento)")
def inscrever_na_sessao_endpoint(id_sessao: int, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    inscricao_criada = eventos.inscrever_na_sessao(db, id_sessao=id_sessao, usuario=usuario)
    return {"mensagem": "Inscrição registrada.", "id_inscricao": inscricao_criada.id_inscricao, "status": inscricao_criada.status}


# ==========================================
# LEITURA PÚBLICA (site institucional - sem autenticação, nunca dado de gestão interna)
# ==========================================
@router.get("/api/publico/eventos", summary="Eventos públicos (leitura, sem autenticação, pro site institucional)")
def listar_eventos_publicos_endpoint(db: Session = Depends(get_db)):
    return [_serializar_evento_publico(e) for e in eventos.listar_eventos_publicos(db)]


@router.get("/api/publico/eventos/{id_evento}", summary="Detalhe público de um evento (leitura, sem autenticação)")
def obter_evento_publico_endpoint(id_evento: int, db: Session = Depends(get_db)):
    evento = eventos.obter_evento(db, id_evento)
    if evento.visibilidade != "Pública":
        raise HTTPException(status_code=404, detail="Evento não encontrado.")
    resposta = _serializar_evento_publico(evento)
    resposta["sessoes"] = [_serializar_sessao(s) for s in eventos.listar_sessoes(db, id_evento=id_evento)]
    resposta["perguntas"] = [_serializar_pergunta(p) for p in eventos.listar_perguntas(db, id_evento=id_evento)]
    return resposta


# ==========================================
# INSCRIÇÃO PÚBLICA COM DEDUPLICAÇÃO (v4.6) - formulário do site, sem login. Protegida por rate
# limiting por IP (sem CAPTCHA comercial pago, conforme o plano exige) - honeypot é checado
# ANTES de tocar em rate limit/banco, pra nunca gastar cota de tentativa legítima com lixo de bot.
# ==========================================
@router.get("/api/publico/eventos/{id_evento}/perguntas", summary="Perguntas do formulário de inscrição (leitura, sem autenticação)")
def listar_perguntas_publicas_endpoint(id_evento: int, db: Session = Depends(get_db)):
    evento = eventos.obter_evento(db, id_evento)
    if evento.visibilidade != "Pública":
        raise HTTPException(status_code=404, detail="Evento não encontrado.")
    return [_serializar_pergunta(p) for p in eventos.listar_perguntas(db, id_evento=id_evento)]


@router.get("/api/publico/eventos/consentimento-lgpd", summary="Texto e versão atuais do consentimento LGPD de inscrição (leitura, sem autenticação)")
def obter_texto_consentimento_lgpd_endpoint(db: Session = Depends(get_db)):
    return {
        "texto": obter_configuracao(db, "TEXTO_CONSENTIMENTO_LGPD_INSCRICAO", ""),
        "versao": obter_configuracao(db, "VERSAO_TEXTO_CONSENTIMENTO_LGPD_INSCRICAO", "1"),
    }


@router.post("/api/publico/eventos/{id_evento}/inscrever-se", summary="Inscrever-se publicamente neste evento (site institucional, sem login)")
def inscrever_publicamente_endpoint(id_evento: int, dados: InscricaoPublicaCriar, request: Request, db: Session = Depends(get_db)):
    if dados.pagina_web:
        # Honeypot disparado - finge sucesso, nunca grava nada e nunca avisa o robô que foi pego.
        return {"mensagem": "Inscrição registrada.", "codigo_checkin": None, "email_enviado": False}

    limitar_taxa_por_ip(db, ip=_ip_publico(request), rota="inscrever-se-evento", limite=5, janela_minutos=10)

    resultado = eventos.inscrever_publicamente(
        db, id_evento=id_evento, id_sessao=dados.id_sessao, nome_completo=dados.nome_completo, cpf=dados.cpf,
        email=dados.email, telefone=dados.telefone, respostas=dados.respostas,
        versao_texto_consentimento=dados.versao_texto_consentimento,
    )
    return {"mensagem": "Inscrição registrada.", **resultado}


@router.post("/api/publico/inscricoes/{token_cancelamento}/cancelar", summary="Autocancelar inscrição pelo link enviado por e-mail (sem login)")
def cancelar_inscricao_publica_endpoint(token_cancelamento: str, request: Request, db: Session = Depends(get_db)):
    limitar_taxa_por_ip(db, ip=_ip_publico(request), rota="cancelar-inscricao-evento", limite=10, janela_minutos=10)
    inscricao_cancelada = servico_inscricao.cancelar_por_token(db, token_cancelamento=token_cancelamento)
    return {"mensagem": "Inscrição cancelada.", "status": inscricao_cancelada.status}
