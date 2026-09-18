"""v4.7 (FASE 4) - vagas com trava real sob concorrência, cotas por categoria e lista de espera
com promoção automática (prazo pra confirmar antes de passar ao próximo).

**A trava é sempre um UPDATE atômico condicionado** (`WHERE vagas_ocupadas < limite`), nunca um
SELECT que conta e só depois decide se insere - entre o SELECT e o INSERT existe uma janela onde
duas requisições concorrentes podem ler a mesma contagem e ambas passarem, estourando o limite.
Um único UPDATE com a condição na cláusula WHERE é atômico no próprio banco (Postgres e SQLite
inclusive - nenhuma extensão específica de dialeto, ao contrário da `EXCLUDE USING gist` da v4.3):
o SGBD nunca deixa duas transações aplicarem o mesmo UPDATE condicionado sobre a mesma linha ao
mesmo tempo sem serializar uma depois da outra, então só uma consegue quando resta 1 vaga.

Cota por categoria (`CotaInscricaoEvento`) é opcional por evento/sessão: existindo qualquer cota
pra um contexto, ELA passa a controlar a vaga de cada categoria; sem nenhuma cota configurada, o
limite genérico do evento/sessão (`Evento.vagas`/`SessaoEvento.vagas`) vale pra todo mundo, como
já era desde a v4.5 (só que agora de verdade, não só como metadado)."""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.config_cache import obter_configuracao
from app.models.associados import Associado
from app.models.eventos import CotaInscricaoEvento, Evento, SessaoEvento
from app.models.motores import CANCELADO, CONFIRMADO, LISTA_DE_ESPERA, PRE_INSCRITO, Inscricao
from app.models.pessoas import Pessoa
from app.services import inscricao as servico_inscricao
from app.services import notificacoes

CATEGORIA_ASSOCIADO = "ASSOCIADO"
CATEGORIA_COMUNIDADE_EXTERNA = "COMUNIDADE_EXTERNA"

_MODELO_POR_CONTEXTO = {"Evento": (Evento, "id_evento"), "SessaoEvento": (SessaoEvento, "id_sessao")}


def categoria_da_pessoa(db: Session, *, id_pessoa: int) -> str:
    """Derivada, nunca escolhida à mão por quem se inscreve - tem `Associado` vinculado à
    `Pessoa` (qualquer situação, mesmo licenciado - a cota não é sobre estar em dia, é sobre ser
    ou não da comunidade interna) = ASSOCIADO, senão COMUNIDADE_EXTERNA."""
    tem_associado = db.query(Associado).filter(Associado.id_pessoa == id_pessoa).first() is not None
    return CATEGORIA_ASSOCIADO if tem_associado else CATEGORIA_COMUNIDADE_EXTERNA


def _existe_alguma_cota(db: Session, *, contexto_tipo: str, id_contexto: int) -> bool:
    return db.query(CotaInscricaoEvento).filter(
        CotaInscricaoEvento.contexto_tipo == contexto_tipo, CotaInscricaoEvento.id_contexto == id_contexto,
    ).first() is not None


def reservar_vaga(db: Session, *, contexto_tipo: str, id_contexto: int, categoria: str) -> tuple[bool, Optional[str]]:
    """Tenta ocupar 1 vaga agora, atomicamente. Retorna (conseguiu, categoria_cota) -
    `categoria_cota` é a categoria quando o evento/sessão tem cota configurada (guardado em
    `Inscricao.categoria_cota` pra liberar/promover a fonte certa depois, com ou sem sucesso na
    reserva), ou `None` quando não há cota nenhuma (bucket genérico do evento/sessão, ou nem
    limite nenhum declarado)."""
    if _existe_alguma_cota(db, contexto_tipo=contexto_tipo, id_contexto=id_contexto):
        atualizadas = db.query(CotaInscricaoEvento).filter(
            CotaInscricaoEvento.contexto_tipo == contexto_tipo, CotaInscricaoEvento.id_contexto == id_contexto,
            CotaInscricaoEvento.categoria == categoria, CotaInscricaoEvento.vagas_ocupadas < CotaInscricaoEvento.vagas_limite,
        ).update({CotaInscricaoEvento.vagas_ocupadas: CotaInscricaoEvento.vagas_ocupadas + 1}, synchronize_session=False)
        db.commit()
        return (atualizadas > 0), categoria

    modelo, campo_id = _MODELO_POR_CONTEXTO[contexto_tipo]
    campo_pk = getattr(modelo, campo_id)
    registro = db.query(modelo).filter(campo_pk == id_contexto).first()
    if registro is None or registro.vagas is None:
        return True, None  # sem limite declarado - sempre cabe, nenhum contador é tocado

    atualizadas = db.query(modelo).filter(
        campo_pk == id_contexto, modelo.vagas_ocupadas < modelo.vagas,
    ).update({modelo.vagas_ocupadas: modelo.vagas_ocupadas + 1}, synchronize_session=False)
    db.commit()
    return (atualizadas > 0), None


def liberar_vaga(db: Session, *, contexto_tipo: str, id_contexto: int, categoria_cota: Optional[str]) -> None:
    """Libera exatamente a fonte usada na reserva (a cota da categoria, ou o bucket genérico) -
    nunca decrementa uma fonte diferente. Só chamar pra quem realmente ocupava vaga (estava
    PRE_INSCRITO/CONFIRMADO) - nunca pra quem estava em LISTA_DE_ESPERA, que não tinha nada
    reservado."""
    if categoria_cota is not None:
        db.query(CotaInscricaoEvento).filter(
            CotaInscricaoEvento.contexto_tipo == contexto_tipo, CotaInscricaoEvento.id_contexto == id_contexto,
            CotaInscricaoEvento.categoria == categoria_cota, CotaInscricaoEvento.vagas_ocupadas > 0,
        ).update({CotaInscricaoEvento.vagas_ocupadas: CotaInscricaoEvento.vagas_ocupadas - 1}, synchronize_session=False)
        db.commit()
        return

    modelo, campo_id = _MODELO_POR_CONTEXTO[contexto_tipo]
    campo_pk = getattr(modelo, campo_id)
    registro = db.query(modelo).filter(campo_pk == id_contexto).first()
    if registro is None or registro.vagas is None:
        return
    db.query(modelo).filter(campo_pk == id_contexto, modelo.vagas_ocupadas > 0).update(
        {modelo.vagas_ocupadas: modelo.vagas_ocupadas - 1}, synchronize_session=False,
    )
    db.commit()


def inscrever_com_controle_de_vaga(
    db: Session, *, contexto_tipo: str, id_contexto: int, id_pessoa: int, respostas_formulario: Optional[dict],
    codigo_checkin: Optional[str] = None, token_cancelamento: Optional[str] = None,
    consentimento_lgpd_versao: Optional[str] = None, identificador_grupo: Optional[str] = None,
) -> Inscricao:
    """Ponto de entrada único pra inscrever alguém respeitando vaga/cota - acima do limite, vira
    LISTA_DE_ESPERA automaticamente, nunca um erro pra quem se inscreve (a pessoa está na fila,
    não foi recusada)."""
    categoria = categoria_da_pessoa(db, id_pessoa=id_pessoa)
    conseguiu, categoria_cota = reservar_vaga(db, contexto_tipo=contexto_tipo, id_contexto=id_contexto, categoria=categoria)
    status_inicial = PRE_INSCRITO if conseguiu else LISTA_DE_ESPERA
    return servico_inscricao.inscrever(
        db, contexto_tipo=contexto_tipo, id_contexto=id_contexto, id_pessoa=id_pessoa,
        respostas_formulario=respostas_formulario, codigo_checkin=codigo_checkin,
        token_cancelamento=token_cancelamento, consentimento_lgpd_versao=consentimento_lgpd_versao,
        status_inicial=status_inicial, categoria_cota=categoria_cota, identificador_grupo=identificador_grupo,
    )


def promover_proximo_da_espera(db: Session, *, contexto_tipo: str, id_contexto: int, categoria_cota: Optional[str]) -> Optional[Inscricao]:
    """Promove o próximo da lista de espera (FIFO por `data_inscricao`) pra uma vaga que acabou
    de abrir NA MESMA categoria/bucket (`categoria_cota` igual - nunca promove alguém de uma
    categoria pra vaga liberada de outra)."""
    proximo = (
        db.query(Inscricao)
        .filter(
            Inscricao.contexto_tipo == contexto_tipo, Inscricao.id_contexto == id_contexto,
            Inscricao.status == LISTA_DE_ESPERA, Inscricao.categoria_cota == categoria_cota,
        )
        .order_by(Inscricao.data_inscricao)
        .first()
    )
    if proximo is None:
        return None

    conseguiu, _ = reservar_vaga(db, contexto_tipo=contexto_tipo, id_contexto=id_contexto, categoria=categoria_da_pessoa(db, id_pessoa=proximo.id_pessoa))
    if not conseguiu:
        return None  # não devia acontecer (uma vaga acabou de ser liberada) - nunca assume, só confirma

    prazo_horas = int(obter_configuracao(db, "PRAZO_CONFIRMACAO_LISTA_ESPERA_HORAS", "24") or "24")
    proximo.status = PRE_INSCRITO
    proximo.prazo_confirmacao = datetime.utcnow() + timedelta(hours=prazo_horas)
    db.commit()
    db.refresh(proximo)

    try:
        pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == proximo.id_pessoa).first()
        if pessoa and pessoa.email_contato:
            notificacoes.enviar_email(
                pessoa.email_contato, assunto="Uma vaga abriu para você!",
                corpo_texto=(
                    f"Uma vaga abriu na inscrição em que você estava na lista de espera.\n\n"
                    f"Você tem até {proximo.prazo_confirmacao.strftime('%d/%m/%Y %H:%M')} (UTC) para confirmar, "
                    f"usando o mesmo link/código já enviado - depois disso a vaga passa para o próximo da fila."
                ),
            )
    except Exception:
        pass  # e-mail é conveniência, nunca trava a promoção em si (mesma decisão da v4.6)

    return proximo


def cancelar_e_promover_por_token(db: Session, *, token_cancelamento: str) -> Inscricao:
    """Autocancelamento (v4.6) agora libera a vaga de verdade e promove o próximo da fila."""
    alvo = db.query(Inscricao).filter(Inscricao.token_cancelamento == token_cancelamento).first()
    if not alvo:
        raise HTTPException(status_code=404, detail="Link de cancelamento inválido.")
    status_anterior, contexto_tipo, id_contexto, categoria_cota = alvo.status, alvo.contexto_tipo, alvo.id_contexto, alvo.categoria_cota

    cancelada = servico_inscricao.cancelar_por_token(db, token_cancelamento=token_cancelamento)

    if status_anterior in (PRE_INSCRITO, CONFIRMADO):
        liberar_vaga(db, contexto_tipo=contexto_tipo, id_contexto=id_contexto, categoria_cota=categoria_cota)
        promover_proximo_da_espera(db, contexto_tipo=contexto_tipo, id_contexto=id_contexto, categoria_cota=categoria_cota)
    return cancelada


def expirar_promocoes_vencidas(db: Session) -> list[dict]:
    """Quem foi promovido da lista de espera e não confirmou até `prazo_confirmacao` perde a
    vaga pro próximo da fila - chamado periodicamente (ver scripts/expirar_promocoes_vagas.py e
    o workflow agendado), nunca só quando alguém abre a tela por acaso."""
    agora = datetime.utcnow()
    vencidas = db.query(Inscricao).filter(
        Inscricao.status == PRE_INSCRITO, Inscricao.prazo_confirmacao.isnot(None), Inscricao.prazo_confirmacao < agora,
    ).all()

    resultado = []
    for insc in vencidas:
        contexto_tipo, id_contexto, categoria_cota = insc.contexto_tipo, insc.id_contexto, insc.categoria_cota
        servico_inscricao.alterar_status(db, id_inscricao=insc.id_inscricao, novo_status=CANCELADO)
        insc.prazo_confirmacao = None
        db.commit()
        liberar_vaga(db, contexto_tipo=contexto_tipo, id_contexto=id_contexto, categoria_cota=categoria_cota)
        promovido = promover_proximo_da_espera(db, contexto_tipo=contexto_tipo, id_contexto=id_contexto, categoria_cota=categoria_cota)
        resultado.append({"id_inscricao": insc.id_inscricao, "id_promovido": promovido.id_inscricao if promovido else None})
    return resultado
