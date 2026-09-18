"""v4.1 (FASE 4) - Projeto como entidade única e configurável. Reaproveita os motores
compartilhados (v4.0) para indicador e o `Orcamento`/`realizado_do_orcamento` (v3.5) para
execução financeira - nunca um mecanismo próprio de indicador/orçamento duplicado aqui."""
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.associados import Associado
from app.models.core import Usuario
from app.models.financeiro import CentroDeCusto
from app.models.projetos import (
    STATUS_ATRASADO,
    STATUS_CONCLUIDO,
    STATUS_PENDENTE,
    AlocacaoVoluntario,
    EquipeProjeto,
    ItemCronograma,
    ProjetoEvento,
    RelatorioFinalProjeto,
    TrocaTurnoVoluntario,
    VagaEscalaVoluntario,
)
from app.models.voluntariado import RegistroHorasVoluntariado
from app.services import indicadores as servico_indicadores
from app.services import orcamento as servico_orcamento
from app.services.catalogos import validar_codigo_em_catalogo
from app.services.voluntariado import termo_vigente

CONTEXTO_PROJETO = "Projeto"


def criar_projeto(
    db: Session, *, nome_projeto: str, tipo_foco: str, necessita_alvara_bombeiros: bool,
    data_inicio: datetime, data_fim_prevista: datetime, descricao: Optional[str], tipo_projeto: Optional[str],
    id_associado_responsavel: Optional[int], publico_alvo: Optional[str], id_centro_custo: Optional[int],
    visibilidade: str, id_usuario: Optional[int],
) -> ProjetoEvento:
    if tipo_projeto is not None:
        validar_codigo_em_catalogo(db, "tipo_projeto", tipo_projeto, "Tipo de projeto")
    if id_associado_responsavel is not None and not db.query(Associado).filter(Associado.id_associado == id_associado_responsavel).first():
        raise HTTPException(status_code=404, detail="Associado responsável não encontrado.")
    if id_centro_custo is not None and not db.query(CentroDeCusto).filter(CentroDeCusto.id_centro_custo == id_centro_custo).first():
        raise HTTPException(status_code=404, detail="Centro de custo não encontrado.")

    projeto = ProjetoEvento(
        nome_projeto=nome_projeto, tipo_foco=tipo_foco, necessita_alvara_bombeiros=necessita_alvara_bombeiros,
        data_inicio=data_inicio, data_fim_prevista=data_fim_prevista, descricao=descricao, tipo_projeto=tipo_projeto,
        status="PLANEJAMENTO", id_associado_responsavel=id_associado_responsavel,
        publico_alvo=publico_alvo, id_centro_custo=id_centro_custo, visibilidade=visibilidade, id_usuario_criacao=id_usuario,
    )
    if projeto.necessita_alvara_bombeiros:
        projeto.status_liberacao = "Pendente de Vistoria"
    db.add(projeto)
    db.commit()
    db.refresh(projeto)
    return projeto


def alterar_status_projeto(db: Session, *, id_projeto: int, novo_status: str) -> ProjetoEvento:
    validar_codigo_em_catalogo(db, "status_projeto", novo_status, "Status do projeto")
    projeto = db.query(ProjetoEvento).filter(ProjetoEvento.id_projeto == id_projeto).first()
    if not projeto:
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")
    projeto.status = novo_status
    db.commit()
    db.refresh(projeto)
    return projeto


def listar_projetos(db: Session) -> list[ProjetoEvento]:
    return db.query(ProjetoEvento).order_by(ProjetoEvento.criado_em.desc()).all()


def obter_projeto(db: Session, id_projeto: int) -> ProjetoEvento:
    projeto = db.query(ProjetoEvento).filter(ProjetoEvento.id_projeto == id_projeto).first()
    if not projeto:
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")
    return projeto


def _exigir_termo_vigente_ou_403(db: Session, id_pessoa: int) -> None:
    if not termo_vigente(db, id_pessoa):
        raise HTTPException(status_code=403, detail="Voluntário sem termo de adesão vigente - não pode ser alocado em projeto.")


def alocar_voluntario(
    db: Session, *, id_projeto: int, id_associado: int, funcao_desempenhada: str,
    turno_data_hora_inicio: Optional[datetime] = None, turno_data_hora_fim: Optional[datetime] = None,
    habilidades_exigidas: Optional[str] = None, horas_previstas: float = 0.0, id_usuario: Optional[int] = None,
):
    if not db.query(ProjetoEvento).filter(ProjetoEvento.id_projeto == id_projeto).first():
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    if not associado:
        raise HTTPException(status_code=404, detail="Associado não encontrado.")
    _exigir_termo_vigente_ou_403(db, associado.id_pessoa)
    if habilidades_exigidas:
        for codigo in habilidades_exigidas.split(","):
            if codigo.strip():
                validar_codigo_em_catalogo(db, "habilidade_voluntario", codigo.strip(), "Habilidade exigida")

    # Alocação direta pela equipe (não passa por candidatura/escala) já nasce CONFIRMADA - fluxo
    # original desde a v2.9, mantido para quem já usa isto assim.
    alocacao = AlocacaoVoluntario(
        id_projeto=id_projeto, id_associado=id_associado, funcao_desempenhada=funcao_desempenhada,
        turno_data_hora_inicio=turno_data_hora_inicio, turno_data_hora_fim=turno_data_hora_fim,
        habilidades_exigidas=habilidades_exigidas, horas_previstas=horas_previstas, status="CONFIRMADA",
        id_usuario_criacao=id_usuario,
    )
    db.add(alocacao)
    db.commit()
    db.refresh(alocacao)
    return alocacao


# ==========================================
# CRONOGRAMA (status sempre derivado, nunca escolhido à mão)
# ==========================================
def status_item_cronograma(item: ItemCronograma) -> str:
    if item.concluido_em is not None:
        return STATUS_CONCLUIDO
    if item.prazo < datetime.utcnow():
        return STATUS_ATRASADO
    return STATUS_PENDENTE


def criar_item_cronograma(db: Session, *, id_projeto: int, tipo: str, titulo: str, prazo: datetime, id_associado_responsavel: Optional[int], id_usuario: Optional[int]) -> ItemCronograma:
    if not db.query(ProjetoEvento).filter(ProjetoEvento.id_projeto == id_projeto).first():
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")
    if id_associado_responsavel is not None and not db.query(Associado).filter(Associado.id_associado == id_associado_responsavel).first():
        raise HTTPException(status_code=404, detail="Associado responsável não encontrado.")

    item = ItemCronograma(
        id_projeto=id_projeto, tipo=tipo, titulo=titulo, prazo=prazo,
        id_associado_responsavel=id_associado_responsavel, id_usuario_criacao=id_usuario,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def concluir_item_cronograma(db: Session, *, id_item: int) -> ItemCronograma:
    item = db.query(ItemCronograma).filter(ItemCronograma.id_item == id_item).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item de cronograma não encontrado.")
    if item.concluido_em is not None:
        raise HTTPException(status_code=400, detail="Este item já está concluído.")
    item.concluido_em = datetime.utcnow()
    db.commit()
    db.refresh(item)
    return item


def listar_cronograma(db: Session, *, id_projeto: int) -> list[dict]:
    itens = db.query(ItemCronograma).filter(ItemCronograma.id_projeto == id_projeto).order_by(ItemCronograma.prazo).all()
    return [
        {
            "id_item": i.id_item, "tipo": i.tipo, "titulo": i.titulo, "prazo": i.prazo,
            "id_associado_responsavel": i.id_associado_responsavel, "concluido_em": i.concluido_em,
            "status": status_item_cronograma(i),
        }
        for i in itens
    ]


# ==========================================
# EQUIPE DO PROJETO
# ==========================================
def adicionar_membro_equipe(db: Session, *, id_projeto: int, id_associado: int, papel: str) -> EquipeProjeto:
    if not db.query(ProjetoEvento).filter(ProjetoEvento.id_projeto == id_projeto).first():
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")
    if not db.query(Associado).filter(Associado.id_associado == id_associado).first():
        raise HTTPException(status_code=404, detail="Associado não encontrado.")
    validar_codigo_em_catalogo(db, "papel_equipe_projeto", papel, "Papel na equipe")

    ja_ativo = db.query(EquipeProjeto).filter(
        EquipeProjeto.id_projeto == id_projeto, EquipeProjeto.id_associado == id_associado, EquipeProjeto.data_fim.is_(None),
    ).first()
    if ja_ativo:
        raise HTTPException(status_code=400, detail="Este associado já está ativo na equipe deste projeto.")

    membro = EquipeProjeto(id_projeto=id_projeto, id_associado=id_associado, papel=papel)
    db.add(membro)
    db.commit()
    db.refresh(membro)
    return membro


def encerrar_participacao_equipe(db: Session, *, id_membro: int) -> EquipeProjeto:
    membro = db.query(EquipeProjeto).filter(EquipeProjeto.id_membro == id_membro).first()
    if not membro:
        raise HTTPException(status_code=404, detail="Participação na equipe não encontrada.")
    if membro.data_fim is not None:
        raise HTTPException(status_code=400, detail="Esta participação já foi encerrada.")
    membro.data_fim = datetime.utcnow()
    db.commit()
    db.refresh(membro)
    return membro


def eh_coordenador_do_projeto(db: Session, *, id_associado: int, id_projeto: int) -> bool:
    return db.query(EquipeProjeto).filter(
        EquipeProjeto.id_projeto == id_projeto, EquipeProjeto.id_associado == id_associado,
        EquipeProjeto.papel == "COORDENADOR", EquipeProjeto.data_fim.is_(None),
    ).first() is not None


def listar_equipe(db: Session, *, id_projeto: int) -> list[EquipeProjeto]:
    return db.query(EquipeProjeto).filter(EquipeProjeto.id_projeto == id_projeto).order_by(EquipeProjeto.data_inicio).all()


def exigir_coordenador_do_projeto(db: Session, *, usuario: Usuario, id_projeto: int) -> Associado:
    """v4.4 - só o coordenador ATIVO daquele projeto específico confirma/recusa candidatura,
    troca de turno ou aprova hora de voluntário - mesma disciplina de `app/services/
    beneficiarios.py::exigir_membro_da_equipe_do_vinculo`: nem `exigir_permissao("projetos")`
    sozinho, nem ser Presidente, dá esse poder por padrão."""
    associado = db.query(Associado).filter(Associado.id_usuario == usuario.id_usuario).first()
    if not associado or not eh_coordenador_do_projeto(db, id_associado=associado.id_associado, id_projeto=id_projeto):
        raise HTTPException(status_code=403, detail="Só o coordenador ativo deste projeto pode fazer isso.")
    return associado


def associado_do_usuario_ou_403(db: Session, usuario: Usuario) -> Associado:
    associado = db.query(Associado).filter(Associado.id_usuario == usuario.id_usuario).first()
    if not associado:
        raise HTTPException(status_code=403, detail="Só um associado pode fazer isso - este usuário não está vinculado a um associado.")
    return associado


# ==========================================
# ESCALA DE VOLUNTARIADO (v4.4) - autocandidatura a uma vaga de turno, confirmação/recusa do
# coordenador, troca entre voluntários e aprovação de horas. Visibilidade das telas de
# autoatendimento ("minha escala"/"meu histórico") é sempre filtrada pelo `Associado` do próprio
# usuário logado - nunca aceita `id_associado` vindo do cliente (preparação real pro RLS da
# v15.4, aplicada aqui na aplicação enquanto o banco não garante por si).
# ==========================================
def criar_vaga_escala(
    db: Session, *, id_projeto: int, funcao_desempenhada: str, habilidades_exigidas: Optional[str],
    turno_data_hora_inicio: datetime, turno_data_hora_fim: datetime, vagas_disponiveis: int,
    horas_previstas: float, id_usuario: Optional[int],
) -> VagaEscalaVoluntario:
    if not db.query(ProjetoEvento).filter(ProjetoEvento.id_projeto == id_projeto).first():
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")
    if turno_data_hora_fim <= turno_data_hora_inicio:
        raise HTTPException(status_code=422, detail="O fim do turno precisa ser depois do início.")
    if vagas_disponiveis < 1:
        raise HTTPException(status_code=422, detail="A vaga precisa de ao menos 1 posição disponível.")
    if habilidades_exigidas:
        for codigo in habilidades_exigidas.split(","):
            if codigo.strip():
                validar_codigo_em_catalogo(db, "habilidade_voluntario", codigo.strip(), "Habilidade exigida")

    vaga = VagaEscalaVoluntario(
        id_projeto=id_projeto, funcao_desempenhada=funcao_desempenhada, habilidades_exigidas=habilidades_exigidas,
        turno_data_hora_inicio=turno_data_hora_inicio, turno_data_hora_fim=turno_data_hora_fim,
        vagas_disponiveis=vagas_disponiveis, horas_previstas=horas_previstas, id_usuario_criacao=id_usuario,
    )
    db.add(vaga)
    db.commit()
    db.refresh(vaga)
    return vaga


def listar_vagas_escala(db: Session, *, id_projeto: Optional[int] = None) -> list[VagaEscalaVoluntario]:
    query = db.query(VagaEscalaVoluntario)
    if id_projeto is not None:
        query = query.filter(VagaEscalaVoluntario.id_projeto == id_projeto)
    return query.order_by(VagaEscalaVoluntario.turno_data_hora_inicio).all()


def _vagas_ocupadas(db: Session, id_vaga: int) -> int:
    return db.query(AlocacaoVoluntario).filter(
        AlocacaoVoluntario.id_vaga == id_vaga, AlocacaoVoluntario.status.in_(["PENDENTE", "CONFIRMADA"]),
    ).count()


def vagas_abertas(db: Session) -> list[dict]:
    """v4.4 - lista de vagas com posição livre, pra tela de autoatendimento do voluntário
    escolher onde se candidatar - nunca expõe dado de outro voluntário, só a vaga em si."""
    abertas = []
    for vaga in db.query(VagaEscalaVoluntario).order_by(VagaEscalaVoluntario.turno_data_hora_inicio).all():
        ocupadas = _vagas_ocupadas(db, vaga.id_vaga)
        if ocupadas < vaga.vagas_disponiveis:
            abertas.append({
                "id_vaga": vaga.id_vaga, "id_projeto": vaga.id_projeto, "funcao_desempenhada": vaga.funcao_desempenhada,
                "habilidades_exigidas": vaga.habilidades_exigidas, "turno_data_hora_inicio": vaga.turno_data_hora_inicio,
                "turno_data_hora_fim": vaga.turno_data_hora_fim, "vagas_disponiveis": vaga.vagas_disponiveis,
                "vagas_livres": vaga.vagas_disponiveis - ocupadas, "horas_previstas": vaga.horas_previstas,
            })
    return abertas


def candidatar_se_a_vaga(db: Session, *, id_vaga: int, usuario: Usuario) -> AlocacaoVoluntario:
    associado = associado_do_usuario_ou_403(db, usuario)
    vaga = db.query(VagaEscalaVoluntario).filter(VagaEscalaVoluntario.id_vaga == id_vaga).first()
    if not vaga:
        raise HTTPException(status_code=404, detail="Vaga de escala não encontrada.")
    _exigir_termo_vigente_ou_403(db, associado.id_pessoa)
    if _vagas_ocupadas(db, id_vaga) >= vaga.vagas_disponiveis:
        raise HTTPException(status_code=400, detail="Não há mais posições livres nesta vaga.")
    ja_candidatado = db.query(AlocacaoVoluntario).filter(
        AlocacaoVoluntario.id_vaga == id_vaga, AlocacaoVoluntario.id_associado == associado.id_associado,
        AlocacaoVoluntario.status.in_(["PENDENTE", "CONFIRMADA"]),
    ).first()
    if ja_candidatado:
        raise HTTPException(status_code=400, detail="Você já está candidatado(a) ou confirmado(a) nesta vaga.")

    alocacao = AlocacaoVoluntario(
        id_projeto=vaga.id_projeto, id_associado=associado.id_associado, funcao_desempenhada=vaga.funcao_desempenhada,
        id_vaga=vaga.id_vaga, turno_data_hora_inicio=vaga.turno_data_hora_inicio, turno_data_hora_fim=vaga.turno_data_hora_fim,
        habilidades_exigidas=vaga.habilidades_exigidas, horas_previstas=vaga.horas_previstas, status="PENDENTE",
        id_usuario_criacao=usuario.id_usuario,
    )
    db.add(alocacao)
    db.commit()
    db.refresh(alocacao)
    return alocacao


def obter_alocacao(db: Session, id_alocacao: int) -> AlocacaoVoluntario:
    alocacao = db.query(AlocacaoVoluntario).filter(AlocacaoVoluntario.id_alocacao == id_alocacao).first()
    if not alocacao:
        raise HTTPException(status_code=404, detail="Alocação de voluntário não encontrada.")
    return alocacao


def listar_candidaturas_pendentes(db: Session, *, id_projeto: int) -> list[AlocacaoVoluntario]:
    return db.query(AlocacaoVoluntario).filter(
        AlocacaoVoluntario.id_projeto == id_projeto, AlocacaoVoluntario.status == "PENDENTE",
    ).order_by(AlocacaoVoluntario.criado_em).all()


def confirmar_alocacao(db: Session, *, id_alocacao: int, usuario: Usuario) -> AlocacaoVoluntario:
    alocacao = obter_alocacao(db, id_alocacao)
    exigir_coordenador_do_projeto(db, usuario=usuario, id_projeto=alocacao.id_projeto)
    if alocacao.status != "PENDENTE":
        raise HTTPException(status_code=400, detail="Só uma candidatura pendente pode ser confirmada.")
    alocacao.status = "CONFIRMADA"
    db.commit()
    db.refresh(alocacao)
    return alocacao


def recusar_alocacao(db: Session, *, id_alocacao: int, usuario: Usuario) -> AlocacaoVoluntario:
    alocacao = obter_alocacao(db, id_alocacao)
    exigir_coordenador_do_projeto(db, usuario=usuario, id_projeto=alocacao.id_projeto)
    if alocacao.status != "PENDENTE":
        raise HTTPException(status_code=400, detail="Só uma candidatura pendente pode ser recusada.")
    alocacao.status = "RECUSADA"
    db.commit()
    db.refresh(alocacao)
    return alocacao


def cancelar_alocacao(db: Session, *, id_alocacao: int, usuario: Usuario) -> AlocacaoVoluntario:
    """Cancelável pelo próprio voluntário (é a própria alocação dele) ou pelo coordenador do
    projeto - nunca por quem não é nenhum dos dois."""
    alocacao = obter_alocacao(db, id_alocacao)
    associado = db.query(Associado).filter(Associado.id_usuario == usuario.id_usuario).first()
    eh_o_proprio = associado is not None and associado.id_associado == alocacao.id_associado
    if not eh_o_proprio:
        exigir_coordenador_do_projeto(db, usuario=usuario, id_projeto=alocacao.id_projeto)
    if alocacao.status not in ("PENDENTE", "CONFIRMADA"):
        raise HTTPException(status_code=400, detail="Esta alocação já não está mais ativa.")
    alocacao.status = "CANCELADA"
    db.commit()
    db.refresh(alocacao)
    return alocacao


def minha_escala(db: Session, *, usuario: Usuario) -> list[AlocacaoVoluntario]:
    associado = associado_do_usuario_ou_403(db, usuario)
    return db.query(AlocacaoVoluntario).filter(
        AlocacaoVoluntario.id_associado == associado.id_associado,
    ).order_by(AlocacaoVoluntario.criado_em.desc()).all()


# ==========================================
# TROCA DE TURNO ENTRE VOLUNTÁRIOS (v4.4)
# ==========================================
def solicitar_troca_turno(db: Session, *, id_alocacao: int, id_associado_substituto: int, motivo: Optional[str], usuario: Usuario) -> TrocaTurnoVoluntario:
    alocacao = obter_alocacao(db, id_alocacao)
    associado = associado_do_usuario_ou_403(db, usuario)
    if associado.id_associado != alocacao.id_associado:
        raise HTTPException(status_code=403, detail="Só quem está alocado neste turno pode pedir a troca.")
    if alocacao.status != "CONFIRMADA":
        raise HTTPException(status_code=400, detail="Só uma alocação confirmada pode ter troca solicitada.")
    substituto = db.query(Associado).filter(Associado.id_associado == id_associado_substituto).first()
    if not substituto:
        raise HTTPException(status_code=404, detail="Associado substituto não encontrado.")
    _exigir_termo_vigente_ou_403(db, substituto.id_pessoa)

    troca = TrocaTurnoVoluntario(
        id_alocacao=id_alocacao, id_associado_substituto=id_associado_substituto, motivo=motivo,
        id_usuario_solicitacao=usuario.id_usuario,
    )
    db.add(troca)
    db.commit()
    db.refresh(troca)
    return troca


def _obter_troca(db: Session, id_troca: int) -> TrocaTurnoVoluntario:
    troca = db.query(TrocaTurnoVoluntario).filter(TrocaTurnoVoluntario.id_troca == id_troca).first()
    if not troca:
        raise HTTPException(status_code=404, detail="Troca de turno não encontrada.")
    return troca


def confirmar_troca_turno(db: Session, *, id_troca: int, usuario: Usuario) -> TrocaTurnoVoluntario:
    troca = _obter_troca(db, id_troca)
    alocacao = obter_alocacao(db, troca.id_alocacao)
    exigir_coordenador_do_projeto(db, usuario=usuario, id_projeto=alocacao.id_projeto)
    if troca.status != "SOLICITADA":
        raise HTTPException(status_code=400, detail="Só uma troca solicitada pode ser confirmada.")
    # A troca é sempre REGISTRADA (nunca silenciosa) - o substituto assume a MESMA alocação
    # (mesmo turno/habilidades exigidas/horas previstas), não uma nova candidatura do zero.
    alocacao.id_associado = troca.id_associado_substituto
    troca.status = "CONFIRMADA"
    troca.id_usuario_resolucao = usuario.id_usuario
    troca.resolvido_em = datetime.utcnow()
    db.commit()
    db.refresh(troca)
    return troca


def recusar_troca_turno(db: Session, *, id_troca: int, usuario: Usuario) -> TrocaTurnoVoluntario:
    troca = _obter_troca(db, id_troca)
    alocacao = obter_alocacao(db, troca.id_alocacao)
    exigir_coordenador_do_projeto(db, usuario=usuario, id_projeto=alocacao.id_projeto)
    if troca.status != "SOLICITADA":
        raise HTTPException(status_code=400, detail="Só uma troca solicitada pode ser recusada.")
    troca.status = "RECUSADA"
    troca.id_usuario_resolucao = usuario.id_usuario
    troca.resolvido_em = datetime.utcnow()
    db.commit()
    db.refresh(troca)
    return troca


def listar_trocas_do_projeto(db: Session, *, id_projeto: int) -> list[TrocaTurnoVoluntario]:
    return db.query(TrocaTurnoVoluntario).join(
        AlocacaoVoluntario, TrocaTurnoVoluntario.id_alocacao == AlocacaoVoluntario.id_alocacao,
    ).filter(AlocacaoVoluntario.id_projeto == id_projeto).order_by(TrocaTurnoVoluntario.criado_em.desc()).all()


# ==========================================
# APROVAÇÃO DE HORAS DE VOLUNTARIADO (v4.4) - lastro pro certificado (v4.8) e score de
# engajamento (v11.1), quando existirem; por ora só a aprovação em si, real e consultável.
# ==========================================
def _obter_registro_horas(db: Session, id_registro: int) -> RegistroHorasVoluntariado:
    registro = db.query(RegistroHorasVoluntariado).filter(RegistroHorasVoluntariado.id_registro == id_registro).first()
    if not registro:
        raise HTTPException(status_code=404, detail="Registro de horas não encontrado.")
    return registro


def aprovar_horas_voluntariado(db: Session, *, id_registro: int, usuario: Usuario) -> RegistroHorasVoluntariado:
    registro = _obter_registro_horas(db, id_registro)
    if registro.id_alocacao is None:
        raise HTTPException(status_code=400, detail="Este registro não está amarrado a uma alocação de projeto - nada para o coordenador aprovar.")
    alocacao = obter_alocacao(db, registro.id_alocacao)
    exigir_coordenador_do_projeto(db, usuario=usuario, id_projeto=alocacao.id_projeto)
    if registro.status != "PENDENTE":
        raise HTTPException(status_code=400, detail="Só um registro pendente pode ser aprovado.")

    registro.status = "APROVADO"
    registro.id_usuario_aprovacao = usuario.id_usuario
    registro.aprovado_em = datetime.utcnow()
    alocacao.horas_realizadas = (alocacao.horas_realizadas or 0.0) + registro.horas
    db.commit()
    db.refresh(registro)
    return registro


def recusar_horas_voluntariado(db: Session, *, id_registro: int, usuario: Usuario) -> RegistroHorasVoluntariado:
    registro = _obter_registro_horas(db, id_registro)
    if registro.id_alocacao is None:
        raise HTTPException(status_code=400, detail="Este registro não está amarrado a uma alocação de projeto - nada para o coordenador recusar.")
    alocacao = obter_alocacao(db, registro.id_alocacao)
    exigir_coordenador_do_projeto(db, usuario=usuario, id_projeto=alocacao.id_projeto)
    if registro.status != "PENDENTE":
        raise HTTPException(status_code=400, detail="Só um registro pendente pode ser recusado.")

    registro.status = "RECUSADO"
    registro.id_usuario_aprovacao = usuario.id_usuario
    registro.aprovado_em = datetime.utcnow()
    db.commit()
    db.refresh(registro)
    return registro


def listar_horas_pendentes_do_projeto(db: Session, *, id_projeto: int) -> list[RegistroHorasVoluntariado]:
    return db.query(RegistroHorasVoluntariado).join(
        AlocacaoVoluntario, RegistroHorasVoluntariado.id_alocacao == AlocacaoVoluntario.id_alocacao,
    ).filter(AlocacaoVoluntario.id_projeto == id_projeto, RegistroHorasVoluntariado.status == "PENDENTE").order_by(RegistroHorasVoluntariado.criado_em).all()


def meu_historico_horas_voluntariado(db: Session, *, usuario: Usuario) -> list[RegistroHorasVoluntariado]:
    associado = associado_do_usuario_ou_403(db, usuario)
    from app.models.voluntariado import TermoAdesaoVoluntario

    return db.query(RegistroHorasVoluntariado).join(
        TermoAdesaoVoluntario, RegistroHorasVoluntariado.id_termo == TermoAdesaoVoluntario.id_termo,
    ).filter(TermoAdesaoVoluntario.id_pessoa == associado.id_pessoa).order_by(RegistroHorasVoluntariado.data.desc()).all()


# ==========================================
# ENCERRAMENTO FORMAL (relatório final versionado)
# ==========================================
def _gerar_texto_relatorio_final(db: Session, projeto: ProjetoEvento) -> str:
    linhas = [f"RELATÓRIO FINAL — {projeto.nome_projeto}", "", f"Status: {projeto.status}", ""]

    linhas.append("1. INDICADORES (resultados x metas)")
    lista_indicadores = servico_indicadores.listar_indicadores(db, contexto_tipo=CONTEXTO_PROJETO, id_contexto=projeto.id_projeto)
    if not lista_indicadores:
        linhas.append("   Nenhum indicador cadastrado para este projeto.")
    for indicador in lista_indicadores:
        medicoes = servico_indicadores.listar_medicoes(db, id_indicador=indicador.id_indicador)
        ultima = medicoes[-1] if medicoes else None
        meta_txt = f"{indicador.meta} {indicador.unidade}" if indicador.meta is not None else "sem meta definida"
        realizado_txt = f"{ultima.valor} {indicador.unidade} (período {ultima.periodo})" if ultima else "sem medição registrada"
        linhas.append(f"   {indicador.nome}: meta {meta_txt} — realizado {realizado_txt}")

    linhas += ["", "2. PÚBLICO ATENDIDO"]
    linhas.append("   Pendência registrada: motor de beneficiários (v4.2) ainda não existe - este relatório não afirma um número que não tem base em dado real.")

    linhas += ["", "3. EXECUÇÃO FINANCEIRA"]
    if projeto.id_centro_custo is None:
        linhas.append("   Projeto sem centro de custo vinculado - sem execução financeira a reportar.")
    else:
        ano_atual = datetime.utcnow().year
        orcamentos = [o for o in servico_orcamento.listar_orcamentos(db, ano=ano_atual) if o["id_centro_custo"] == projeto.id_centro_custo]
        if not orcamentos:
            linhas.append(f"   Nenhum orçamento ({ano_atual}) cadastrado para o centro de custo deste projeto.")
        for o in orcamentos:
            linhas.append(f"   Previsto R$ {o['valor_previsto']:.2f} — Realizado R$ {o['realizado']:.2f} ({'estourado' if o['estourado'] else 'dentro do previsto'})")

    linhas += ["", "4. CRONOGRAMA"]
    cronograma = listar_cronograma(db, id_projeto=projeto.id_projeto)
    if not cronograma:
        linhas.append("   Nenhum item de cronograma cadastrado.")
    for item in cronograma:
        linhas.append(f"   [{item['status']}] {item['tipo']}: {item['titulo']} (prazo {item['prazo'].date().isoformat()})")

    return "\n".join(linhas)


def gerar_relatorio_final(db: Session, *, id_projeto: int, id_usuario: Optional[int]) -> RelatorioFinalProjeto:
    projeto = obter_projeto(db, id_projeto)
    conteudo = _gerar_texto_relatorio_final(db, projeto)

    ultima_versao = db.query(func.max(RelatorioFinalProjeto.versao)).filter(RelatorioFinalProjeto.id_projeto == id_projeto).scalar() or 0
    relatorio = RelatorioFinalProjeto(id_projeto=id_projeto, versao=ultima_versao + 1, conteudo=conteudo, id_usuario_geracao=id_usuario)
    db.add(relatorio)
    db.commit()
    db.refresh(relatorio)
    return relatorio


def listar_relatorios_finais(db: Session, *, id_projeto: int) -> list[RelatorioFinalProjeto]:
    return db.query(RelatorioFinalProjeto).filter(RelatorioFinalProjeto.id_projeto == id_projeto).order_by(RelatorioFinalProjeto.versao.desc()).all()
