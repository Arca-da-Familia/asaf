"""v4.3 (FASE 4) - reserva de espaço: cadastro de espaço/bloqueio, fluxo de reserva (instantânea
ou aprovação manual, conforme o espaço), cancelamento/no-show e checklist de devolução. A
disponibilidade pública (`GET /api/espacos/{id}/disponibilidade`) é a ÚNICA rota deste módulo sem
autenticação - leitura de horário ocupado pro site institucional, nunca expõe quem reservou."""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.schemas.espacos import (
    BloqueioEspacoCriar,
    EspacoCriar,
    RegistrarDevolucao,
    RegistrarRetirada,
    ReservaCancelar,
    ReservaCriar,
    ReservaRecorrenteCriar,
    ReservaRecusar,
)
from app.security import exigir_permissao
from app.services import espacos, reservas

router = APIRouter()
_permissao_projetos = exigir_permissao("projetos")


def _ip_origem(request: Request) -> str:
    return request.client.host if request.client else None


def _serializar_espaco(e) -> dict:
    return {
        "id_espaco": e.id_espaco, "nome": e.nome, "tipo": e.tipo, "capacidade": e.capacidade,
        "recursos_disponiveis": e.recursos_disponiveis, "regras_uso": e.regras_uso,
        "horario_funcionamento_inicio": e.horario_funcionamento_inicio, "horario_funcionamento_fim": e.horario_funcionamento_fim,
        "exige_aprovacao": e.exige_aprovacao, "valor_reserva": e.valor_reserva,
        "isento_para_associado_adimplente": e.isento_para_associado_adimplente,
        "id_conta_contabil_receita": e.id_conta_contabil_receita, "prazo_cancelamento_horas": e.prazo_cancelamento_horas,
        "taxa_cancelamento_tardio": e.taxa_cancelamento_tardio, "limite_no_show_bloqueio": e.limite_no_show_bloqueio,
        "ativo": e.ativo,
    }


def _serializar_reserva(r) -> dict:
    return {
        "id_reserva": r.id_reserva, "id_espaco": r.id_espaco, "id_associado_solicitante": r.id_associado_solicitante,
        "data_hora_inicio": r.data_hora_inicio, "data_hora_fim": r.data_hora_fim, "finalidade": r.finalidade,
        "status": r.status, "motivo_status": r.motivo_status, "id_titulo_cobranca": r.id_titulo_cobranca,
        "identificador_serie": r.identificador_serie,
    }


# ==========================================
# ESPAÇO
# ==========================================
@router.post("/api/espacos/", summary="Cadastrar Espaço")
def criar_espaco_endpoint(dados: EspacoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    espaco = espacos.criar_espaco(
        db, nome=dados.nome, tipo=dados.tipo, capacidade=dados.capacidade, recursos_disponiveis=dados.recursos_disponiveis,
        regras_uso=dados.regras_uso, horario_funcionamento_inicio=dados.horario_funcionamento_inicio,
        horario_funcionamento_fim=dados.horario_funcionamento_fim, exige_aprovacao=dados.exige_aprovacao,
        valor_reserva=dados.valor_reserva, isento_para_associado_adimplente=dados.isento_para_associado_adimplente,
        id_conta_contabil_receita=dados.id_conta_contabil_receita, prazo_cancelamento_horas=dados.prazo_cancelamento_horas,
        taxa_cancelamento_tardio=dados.taxa_cancelamento_tardio, limite_no_show_bloqueio=dados.limite_no_show_bloqueio,
    )
    registrar_auditoria(
        db, usuario, "espacos", "CREATE", id_registro_afetado=espaco.id_espaco,
        dados_depois={"nome": espaco.nome, "tipo": espaco.tipo}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Espaço cadastrado.", "id_espaco": espaco.id_espaco}


@router.get("/api/espacos/", summary="Listar Espaços")
def listar_espacos_endpoint(db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [_serializar_espaco(e) for e in espacos.listar_espacos(db)]


@router.get("/api/espacos/{id_espaco}/disponibilidade", summary="Disponibilidade pública do espaço (leitura, sem autenticação, nunca expõe quem reservou)")
def disponibilidade_publica_endpoint(id_espaco: int, db: Session = Depends(get_db)):
    return espacos.disponibilidade_publica(db, id_espaco=id_espaco)


@router.post("/api/espacos/{id_espaco}/bloqueios", summary="Registrar bloqueio do espaço (manutenção, feriado, uso institucional)")
def criar_bloqueio_endpoint(id_espaco: int, dados: BloqueioEspacoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    bloqueio = espacos.criar_bloqueio(
        db, id_espaco=id_espaco, data_hora_inicio=dados.data_hora_inicio, data_hora_fim=dados.data_hora_fim,
        motivo=dados.motivo, descricao=dados.descricao, id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "bloqueios_espaco", "CREATE", id_registro_afetado=bloqueio.id_bloqueio,
        dados_depois={"id_espaco": bloqueio.id_espaco, "motivo": bloqueio.motivo}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Bloqueio registrado.", "id_bloqueio": bloqueio.id_bloqueio}


@router.get("/api/espacos/{id_espaco}/bloqueios", summary="Listar bloqueios do espaço")
def listar_bloqueios_endpoint(id_espaco: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [
        {"id_bloqueio": b.id_bloqueio, "data_hora_inicio": b.data_hora_inicio, "data_hora_fim": b.data_hora_fim, "motivo": b.motivo, "descricao": b.descricao}
        for b in espacos.listar_bloqueios(db, id_espaco=id_espaco)
    ]


# ==========================================
# RESERVA
# ==========================================
@router.post("/api/reservas-espaco/", summary="Criar Reserva (instantânea ou solicitação, conforme o espaço)")
def criar_reserva_endpoint(dados: ReservaCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    reserva = reservas.criar_reserva(
        db, id_espaco=dados.id_espaco, id_associado_solicitante=dados.id_associado_solicitante,
        data_hora_inicio=dados.data_hora_inicio, data_hora_fim=dados.data_hora_fim, finalidade=dados.finalidade,
        id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "reservas_espaco", "CREATE", id_registro_afetado=reserva.id_reserva,
        dados_depois={"id_espaco": reserva.id_espaco, "status": reserva.status}, ip_origem=_ip_origem(request),
    )
    return _serializar_reserva(reserva)


@router.post("/api/reservas-espaco/recorrente", summary="Criar Reserva Recorrente (N ocorrências semanais, tratadas individualmente)")
def criar_reserva_recorrente_endpoint(dados: ReservaRecorrenteCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    resultado = reservas.criar_reserva_recorrente(
        db, id_espaco=dados.id_espaco, id_associado_solicitante=dados.id_associado_solicitante,
        data_hora_inicio=dados.data_hora_inicio, data_hora_fim=dados.data_hora_fim, finalidade=dados.finalidade,
        quantidade_semanas=dados.quantidade_semanas, id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "reservas_espaco", "CREATE_RECORRENTE", dados_depois={"id_espaco": dados.id_espaco, "quantidade_semanas": dados.quantidade_semanas, "ocorrencias": resultado},
        ip_origem=_ip_origem(request),
    )
    return {"ocorrencias": resultado}


@router.get("/api/reservas-espaco/", summary="Listar Reservas")
def listar_reservas_endpoint(id_espaco: int = None, id_associado_solicitante: int = None, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [_serializar_reserva(r) for r in reservas.listar_reservas(db, id_espaco=id_espaco, id_associado_solicitante=id_associado_solicitante)]


@router.post("/api/reservas-espaco/{id_reserva}/aprovar", summary="Aprovar Reserva solicitada")
def aprovar_reserva_endpoint(id_reserva: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    reserva = reservas.aprovar_reserva(db, id_reserva=id_reserva)
    registrar_auditoria(db, usuario, "reservas_espaco", "APROVACAO", id_registro_afetado=reserva.id_reserva, ip_origem=_ip_origem(request))
    return _serializar_reserva(reserva)


@router.post("/api/reservas-espaco/{id_reserva}/recusar", summary="Recusar Reserva solicitada")
def recusar_reserva_endpoint(id_reserva: int, dados: ReservaRecusar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    reserva = reservas.recusar_reserva(db, id_reserva=id_reserva, motivo=dados.motivo)
    registrar_auditoria(db, usuario, "reservas_espaco", "RECUSA", id_registro_afetado=reserva.id_reserva, dados_depois={"motivo": dados.motivo}, ip_origem=_ip_origem(request))
    return _serializar_reserva(reserva)


@router.post("/api/reservas-espaco/{id_reserva}/cancelar", summary="Cancelar Reserva (pode gerar taxa se fora do prazo)")
def cancelar_reserva_endpoint(id_reserva: int, dados: ReservaCancelar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    reserva = reservas.cancelar_reserva(db, id_reserva=id_reserva, motivo=dados.motivo, id_usuario=usuario.id_usuario)
    registrar_auditoria(db, usuario, "reservas_espaco", "CANCELAMENTO", id_registro_afetado=reserva.id_reserva, dados_depois={"motivo": dados.motivo}, ip_origem=_ip_origem(request))
    return _serializar_reserva(reserva)


@router.post("/api/reservas-espaco/{id_reserva}/nao-compareceu", summary="Marcar não comparecimento (no-show)")
def marcar_no_show_endpoint(id_reserva: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    reserva = reservas.marcar_no_show(db, id_reserva=id_reserva)
    registrar_auditoria(db, usuario, "reservas_espaco", "NAO_COMPARECEU", id_registro_afetado=reserva.id_reserva, ip_origem=_ip_origem(request))
    return _serializar_reserva(reserva)


# ==========================================
# CHECKLIST DE ENTREGA/DEVOLUÇÃO
# ==========================================
@router.post("/api/reservas-espaco/{id_reserva}/retirada", summary="Registrar retirada do espaço (checklist)")
def registrar_retirada_endpoint(id_reserva: int, dados: RegistrarRetirada, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    checklist = reservas.registrar_retirada(db, id_reserva=id_reserva, condicao_retirada=dados.condicao_retirada, id_usuario=usuario.id_usuario)
    registrar_auditoria(db, usuario, "checklists_devolucao_espaco", "RETIRADA", id_registro_afetado=checklist.id_checklist, ip_origem=_ip_origem(request))
    return {"mensagem": "Retirada registrada.", "id_checklist": checklist.id_checklist}


@router.post("/api/reservas-espaco/{id_reserva}/devolucao", summary="Registrar devolução do espaço (checklist, com avaria se houver)")
def registrar_devolucao_endpoint(id_reserva: int, dados: RegistrarDevolucao, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    checklist = reservas.registrar_devolucao(
        db, id_reserva=id_reserva, condicao_devolucao=dados.condicao_devolucao, houve_avaria=dados.houve_avaria,
        descricao_avaria=dados.descricao_avaria, id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "checklists_devolucao_espaco", "DEVOLUCAO", id_registro_afetado=checklist.id_checklist,
        dados_depois={"houve_avaria": checklist.houve_avaria}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Devolução registrada.", "houve_avaria": checklist.houve_avaria}


@router.get("/api/reservas-espaco/{id_reserva}/checklist", summary="Ver checklist de entrega/devolução da reserva")
def obter_checklist_endpoint(id_reserva: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    checklist = reservas.obter_checklist(db, id_reserva)
    if not checklist:
        return None
    return {
        "condicao_retirada": checklist.condicao_retirada, "data_retirada": checklist.data_retirada,
        "condicao_devolucao": checklist.condicao_devolucao, "houve_avaria": checklist.houve_avaria,
        "descricao_avaria": checklist.descricao_avaria, "data_devolucao": checklist.data_devolucao,
    }
