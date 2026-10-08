"""v4.5 (FASE 4) - Evento como entidade única (pontual, com sessões e edições recorrentes).
Inscrição reaproveita o motor genérico da v4.0 (`/api/inscricoes/`, já existente em
`app/routers/motores.py`, permissão "projetos") pro lado da gestão; aqui só o autoatendimento
(o próprio associado se inscrevendo) e a leitura pública pro site institucional."""
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.config_cache import obter_configuracao
from app.database import get_db
from app.schemas.eventos import (
    CotaInscricaoCriar,
    InscreverAssociadoCriar,
    CupomDescontoCriar,
    EventoCobrancaConfig,
    EventoCriar,
    EventoEditar,
    EventoElegibilidadeConfig,
    EventoReembolsoConfig,
    FaixaPrecoEventoCriar,
    InscricaoPublicaCriar,
    IsencaoTaxaCriar,
    NovaEdicaoEventoCriar,
    PerguntaEventoCriar,
    SessaoEventoCriar,
)
from app.schemas.portaria import TokenPortariaCriar
from app.security import exigir_permissao, get_current_user
from app.models.motores import CANCELADO, Inscricao, RegistroPresenca
from app.services import certificados as servico_certificados
from app.services import cupons as servico_cupons
from app.services import eventos
from app.services import eventos_fotos as servico_de_fotos
from app.services import fechamento_evento as servico_fechamento_evento
from app.services import inscricao as servico_inscricao
from app.services import isencoes_taxa as servico_isencoes_taxa
from app.services import pesquisa_satisfacao as servico_pesquisa_satisfacao
from app.services import portaria as servico_portaria
from app.services import publico_contexto
from app.services import precos_evento as servico_precos_evento
from app.services import vagas as servico_vagas
from app.services.protecao_publica import limitar_taxa_por_ip

router = APIRouter()
_permissao_projetos = exigir_permissao("projetos")
_permissao_checkin = exigir_permissao("gerenciar_checkin_evento")


# v5.4h - inscrição pública: o limite por IP era 5 a cada 10 minutos, o que barrava a secretaria de uma igreja, uma escola ou um provedor móvel (todos atrás do
# mesmo IP) já na sexta pessoa. Agora são 30 a cada 10 minutos: um humano digitando não chega a isso (uma inscrição a cada 20 s), e quem tenta em massa é barrado.
LIMITE_DE_INSCRICOES_POR_IP = 30
JANELA_DE_INSCRICOES_MINUTOS = 10


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


def _vagas_livres(e) -> Optional[int]:
    return None if e.vagas is None else max(0, e.vagas - e.vagas_ocupadas)


def _serializar_evento(e) -> dict:
    return {
        "id_evento": e.id_evento, "titulo": e.titulo, "descricao": e.descricao, "categoria": e.categoria,
        "data_hora_inicio": e.data_hora_inicio, "data_hora_fim": e.data_hora_fim, "id_espaco": e.id_espaco,
        "endereco_avulso": e.endereco_avulso, "id_associado_responsavel": e.id_associado_responsavel,
        "vagas": e.vagas, "vagas_ocupadas": e.vagas_ocupadas, "vagas_livres": _vagas_livres(e),
        "gratuito": e.gratuito, "visibilidade": e.visibilidade, "id_edicao_anterior": e.id_edicao_anterior,
        "id_projeto": e.id_projeto,
    }


def _serializar_evento_publico(e, projetos_publicos: set) -> dict:
    # v4.5 - só o que o site institucional precisa - nunca campos de gestão interna
    # (id_usuario_criacao, etc.). v5.5: `id_projeto` só vai quando o projeto também é Público (o site só tem página dele).
    return {
        "id_evento": e.id_evento, "titulo": e.titulo, "descricao": e.descricao, "categoria": e.categoria,
        "data_hora_inicio": e.data_hora_inicio, "data_hora_fim": e.data_hora_fim, "id_espaco": e.id_espaco,
        "endereco_avulso": e.endereco_avulso, "vagas": e.vagas, "vagas_livres": _vagas_livres(e), "gratuito": e.gratuito,
        "id_projeto": e.id_projeto if e.id_projeto in projetos_publicos else None,
    }


def _serializar_sessao(s) -> dict:
    return {
        "id_sessao": s.id_sessao, "id_evento": s.id_evento, "titulo": s.titulo, "descricao": s.descricao,
        "data_hora_inicio": s.data_hora_inicio, "data_hora_fim": s.data_hora_fim, "vagas": s.vagas,
        "vagas_ocupadas": s.vagas_ocupadas, "vagas_livres": _vagas_livres(s),
    }


def _serializar_pergunta(p) -> dict:
    return {
        "id_pergunta": p.id_pergunta, "id_evento": p.id_evento, "enunciado": p.enunciado, "tipo": p.tipo,
        "opcoes": p.opcoes, "obrigatoria": p.obrigatoria, "ordem": p.ordem,
    }


def _serializar_cota(c) -> dict:
    return {
        "id_cota": c.id_cota, "contexto_tipo": c.contexto_tipo, "id_contexto": c.id_contexto,
        "categoria": c.categoria, "vagas_limite": c.vagas_limite, "vagas_ocupadas": c.vagas_ocupadas,
    }


@router.post("/api/eventos/", summary="Criar Evento")
def criar_evento_endpoint(dados: EventoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    evento = eventos.criar_evento(
        db, titulo=dados.titulo, descricao=dados.descricao, categoria=dados.categoria,
        data_hora_inicio=dados.data_hora_inicio, data_hora_fim=dados.data_hora_fim, id_espaco=dados.id_espaco,
        endereco_avulso=dados.endereco_avulso, id_associado_responsavel=dados.id_associado_responsavel,
        vagas=dados.vagas, gratuito=dados.gratuito, visibilidade=dados.visibilidade, id_usuario=usuario.id_usuario,
        id_projeto=dados.id_projeto,
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


@router.put("/api/eventos/{id_evento}", summary="Editar o cadastro do evento (título, descrição, datas, local, visibilidade, projeto)")
def editar_evento_endpoint(id_evento: int, dados: EventoEditar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    evento, antes = eventos.editar_evento(db, id_evento, dados.model_dump(exclude_unset=True))
    registrar_auditoria(
        db, usuario, "eventos", "UPDATE", id_registro_afetado=evento.id_evento,
        dados_antes=antes, dados_depois={c: getattr(evento, c) for c in antes}, ip_origem=_ip_origem(request),
    )
    return _serializar_evento(evento)


# ==========================================
# FOTOS DO EVENTO (v5.5) - só entram com a autorização de imagem; a imagem é regravada sem metadado
# ==========================================
@router.get("/api/eventos/{id_evento}/fotos", summary="Fotos do evento (visão de gestão)")
def listar_fotos_do_evento_endpoint(id_evento: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    evento = eventos.obter_evento(db, id_evento)
    return [servico_de_fotos.para_o_painel(f) for f in servico_de_fotos.fotos_do_evento(db, evento.id_evento)]


@router.post("/api/eventos/{id_evento}/fotos", summary="Enviar foto do evento (exige a autorização de imagem)", status_code=201)
async def enviar_foto_do_evento_endpoint(
    id_evento: int, request: Request, arquivo: UploadFile = File(...), alt: str = Form(""),
    autorizacao_imagem: bool = Form(False), id_documento_autorizacao: Optional[int] = Form(None),
    db: Session = Depends(get_db), usuario=Depends(_permissao_projetos),
):
    evento = eventos.obter_evento(db, id_evento)
    conteudo = await arquivo.read()
    foto = await run_in_threadpool(
        servico_de_fotos.adicionar_foto, db, usuario, evento, conteudo, alt=alt, autorizacao_imagem=autorizacao_imagem,
        id_documento_autorizacao=id_documento_autorizacao,
    )
    registrar_auditoria(
        db, usuario, "eventos", "FOTO_ENVIADA", id_registro_afetado=evento.id_evento,
        dados_depois={"id_foto": foto.id_foto, "id_documento": id_documento_autorizacao}, ip_origem=_ip_origem(request),
    )
    return [servico_de_fotos.para_o_painel(f) for f in servico_de_fotos.fotos_do_evento(db, evento.id_evento)]


@router.get("/api/eventos/{id_evento}/fotos/{id_foto}/arquivo", summary="Ver a foto (autenticado; a foto fica em área privada)")
async def ver_foto_do_evento_endpoint(id_evento: int, id_foto: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    evento = eventos.obter_evento(db, id_evento)
    foto = servico_de_fotos.buscar_foto(db, evento, id_foto)
    conteudo = await run_in_threadpool(servico_de_fotos.ler_arquivo, foto)
    return Response(content=conteudo, media_type="image/jpeg", headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.delete("/api/eventos/{id_evento}/fotos/{id_foto}", summary="Apagar a foto (a autorização foi retirada): some do site e do armazenamento")
def apagar_foto_do_evento_endpoint(id_evento: int, id_foto: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    evento = eventos.obter_evento(db, id_evento)
    foto = servico_de_fotos.apagar_foto(db, evento, id_foto)
    registrar_auditoria(
        db, usuario, "eventos", "FOTO_APAGADA", id_registro_afetado=evento.id_evento,
        dados_antes={"id_foto": foto.id_foto}, ip_origem=_ip_origem(request),
    )
    return [servico_de_fotos.para_o_painel(f) for f in servico_de_fotos.fotos_do_evento(db, evento.id_evento)]


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
# COTAS POR CATEGORIA (v4.7) - opcional; sem nenhuma cota, o limite genérico do evento/sessão
# vale pra todo mundo (ver app/services/vagas.py).
# ==========================================
@router.post("/api/eventos/{id_evento}/cotas", summary="Criar cota de vagas por categoria para o evento")
def criar_cota_evento_endpoint(id_evento: int, dados: CotaInscricaoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    cota = eventos.criar_cota(db, contexto_tipo=eventos.CONTEXTO_EVENTO, id_contexto=id_evento, categoria=dados.categoria, vagas_limite=dados.vagas_limite)
    registrar_auditoria(
        db, usuario, "cotas_inscricao_evento", "CREATE", id_registro_afetado=cota.id_cota,
        dados_depois={"id_evento": id_evento, "categoria": cota.categoria, "vagas_limite": cota.vagas_limite}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Cota criada.", "id_cota": cota.id_cota}


@router.get("/api/eventos/{id_evento}/cotas", summary="Listar cotas de vagas por categoria do evento")
def listar_cotas_evento_endpoint(id_evento: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [_serializar_cota(c) for c in eventos.listar_cotas(db, contexto_tipo=eventos.CONTEXTO_EVENTO, id_contexto=id_evento)]


@router.post("/api/eventos/sessoes/{id_sessao}/cotas", summary="Criar cota de vagas por categoria para a sessão")
def criar_cota_sessao_endpoint(id_sessao: int, dados: CotaInscricaoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    cota = eventos.criar_cota(db, contexto_tipo=eventos.CONTEXTO_SESSAO_EVENTO, id_contexto=id_sessao, categoria=dados.categoria, vagas_limite=dados.vagas_limite)
    registrar_auditoria(
        db, usuario, "cotas_inscricao_evento", "CREATE", id_registro_afetado=cota.id_cota,
        dados_depois={"id_sessao": id_sessao, "categoria": cota.categoria, "vagas_limite": cota.vagas_limite}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Cota criada.", "id_cota": cota.id_cota}


@router.get("/api/eventos/sessoes/{id_sessao}/cotas", summary="Listar cotas de vagas por categoria da sessão")
def listar_cotas_sessao_endpoint(id_sessao: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [_serializar_cota(c) for c in eventos.listar_cotas(db, contexto_tipo=eventos.CONTEXTO_SESSAO_EVENTO, id_contexto=id_sessao)]


# ==========================================
# EXPIRAÇÃO DE PROMOÇÕES DA LISTA DE ESPERA (v4.7) - disparado periodicamente por
# scripts/expirar_promocoes_vagas.py (workflow agendado); exposto aqui também pra disparo manual
# por quem tem permissão de projetos, sem precisar esperar o próximo ciclo agendado.
# ==========================================
@router.post("/api/eventos/expirar-promocoes-vencidas", summary="Expira promoções de lista de espera vencidas e promove o próximo da fila")
def expirar_promocoes_vencidas_endpoint(request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    resultado = servico_vagas.expirar_promocoes_vencidas(db)
    for item in resultado:
        registrar_auditoria(db, usuario, "inscricoes", "EXPIRACAO_PROMOCAO", id_registro_afetado=item["id_inscricao"], dados_depois=item, ip_origem=_ip_origem(request))
    return {"mensagem": f"{len(resultado)} promoção(ões) vencida(s) processada(s).", "detalhes": resultado}


# ==========================================
# AUTOATENDIMENTO - o próprio associado se inscrevendo (gestão de inscrição de terceiros
# continua em /api/inscricoes/, app/routers/motores.py, permissão "projetos")
# ==========================================
@router.post("/api/eventos/{id_evento}/inscricao", summary="Inscrever-se neste evento (autoatendimento)")
def inscrever_no_evento_endpoint(id_evento: int, request: Request, codigo_cupom: Optional[str] = None, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    inscricao_criada = eventos.inscrever_no_evento(db, id_evento=id_evento, usuario=usuario, codigo_cupom=codigo_cupom)
    registrar_auditoria(db, usuario, "inscricoes", "INSCRICAO", id_registro_afetado=inscricao_criada.id_inscricao, ip_origem=_ip_origem(request))
    return {"mensagem": "Inscrição registrada.", "id_inscricao": inscricao_criada.id_inscricao, "status": inscricao_criada.status}


@router.post("/api/eventos/{id_evento}/inscrever-associado", summary="Inscrever um associado neste evento (feito pela secretaria, com controle de vagas)")
def inscrever_associado_no_evento_endpoint(
    id_evento: int, dados: InscreverAssociadoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos),
):
    inscricao_criada = eventos.inscrever_associado_no_evento(
        db, id_evento=id_evento, id_associado=dados.id_associado, operador=usuario, codigo_cupom=dados.codigo_cupom,
    )
    registrar_auditoria(
        db, usuario, "inscricoes", "INSCRICAO_PELA_SECRETARIA", id_registro_afetado=inscricao_criada.id_inscricao,
        dados_depois={"id_evento": id_evento, "id_associado": dados.id_associado, "status": inscricao_criada.status}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Inscrição registrada.", "id_inscricao": inscricao_criada.id_inscricao, "status": inscricao_criada.status}


@router.post("/api/eventos/sessoes/{id_sessao}/inscricao", summary="Inscrever-se nesta sessão do evento (autoatendimento)")
def inscrever_na_sessao_endpoint(id_sessao: int, request: Request, codigo_cupom: Optional[str] = None, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    inscricao_criada = eventos.inscrever_na_sessao(db, id_sessao=id_sessao, usuario=usuario, codigo_cupom=codigo_cupom)
    registrar_auditoria(db, usuario, "inscricoes", "INSCRICAO", id_registro_afetado=inscricao_criada.id_inscricao, ip_origem=_ip_origem(request))
    return {"mensagem": "Inscrição registrada.", "id_inscricao": inscricao_criada.id_inscricao, "status": inscricao_criada.status}


# ==========================================
# PORTARIA (v4.8) - emitir/listar/revogar o token de operação que dá acesso aos endpoints
# públicos de check-in/check-out (app/routers/portaria.py), sem login de quem opera. Permissão
# própria (`gerenciar_checkin_evento`), separada de "projetos" de propósito (ver plano da v4.8).
# ==========================================
@router.post("/api/eventos/{id_evento}/tokens-portaria", summary="Emitir token de operação da portaria para este evento")
def emitir_token_portaria_endpoint(id_evento: int, dados: TokenPortariaCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_checkin)):
    registro, token = servico_portaria.emitir_token_portaria(
        db, id_evento=id_evento, descricao=dados.descricao, horas_validade=dados.horas_validade, id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "tokens_portaria", "CREATE", id_registro_afetado=registro.id_token_portaria,
        dados_depois={"id_evento": id_evento, "descricao": registro.descricao, "expira_em": str(registro.expira_em)},
        ip_origem=_ip_origem(request),
    )
    return {
        "mensagem": "Token de portaria emitido.", "id_token_portaria": registro.id_token_portaria, "token": token,
        "url_portaria": f"/portaria/{token}", "expira_em": registro.expira_em,
    }


@router.get("/api/eventos/{id_evento}/tokens-portaria", summary="Listar tokens de operação da portaria deste evento")
def listar_tokens_portaria_endpoint(id_evento: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_checkin)):
    return [
        {
            "id_token_portaria": t.id_token_portaria, "descricao": t.descricao, "criado_em": t.criado_em,
            "expira_em": t.expira_em, "revogado_em": t.revogado_em,
        }
        for t in servico_portaria.listar_tokens_portaria(db, id_evento=id_evento)
    ]


@router.post("/api/eventos/{id_evento}/tokens-portaria/{id_token_portaria}/revogar", summary="Revogar token de operação da portaria")
def revogar_token_portaria_endpoint(id_evento: int, id_token_portaria: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_checkin)):
    registro = servico_portaria.revogar_token_portaria(db, id_evento=id_evento, id_token_portaria=id_token_portaria, id_usuario=usuario.id_usuario)
    registrar_auditoria(
        db, usuario, "tokens_portaria", "REVOGAR", id_registro_afetado=registro.id_token_portaria,
        dados_depois={"revogado_em": str(registro.revogado_em)}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Token de portaria revogado."}


# ==========================================
# ELEGIBILIDADE E EMISSÃO DE CRACHÁ/CERTIFICADO (v4.8) - elegibilidade é sempre calculada
# (app/services/certificados.py::calcular_elegibilidade), nunca concedida à mão; sem parâmetro de
# override em nenhum endpoint abaixo, de propósito.
# ==========================================
@router.put("/api/eventos/{id_evento}/elegibilidade-config", summary="Configurar sobrescrita de elegibilidade ao certificado deste evento")
def atualizar_elegibilidade_config_endpoint(id_evento: int, dados: EventoElegibilidadeConfig, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_checkin)):
    evento = eventos.atualizar_configuracao_elegibilidade(
        db, id_evento=id_evento, percentual_minimo=dados.percentual_minimo, carga_horaria_horas=dados.carga_horaria_horas,
    )
    registrar_auditoria(
        db, usuario, "eventos", "ATUALIZAR_ELEGIBILIDADE", id_registro_afetado=evento.id_evento,
        dados_depois={"percentual_minimo_certificado": str(evento.percentual_minimo_certificado), "carga_horaria_horas": str(evento.carga_horaria_horas)},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Configuração de elegibilidade atualizada."}


@router.get("/api/eventos/{id_evento}/elegibilidade", summary="Elegibilidade ao certificado de cada inscrito deste evento")
def listar_elegibilidade_endpoint(id_evento: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_checkin)):
    return servico_certificados.listar_elegibilidade_evento(db, id_evento=id_evento)


@router.post("/api/eventos/{id_evento}/crachas/{id_pessoa}", summary="Emitir crachá em PDF para esta pessoa neste evento")
def emitir_cracha_endpoint(id_evento: int, id_pessoa: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_checkin)):
    documento = servico_certificados.emitir_cracha(db, id_evento=id_evento, id_pessoa=id_pessoa, id_usuario=usuario.id_usuario)
    registrar_auditoria(
        db, usuario, "documentos_emitidos", "EMITIR_CRACHA", id_registro_afetado=documento.id_documento,
        dados_depois={"id_evento": id_evento, "id_pessoa": id_pessoa}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Crachá emitido.", "id_documento": documento.id_documento, "caminho_arquivo": documento.caminho_arquivo}


@router.post("/api/eventos/{id_evento}/certificados/{id_pessoa}", summary="Emitir certificado em PDF para esta pessoa neste evento (recusa se não elegível)")
def emitir_certificado_endpoint(id_evento: int, id_pessoa: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_checkin)):
    documento = servico_certificados.emitir_certificado(
        db, id_evento=id_evento, id_pessoa=id_pessoa, id_usuario=usuario.id_usuario, url_base_verificacao=str(request.base_url),
    )
    registrar_auditoria(
        db, usuario, "documentos_emitidos", "EMITIR_CERTIFICADO", id_registro_afetado=documento.id_documento,
        dados_depois={"id_evento": id_evento, "id_pessoa": id_pessoa, "codigo_verificacao": documento.codigo_verificacao},
        ip_origem=_ip_origem(request),
    )
    return {
        "mensagem": "Certificado emitido.", "id_documento": documento.id_documento,
        "caminho_arquivo": documento.caminho_arquivo, "codigo_verificacao": documento.codigo_verificacao,
    }


# ==========================================
# FINANCEIRO DE EVENTO (v4.9) - cobrança de inscrição integrada à FASE 3 (faixa de preço por
# categoria/data, cupom, isenção justificada), reembolso por cancelamento e fechamento
# financeiro automático ao encerrar. Mesma permissão de gestão geral do evento ("projetos") -
# mesmo critério já usado pelos campos financeiros de `Espaco` (v4.3), nunca "financeiro"
# aqui de propósito, pra ficar consistente com o resto da FASE 4.
# ==========================================
@router.put("/api/eventos/{id_evento}/cobranca-config", summary="Configurar cobrança de inscrição do evento")
def configurar_cobranca_evento_endpoint(id_evento: int, dados: EventoCobrancaConfig, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    evento = eventos.configurar_cobranca_evento(
        db, id_evento=id_evento, valor_base=dados.valor_base,
        id_conta_contabil_receita=dados.id_conta_contabil_receita, id_centro_custo=dados.id_centro_custo,
    )
    registrar_auditoria(
        db, usuario, "eventos", "CONFIGURAR_COBRANCA", id_registro_afetado=evento.id_evento,
        dados_depois={"valor_base": str(evento.valor_base), "id_centro_custo": evento.id_centro_custo},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Configuração de cobrança atualizada."}


@router.put("/api/eventos/{id_evento}/reembolso-config", summary="Configurar política de reembolso por cancelamento do evento")
def configurar_reembolso_evento_endpoint(id_evento: int, dados: EventoReembolsoConfig, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    evento = eventos.obter_evento(db, id_evento)
    evento.prazo_cancelamento_horas = dados.prazo_cancelamento_horas
    evento.percentual_reembolso_cancelamento = dados.percentual_reembolso_cancelamento
    db.commit()
    registrar_auditoria(
        db, usuario, "eventos", "CONFIGURAR_REEMBOLSO", id_registro_afetado=evento.id_evento,
        dados_depois={"prazo_cancelamento_horas": evento.prazo_cancelamento_horas, "percentual_reembolso_cancelamento": str(evento.percentual_reembolso_cancelamento)},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Configuração de reembolso atualizada."}


@router.post("/api/eventos/{id_evento}/faixas-preco", summary="Criar faixa de preço de inscrição (por categoria/vigência)")
def criar_faixa_preco_endpoint(id_evento: int, dados: FaixaPrecoEventoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    faixa = servico_precos_evento.criar_faixa_preco(
        db, id_evento=id_evento, categoria=dados.categoria, valor=dados.valor,
        data_vigencia_inicio=dados.data_vigencia_inicio, data_vigencia_fim=dados.data_vigencia_fim, id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "faixas_preco_evento", "CREATE", id_registro_afetado=faixa.id_faixa,
        dados_depois={"id_evento": id_evento, "categoria": faixa.categoria, "valor": str(faixa.valor)}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Faixa de preço criada.", "id_faixa": faixa.id_faixa}


@router.get("/api/eventos/{id_evento}/faixas-preco", summary="Listar faixas de preço de inscrição do evento")
def listar_faixas_preco_endpoint(id_evento: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [
        {
            "id_faixa": f.id_faixa, "categoria": f.categoria, "valor": f.valor,
            "data_vigencia_inicio": f.data_vigencia_inicio, "data_vigencia_fim": f.data_vigencia_fim,
        }
        for f in servico_precos_evento.listar_faixas_preco(db, id_evento=id_evento)
    ]


@router.post("/api/eventos/{id_evento}/cupons", summary="Criar cupom de desconto para inscrição no evento")
def criar_cupom_evento_endpoint(id_evento: int, dados: CupomDescontoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    cupom = servico_cupons.criar_cupom(
        db, codigo=dados.codigo, contexto_tipo="Evento", id_contexto=id_evento, tipo_desconto=dados.tipo_desconto,
        valor_desconto=dados.valor_desconto, limite_uso=dados.limite_uso,
        data_vigencia_inicio=dados.data_vigencia_inicio, data_vigencia_fim=dados.data_vigencia_fim, id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "cupons_desconto", "CREATE", id_registro_afetado=cupom.id_cupom,
        dados_depois={"id_evento": id_evento, "codigo": cupom.codigo}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Cupom criado.", "id_cupom": cupom.id_cupom, "codigo": cupom.codigo}


@router.get("/api/eventos/{id_evento}/cupons", summary="Listar cupons de desconto do evento")
def listar_cupons_evento_endpoint(id_evento: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [
        {
            "id_cupom": c.id_cupom, "codigo": c.codigo, "tipo_desconto": c.tipo_desconto, "valor_desconto": c.valor_desconto,
            "limite_uso": c.limite_uso, "usos_atuais": c.usos_atuais, "data_vigencia_inicio": c.data_vigencia_inicio,
            "data_vigencia_fim": c.data_vigencia_fim, "ativo": c.ativo,
        }
        for c in servico_cupons.listar_cupons(db, contexto_tipo="Evento", id_contexto=id_evento)
    ]


@router.post("/api/eventos/{id_evento}/isencoes", summary="Conceder isenção justificada de taxa de inscrição")
def conceder_isencao_evento_endpoint(id_evento: int, dados: IsencaoTaxaCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    isencao = servico_isencoes_taxa.conceder_isencao(
        db, contexto_tipo="Evento", id_contexto=id_evento, id_pessoa=dados.id_pessoa, motivo=dados.motivo,
        percentual_isencao=dados.percentual_isencao, id_usuario_aprovador=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "isencoes_taxa_contexto", "CREATE", id_registro_afetado=isencao.id_isencao,
        dados_depois={"id_evento": id_evento, "id_pessoa": isencao.id_pessoa, "percentual_isencao": str(isencao.percentual_isencao)},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Isenção concedida.", "id_isencao": isencao.id_isencao}


@router.get("/api/eventos/{id_evento}/isencoes", summary="Listar isenções de taxa de inscrição do evento")
def listar_isencoes_evento_endpoint(id_evento: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [
        {
            "id_isencao": i.id_isencao, "id_pessoa": i.id_pessoa, "motivo": i.motivo,
            "percentual_isencao": i.percentual_isencao, "id_usuario_aprovador": i.id_usuario_aprovador,
        }
        for i in servico_isencoes_taxa.listar_isencoes(db, contexto_tipo="Evento", id_contexto=id_evento)
    ]


@router.post("/api/eventos/{id_evento}/fechamento", summary="Gerar fechamento financeiro do evento (manual, sem esperar a tarefa periódica)")
def gerar_fechamento_evento_endpoint(id_evento: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    fechamento = servico_fechamento_evento.gerar_fechamento_evento(db, id_evento=id_evento, id_usuario=usuario.id_usuario)
    registrar_auditoria(
        db, usuario, "fechamentos_evento", "CREATE", id_registro_afetado=fechamento.id_fechamento,
        dados_depois={
            "id_evento": id_evento, "total_inscritos": fechamento.total_inscritos, "total_presentes": fechamento.total_presentes,
            "total_arrecadado": str(fechamento.total_arrecadado), "total_custos": str(fechamento.total_custos), "resultado": str(fechamento.resultado),
        },
        ip_origem=_ip_origem(request),
    )
    return {
        "mensagem": "Fechamento gerado.", "id_fechamento": fechamento.id_fechamento,
        "total_inscritos": fechamento.total_inscritos, "total_presentes": fechamento.total_presentes,
        "total_arrecadado": fechamento.total_arrecadado, "total_custos": fechamento.total_custos, "resultado": fechamento.resultado,
    }


@router.get("/api/eventos/{id_evento}/fechamento", summary="Listar histórico de fechamentos financeiros do evento")
def listar_fechamentos_evento_endpoint(id_evento: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [
        {
            "id_fechamento": f.id_fechamento, "gerado_em": f.gerado_em, "total_inscritos": f.total_inscritos,
            "total_presentes": f.total_presentes, "total_arrecadado": f.total_arrecadado, "total_custos": f.total_custos,
            "resultado": f.resultado, "id_usuario_geracao": f.id_usuario_geracao,
        }
        for f in servico_fechamento_evento.listar_fechamentos_evento(db, id_evento=id_evento)
    ]


# ==========================================
# PESQUISA DE SATISFAÇÃO (v4.10) - convite automático já acontece pela mesma tarefa diária do
# fechamento financeiro (v4.9, ver app/services/fechamento_evento.py); aqui só o disparo manual
# (sem esperar o ciclo) e a leitura do resultado agregado, sempre anônimo.
# ==========================================
@router.post("/api/eventos/{id_evento}/pesquisa-satisfacao/convidar", summary="Gerar convites de pesquisa de satisfação (manual, sem esperar a tarefa periódica)")
def convidar_pesquisa_satisfacao_endpoint(id_evento: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    convites = servico_pesquisa_satisfacao.gerar_convites(db, id_evento=id_evento)
    registrar_auditoria(
        db, usuario, "respostas_pesquisa_satisfacao", "CONVIDAR", id_registro_afetado=id_evento,
        dados_depois={"quantidade_convites_novos": len(convites)}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Convites gerados.", "quantidade_convites_novos": len(convites)}


@router.get("/api/eventos/{id_evento}/pesquisa-satisfacao/resultado", summary="Resultado agregado da pesquisa de satisfação (sempre anônimo)")
def resultado_pesquisa_satisfacao_endpoint(id_evento: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return servico_pesquisa_satisfacao.calcular_resultado(db, id_evento=id_evento)


# ==========================================
# COMPARAÇÃO ENTRE EDIÇÕES (v4.10) - nenhuma agregação nova de dado, só reaproveita, edição por
# edição, o que cada versão anterior já calcula (inscritos/presentes do motor v4.0/v4.8,
# arrecadado/resultado do último FechamentoEvento v4.9, satisfação desta versão).
# ==========================================
@router.get("/api/eventos/{id_evento}/comparacao-edicoes", summary="Comparação entre edições do evento")
def comparacao_edicoes_endpoint(id_evento: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    linhas = []
    for edicao in eventos.listar_cadeia_edicoes(db, id_evento=id_evento):
        total_inscritos = (
            db.query(Inscricao)
            .filter(Inscricao.contexto_tipo == "Evento", Inscricao.id_contexto == edicao.id_evento, Inscricao.status != CANCELADO)
            .count()
        )
        total_presentes = (
            db.query(RegistroPresenca.id_pessoa)
            .filter(RegistroPresenca.contexto_tipo == "Evento", RegistroPresenca.id_contexto == edicao.id_evento)
            .distinct()
            .count()
        )
        ultimos_fechamentos = servico_fechamento_evento.listar_fechamentos_evento(db, id_evento=edicao.id_evento)
        ultimo_fechamento = ultimos_fechamentos[0] if ultimos_fechamentos else None
        resultado_satisfacao = servico_pesquisa_satisfacao.calcular_resultado(db, id_evento=edicao.id_evento)
        linhas.append({
            "id_evento": edicao.id_evento, "titulo": edicao.titulo, "data_hora_inicio": edicao.data_hora_inicio,
            "total_inscritos": total_inscritos, "total_presentes": total_presentes,
            "total_arrecadado": ultimo_fechamento.total_arrecadado if ultimo_fechamento else None,
            "resultado_financeiro": ultimo_fechamento.resultado if ultimo_fechamento else None,
            "nota_media_satisfacao": resultado_satisfacao["nota_media"],
        })
    return linhas


# ==========================================
# EXPORTAÇÃO DE PRESENÇA/ELEGIBILIDADE (v4.8) - nunca caminho padrão: permissão própria
# (`exportar_presencas_evento`, separada de `gerenciar_checkin_evento` de propósito, mesmo
# critério de `exportar_dados_pessoais`) e sempre com auditoria - mesmo padrão de
# `GET /api/associados/exportar` (app/routers/importacao.py).
# ==========================================
_COLUNAS_EXPORTAVEIS_PRESENCA = {
    "id_pessoa": lambda l: l["id_pessoa"],
    "nome_completo": lambda l: l["nome_completo"],
    "percentual": lambda l: l["percentual"],
    "limite_aplicado": lambda l: l["limite_aplicado"],
    "elegivel": lambda l: l["elegivel"],
}


@router.get("/api/eventos/{id_evento}/presencas/exportar", summary="Exportar presença/elegibilidade de um evento (permissão própria)")
def exportar_presencas_endpoint(id_evento: int, colunas: str, request: Request, db: Session = Depends(get_db), usuario=Depends(exigir_permissao("exportar_presencas_evento"))):
    colunas_pedidas = [c.strip() for c in colunas.split(",") if c.strip()]
    desconhecidas = [c for c in colunas_pedidas if c not in _COLUNAS_EXPORTAVEIS_PRESENCA]
    if desconhecidas:
        raise HTTPException(status_code=422, detail=f"Coluna(s) desconhecida(s): {', '.join(desconhecidas)}.")
    if not colunas_pedidas:
        raise HTTPException(status_code=422, detail="Informe ao menos uma coluna.")

    linhas_origem = servico_certificados.listar_elegibilidade_evento(db, id_evento=id_evento)
    linhas = [{c: _COLUNAS_EXPORTAVEIS_PRESENCA[c](l) for c in colunas_pedidas} for l in linhas_origem]

    registrar_auditoria(
        db, usuario, "registros_presenca", "EXPORT", id_registro_afetado=id_evento,
        dados_depois={"id_evento": id_evento, "colunas": colunas_pedidas, "total_linhas": len(linhas)},
        ip_origem=_ip_origem(request),
    )
    return {"colunas": colunas_pedidas, "linhas": linhas}


# ==========================================
# LEITURA PÚBLICA (site institucional - sem autenticação, nunca dado de gestão interna)
# ==========================================
@router.get("/api/publico/eventos", summary="Eventos públicos (leitura, sem autenticação, pro site institucional)")
def listar_eventos_publicos_endpoint(db: Session = Depends(get_db)):
    projetos_publicos = publico_contexto.ids_de_projetos_publicos(db)
    return [_serializar_evento_publico(e, projetos_publicos) for e in eventos.listar_eventos_publicos(db)]


# v4.6 - rotas literais (`/consentimento-lgpd`) SEMPRE antes de `/{id_evento}` - mesmo achado
# real já corrigido na v4.5 (`/api/eventos/minhas-inscricoes` vs `/api/eventos/{id_evento}`):
# FastAPI/Starlette casa rota por ordem de registro, e um segmento parametrizado sem conversor
# próprio casa com QUALQUER string, inclusive um literal registrado depois dele.
@router.get("/api/publico/eventos/consentimento-lgpd", summary="Texto e versão atuais do consentimento LGPD de inscrição (leitura, sem autenticação)")
def obter_texto_consentimento_lgpd_endpoint(db: Session = Depends(get_db)):
    return {
        "texto": obter_configuracao(db, "TEXTO_CONSENTIMENTO_LGPD_INSCRICAO", ""),
        "versao": obter_configuracao(db, "VERSAO_TEXTO_CONSENTIMENTO_LGPD_INSCRICAO", "1"),
    }


@router.get("/api/publico/eventos/{id_evento}", summary="Detalhe público de um evento (leitura, sem autenticação)")
def obter_evento_publico_endpoint(id_evento: int, db: Session = Depends(get_db)):
    evento = eventos.obter_evento(db, id_evento)
    if evento.visibilidade != "Pública":
        raise HTTPException(status_code=404, detail="Evento não encontrado.")
    resposta = _serializar_evento_publico(evento, publico_contexto.ids_de_projetos_publicos(db))
    resposta["sessoes"] = [_serializar_sessao(s) for s in eventos.listar_sessoes(db, id_evento=id_evento)]
    resposta["perguntas"] = [_serializar_pergunta(p) for p in eventos.listar_perguntas(db, id_evento=id_evento)]
    # v5.5: o contexto do evento — projeto, outras edições, relatórios/documentos aprovados e fotos com autorização de imagem
    resposta.update(publico_contexto.contexto_do_evento(db, evento))
    return resposta


@router.get("/api/publico/eventos/{id_evento}/fotos/{id_foto}", summary="Foto de um evento Público (a autorização de imagem já foi confirmada)")
async def foto_publica_do_evento_endpoint(id_evento: int, id_foto: int, db: Session = Depends(get_db)):
    foto = publico_contexto.foto_publica(db, id_evento, id_foto)
    if foto is None:  # evento inexistente, interno, foto de outro evento ou sem autorização: todos respondem igual
        raise HTTPException(status_code=404, detail="Foto não encontrada.")
    conteudo = await run_in_threadpool(servico_de_fotos.ler_arquivo, foto)
    return Response(content=conteudo, media_type="image/jpeg", headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=300"})


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


@router.post("/api/publico/eventos/{id_evento}/inscrever-se", summary="Inscrever-se publicamente neste evento (site institucional, sem login)")
def inscrever_publicamente_endpoint(id_evento: int, dados: InscricaoPublicaCriar, request: Request, db: Session = Depends(get_db)):
    if dados.pagina_web:
        # Honeypot disparado - finge sucesso, nunca grava nada e nunca avisa o robô que foi pego.
        return {"mensagem": "Inscrição registrada.", "codigo_checkin": None, "email_enviado": False}

    limitar_taxa_por_ip(db, ip=_ip_publico(request), rota="inscrever-se-evento", limite=LIMITE_DE_INSCRICOES_POR_IP, janela_minutos=JANELA_DE_INSCRICOES_MINUTOS)

    resultado = eventos.inscrever_publicamente(
        db, id_evento=id_evento, id_sessao=dados.id_sessao, nome_completo=dados.nome_completo, cpf=dados.cpf,
        email=dados.email, telefone=dados.telefone, respostas=dados.respostas,
        versao_texto_consentimento=dados.versao_texto_consentimento,
        participantes_adicionais=[p.model_dump() for p in dados.participantes_adicionais],
        codigo_cupom=dados.codigo_cupom,
    )
    # usuario=None (mesmo padrão SISTEMA já usado pela tarefa mensal financeira, v3.2.1) - não há
    # login aqui, mas a ação é sensível o bastante (dado pessoal + ocupa vaga) pra sempre deixar
    # rastro auditável, com o IP capturado pro rate limiting servindo de referência de origem. Um
    # registro por participante do grupo (nunca só o principal) - mesma "tratamento individual"
    # já aplicada ao resto da inscrição em grupo.
    for participante in resultado["participantes"]:
        registrar_auditoria(db, None, "inscricoes", "INSCRICAO_PUBLICA", id_registro_afetado=participante["id_inscricao"], ip_origem=_ip_publico(request))
    return {"mensagem": "Inscrição registrada.", **resultado}


@router.post("/api/publico/inscricoes/{token_cancelamento}/cancelar", summary="Autocancelar inscrição pelo link enviado por e-mail (sem login) - libera a vaga e promove o próximo da lista de espera")
def cancelar_inscricao_publica_endpoint(token_cancelamento: str, request: Request, db: Session = Depends(get_db)):
    limitar_taxa_por_ip(db, ip=_ip_publico(request), rota="cancelar-inscricao-evento", limite=10, janela_minutos=10)
    inscricao_cancelada, titulo_reembolso = servico_vagas.cancelar_e_promover_por_token(db, token_cancelamento=token_cancelamento)
    registrar_auditoria(
        db, None, "inscricoes", "CANCELAMENTO_PUBLICO", id_registro_afetado=inscricao_cancelada.id_inscricao,
        dados_depois={"id_titulo_reembolso": titulo_reembolso.id_titulo if titulo_reembolso else None},
        ip_origem=_ip_publico(request),
    )
    return {
        "mensagem": "Inscrição cancelada.", "status": inscricao_cancelada.status,
        "reembolso": {"id_titulo": titulo_reembolso.id_titulo, "valor": titulo_reembolso.valor_original} if titulo_reembolso else None,
    }


@router.post("/api/publico/inscricoes/{token_cancelamento}/confirmar", summary="Confirmar inscrição promovida da lista de espera pelo link enviado por e-mail (sem login)")
def confirmar_inscricao_publica_endpoint(token_cancelamento: str, request: Request, db: Session = Depends(get_db)):
    limitar_taxa_por_ip(db, ip=_ip_publico(request), rota="confirmar-inscricao-evento", limite=10, janela_minutos=10)
    inscricao_confirmada = servico_inscricao.confirmar_por_token(db, token_cancelamento=token_cancelamento)
    registrar_auditoria(db, None, "inscricoes", "CONFIRMACAO_PUBLICA", id_registro_afetado=inscricao_confirmada.id_inscricao, ip_origem=_ip_publico(request))
    return {"mensagem": "Inscrição confirmada.", "status": inscricao_confirmada.status}
