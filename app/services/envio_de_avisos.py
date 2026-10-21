"""v6.2a (FASE 6) - o envio por e-mail dos avisos do mural, em lotes, pela tarefa periódica (de 15 em 15 minutos: `scripts/enviar_emails_de_avisos.py`), nunca dentro do clique de publicar.

O que este módulo garante:
  - respeita um TETO DIÁRIO (`EMAIL_LIMITE_DIARIO`, padrão 1.500: a conta Google Workspace envia até 2.000 por dia, contando os e-mails automáticos) e um teto por rodada
    (`EMAIL_LOTE_POR_RODADA`); uma conexão com o servidor de e-mail por rodada; as categorias OBRIGATÓRIAS (Convocação, Mudança de regra) saem primeiro;
  - cada entrega é PEGA por uma rodada só (`Na fila` -> `Enviando`, numa troca condicional no banco) antes de sair: duas rodadas ao mesmo tempo nunca mandam o mesmo e-mail duas vezes,
    e o aviso retirado no meio da rodada não sai mais (retirar cancela o que está na fila, e o que já foi cancelado não é pego); a entrega que ficou `Enviando` porque a rodada parou
    no meio vira `Falhou` com o motivo (pode ter saído ou não) e pode ser reenviada à mão;
  - o endereço é lido do cadastro NA HORA de enviar (nunca guardado), pela mesma regra da conferência (`comunicacao.email_de`); quem ficou sem e-mail vira "sem e-mail no cadastro";
  - a recusa de UM destinatário não para a rodada: recusa DEFINITIVA (5xx) não tenta de novo e, se o servidor disse que a caixa não existe (5.1.x) e o endereço era o de CONTATO, ele vai
    para a fila de higienização da v1.8; falha PASSAGEIRA (4xx) volta para a fila, até 3 tentativas, com espera crescente; só param a rodada: o LIMITE DIÁRIO do Google (5.4.5, a
    entrega volta para a fila sem gastar tentativa), a queda da conexão ou o 421 (o servidor fecha a conexão) e a recusa do REMETENTE (problema de configuração, não da pessoa);
  - "Enviado" quer dizer que saiu do servidor de e-mail da ASAF: o Google recusa na hora só caixa inexistente do próprio Google; a devolução que chega depois, de outros provedores, cai
    na caixa asaf@asaf.org.br e não é lida pelo sistema (fica para depois, com registro no plano);
  - o motivo da falha é guardado em português e sem o endereço; a Auditoria guarda só as contagens da rodada, e só quando algo foi enviado ou falhou; nada pessoal vai para o log;
  - aviso que saiu do mural (venceu) antes de o e-mail sair cancela o que ainda estava na fila;
  - sem servidor de e-mail configurado (a homologação, de propósito) não faz nada e diz isso."""
from __future__ import annotations

import logging
import re
import smtplib
from datetime import datetime, timedelta
from typing import Callable, Optional

from sqlalchemy import case, inspect
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.config_cache import obter_configuracao
from app.models.associados import Associado
from app.models.comunicacao import CANAL_EMAIL, CANCELADO, ENVIADO, ENVIANDO, FALHOU, NA_FILA, NAO_RECEBE, SEM_EMAIL, Aviso, AvisoDestinatario, EntregaDeAviso
from app.models.preferencias_de_comunicacao import AVISOS as AVISO_POR_EMAIL
from app.services import comunicacao, notificacoes, preferencias_de_comunicacao
from app.services.fuso import dia_e_hora_em_belem
from app.services.site_publico import link_para_o_aviso

LOG = logging.getLogger("asaf.envio_de_avisos")

MAXIMO_DE_TENTATIVAS = 3
ESPERA_ENTRE_TENTATIVAS = timedelta(minutes=30)
PRESA_EM_ENVIANDO = timedelta(hours=1)  # a rodada que pegou e não terminou (caiu no meio): depois disso a entrega vira Falhou
_ENDERECO = re.compile(r"\S+@\S+")
_STATUS = re.compile(r"\b([245]\.\d{1,3}\.\d{1,3})\b")

# o tipo de cada erro do servidor de e-mail
LIMITE, DEFINITIVA, ENDERECO_INEXISTENTE, PASSAGEIRA, CONEXAO, REMETENTE = "limite", "definitiva", "endereco_inexistente", "passageira", "conexao", "remetente"
PAUSA = "pausa"  # o servidor pediu para esperar no REMETENTE (4xx): ninguém tem culpa; para a rodada sem alarme


def _numero(db: Session, chave: str, padrao: int) -> int:
    try:
        valor = int(float(str(obter_configuracao(db, chave, str(padrao))).strip()))
    except (TypeError, ValueError, OverflowError):
        return padrao
    return valor if valor >= 0 else padrao


def _codigo_e_texto(erro: Exception) -> tuple[Optional[int], str]:
    if isinstance(erro, smtplib.SMTPRecipientsRefused):
        codigo, mensagem = next(iter(erro.recipients.values()), (None, b""))
    elif isinstance(erro, smtplib.SMTPResponseException):
        codigo, mensagem = erro.smtp_code, erro.smtp_error
    else:
        return None, ""
    return codigo, (mensagem.decode("utf-8", "replace") if isinstance(mensagem, bytes) else str(mensagem))


def classificar(erro: Exception) -> str:
    """O que fazer com o erro de UMA mensagem: 'limite' (a conta chegou ao limite do dia: parar), 'remetente' (o servidor recusou o REMETENTE: configuração, parar),
    'conexao' (a conexão caiu ou o servidor a fechou com 421: parar), 'endereco_inexistente' / 'definitiva' (recusa de vez desta pessoa) ou 'passageira' (tentar de novo depois)."""
    codigo, texto = _codigo_e_texto(erro)
    if "5.4.5" in texto or "sending limit" in texto.lower():
        return LIMITE
    if codigo == 421 or isinstance(erro, smtplib.SMTPServerDisconnected):
        return CONEXAO
    if codigo is None:
        # não é resposta do servidor: rede caiu (OSError/socket), ou um erro no meio da conversa (ex.: caractere inválido): a conexão não é mais confiável
        return CONEXAO
    if isinstance(erro, smtplib.SMTPSenderRefused):
        return REMETENTE if 500 <= codigo < 600 else PAUSA
    if 500 <= codigo < 600:
        status = _STATUS.search(texto)
        return ENDERECO_INEXISTENTE if status and status.group(1).startswith("5.1.") else DEFINITIVA
    return PASSAGEIRA


def motivo_legivel(erro: Exception, tipo: str) -> str:
    """O motivo para a tela, em português, com o código do servidor e sem nenhum endereço."""
    codigo, texto = _codigo_e_texto(erro)
    status = _STATUS.search(texto)
    sufixo = f" ({' '.join(str(x) for x in (codigo, status.group(1) if status else None) if x)})" if codigo else ""
    frases = {
        ENDERECO_INEXISTENTE: "O servidor de destino disse que este endereço não existe",
        DEFINITIVA: "O servidor recusou a mensagem",
        PASSAGEIRA: "O servidor pediu para tentar mais tarde",
        CONEXAO: "A conexão com o servidor de e-mail caiu durante o envio",
    }
    return _ENDERECO.sub("(endereço)", frases.get(tipo, "Falha no envio") + sufixo)[:300]


def montar_email(
    db: Session, aviso: Aviso, linha: AvisoDestinatario, nomes: Callable[[Optional[int]], Optional[str]], *, obrigatorio: bool = False, id_pessoa: Optional[int] = None,
) -> tuple[str, str, dict]:
    """O assunto e o texto (só texto). Quem tem acesso ao painel recebe o link para abrir (e confirmar a leitura, quando o aviso pede); quem não tem, a explicação de que o aviso também
    está guardado no nome dele. Nunca diz a regra do grupo (ela pode revelar a situação da pessoa, ex.: inadimplente)."""
    assunto = f"ASAF: {aviso.titulo}"[:200]
    autor = nomes(aviso.id_usuario_autor) or "a Diretoria"
    # v6.2c: as variáveis do texto ({primeiro_nome}, {nome}) viram o nome de quem recebe
    associado = db.get(Associado, linha.id_associado) if linha.id_associado is not None else None
    texto = comunicacao.personalizar(aviso.texto.strip(), associado.nome_completo if associado is not None else None)
    partes = [texto, "", "—", f"Aviso publicado por {autor} em {dia_e_hora_em_belem(aviso.publicado_em)} (horário de Belém) no painel da ASAF."]
    if linha.id_usuario is not None or linha.tinha_acesso:
        acao = "abrir o aviso e confirmar que leu" if aviso.exige_confirmacao else "abrir o aviso"
        partes.append(f"Para {acao} no painel: {link_para_o_aviso(db, aviso.id_aviso)}")
    else:
        partes.append("Este aviso também fica guardado no seu nome no painel da ASAF: você o verá quando tiver acesso ao painel.")
    partes += ["", "Este e-mail foi enviado pela ASAF (asaf.org.br). Responda a este e-mail se precisar falar com a associação."]
    cabecalhos: dict = {}
    if obrigatorio:
        partes.append("Este é um aviso obrigatório da associação (convocação ou mudança de regra): ele chega mesmo a quem desligou os outros avisos por e-mail.")
    elif id_pessoa is not None:
        # v6.2b: o aviso que não é obrigatório leva o link para parar de receber (e o cabeçalho que os programas de e-mail usam para o botão de cancelar)
        texto, cabecalhos = preferencias_de_comunicacao.rodape(db, id_pessoa, AVISO_POR_EMAIL)
        partes.append(texto.strip())
    return assunto, "\n".join(partes), cabecalhos


def _pegar(db: Session, entrega: EntregaDeAviso) -> bool:
    """Troca Na fila -> Enviando SÓ se ainda estiver na fila (troca condicional no banco): a outra rodada, ou a retirada do aviso, que chegou antes ganha."""
    pegou = (
        db.query(EntregaDeAviso).filter(EntregaDeAviso.id_entrega == entrega.id_entrega, EntregaDeAviso.situacao == NA_FILA)
        .update({"situacao": ENVIANDO, "pego_em": datetime.utcnow()}, synchronize_session=False)
    )
    db.commit()
    return pegou == 1


def _arrumar_a_fila(db: Session, agora: datetime) -> None:
    """Antes de enviar: (1) o que ficou `Enviando` por mais de 1 hora (a rodada caiu no meio) vira Falhou, dizendo que pode ter saído; (2) o que ainda estava na fila de um aviso que já
    saiu do mural (venceu) é cancelado."""
    db.query(EntregaDeAviso).filter(EntregaDeAviso.situacao == ENVIANDO, EntregaDeAviso.pego_em < agora - PRESA_EM_ENVIANDO).update(
        {"situacao": FALHOU, "ultimo_erro": "A rodada de envio parou no meio: o e-mail pode ter saído ou não. Reenvie se precisar."}, synchronize_session=False,
    )
    # só os avisos vencidos que AINDA têm e-mail na fila (os antigos, já resolvidos, não são relidos a cada rodada)
    vencidos = [
        i for (i,) in db.query(Aviso.id_aviso).join(AvisoDestinatario, AvisoDestinatario.id_aviso == Aviso.id_aviso)
        .join(EntregaDeAviso, EntregaDeAviso.id_destinatario == AvisoDestinatario.id_destinatario)
        .filter(Aviso.por_email.is_(True), Aviso.retirado_em.is_(None), Aviso.valido_ate < comunicacao.hoje(), EntregaDeAviso.situacao == NA_FILA)
        .distinct().all()
    ]
    for lote in comunicacao._em_lotes(vencidos):
        ids = [i for (i,) in db.query(AvisoDestinatario.id_destinatario).filter(AvisoDestinatario.id_aviso.in_(lote)).all()]
        for pedaco in comunicacao._em_lotes(ids):
            db.query(EntregaDeAviso).filter(EntregaDeAviso.id_destinatario.in_(pedaco), EntregaDeAviso.situacao == NA_FILA).update(
                {"situacao": CANCELADO, "ultimo_erro": "O aviso saiu do mural antes de o e-mail sair."}, synchronize_session=False,
            )
    db.commit()


def enviar_pendentes(db: Session, agora: Optional[datetime] = None, conexao: Callable[[], notificacoes.ConexaoDeEmail] = notificacoes.ConexaoDeEmail) -> dict:
    """Uma rodada: envia o que está na fila, dentro dos tetos. Devolve as contagens e, quando nada saiu de propósito, o motivo."""
    agora = agora or datetime.utcnow()
    resultado = {"enviados": 0, "falharam": 0, "vao_tentar_de_novo": 0, "sem_email": 0, "motivo": None}
    if not notificacoes.smtp_configurado():
        resultado["motivo"] = "o servidor de e-mail não está configurado neste ambiente"
        return resultado
    if not inspect(db.get_bind()).has_table("entregas_de_aviso"):
        resultado["motivo"] = "a migração da v6.2a ainda não rodou neste banco"  # a tarefa agendada pode rodar o código novo antes do Deploy API aplicar a migração
        return resultado
    _arrumar_a_fila(db, agora)
    lote, teto = _numero(db, "EMAIL_LOTE_POR_RODADA", 100), _numero(db, "EMAIL_LIMITE_DIARIO", 1500)
    enviados_em_24h = (
        db.query(EntregaDeAviso).filter(EntregaDeAviso.canal == CANAL_EMAIL, EntregaDeAviso.situacao == ENVIADO, EntregaDeAviso.enviado_em >= agora - timedelta(hours=24)).count()
    )
    if lote <= 0:
        resultado["motivo"] = "o teto por rodada está em zero (Configurações)"
        return resultado
    if teto - enviados_em_24h <= 0:
        resultado["motivo"] = "o teto diário de e-mails de avisos já foi atingido"
        return resultado
    obrigatorias = comunicacao.categorias_obrigatorias(db)
    fila = (
        db.query(EntregaDeAviso, AvisoDestinatario, Aviso)
        .join(AvisoDestinatario, AvisoDestinatario.id_destinatario == EntregaDeAviso.id_destinatario)
        .join(Aviso, Aviso.id_aviso == AvisoDestinatario.id_aviso)
        .filter(
            EntregaDeAviso.canal == CANAL_EMAIL, EntregaDeAviso.situacao == NA_FILA, Aviso.retirado_em.is_(None), Aviso.valido_ate >= comunicacao.hoje(),
            (EntregaDeAviso.proxima_tentativa_em.is_(None)) | (EntregaDeAviso.proxima_tentativa_em <= agora),
        )
        .order_by(case((Aviso.categoria.in_(obrigatorias or {""}), 0), else_=1), EntregaDeAviso.id_entrega)
        .limit(min(lote, teto - enviados_em_24h)).all()
    )
    if not fila:
        return resultado
    nomes = comunicacao._Nomes(db)
    try:
        with conexao() as smtp:
            for entrega, linha, aviso in fila:
                if not _pegar(db, entrega):
                    continue  # outra rodada pegou, ou o aviso foi retirado no meio
                obrigatorio = aviso.categoria in obrigatorias
                id_pessoa = db.query(Associado.id_pessoa).filter(Associado.id_associado == linha.id_associado).scalar() if linha.id_associado is not None else None
                if not obrigatorio and not preferencias_de_comunicacao.recebe(db, id_pessoa, AVISO_POR_EMAIL):
                    entrega.situacao = NAO_RECEBE  # desligou depois de o aviso ser publicado
                    resultado["nao_recebe"] = resultado.get("nao_recebe", 0) + 1
                    db.commit()
                    continue
                endereco, origem = comunicacao.email_atual(db, linha)
                if endereco is None:
                    entrega.situacao = SEM_EMAIL
                    resultado["sem_email"] += 1
                    db.commit()
                    continue
                assunto, corpo, cabecalhos = montar_email(db, aviso, linha, nomes, obrigatorio=obrigatorio, id_pessoa=id_pessoa)
                try:
                    smtp.enviar(endereco, assunto, corpo, cabecalhos)
                except Exception as erro:  # noqa: BLE001 - cada erro é classificado; só os que tornam a conexão (ou a conta) inútil param a rodada
                    tipo = classificar(erro)
                    if tipo in (LIMITE, REMETENTE, PAUSA):
                        entrega.situacao = NA_FILA  # não é culpa da pessoa: volta sem gastar tentativa
                        db.commit()
                        resultado["motivo"] = {
                            LIMITE: "o servidor de e-mail avisou que a conta chegou ao limite do dia",
                            REMETENTE: "o servidor de e-mail recusou o REMETENTE (configuração): nada mais foi enviado",
                            PAUSA: "o servidor de e-mail pediu para esperar: o resto fica para a próxima rodada",
                        }[tipo]
                        if tipo == REMETENTE:
                            resultado["erro_de_conexao"] = True
                        break
                    entrega.tentativas += 1
                    entrega.ultimo_erro = motivo_legivel(erro, tipo)
                    if tipo in (PASSAGEIRA, CONEXAO) and entrega.tentativas < MAXIMO_DE_TENTATIVAS:
                        entrega.situacao = NA_FILA
                        entrega.proxima_tentativa_em = agora + ESPERA_ENTRE_TENTATIVAS * entrega.tentativas
                        resultado["vao_tentar_de_novo"] += 1
                    else:
                        entrega.situacao = FALHOU
                        resultado["falharam"] += 1
                        if tipo == ENDERECO_INEXISTENTE and origem == comunicacao.EMAIL_DO_CONTATO:
                            _marcar_contato(db, linha)
                    db.commit()
                    if tipo == CONEXAO:
                        break  # a conexão caiu (ou o servidor a fechou): o resto fica para a próxima rodada
                    continue
                entrega.situacao = ENVIADO
                entrega.enviado_em = datetime.utcnow()
                entrega.tentativas += 1
                entrega.ultimo_erro = None
                resultado["enviados"] += 1
                db.commit()
    except (smtplib.SMTPException, OSError) as erro:
        # não conseguiu nem conectar (ou a senha foi recusada): nada muda na fila; quem roda precisa saber
        db.rollback()
        LOG.error("não foi possível conectar ao servidor de e-mail: %s %s", type(erro).__name__, getattr(erro, "smtp_code", ""))
        resultado["motivo"] = "não foi possível conectar ao servidor de e-mail"
        resultado["erro_de_conexao"] = True
    if resultado["enviados"] or resultado["falharam"]:
        registrar_auditoria(db, None, "avisos", "EMAILS_DE_AVISOS_ENVIADOS", dados_depois={k: v for k, v in resultado.items() if k != "motivo" and v})
    return resultado


def _marcar_contato(db: Session, linha: AvisoDestinatario) -> None:
    """O servidor disse que o endereço de CONTATO não existe: o contato vai para a fila de higienização da v1.8 (uma vez por pessoa enquanto estiver lá)."""
    from app.models.qualidade_cadastro import CONTATO_EMAIL_SUSPEITO, PENDENTE, FilaRevisaoCadastro
    from app.services.higienizacao_contato import marcar_email_suspeito

    if linha.id_associado is None:
        return
    associado = db.get(Associado, linha.id_associado)
    if associado is None or associado.pessoa is None:
        return
    ja_na_fila = db.query(FilaRevisaoCadastro).filter(
        FilaRevisaoCadastro.tipo_sinal == CONTATO_EMAIL_SUSPEITO, FilaRevisaoCadastro.id_pessoa_a == associado.id_pessoa, FilaRevisaoCadastro.status == PENDENTE,
    ).first()
    if ja_na_fila is None:
        marcar_email_suspeito(db, associado.pessoa, "O servidor de e-mail recusou o endereço como inexistente ao enviar um aviso do mural (v6.2a).")
