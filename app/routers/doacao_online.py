"""v5.6a (FASE 5) - doar pelo site com Pix estático e confirmação manual da tesouraria: a página pública (campanhas, código Pix, intenção identificada) e a tela do painel de quem
confere o extrato e confirma (ver app/models/intencoes_de_doacao.py e app/services/doacao_online.py)."""
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.core import Usuario
from app.models.intencoes_de_doacao import CONFIRMADA, SITUACOES, IntencaoDeDoacao
from app.schemas.doacao_online import ConfirmarIntencaoDeDoacao, IntencaoDeDoacaoCriar, IntencaoNaoLocalizada, validar_valor_da_doacao
from app.security import exigir_permissao
from app.services import doacao_online as servico
from app.services.protecao_publica import ip_publico as _ip_publico, limitar_taxa_por_ip

router = APIRouter()
_permissao_da_tesouraria = exigir_permissao(servico.PERMISSAO_DA_TESOURARIA)

# o formulário público: poucos pedidos por IP e hora (uma igreja atrás do mesmo provedor pode mandar vários)
LIMITE_DE_INTENCOES_POR_IP = 10
JANELA_DE_INTENCOES_MINUTOS = 60
POR_PAGINA_PADRAO = 25


@router.get("/api/publico/doacao", summary="Dados para doar pelo site: o Pix da associação e as campanhas em andamento, com meta e quanto já foi recebido (público)")
def dados_da_doacao(db: Session = Depends(get_db)):
    pix = servico.dados_do_pix(db)
    return {
        "pix_disponivel": pix is not None,
        "chave_pix": pix["chave"] if pix else None, "beneficiario": pix["beneficiario"] if pix else None, "cidade": pix["cidade"] if pix else None,
        "campanhas": servico.campanhas_publicas(db),
        "versao_aviso_de_privacidade": servico.VERSAO_AVISO_DE_PRIVACIDADE_DOACAO, "dias_de_validade_do_pedido": servico.dias_para_expirar(db),
    }


@router.get("/api/publico/doacao/pix", summary="Código Pix (copia e cola) para doar SEM se identificar, livre ou com valor, para a associação ou para uma campanha (público)")
def pix_da_doacao_anonima(valor: Optional[Decimal] = None, id_campanha: Optional[int] = None, db: Session = Depends(get_db)):
    pix = servico.exigir_pix(db)
    try:
        valor = validar_valor_da_doacao(valor, obrigatorio=False)
    except ValueError as erro:
        raise HTTPException(status_code=400, detail=str(erro))
    if id_campanha is not None:
        servico.campanha_que_recebe(db, id_campanha)
    return {
        "copia_e_cola": servico.copia_e_cola(pix, valor=valor, txid=f"ASAFCAMP{id_campanha}" if id_campanha is not None else "ASAFDOACAO"),
        "valor": valor, "id_campanha": id_campanha, "chave_pix": pix["chave"], "beneficiario": pix["beneficiario"], "cidade": pix["cidade"],
    }


@router.post("/api/publico/doacoes/intencoes", summary="Doar pelo site SE IDENTIFICANDO: protocolo e código Pix; a doação só é registrada quando a tesouraria confirmar (público - sem autenticação)")
def enviar_intencao(dados: IntencaoDeDoacaoCriar, request: Request, db: Session = Depends(get_db)):
    if dados.pagina_web:
        # armadilha de robô disparada: finge sucesso, não grava nada e não avisa quem foi pego
        return {"mensagem": "Pedido recebido.", "protocolo": None, "valor": None, "copia_e_cola": None, "expira_em": None}

    ip = _ip_publico(request)
    limitar_taxa_por_ip(db, ip=ip, rota="enviar-intencao-doacao", limite=LIMITE_DE_INTENCOES_POR_IP, janela_minutos=JANELA_DE_INTENCOES_MINUTOS)
    pix = servico.exigir_pix(db)
    servico.exigir_aviso_de_privacidade(dados.consentimento_lgpd, dados.versao_texto_consentimento)

    intencao, nova = servico.registrar_intencao(
        db, nome_completo=dados.nome_completo, email=dados.email, cpf=dados.cpf, valor=dados.valor, id_campanha=dados.id_campanha,
        versao_do_aviso=dados.versao_texto_consentimento or "",
    )
    if nova:
        registrar_auditoria(db, None, "intencoes_de_doacao", "INTENCAO_DOACAO_PUBLICA", id_registro_afetado=intencao.id_intencao, ip_origem=ip)
        servico.confirmar_recebimento_por_email(intencao, pix)
    # a resposta é a mesma para uma intenção nova e para a mesma mandada de novo: o protocolo, o valor e o código do Pix
    return {
        "mensagem": "Pedido recebido.", "protocolo": intencao.protocolo, "valor": intencao.valor_informado, "id_campanha": intencao.id_campanha,
        "copia_e_cola": servico.copia_e_cola(pix, valor=intencao.valor_informado, txid=servico.txid_da_intencao(intencao)),
        "chave_pix": pix["chave"], "beneficiario": pix["beneficiario"], "cidade": pix["cidade"], "expira_em": intencao.expira_em,
    }


# ------------------------------------------------------------------------------------------------ a conferência no painel
def _buscar_ou_404(db: Session, id_intencao: int, travar: bool = False) -> IntencaoDeDoacao:
    consulta = db.query(IntencaoDeDoacao).filter(IntencaoDeDoacao.id_intencao == id_intencao)
    if travar:
        consulta = consulta.with_for_update()  # dois cliques (ou duas pessoas) confirmando a mesma: a segunda espera e vê que já foi
    intencao = consulta.first()
    if intencao is None:
        raise HTTPException(status_code=404, detail="Doação a conferir não encontrada.")
    return intencao


def _ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


@router.get("/api/intencoes-doacao/resumo", summary="Resumo da conferência: quantas esperam, venceram, não foram localizadas e foram confirmadas")
def resumo_da_conferencia(db: Session = Depends(get_db), _usuario=Depends(_permissao_da_tesouraria)):
    return servico.resumo(db)


@router.get("/api/intencoes-doacao/", summary="Listar as doações feitas pelo site que esperam conferência no extrato (com filtro e paginação)")
def listar_intencoes(
    situacao: Optional[str] = None, busca: Optional[str] = None, pagina: int = Query(1, ge=1), por_pagina: int = Query(POR_PAGINA_PADRAO, ge=1, le=100),
    db: Session = Depends(get_db), _usuario=Depends(_permissao_da_tesouraria),
):
    if situacao and situacao != "a_conferir" and situacao not in SITUACOES:
        raise HTTPException(status_code=400, detail="Situação desconhecida.")
    consulta = servico.filtrar(db, situacao=situacao, busca=busca)
    total = consulta.count()
    itens = servico.ordenar_para_a_tela(consulta).offset((pagina - 1) * por_pagina).limit(por_pagina).all()
    return {"total": total, "pagina": pagina, "por_pagina": por_pagina, "itens": servico.serializar_lista(db, itens)}


@router.post("/api/intencoes-doacao/{id_intencao}/confirmar", summary="Confirmar que o Pix chegou: registra a doação (com o valor RECEBIDO), emite o recibo numerado e o manda por e-mail")
def confirmar_intencao(id_intencao: int, dados: ConfirmarIntencaoDeDoacao, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_da_tesouraria)):
    intencao = _buscar_ou_404(db, id_intencao, travar=True)
    antes = {"status": intencao.status, "valor_informado": str(intencao.valor_informado) if intencao.valor_informado is not None else None}
    doacao = servico.confirmar(
        db, intencao, usuario, valor_recebido=dados.valor_recebido, id_conta_contabil=dados.id_conta_contabil, id_conta_contabil_caixa=dados.id_conta_contabil_caixa,
        id_centro_custo_destinacao=dados.id_centro_custo_destinacao,
    )
    registrar_auditoria(
        db, usuario, "intencoes_de_doacao", "INTENCAO_DOACAO_CONFIRMADA", id_registro_afetado=intencao.id_intencao, dados_antes=antes,
        dados_depois={
            "status": CONFIRMADA, "id_doacao": doacao.id_doacao, "numero_recibo": doacao.numero_recibo, "valor_recebido": str(doacao.valor),
            "recibo_enviado_por_email": intencao.recibo_enviado_por_email,
        },
        ip_origem=_ip(request),
    )
    return {
        "mensagem": "Doação confirmada e recibo emitido.", "id_doacao": doacao.id_doacao, "numero_recibo": doacao.numero_recibo,
        "recibo_enviado_por_email": intencao.recibo_enviado_por_email, **servico.serializar_lista(db, [intencao])[0],
    }


@router.post("/api/intencoes-doacao/{id_intencao}/nao-localizada", summary="Marcar que o Pix não foi localizado no extrato (nada é apagado; se o dinheiro chegar depois, ainda dá para confirmar)")
def marcar_nao_localizada(id_intencao: int, dados: IntencaoNaoLocalizada, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_da_tesouraria)):
    intencao = _buscar_ou_404(db, id_intencao, travar=True)
    antes = {"status": intencao.status}
    servico.marcar_nao_localizada(db, intencao, usuario, dados.observacao)
    registrar_auditoria(
        db, usuario, "intencoes_de_doacao", "INTENCAO_DOACAO_NAO_LOCALIZADA", id_registro_afetado=intencao.id_intencao, dados_antes=antes,
        dados_depois={"status": intencao.status, "observacao": intencao.observacao}, ip_origem=_ip(request),
    )
    return servico.serializar_lista(db, [intencao])[0]
