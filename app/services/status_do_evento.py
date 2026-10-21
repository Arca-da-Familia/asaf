"""v5.5d (FASE 5) - Status do evento: Programado / Adiado / Cancelado / Realizado, com motivo.

Antes, o único jeito de "tirar" um evento do ar era voltá-lo para Interna: o site não dizia que ele foi cancelado, quem já estava inscrito não sabia, e a fila de espera continuava
andando. Agora o status é um fato do evento, com motivo, e os outros módulos o respeitam: evento cancelado, adiado ou realizado não recebe inscrição nova; a vaga que abre não
promove ninguém da lista de espera; a portaria não faz check-in; o site mostra a situação e o motivo (e o Google recebe o `eventStatus` certo); quem estava inscrito recebe e-mail.

Este módulo não importa `app.services.eventos` (que importa este): trabalha direto nos modelos."""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.config_cache import obter_configuracao
from app.models.eventos import (
    STATUS_DO_EVENTO,
    STATUS_EVENTO_ADIADO,
    STATUS_EVENTO_CANCELADO,
    STATUS_EVENTO_PROGRAMADO,
    STATUS_EVENTO_REALIZADO,
    Evento,
    SessaoEvento,
)
from app.models.motores import CONFIRMADO, LISTA_DE_ESPERA, PRE_INSCRITO, Inscricao
from app.models.pessoas import Pessoa
from app.models.preferencias_de_comunicacao import EVENTOS
from app.services import notificacoes, preferencias_de_comunicacao
from app.services.fuso import ROTULO_DO_FUSO, dia_e_hora_em_belem
from app.services.documentos_verificacao import exigir_texto_sem_dado_pessoal
from app.services.site_publico import url_base_do_site

TAMANHO_MINIMO_DO_MOTIVO = 5

# De onde cada situação pode ir. `Programado -> Programado` só existe como remarcação (com data nova); `Realizado` não volta atrás.
_TRANSICOES = {
    STATUS_EVENTO_PROGRAMADO: {STATUS_EVENTO_ADIADO, STATUS_EVENTO_CANCELADO, STATUS_EVENTO_REALIZADO, STATUS_EVENTO_PROGRAMADO},
    STATUS_EVENTO_ADIADO: {STATUS_EVENTO_PROGRAMADO, STATUS_EVENTO_CANCELADO},
    STATUS_EVENTO_CANCELADO: {STATUS_EVENTO_PROGRAMADO},
    STATUS_EVENTO_REALIZADO: set(),
}

_RECUSA_DE_INSCRICAO = {
    STATUS_EVENTO_CANCELADO: "Este evento foi cancelado: não recebe inscrições.",
    STATUS_EVENTO_ADIADO: "Este evento foi adiado: as inscrições reabrem quando a nova data for definida.",
    STATUS_EVENTO_REALIZADO: "Este evento já foi realizado: as inscrições estão encerradas.",
}


def exigir_evento_aceita_inscricao(evento: Evento) -> None:
    """Cancelado, adiado e realizado não recebem inscrição nova (por nenhuma porta: site, associado, secretaria)."""
    recusa = _RECUSA_DE_INSCRICAO.get(evento.status)
    if recusa:
        raise HTTPException(status_code=400, detail=recusa)


def exigir_evento_aceita_checkin(evento: Evento) -> None:
    """Na portaria, evento cancelado ou adiado não tem entrada. Realizado ainda aceita (a secretaria lança presença depois do evento)."""
    if evento.status == STATUS_EVENTO_CANCELADO:
        raise HTTPException(status_code=400, detail="Este evento foi cancelado: não há check-in.")
    if evento.status == STATUS_EVENTO_ADIADO:
        raise HTTPException(status_code=400, detail="Este evento foi adiado: não há check-in enquanto a nova data não for definida.")


def evento_do_contexto(db: Session, contexto_tipo: str, id_contexto: int) -> Optional[Evento]:
    """O evento a que uma inscrição pertence (direto ou pela sessão); `None` se o contexto não é de evento."""
    if contexto_tipo == "Evento":
        return db.query(Evento).filter(Evento.id_evento == id_contexto).first()
    if contexto_tipo == "SessaoEvento":
        sessao = db.query(SessaoEvento).filter(SessaoEvento.id_sessao == id_contexto).first()
        return db.query(Evento).filter(Evento.id_evento == sessao.id_evento).first() if sessao else None
    return None


def evento_em_andamento_normal(db: Session, contexto_tipo: str, id_contexto: int) -> bool:
    """Falso só quando o contexto é de um evento que NÃO está Programado (cancelado, adiado, realizado): aí a fila de espera não anda e o prazo de confirmação não vence."""
    evento = evento_do_contexto(db, contexto_tipo, id_contexto)
    return evento is None or evento.status == STATUS_EVENTO_PROGRAMADO


def sem_fuso(momento: Optional[datetime]) -> Optional[datetime]:
    """Os instantes ficam em UTC sem fuso: o que chega com fuso (o painel manda com "Z") é trazido para UTC antes de comparar."""
    if momento is None:
        return None
    return momento.astimezone(timezone.utc).replace(tzinfo=None) if momento.tzinfo else momento


def _inscricoes_do_evento(db: Session, evento: Evento, status: tuple) -> list:
    ids_sessoes = [i for (i,) in db.query(SessaoEvento.id_sessao).filter(SessaoEvento.id_evento == evento.id_evento).all()]
    consulta = db.query(Inscricao).filter(Inscricao.status.in_(status))
    de_evento = (Inscricao.contexto_tipo == "Evento") & (Inscricao.id_contexto == evento.id_evento)
    if ids_sessoes:
        de_sessao = (Inscricao.contexto_tipo == "SessaoEvento") & (Inscricao.id_contexto.in_(ids_sessoes))
        return consulta.filter(de_evento | de_sessao).all()
    return consulta.filter(de_evento).all()


def tem_inscritos_ativos(db: Session, evento: Evento) -> bool:
    """Alguém inscrito (ou na lista de espera) que precisaria saber de uma mudança no evento."""
    return bool(_inscricoes_do_evento(db, evento, (PRE_INSCRITO, CONFIRMADO, LISTA_DE_ESPERA)))


def _formatar(momento: datetime) -> str:
    """A hora que o sistema guarda é UTC: o e-mail mostra a de Belém, dizendo qual é."""
    return f"{dia_e_hora_em_belem(momento)} ({ROTULO_DO_FUSO})"


def _texto_do_aviso(db: Session, evento: Evento, *, situacao_nova: str, motivo: Optional[str], inicio_anterior: Optional[datetime]) -> tuple:
    """(assunto, corpo) do e-mail de quem estava inscrito. Só afirma o que o sistema faz: a inscrição NÃO é cancelada pelo sistema."""
    pagina = f"\n\nA página do evento: {url_base_do_site(db)}/eventos/{evento.id_evento}/" if evento.visibilidade == "Pública" else ""
    linha_do_motivo = f"\nMotivo: {motivo}" if motivo else ""
    if situacao_nova == STATUS_EVENTO_CANCELADO:
        # evento com cobrança: quem pagou e cancela a inscrição pelo link do e-mail de confirmação recebe o valor INTEIRO (o sistema registra a devolução; a secretaria faz o pagamento)
        devolucao = (
            "\n\nSe você pagou a inscrição, cancele-a pelo link do e-mail de confirmação: o sistema registra a devolução do valor inteiro e a secretaria faz o pagamento."
            if evento.valor_base is not None
            else ""
        )
        return (
            f"Evento cancelado - {evento.titulo}",
            f"Aviso importante sobre o evento \"{evento.titulo}\":\n\nO evento foi CANCELADO.{linha_do_motivo}{devolucao}{pagina}",
        )
    if situacao_nova == STATUS_EVENTO_ADIADO:
        return (
            f"Evento adiado - {evento.titulo}",
            f"Aviso importante sobre o evento \"{evento.titulo}\":\n\nO evento foi ADIADO e a nova data ainda não foi definida.{linha_do_motivo}\n\n"
            f"Sua inscrição (ou o seu lugar na lista de espera) continua registrada. Quando a nova data for definida, a ASAF enviará um novo aviso por e-mail (a menos que você desligue esses avisos).{pagina}",
        )
    if inicio_anterior is not None and inicio_anterior != evento.data_hora_inicio:
        return (
            f"Evento remarcado - {evento.titulo}",
            f"Aviso importante sobre o evento \"{evento.titulo}\":\n\nO evento foi REMARCADO para {_formatar(evento.data_hora_inicio)} (a data anterior era {_formatar(inicio_anterior)}).{linha_do_motivo}\n\n"
            f"Sua inscrição (ou o seu lugar na lista de espera) continua registrada. Se você não puder ir na nova data, cancele pelo link do e-mail de confirmação da inscrição.{pagina}",
        )
    return (
        f"Evento mantido - {evento.titulo}",
        f"Aviso sobre o evento \"{evento.titulo}\":\n\nO evento voltou a estar programado para {_formatar(evento.data_hora_inicio)}.{linha_do_motivo}\n\n"
        f"Sua inscrição (ou o seu lugar na lista de espera) continua registrada.{pagina}",
    )


def _avisar_inscritos(db: Session, evento: Evento, *, situacao_nova: str, motivo: Optional[str], inicio_anterior: Optional[datetime]) -> dict:
    """Um e-mail por endereço (uma família inscrita junta recebe um só), em melhor esforço: e-mail que falha nunca desfaz a mudança de status. O resultado conta o que aconteceu de
    verdade (a secretaria vê no painel quantos avisos saíram e quantos inscritos ficaram sem e-mail)."""
    inscricoes = _inscricoes_do_evento(db, evento, (PRE_INSCRITO, CONFIRMADO, LISTA_DE_ESPERA))
    ids_pessoas = {i.id_pessoa for i in inscricoes}
    emails_por_pessoa = {
        id_pessoa: (email or "").strip().lower()
        for id_pessoa, email in db.query(Pessoa.id_pessoa, Pessoa.email_contato).filter(Pessoa.id_pessoa.in_(ids_pessoas)).all()
    } if ids_pessoas else {}
    sem_email = sum(1 for i in inscricoes if not emails_por_pessoa.get(i.id_pessoa))
    # v6.2b: o e-mail vai UMA vez por endereço; por isso a escolha vale para o endereço: se alguém que usa aquele endereço desligou os avisos de evento (pelo link
    # do e-mail ou no Meu Perfil), o endereço não recebe (senão quem desligou continuaria recebendo pelo link de outra pessoa da família)
    com_email = {i for i in ids_pessoas if emails_por_pessoa.get(i)}
    desligaram = preferencias_de_comunicacao.quem_nao_recebe(db, com_email, EVENTOS)
    enderecos_desligados = {emails_por_pessoa[i] for i in desligaram}
    pessoa_do_endereco: dict[str, int] = {}
    for id_pessoa in sorted(com_email):
        email = emails_por_pessoa[id_pessoa]
        if email not in enderecos_desligados:
            pessoa_do_endereco.setdefault(email, id_pessoa)
    destinatarios = sorted(pessoa_do_endereco)
    assunto, corpo = _texto_do_aviso(db, evento, situacao_nova=situacao_nova, motivo=motivo, inicio_anterior=inicio_anterior)
    enviados = 0
    for destinatario in destinatarios:
        rodape, cabecalhos = preferencias_de_comunicacao.rodape(db, pessoa_do_endereco[destinatario], EVENTOS)
        try:
            notificacoes.enviar_email(destinatario, assunto=assunto, corpo_texto=corpo + rodape, cabecalhos=cabecalhos)
            enviados += 1
        except Exception:
            pass  # SMTP fora do ar ou não configurado (a homologação não tem): a mudança de status já está gravada
    return {
        "inscricoes_a_avisar": len(inscricoes), "avisos_enviados": enviados, "inscritos_sem_email": sem_email, "enderecos": len(destinatarios),
        "enderecos_que_desligaram": len(enderecos_desligados),
    }


def _inscricoes_com_cobranca(db: Session, evento: Evento) -> int:
    ativas = _inscricoes_do_evento(db, evento, (PRE_INSCRITO, CONFIRMADO, LISTA_DE_ESPERA, "Presente", "Ausente"))
    return sum(1 for i in ativas if i.id_titulo_cobranca)


def alterar_status(
    db: Session, evento: Evento, *, novo_status: str, motivo: Optional[str],
    nova_data_hora_inicio: Optional[datetime] = None, nova_data_hora_fim: Optional[datetime] = None, agora: Optional[datetime] = None,
) -> dict:
    """Muda a situação do evento e devolve `{"antes", "depois", "avisos", "inscricoes_com_cobranca", "sessoes_deslocadas"}` (a rota grava na Auditoria). Cancelar e adiar exigem
    motivo; realizado só depois de o evento começar; voltar a Programado (reativar, retomar ou remarcar) só pede data nova quando a data do evento já passou, e a programação (sessões)
    acompanha a data nova."""
    agora = agora or datetime.utcnow()
    if novo_status not in STATUS_DO_EVENTO:
        raise HTTPException(status_code=422, detail=f"Situação inválida: use uma de {', '.join(STATUS_DO_EVENTO)}.")
    atual = evento.status or STATUS_EVENTO_PROGRAMADO
    nova_inicio, nova_fim = sem_fuso(nova_data_hora_inicio), sem_fuso(nova_data_hora_fim)
    motivo = (motivo or "").strip() or None
    antes = {"status": atual, "motivo_status": evento.motivo_status, "data_hora_inicio": evento.data_hora_inicio}

    if novo_status == atual and not (novo_status == STATUS_EVENTO_PROGRAMADO and nova_inicio is not None):
        raise HTTPException(status_code=400, detail=f"O evento já está {atual.lower()}.")
    if novo_status not in _TRANSICOES.get(atual, set()):
        if atual == STATUS_EVENTO_REALIZADO:
            raise HTTPException(status_code=400, detail="Um evento realizado não volta atrás: para outra edição, crie uma nova edição do evento.")
        raise HTTPException(status_code=400, detail=f"Um evento {atual.lower()} não pode passar para {novo_status.lower()}.")
    if (nova_inicio is not None or nova_fim is not None) and novo_status != STATUS_EVENTO_PROGRAMADO:
        raise HTTPException(status_code=422, detail="A data nova só vale ao voltar o evento para Programado (remarcar).")
    if nova_fim is not None and nova_inicio is None:
        raise HTTPException(status_code=422, detail="Informe também o começo da nova data.")

    if novo_status in (STATUS_EVENTO_CANCELADO, STATUS_EVENTO_ADIADO):
        if motivo is None or len(motivo) < TAMANHO_MINIMO_DO_MOTIVO:
            raise HTTPException(status_code=422, detail=f"Diga o motivo ({'cancelamento' if novo_status == STATUS_EVENTO_CANCELADO else 'adiamento'}): pelo menos {TAMANHO_MINIMO_DO_MOTIVO} letras. Ele aparece no site.")
    if motivo is not None and evento.visibilidade == "Pública":
        exigir_texto_sem_dado_pessoal({"motivo": motivo})

    if novo_status == STATUS_EVENTO_REALIZADO and evento.data_hora_inicio > agora:
        raise HTTPException(status_code=400, detail="O evento ainda não começou: só dá para marcar como realizado depois do início.")

    inicio_anterior_para_o_aviso: Optional[datetime] = None
    sessoes_deslocadas = 0
    if novo_status == STATUS_EVENTO_PROGRAMADO:
        if nova_inicio is not None and nova_inicio == evento.data_hora_inicio:
            if atual == STATUS_EVENTO_PROGRAMADO:
                raise HTTPException(status_code=422, detail="A nova data é igual à atual: não há o que remarcar.")
            if nova_inicio <= agora:
                raise HTTPException(status_code=422, detail="A nova data precisa estar no futuro.")
            # adiado ou cancelado que volta para a MESMA data (a data original ainda está no futuro): é retomada, não remarcação
            if nova_fim is not None:
                if nova_fim <= nova_inicio:
                    raise HTTPException(status_code=422, detail="O fim do evento precisa ser depois do início.")
                evento.data_hora_fim = nova_fim
            nova_inicio = None
        if nova_inicio is None:
            if evento.data_hora_inicio <= agora:
                raise HTTPException(status_code=422, detail="A data do evento já passou: informe a nova data.")
        else:
            if nova_inicio <= agora:
                raise HTTPException(status_code=422, detail="A nova data precisa estar no futuro.")
            if nova_fim is not None and nova_fim <= nova_inicio:
                raise HTTPException(status_code=422, detail="O fim do evento precisa ser depois do início.")
            duracao = (evento.data_hora_fim - evento.data_hora_inicio) if evento.data_hora_fim else None
            deslocamento = nova_inicio - evento.data_hora_inicio
            inicio_anterior_para_o_aviso = evento.data_hora_inicio
            for sessao in db.query(SessaoEvento).filter(SessaoEvento.id_evento == evento.id_evento).all():
                sessao.data_hora_inicio = sem_fuso(sessao.data_hora_inicio) + deslocamento
                if sessao.data_hora_fim is not None:
                    sessao.data_hora_fim = sem_fuso(sessao.data_hora_fim) + deslocamento
                sessoes_deslocadas += 1
            evento.data_hora_inicio_anterior = evento.data_hora_inicio
            evento.data_hora_inicio = nova_inicio
            evento.data_hora_fim = nova_fim if nova_fim is not None else (nova_inicio + duracao if duracao is not None else None)
            # quem tinha sido promovido da fila e ainda não confirmou ganha prazo novo: o prazo antigo venceu enquanto o evento estava parado
            prazo_horas = int(obter_configuracao(db, "PRAZO_CONFIRMACAO_LISTA_ESPERA_HORAS", "24") or "24")
            for inscricao in _inscricoes_do_evento(db, evento, (PRE_INSCRITO,)):
                if inscricao.prazo_confirmacao is not None:
                    inscricao.prazo_confirmacao = agora + timedelta(hours=prazo_horas)

    evento.status = novo_status
    evento.motivo_status = motivo if novo_status in (STATUS_EVENTO_CANCELADO, STATUS_EVENTO_ADIADO) or (novo_status == STATUS_EVENTO_PROGRAMADO and nova_inicio is not None) else None
    evento.status_alterado_em = agora
    if novo_status == STATUS_EVENTO_PROGRAMADO and nova_inicio is None:
        evento.data_hora_inicio_anterior = None  # reativado na mesma data: não é remarcação
    db.commit()
    db.refresh(evento)

    avisos = None
    if novo_status != STATUS_EVENTO_REALIZADO:
        avisos = _avisar_inscritos(db, evento, situacao_nova=novo_status, motivo=evento.motivo_status, inicio_anterior=inicio_anterior_para_o_aviso)
    depois = {"status": evento.status, "motivo_status": evento.motivo_status, "data_hora_inicio": evento.data_hora_inicio}
    return {
        "antes": antes, "depois": depois, "avisos": avisos, "sessoes_deslocadas": sessoes_deslocadas,
        "inscricoes_com_cobranca": _inscricoes_com_cobranca(db, evento) if novo_status == STATUS_EVENTO_CANCELADO else 0,
    }
