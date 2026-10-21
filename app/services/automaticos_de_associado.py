"""v6.2d (FASE 6) - as comunicações automáticas do ciclo do associado (pendências da v1.2): as boas-vindas a quem teve a filiação aprovada e o aviso à secretaria quando acaba o
período de experiência.

O que este módulo garante:
  - as boas-vindas vão por e-mail ao endereço do cadastro na hora da aprovação (melhor esforço: e-mail que falha nunca desfaz a aprovação), com a matrícula e o fim do período de
    experiência; a Auditoria guarda o resultado (enviado, sem e-mail no cadastro, falhou, sem servidor de e-mail), nunca o endereço, e o log da API também não; é resposta da
    associação a um pedido da pessoa (a filiação), não comunicação que se desliga;
  - quando a secretaria libera o acesso ao painel, o sino do novo usuário dá as boas-vindas ao painel;
  - a rotina periódica acha quem estava "Em Experiência" e cujo período já acabou e recalcula a situação (em dia ou inadimplente, pelo financeiro); a saída de "Em Experiência"
    com o prazo vencido avisa no sino quem tem a permissão `associados` (pelo nível ou pelo cargo) no MESMO commit da situação nova (ver `recalcular_categoria_associado`), venha
    da rotina ou de um lançamento financeiro; é uma vez por pessoa, porque depois dela a pessoa não está mais "Em Experiência"."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.models.associados import Associado
from app.models.core import Usuario
from app.services import comunicacao, envio_de_avisos, notificacoes, notificacoes_painel
from app.services.categoria_associado import EM_EXPERIENCIA, recalcular_categoria_associado
from app.services.fuso import dia_em_belem

LOG = logging.getLogger("asaf.automaticos_de_associado")

ENVIADO, SEM_EMAIL, FALHOU, SEM_SERVIDOR = "enviado", "sem_email", "falhou", "sem_servidor_de_email"


def texto_de_boas_vindas(associado: Associado) -> tuple[str, str]:
    partes = [
        comunicacao.personalizar("Olá, {primeiro_nome}!", associado.nome_completo),
        "",
        f"A sua filiação à ASAF foi aprovada. Seja bem-vindo(a)! A sua matrícula é a nº {associado.numero_matricula}.",
    ]
    if associado.data_fim_experiencia:
        partes.append(f"Até {dia_em_belem(associado.data_fim_experiencia)} você está no período de experiência de novo associado.")
    partes += [
        "",
        "Para entrar no painel do associado (avisos, assembleias, seus dados), peça à secretaria da ASAF a liberação do seu acesso.",
        "",
        "Este e-mail foi enviado pela ASAF (asaf.org.br). Responda a este e-mail se precisar falar com a associação.",
    ]
    return "Bem-vindo(a) à ASAF", "\n".join(partes)


def enviar_boas_vindas(db: Session, associado: Associado, usuario: Optional[Usuario], ip: Optional[str] = None) -> str:
    """Tenta o e-mail de boas-vindas e registra na Auditoria o resultado (sem o endereço). Nunca levanta erro."""
    email = comunicacao.email_valido(associado.email_contato)  # endereço que o servidor não aceitaria (ex.: com acento) conta como sem e-mail
    if not email:
        resultado = SEM_EMAIL
    elif not notificacoes.smtp_configurado():
        resultado = SEM_SERVIDOR
    else:
        assunto, corpo = texto_de_boas_vindas(associado)
        try:
            notificacoes.enviar_email(email, assunto, corpo)
            resultado = ENVIADO
        except Exception as erro:  # noqa: BLE001 - e-mail que falha nunca desfaz a aprovação; o resultado fica registrado
            # o motivo legível, sem o endereço (o texto da recusa do servidor traz o destinatário)
            LOG.warning("o e-mail de boas-vindas do associado %s não saiu: %s", associado.id_associado, envio_de_avisos.motivo_legivel(erro, envio_de_avisos.classificar(erro)))
            resultado = FALHOU
    registrar_auditoria(
        db, usuario, "associados", "BOAS_VINDAS_ENVIADAS", id_registro_afetado=associado.id_associado, dados_depois={"email": resultado}, ip_origem=ip,
    )
    return resultado


def boas_vindas_no_sino(db: Session, id_usuario: int) -> None:
    """Quando a secretaria libera o acesso: o primeiro aviso do sino é o de boas-vindas (vale também para o associado antigo que só agora ganhou acesso). Não faz commit."""
    notificacoes_painel.notificar(
        db, [id_usuario], tipo="boas_vindas", titulo="Bem-vindo(a) ao painel da ASAF",
        texto="O seu acesso ao painel está liberado. Aqui você vê os avisos da associação, as assembleias e os seus dados.", link="/meus-avisos",
    )


def _quem_cuida_de_associados(db: Session) -> list[int]:
    from app.security import usuario_tem_permissao

    return [u.id_usuario for u in db.query(Usuario).filter(Usuario.ativo.is_(True)).all() if usuario_tem_permissao(db, u, "associados")]


def avisar_no_sino_o_fim_da_experiencia(db: Session, associado: Associado, nova: str) -> None:
    """Chamado por `recalcular_categoria_associado` ao tirar alguém de "Em Experiência" com o prazo vencido, ANTES do commit da situação nova (os dois vão juntos). Não faz commit."""
    notificacoes_painel.notificar(
        db, _quem_cuida_de_associados(db), tipo="fim_de_experiencia",
        titulo=f"Fim do período de experiência: matrícula nº {associado.numero_matricula}",
        texto=f"{associado.nome_completo or 'O associado'} terminou o período de experiência em {dia_em_belem(associado.data_fim_experiencia)}; a situação agora é: {nova}.",
        link=f"/associados/{associado.id_associado}",
    )


def avisar_fim_de_experiencia(db: Session) -> dict:
    """A rodada: quem está "Em Experiência" com o período já acabado tem a situação recalculada (e o aviso no sino sai junto, ver `recalcular_categoria_associado`)."""
    agora = datetime.utcnow()  # o mesmo relógio do cálculo da situação (categoria_associado)
    acabaram = (
        db.query(Associado.id_associado)
        .filter(Associado.status_arrolamento == EM_EXPERIENCIA, Associado.data_fim_experiencia.isnot(None), Associado.data_fim_experiencia <= agora)
        .order_by(Associado.id_associado).all()
    )
    avisados = 0
    for (id_associado,) in acabaram:
        if recalcular_categoria_associado(db, id_associado) != EM_EXPERIENCIA:
            avisados += 1
    return {"fim_de_experiencia": avisados}
