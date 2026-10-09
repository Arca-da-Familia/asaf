"""v5.5a (FASE 5) - a fila única de atendimento: o formulário público do site (contato, pedido de informação sobre recursos públicos, solicitação de titular de
dados da LGPD) e a tela do painel de quem atende (ver app/models/atendimento.py e app/services/atendimento.py)."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.atendimento import ENCERRADO, SITUACOES, TIPOS, Atendimento
from app.models.core import Usuario
from app.schemas.atendimento import AtendimentoEncerrar, AtendimentoPublicoCriar, AtendimentoResponder
from app.security import exigir_permissao
from app.services import atendimento as servico
from app.services.protecao_publica import ip_publico as _ip_publico, limitar_taxa_por_ip

router = APIRouter()
_permissao_da_fila = exigir_permissao(servico.PERMISSAO_DA_FILA)

# o formulário público do site: poucos pedidos por vez por IP (uma família ou uma igreja atrás do mesmo provedor pode mandar vários, por isso a janela é de uma hora)
LIMITE_DE_PEDIDOS_POR_IP = 10
JANELA_DE_PEDIDOS_MINUTOS = 60
POR_PAGINA_PADRAO = 25


@router.get("/api/publico/atendimentos/prazos", summary="Prazo de resposta de cada tipo de pedido, em dias (público)")
def prazos_de_resposta(db: Session = Depends(get_db)):
    return servico.prazos_publicos(db)


@router.post("/api/publico/atendimentos", summary="Enviar um pedido pelo site: contato, pedido de informação ou solicitação de titular (público - sem autenticação)")
def enviar_pedido(dados: AtendimentoPublicoCriar, request: Request, db: Session = Depends(get_db)):
    if dados.pagina_web:
        # armadilha de robô disparada: finge sucesso, não grava nada e não avisa quem foi pego
        return {"mensagem": "Pedido recebido.", "protocolo": None, "prazo_dias": None, "prazo_em": None}

    ip = _ip_publico(request)
    limitar_taxa_por_ip(db, ip=ip, rota="enviar-atendimento", limite=LIMITE_DE_PEDIDOS_POR_IP, janela_minutos=JANELA_DE_PEDIDOS_MINUTOS)
    servico.exigir_aviso_de_privacidade(dados.consentimento_lgpd, dados.versao_texto_consentimento)

    atendimento, novo = servico.registrar_pelo_site(
        db, tipo=dados.tipo, subtipo=dados.subtipo, assunto=dados.assunto, mensagem=dados.mensagem, nome_completo=dados.nome_completo,
        email=dados.email_contato, telefone=dados.telefone_whatsapp, cpf=dados.cpf, versao_do_aviso=dados.versao_texto_consentimento or "",
    )
    if novo:
        registrar_auditoria(db, None, "atendimentos", "ATENDIMENTO_PUBLICO", id_registro_afetado=atendimento.id_atendimento, ip_origem=ip)
    # a resposta é a mesma para um pedido novo e para o mesmo pedido mandado de novo: quem está de fora só recebe o protocolo e o prazo
    return {
        "mensagem": "Pedido recebido.", "protocolo": atendimento.protocolo, "prazo_dias": atendimento.prazo_dias, "prazo_em": atendimento.prazo_em,
    }


# ------------------------------------------------------------------------------------------------ a fila no painel
def _buscar_ou_404(db: Session, id_atendimento: int) -> Atendimento:
    atendimento = db.query(Atendimento).filter(Atendimento.id_atendimento == id_atendimento).first()
    if atendimento is None:
        raise HTTPException(status_code=404, detail="Atendimento não encontrado.")
    return atendimento


def _ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


@router.get("/api/atendimentos/resumo", summary="Resumo da fila: novos, em atendimento, vencidos e que vencem em 3 dias")
def resumo_da_fila(db: Session = Depends(get_db), _usuario=Depends(_permissao_da_fila)):
    return servico.resumo(db)


@router.get("/api/atendimentos/", summary="Listar os atendimentos (fila única), com filtros e paginação")
def listar_atendimentos(
    tipo: Optional[str] = None, situacao: Optional[str] = None, vencidos: bool = False, busca: Optional[str] = None,
    pagina: int = Query(1, ge=1), por_pagina: int = Query(POR_PAGINA_PADRAO, ge=1, le=100),
    db: Session = Depends(get_db), _usuario=Depends(_permissao_da_fila),
):
    if tipo and tipo not in TIPOS:
        raise HTTPException(status_code=400, detail="Tipo de atendimento desconhecido.")
    if situacao and situacao != "abertos" and situacao not in SITUACOES:
        raise HTTPException(status_code=400, detail="Situação desconhecida.")
    consulta = servico.filtrar(db, tipo=tipo, situacao=situacao, vencidos=vencidos, busca=busca)
    total = consulta.count()
    itens = servico.ordenar_para_a_tela(consulta).offset((pagina - 1) * por_pagina).limit(por_pagina).all()
    return {"total": total, "pagina": pagina, "por_pagina": por_pagina, "itens": [servico.serializar(a) for a in itens]}


@router.get("/api/atendimentos/{id_atendimento}", summary="Abrir um atendimento (com os outros pedidos da mesma pessoa)")
def abrir_atendimento(id_atendimento: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_da_fila)):
    atendimento = _buscar_ou_404(db, id_atendimento)
    return {**servico.serializar(atendimento, completo=True), "outros_do_remetente": servico.outros_do_remetente(db, atendimento)}


@router.post("/api/atendimentos/{id_atendimento}/assumir", summary="Assumir o atendimento (passa a ser o responsável e a situação vira Em atendimento)")
def assumir_atendimento(id_atendimento: int, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_da_fila)):
    atendimento = _buscar_ou_404(db, id_atendimento)
    antes = {"status": atendimento.status, "id_responsavel": atendimento.id_responsavel}
    servico.assumir(db, atendimento, usuario)
    registrar_auditoria(
        db, usuario, "atendimentos", "ATENDIMENTO_ASSUMIDO", id_registro_afetado=atendimento.id_atendimento, dados_antes=antes,
        dados_depois={"status": atendimento.status, "id_responsavel": atendimento.id_responsavel}, ip_origem=_ip(request),
    )
    return servico.serializar(atendimento, completo=True)


@router.post("/api/atendimentos/{id_atendimento}/responder", summary="Registrar a resposta (e tentar mandá-la por e-mail)")
def responder_atendimento(id_atendimento: int, dados: AtendimentoResponder, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_da_fila)):
    atendimento = _buscar_ou_404(db, id_atendimento)
    antes = {"status": atendimento.status}
    servico.responder(db, atendimento, usuario, dados.resposta)
    registrar_auditoria(
        db, usuario, "atendimentos", "ATENDIMENTO_RESPONDIDO", id_registro_afetado=atendimento.id_atendimento, dados_antes=antes,
        dados_depois={
            "status": atendimento.status, "situacao_do_prazo": servico.situacao_do_prazo(atendimento), "resposta_enviada_por_email": atendimento.resposta_enviada_por_email,
        },
        ip_origem=_ip(request),
    )
    return servico.serializar(atendimento, completo=True)


@router.post("/api/atendimentos/{id_atendimento}/encerrar", summary="Encerrar o atendimento, com o motivo")
def encerrar_atendimento(id_atendimento: int, dados: AtendimentoEncerrar, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_da_fila)):
    atendimento = _buscar_ou_404(db, id_atendimento)
    antes = {"status": atendimento.status}
    servico.encerrar(db, atendimento, usuario, dados.motivo)
    registrar_auditoria(
        db, usuario, "atendimentos", "ATENDIMENTO_ENCERRADO", id_registro_afetado=atendimento.id_atendimento, dados_antes=antes,
        dados_depois={"status": ENCERRADO, "motivo": atendimento.motivo_encerramento}, ip_origem=_ip(request),
    )
    return servico.serializar(atendimento, completo=True)
