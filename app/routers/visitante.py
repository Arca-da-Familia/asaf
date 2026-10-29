"""v5.6b (FASE 5) - conta de visitante: entrar com o e-mail e um código de uso único (sem senha) e consultar, numa área só, as inscrições em eventos, os certificados e as doações feitas pelo
site (ver app/models/conta_de_visitante.py e app/services/conta_de_visitante.py).

`/api/publico/visitante/...` é aberto (pedir o código e entrar); `/api/visitante/...` exige a sessão do visitante (cabeçalho `Authorization: Bearer <código da sessão>`), que NÃO vale para nenhuma
rota do painel: a sessão do visitante não é um token de usuário e o painel nunca a aceita."""
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.conta_de_visitante import SessaoDeVisitante
from app.schemas.conta_de_visitante import EntrarComCodigo, PedirCodigoDeVisitante
from app.services import atendimento as atendimentos
from app.services import conta_de_visitante as servico
from app.services.protecao_publica import ip_publico as _ip_publico


def sessao_do_visitante(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)) -> SessaoDeVisitante:
    partes = (authorization or "").split(" ", 1)
    token = partes[1].strip() if len(partes) == 2 and partes[0].lower() == "bearer" else None
    return servico.sessao_valida(db, token)


router = APIRouter()


@router.post("/api/publico/visitante/codigo", summary="Pedir o código de acesso da área do visitante por e-mail (público - a resposta é a mesma exista ou não algo ligado ao e-mail)")
def pedir_codigo(dados: PedirCodigoDeVisitante, request: Request, tarefas: BackgroundTasks, db: Session = Depends(get_db)):
    resposta = {"mensagem": servico.MENSAGEM_DO_PEDIDO, "minutos_de_validade": servico.MINUTOS_DE_VALIDADE_DO_CODIGO}
    if dados.pagina_web:
        # armadilha de robô disparada: finge sucesso e não faz nada
        return resposta
    codigo = servico.pedir_codigo(db, email=dados.email, ip=_ip_publico(request))
    if codigo is not None:
        # o envio vai para depois da resposta: a demora do e-mail não mostra a quem está de fora que havia algo ligado ao endereço
        tarefas.add_task(servico.enviar_codigo_por_email, servico.normalizar_email(dados.email), codigo)
        if servico.codigo_de_teste_na_resposta():
            resposta["codigo_de_teste"] = codigo
    return resposta


@router.post("/api/publico/visitante/entrar", summary="Entrar na área do visitante com o e-mail e o código recebido (público)")
def entrar(dados: EntrarComCodigo, request: Request, db: Session = Depends(get_db)):
    ip = _ip_publico(request)
    token, expira_em = servico.entrar(db, email=dados.email, codigo=dados.codigo, ip=ip)
    registrar_auditoria(db, None, "sessoes_de_visitante", "VISITANTE_ENTROU", ip_origem=ip)
    return {"token": token, "expira_em": expira_em}


@router.get("/api/visitante/minha-conta", summary="O que está ligado ao meu e-mail: inscrições em eventos, certificados e doações pelo site (sessão do visitante)")
def minha_conta(sessao: SessaoDeVisitante = Depends(sessao_do_visitante), db: Session = Depends(get_db)):
    return servico.minha_conta(db, sessao)


@router.get("/api/visitante/pedidos/{protocolo}/relatorio", summary="v7.2c - baixar o relatório dos meus dados liberado pelo encarregado: PDF ou o arquivo da "
            "portabilidade (JSON), por 15 dias (sessão do visitante)")
def baixar_relatorio(protocolo: str, request: Request, formato: str = "pdf", sessao: SessaoDeVisitante = Depends(sessao_do_visitante),
                     db: Session = Depends(get_db)):
    from app.services import entrega_ao_titular

    if formato not in entrega_ao_titular.FORMATOS:
        raise HTTPException(status_code=400, detail="Formato desconhecido.")
    pedido = servico.pedido_do_titular_do_email(db, sessao.email, protocolo)
    entrega = entrega_ao_titular.vigente(db, pedido) if pedido is not None and pedido.identidade_validada_em is not None else None
    if entrega is None:
        # pedido de outro e-mail, sem relatório liberado ou já vencido: a mesma resposta (não diz se o protocolo existe)
        raise HTTPException(status_code=404, detail="Não há relatório disponível para este pedido. Se o prazo de 15 dias acabou, faça um novo pedido.")
    if formato == "pdf":
        conteudo, tipo, nome = entrega_ao_titular.pdf(entrega, pedido), "application/pdf", f"meus-dados-asaf-{pedido.protocolo}.pdf"
    else:
        conteudo, tipo, nome = entrega_ao_titular.arquivo_de_portabilidade(entrega, pedido), "application/json", f"meus-dados-asaf-{pedido.protocolo}.json"
    # a leitura do relatório (pode ter dado sensível) fica na Auditoria: classificacao_de_dados.DOWNLOAD_RELATORIO_DO_TITULAR
    registrar_auditoria(db, None, "atendimentos", "DOWNLOAD_RELATORIO_DO_TITULAR", id_registro_afetado=pedido.id_atendimento,
                        dados_depois={"id_entrega": entrega.id_entrega, "formato": formato}, ip_origem=_ip_publico(request))
    return Response(content=conteudo, media_type=tipo, headers={
        "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "Content-Disposition": f'attachment; filename="{nome}"',
    })


@router.post("/api/visitante/sair", summary="Encerrar a sessão do visitante (sessão do visitante)")
def sair(sessao: SessaoDeVisitante = Depends(sessao_do_visitante), db: Session = Depends(get_db)):
    servico.sair(db, sessao)
    return {"mensagem": "Sessão encerrada."}


@router.post("/api/visitante/pedir-apagamento", summary="Pedir a eliminação dos meus dados: abre um pedido de titular na fila de atendimento (sessão do visitante)")
def pedir_apagamento(request: Request, sessao: SessaoDeVisitante = Depends(sessao_do_visitante), db: Session = Depends(get_db)):
    atendimento, novo = servico.pedir_apagamento(db, sessao)
    if novo:
        registrar_auditoria(
            db, None, "atendimentos", "VISITANTE_PEDIU_APAGAMENTO", id_registro_afetado=atendimento.id_atendimento, dados_depois={"identidade": atendimento.identidade_validacao},
            ip_origem=_ip_publico(request),
        )
        atendimentos.confirmar_recebimento_por_email(atendimento)
    return {"mensagem": "Pedido recebido.", "protocolo": atendimento.protocolo, "prazo_dias": atendimento.prazo_dias, "prazo_em": atendimento.prazo_em, "ja_existia": not novo}
