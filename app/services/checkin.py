"""v4.8 (FASE 4) - check-in/check-out da portaria, sem login de quem opera (token de operação
escopado a um evento, ver app/services/portaria.py). Resolve a pessoa por código curto (que
também é o conteúdo do QR - o QR só decodifica pro mesmo código, não existe uma segunda via de
resolução no servidor) ou por carteirinha digital (v1.1), e grava no motor de presença genérico
da v4.0 (app/services/presenca.py), nunca um mecanismo próprio.

Idempotência: toda ação carrega uma `chave_idempotencia` gerada pelo cliente (a fila offline do
navegador nunca a regenera num reenvio) - checada primeiro, sempre, antes de qualquer outra
coisa. Isto é o que permite a portaria funcionar offline: reenviar a mesma ação depois de
reconectar nunca duplica um RegistroPresenca."""
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.eventos import SessaoEvento
from app.models.motores import AUSENTE, CANCELADO, CONFIRMADO, LISTA_DE_ESPERA, PRESENTE, PRE_INSCRITO, Inscricao, RegistroPresenca
from app.models.portaria import OperacaoPortariaIdempotente
from app.security import decodificar_token_carteirinha
from app.services import inscricao as servico_inscricao
from app.services import presenca as servico_presenca
from app.services.eventos import CONTEXTO_EVENTO, CONTEXTO_SESSAO_EVENTO

METODO_CODIGO = "codigo"
METODO_CARTEIRINHA = "carteirinha"
METODOS_VALIDOS = {METODO_CODIGO, METODO_CARTEIRINHA}


def _resolver_contexto_pedido(db: Session, *, id_evento: int, id_sessao: Optional[int]) -> tuple[str, int]:
    if id_sessao is None:
        return CONTEXTO_EVENTO, id_evento
    sessao = db.query(SessaoEvento).filter(SessaoEvento.id_sessao == id_sessao).first()
    if not sessao or sessao.id_evento != id_evento:
        raise HTTPException(status_code=404, detail="Sessão não encontrada para este evento.")
    return CONTEXTO_SESSAO_EVENTO, id_sessao


def _contexto_pertence_ao_evento(db: Session, *, contexto_tipo: str, id_contexto: int, id_evento: int) -> bool:
    if contexto_tipo == CONTEXTO_EVENTO:
        return id_contexto == id_evento
    if contexto_tipo == CONTEXTO_SESSAO_EVENTO:
        sessao = db.query(SessaoEvento).filter(SessaoEvento.id_sessao == id_contexto).first()
        return bool(sessao and sessao.id_evento == id_evento)
    return False


def _operacao_existente(db: Session, chave_idempotencia: str) -> Optional[RegistroPresenca]:
    operacao = db.query(OperacaoPortariaIdempotente).filter(
        OperacaoPortariaIdempotente.chave_idempotencia == chave_idempotencia
    ).first()
    if not operacao:
        return None
    return db.query(RegistroPresenca).filter(RegistroPresenca.id_registro == operacao.id_registro_presenca).first()


def _registrar_idempotencia(db: Session, *, chave_idempotencia: str, id_registro_presenca: int, tipo: str) -> None:
    db.add(OperacaoPortariaIdempotente(
        chave_idempotencia=chave_idempotencia, id_registro_presenca=id_registro_presenca, tipo=tipo,
    ))
    db.commit()


def _resolver_pessoa_e_inscricao_por_codigo(db: Session, *, codigo: str, id_evento: int) -> Inscricao:
    inscricao_encontrada = db.query(Inscricao).filter(Inscricao.codigo_checkin == codigo).first()
    if not inscricao_encontrada:
        raise HTTPException(status_code=404, detail="Código de check-in não encontrado.")
    if not _contexto_pertence_ao_evento(
        db, contexto_tipo=inscricao_encontrada.contexto_tipo, id_contexto=inscricao_encontrada.id_contexto, id_evento=id_evento,
    ):
        raise HTTPException(status_code=404, detail="Este código de check-in não pertence a este evento.")
    return inscricao_encontrada


def _resolver_pessoa_e_inscricao_por_carteirinha(
    db: Session, *, token_carteirinha: str, contexto_tipo: str, id_contexto: int,
) -> tuple[int, Optional[Inscricao]]:
    payload = decodificar_token_carteirinha(token_carteirinha)
    id_pessoa = payload["id_pessoa"]
    inscricao_encontrada = db.query(Inscricao).filter(
        Inscricao.contexto_tipo == contexto_tipo, Inscricao.id_contexto == id_contexto, Inscricao.id_pessoa == id_pessoa,
    ).first()
    return id_pessoa, inscricao_encontrada


def _confirmar_presenca_na_inscricao(db: Session, inscricao_registro: Inscricao) -> None:
    """Move a inscrição pro status PRESENTE respeitando a máquina de estados do motor genérico
    (`app/services/inscricao.py::_TRANSICOES_VALIDAS`, que não tem transição direta
    PRE_INSCRITO -> PRESENTE - chegar na portaria é confirmação implícita, então passa por
    CONFIRMADO no caminho). LISTA_DE_ESPERA nunca vira PRESENTE pela portaria - isso reservaria
    vaga por um canal que não passa pelo controle atômico da v4.7 (app/services/vagas.py); quem
    está na lista de espera só entra se alguém com permissão confirmar antes pelo caminho normal."""
    if inscricao_registro.status == CANCELADO:
        raise HTTPException(status_code=400, detail="Esta inscrição foi cancelada - check-in recusado.")
    if inscricao_registro.status == LISTA_DE_ESPERA:
        raise HTTPException(status_code=400, detail="Esta inscrição está na lista de espera, sem vaga confirmada.")
    if inscricao_registro.status == AUSENTE:
        raise HTTPException(status_code=400, detail="Esta inscrição já foi marcada como ausente.")
    if inscricao_registro.status == PRESENTE:
        return
    if inscricao_registro.status == PRE_INSCRITO:
        servico_inscricao.alterar_status(db, id_inscricao=inscricao_registro.id_inscricao, novo_status=CONFIRMADO)
    servico_inscricao.alterar_status(db, id_inscricao=inscricao_registro.id_inscricao, novo_status=PRESENTE)


def realizar_checkin(
    db: Session, *, id_evento: int, id_sessao: Optional[int], metodo: str, codigo: Optional[str],
    token_carteirinha: Optional[str], chave_idempotencia: str,
) -> RegistroPresenca:
    existente = _operacao_existente(db, chave_idempotencia)
    if existente is not None:
        return existente

    if metodo not in METODOS_VALIDOS:
        raise HTTPException(status_code=422, detail="Método de check-in inválido - use 'codigo' ou 'carteirinha'.")

    if metodo == METODO_CODIGO:
        if not codigo:
            raise HTTPException(status_code=422, detail="Informe o código de check-in.")
        inscricao_registro = _resolver_pessoa_e_inscricao_por_codigo(db, codigo=codigo, id_evento=id_evento)
        contexto_tipo, id_contexto = inscricao_registro.contexto_tipo, inscricao_registro.id_contexto
        id_pessoa = inscricao_registro.id_pessoa
    else:
        if not token_carteirinha:
            raise HTTPException(status_code=422, detail="Informe a carteirinha digital.")
        contexto_tipo, id_contexto = _resolver_contexto_pedido(db, id_evento=id_evento, id_sessao=id_sessao)
        id_pessoa, inscricao_registro = _resolver_pessoa_e_inscricao_por_carteirinha(
            db, token_carteirinha=token_carteirinha, contexto_tipo=contexto_tipo, id_contexto=id_contexto,
        )
        if inscricao_registro is None:
            # Walk-in: apareceu na portaria sem inscrição prévia - inscrição nasce direto como
            # PRESENTE (nunca passa pelo controle de vaga da v4.7; quem opera a portaria decidiu
            # deixar entrar, isso já é a decisão).
            inscricao_registro = servico_inscricao.inscrever(
                db, contexto_tipo=contexto_tipo, id_contexto=id_contexto, id_pessoa=id_pessoa,
                respostas_formulario=None, status_inicial=PRESENTE,
            )

    _confirmar_presenca_na_inscricao(db, inscricao_registro)

    registro = servico_presenca.registrar_entrada(
        db, contexto_tipo=contexto_tipo, id_contexto=id_contexto, id_pessoa=id_pessoa,
        meio_registro=metodo, id_usuario_operador=None,
    )
    _registrar_idempotencia(db, chave_idempotencia=chave_idempotencia, id_registro_presenca=registro.id_registro, tipo="entrada")
    return registro


def realizar_checkout(
    db: Session, *, id_evento: int, id_sessao: Optional[int], metodo: str, codigo: Optional[str],
    token_carteirinha: Optional[str], chave_idempotencia: str,
) -> RegistroPresenca:
    existente = _operacao_existente(db, chave_idempotencia)
    if existente is not None:
        return existente

    if metodo not in METODOS_VALIDOS:
        raise HTTPException(status_code=422, detail="Método de check-out inválido - use 'codigo' ou 'carteirinha'.")

    if metodo == METODO_CODIGO:
        if not codigo:
            raise HTTPException(status_code=422, detail="Informe o código de check-in.")
        inscricao_registro = _resolver_pessoa_e_inscricao_por_codigo(db, codigo=codigo, id_evento=id_evento)
        contexto_tipo, id_contexto, id_pessoa = inscricao_registro.contexto_tipo, inscricao_registro.id_contexto, inscricao_registro.id_pessoa
    else:
        if not token_carteirinha:
            raise HTTPException(status_code=422, detail="Informe a carteirinha digital.")
        contexto_tipo, id_contexto = _resolver_contexto_pedido(db, id_evento=id_evento, id_sessao=id_sessao)
        payload = decodificar_token_carteirinha(token_carteirinha)
        id_pessoa = payload["id_pessoa"]

    # Resolve pela chave natural (contexto + pessoa + sem saída), nunca pelo id do registro - o
    # cliente offline pode nunca ter recebido o id do check-in se ele ainda não sincronizou.
    aberto = db.query(RegistroPresenca).filter(
        RegistroPresenca.contexto_tipo == contexto_tipo, RegistroPresenca.id_contexto == id_contexto,
        RegistroPresenca.id_pessoa == id_pessoa, RegistroPresenca.hora_saida.is_(None),
    ).first()
    if not aberto:
        raise HTTPException(status_code=404, detail="Não há check-in em aberto para esta pessoa neste contexto.")

    registro = servico_presenca.registrar_saida(db, id_registro=aberto.id_registro, id_usuario_operador=None)
    _registrar_idempotencia(db, chave_idempotencia=chave_idempotencia, id_registro_presenca=registro.id_registro, tipo="saida")
    return registro
