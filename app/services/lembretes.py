"""v3.2.1/v3.2.2 (adaptado, 2026-09-17) - régua de cobrança por e-mail, com o Pix já pronto
(copia e cola) - substitui Pix Automático (Resolução BCB 402/506, exige convênio com um banco/PSP
parceiro pago, sem orçamento hoje - achado confirmado com o usuário). Multicanal fica pra FASE
11/v11.3 (só e-mail por enquanto). Cada tipo de lembrete só sai uma vez por título
(`LembreteMensalidadeEnviado`, trava por UniqueConstraint(id_titulo, tipo_lembrete)):
- alguns dias antes do vencimento (`DIAS_LEMBRETE_MENSALIDADE`, configurável);
- no próprio dia do vencimento;
- escalonado depois do vencimento (`DIAS_ATRASO_LEMBRETE`, lista configurável de dias de
  atraso - v3.2.2), tom mais urgente, mencionando a possibilidade de negociar/parcelar.
Nunca debita nada sozinho - só entrega o Pix pronto na caixa de entrada, decisão de pagar
continua 100% humana.

v6.2d (FASE 6): roda TODO DIA (tarefa diária própria, 09:00 de Belém), não só no dia 1 do mês - antes o "5 dias antes" só pegava o
título que vencesse no dia 6. O "hoje" é o dia de Belém. Uma rodada que não aconteceu (o agendador do GitHub atrasa ou pula) é
recuperada: cada lembrete aceita até `_DIAS_DE_TOLERANCIA` dias de atraso (o "vence hoje" não, porque o texto ficaria errado). Um
título recebe no máximo um lembrete por rodada (as faixas não se cruzam: degrau de atraso só de 1 dia ou mais) e nunca um aviso de
atraso menor depois de um maior. Um e-mail que falha não derruba o
lote: o lembrete não fica marcado (sai na rodada seguinte, dentro da tolerância), e o endereço que o servidor diz não existir vai para a
fila de higienização da v1.8; se a falha é da conta ou da conexão (limite do dia, remetente recusado, servidor fora, servidor pedindo
pausa), a rodada para. Cada e-mail abre a própria conexão: um erro que não veio do servidor (ex.: um caractere que a conversa com o
servidor não aceita) é falha só daquela mensagem. O endereço segue a regra única dos e-mails do sistema (`comunicacao.email_valido`)."""
import logging
import smtplib
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.models.associados import Associado
from app.models.core import ConfiguracaoInstitucional
from app.models.financeiro import LembreteMensalidadeEnviado, TituloFinanceiro
from app.models.preferencias_de_comunicacao import LEMBRETES_DE_MENSALIDADE
from app.services import comunicacao, envio_de_avisos, notificacoes, pix, preferencias_de_comunicacao
from app.services.formato import reais

LOG = logging.getLogger("asaf.lembretes")

_DIAS_LEMBRETE_PADRAO = 5
_DIAS_ATRASO_PADRAO = [7, 15, 30]
_DIAS_DE_TOLERANCIA = 2  # recupera até 2 rodadas diárias perdidas
_PARA_A_RODADA = {envio_de_avisos.LIMITE, envio_de_avisos.REMETENTE, envio_de_avisos.CONEXAO, envio_de_avisos.PAUSA}
# a pausa pedida pelo servidor para a rodada sem alarme (ninguém tem culpa); estas pedem que alguém olhe
PARA_COM_ALARME = {envio_de_avisos.LIMITE, envio_de_avisos.REMETENTE, envio_de_avisos.CONEXAO}


def _tipo_da_falha(erro: Exception) -> str:
    """Como `envio_de_avisos.classificar`, menos uma coisa: lá a conexão é uma só para o lote e um erro no meio da conversa a deixa inútil; aqui cada e-mail abre a sua, então o
    erro que não veio do servidor nem da rede (ex.: UnicodeEncodeError de um caractere no endereço) é falha só desta mensagem. Sem servidor configurado (RuntimeError) para."""
    if not isinstance(erro, (smtplib.SMTPException, OSError, RuntimeError)):
        return envio_de_avisos.DEFINITIVA
    return envio_de_avisos.classificar(erro)


def _dias_lembrete_configurado(db: Session) -> int:
    config = db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao == "DIAS_LEMBRETE_MENSALIDADE").first()
    try:
        return int(config.valor_configuracao) if config and config.valor_configuracao else _DIAS_LEMBRETE_PADRAO
    except ValueError:
        return _DIAS_LEMBRETE_PADRAO


def _dias_atraso_configurado(db: Session) -> list[int]:
    config = db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao == "DIAS_ATRASO_LEMBRETE").first()
    if not config or not config.valor_configuracao:
        return _DIAS_ATRASO_PADRAO
    try:
        # v6.2d: só degraus de 1 dia ou mais (um "0" seria o mesmo dia do "vence hoje" e mandaria dois e-mails na mesma rodada)
        return sorted({int(d.strip()) for d in config.valor_configuracao.split(",") if d.strip() and int(d.strip()) > 0}) or _DIAS_ATRASO_PADRAO
    except ValueError:
        return _DIAS_ATRASO_PADRAO


def _corpo_lembrete(titulo: TituloFinanceiro, payload_pix: str, tipo_lembrete: str, hoje: Optional[date] = None) -> str:
    if tipo_lembrete == "NO_VENCIMENTO":
        quando = "vence hoje"
    elif tipo_lembrete.startswith("ATRASO_"):
        # os dias de verdade (a rodada pode estar recuperando um dia perdido), não o número do degrau
        dias = (hoje - titulo.data_vencimento.date()).days if hoje else tipo_lembrete.split("_")[1]
        quando = f"está em atraso há {dias} dia(s) (venceu em {titulo.data_vencimento.strftime('%d/%m/%Y')})"
    else:
        quando = f"vence em {titulo.data_vencimento.strftime('%d/%m/%Y')}"

    aviso_atraso = (
        "\nSe precisar, procure a tesouraria para negociar o pagamento em parcelas - "
        "regularizar reabilita automaticamente seus direitos associativos.\n"
        if tipo_lembrete.startswith("ATRASO_") else ""
    )
    return (
        f"Olá,\n\nSua mensalidade \"{titulo.descricao}\" {quando}, no valor de "
        f"{reais(titulo.saldo_devedor)}.\n\n"
        f"Pix copia e cola (abra o app do seu banco, Pix > Pix Copia e Cola):\n{payload_pix}\n"
        f"{aviso_atraso}\n"
        f"Este é um lembrete automático - nenhum valor foi debitado, o pagamento continua "
        f"sendo feito por você, quando quiser.\n"
    )


def enviar_lembretes_do_dia(db: Session, hoje: Optional[datetime] = None) -> list[dict]:
    """Os lembretes que saíram nesta rodada (para quem só quer a lista); `rodada_de_lembretes` devolve também as falhas."""
    return rodada_de_lembretes(db, hoje)["enviados"]


def rodada_de_lembretes(db: Session, hoje: Optional[datetime] = None) -> dict:
    hoje_data = hoje.date() if hoje else comunicacao.hoje()  # o dia de Belém
    dias_antes = _dias_lembrete_configurado(db)
    tolerancia = timedelta(days=_DIAS_DE_TOLERANCIA)

    # (tipo, primeiro dia de vencimento aceito, último dia) - inclusive. O maior atraso primeiro: quem está mais atrasado recebe o aviso mais firme.
    faixas: list[tuple[str, date, date]] = []
    for dias_atraso in sorted(_dias_atraso_configurado(db), reverse=True):
        alvo = hoje_data - timedelta(days=dias_atraso)
        faixas.append((f"ATRASO_{dias_atraso}", alvo - tolerancia, alvo))
    faixas.append(("NO_VENCIMENTO", hoje_data, hoje_data))
    alvo = hoje_data + timedelta(days=dias_antes)
    faixas.append(("ANTES_VENCIMENTO", max(alvo - tolerancia, hoje_data + timedelta(days=1)), alvo))

    enviados: list[dict] = []
    falhas = 0
    parou: Optional[str] = None
    for tipo_lembrete, de, ate in faixas:
        if de > ate:
            continue
        titulos = (
            db.query(TituloFinanceiro)
            .filter(
                TituloFinanceiro.tipo_titulo == "A Receber",
                TituloFinanceiro.status == "Pendente",
                TituloFinanceiro.id_associado.isnot(None),
                func.date(TituloFinanceiro.data_vencimento) >= de,
                func.date(TituloFinanceiro.data_vencimento) <= ate,
            )
            .order_by(TituloFinanceiro.id_titulo)
            .all()
        )
        for titulo in titulos:
            ja_enviados = {
                t for (t,) in db.query(LembreteMensalidadeEnviado.tipo_lembrete).filter(LembreteMensalidadeEnviado.id_titulo == titulo.id_titulo).all()
            }
            if tipo_lembrete in ja_enviados:
                continue
            if tipo_lembrete.startswith("ATRASO_"):
                dias = int(tipo_lembrete.split("_")[1])
                if any(t.startswith("ATRASO_") and int(t.split("_")[1]) > dias for t in ja_enviados):
                    continue  # já recebeu um aviso de atraso maior: nunca volta para um menor

            associado = db.query(Associado).filter(Associado.id_associado == titulo.id_associado).first()
            email = comunicacao.email_valido(associado.email_contato) if associado else None
            if not email:
                continue  # sem e-mail, ou um que o servidor não aceitaria (ex.: com acento)
            # v6.2b: quem desligou os lembretes de mensalidade (pelo link do e-mail ou no Meu Perfil) não recebe; o título continua o mesmo
            if not preferencias_de_comunicacao.recebe(db, associado.id_pessoa, LEMBRETES_DE_MENSALIDADE):
                continue

            payload_pix = pix.payload_pix_do_titulo(db, titulo)
            rodape, cabecalhos = preferencias_de_comunicacao.rodape(db, associado.id_pessoa, LEMBRETES_DE_MENSALIDADE)
            try:
                notificacoes.enviar_email(
                    email,
                    assunto=f"Lembrete de mensalidade - {titulo.descricao}",
                    corpo_texto=_corpo_lembrete(titulo, payload_pix, tipo_lembrete, hoje_data) + rodape,
                    cabecalhos=cabecalhos,
                )
            except Exception as erro:  # noqa: BLE001 - uma falha não derruba o lote; o lembrete fica sem marca e sai na próxima rodada
                db.rollback()
                falhas += 1
                tipo_do_erro = _tipo_da_falha(erro)
                LOG.warning("lembrete do título %s (%s) não saiu: %s", titulo.id_titulo, tipo_lembrete, envio_de_avisos.motivo_legivel(erro, tipo_do_erro))
                if tipo_do_erro == envio_de_avisos.ENDERECO_INEXISTENTE:
                    envio_de_avisos.marcar_contato_inexistente(db, db.get(Associado, titulo.id_associado), "um lembrete de mensalidade (v6.2d)")
                if tipo_do_erro in _PARA_A_RODADA:
                    parou = tipo_do_erro
                    break
                continue
            db.add(LembreteMensalidadeEnviado(id_titulo=titulo.id_titulo, tipo_lembrete=tipo_lembrete))
            db.commit()
            enviados.append({"id_titulo": titulo.id_titulo, "tipo_lembrete": tipo_lembrete, "email": email})
        if parou:
            break

    if enviados or falhas:
        # a rodada na Auditoria (pelo sistema, sem endereço): quantos saíram, quantos falharam e se parou; o lembrete de cada título fica em LembreteMensalidadeEnviado
        registrar_auditoria(
            db, None, "lembretes_mensalidade_enviados", "LEMBRETES_DO_DIA",
            dados_depois={"dia": hoje_data.isoformat(), "enviados": len(enviados), "falhas": falhas, "parou": parou},
        )
    return {"enviados": enviados, "falhas": falhas, "parou": parou}
