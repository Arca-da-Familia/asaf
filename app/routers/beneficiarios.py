"""v4.2 (FASE 4) - Beneficiários e atendimento. `exigir_permissao("projetos")` é o piso (mesmo
módulo de Projetos), mas o prontuário e o encaminhamento têm uma segunda trava por cima:
`exigir_membro_da_equipe_do_vinculo` - só quem está ativo na equipe DAQUELE projeto específico
lê ou escreve, nunca "quem tem permissão de projetos" de modo geral. Toda consulta ao prontuário
é auditada (`CONSULTA_PRONTUARIO`), não só a escrita - dado sensível pede rastro de quem LEU,
não só de quem mudou."""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.schemas.beneficiarios import (
    BeneficiarioCriar,
    BeneficiarioProjetoCriar,
    EncaminhamentoRedeExternaCriar,
    RegistroAtendimentoCriar,
)
from app.security import exigir_permissao
from app.services import beneficiarios

router = APIRouter()
_permissao_projetos = exigir_permissao("projetos")


def _ip_origem(request: Request) -> str:
    return request.client.host if request.client else None


def _serializar_beneficiario(b) -> dict:
    return {
        "id_beneficiario": b.id_beneficiario, "id_pessoa": b.id_pessoa,
        "consentimento_lgpd_registrado": b.consentimento_lgpd_registrado,
        "observacao_consentimento": b.observacao_consentimento, "data_consentimento": b.data_consentimento,
    }


@router.post("/api/beneficiarios/", summary="Cadastrar Beneficiário (papel de Pessoa)")
def criar_beneficiario_endpoint(dados: BeneficiarioCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    beneficiario = beneficiarios.criar_beneficiario(
        db, id_pessoa=dados.id_pessoa, nome_completo=dados.nome_completo, data_nascimento=dados.data_nascimento,
        consentimento_lgpd_registrado=dados.consentimento_lgpd_registrado, observacao_consentimento=dados.observacao_consentimento,
        id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "beneficiarios", "CREATE", id_registro_afetado=beneficiario.id_beneficiario,
        dados_depois={"id_pessoa": beneficiario.id_pessoa}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Beneficiário cadastrado.", "id_beneficiario": beneficiario.id_beneficiario}


@router.get("/api/beneficiarios/", summary="Listar Beneficiários")
def listar_beneficiarios_endpoint(db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [_serializar_beneficiario(b) for b in beneficiarios.listar_beneficiarios(db)]


@router.get("/api/beneficiarios/{id_beneficiario}/nucleo-familiar", summary="Núcleo familiar do beneficiário (reaproveita DependenteFamiliar, v1.7)")
def nucleo_familiar_endpoint(id_beneficiario: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [
        {"id_dependente": d.id_dependente, "id_pessoa_titular": d.id_pessoa_titular, "id_pessoa_vinculada": d.id_pessoa_vinculada, "grau_parentesco": d.grau_parentesco}
        for d in beneficiarios.nucleo_familiar(db, id_beneficiario=id_beneficiario)
    ]


# ==========================================
# VÍNCULO BENEFICIÁRIO x PROJETO
# ==========================================
@router.post("/api/beneficiarios-projeto/", summary="Vincular Beneficiário a um Projeto (com papel)")
def vincular_a_projeto_endpoint(dados: BeneficiarioProjetoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    vinculo = beneficiarios.vincular_a_projeto(
        db, id_beneficiario=dados.id_beneficiario, id_projeto=dados.id_projeto, papel=dados.papel,
        atendimento_por_familia=dados.atendimento_por_familia, id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "beneficiarios_projeto", "CREATE", id_registro_afetado=vinculo.id_vinculo,
        dados_depois={"id_beneficiario": vinculo.id_beneficiario, "id_projeto": vinculo.id_projeto, "papel": vinculo.papel},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Beneficiário vinculado ao projeto.", "id_vinculo": vinculo.id_vinculo}


@router.get("/api/projetos/{id_projeto}/beneficiarios", summary="Listar beneficiários vinculados a um projeto")
def listar_vinculos_do_projeto_endpoint(id_projeto: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [
        {
            "id_vinculo": v.id_vinculo, "id_beneficiario": v.id_beneficiario, "papel": v.papel,
            "atendimento_por_familia": v.atendimento_por_familia, "data_inicio": v.data_inicio, "data_fim": v.data_fim,
        }
        for v in beneficiarios.listar_vinculos_do_projeto(db, id_projeto=id_projeto)
    ]


# ==========================================
# PRONTUÁRIO DE ATENDIMENTO (dado sensível - só equipe do projeto, consulta auditada)
# ==========================================
@router.post("/api/beneficiarios-projeto/{id_vinculo}/atendimentos", summary="Registrar atendimento (prontuário - imutável)")
def registrar_atendimento_endpoint(id_vinculo: int, dados: RegistroAtendimentoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    beneficiarios.exigir_membro_da_equipe_do_vinculo(db, usuario=usuario, id_vinculo=id_vinculo)
    registro = beneficiarios.registrar_atendimento(db, id_vinculo=id_vinculo, relato=dados.relato, id_usuario=usuario.id_usuario)
    registrar_auditoria(
        db, usuario, "registros_atendimento", "CREATE", id_registro_afetado=registro.id_registro,
        dados_depois={"id_vinculo": registro.id_vinculo}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Atendimento registrado.", "id_registro": registro.id_registro}


@router.get("/api/beneficiarios-projeto/{id_vinculo}/atendimentos", summary="Listar prontuário de atendimento (consulta auditada)")
def listar_atendimentos_endpoint(id_vinculo: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    beneficiarios.exigir_membro_da_equipe_do_vinculo(db, usuario=usuario, id_vinculo=id_vinculo)
    registros = beneficiarios.listar_atendimentos(db, id_vinculo=id_vinculo)
    registrar_auditoria(
        db, usuario, "registros_atendimento", "CONSULTA_PRONTUARIO", id_registro_afetado=id_vinculo,
        dados_depois={"quantidade_resultados": len(registros)}, ip_origem=_ip_origem(request),
    )
    return [
        {"id_registro": r.id_registro, "data_atendimento": r.data_atendimento, "relato": r.relato, "id_usuario_autor": r.id_usuario_autor}
        for r in registros
    ]


# ==========================================
# ENCAMINHAMENTO À REDE EXTERNA
# ==========================================
@router.post("/api/beneficiarios-projeto/{id_vinculo}/encaminhamentos", summary="Registrar encaminhamento à rede externa")
def registrar_encaminhamento_endpoint(id_vinculo: int, dados: EncaminhamentoRedeExternaCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    beneficiarios.exigir_membro_da_equipe_do_vinculo(db, usuario=usuario, id_vinculo=id_vinculo)
    encaminhamento = beneficiarios.registrar_encaminhamento(db, id_vinculo=id_vinculo, tipo_rede=dados.tipo_rede, descricao=dados.descricao, id_usuario=usuario.id_usuario)
    registrar_auditoria(
        db, usuario, "encaminhamentos_rede_externa", "CREATE", id_registro_afetado=encaminhamento.id_encaminhamento,
        dados_depois={"id_vinculo": encaminhamento.id_vinculo, "tipo_rede": encaminhamento.tipo_rede}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Encaminhamento registrado.", "id_encaminhamento": encaminhamento.id_encaminhamento}


@router.get("/api/beneficiarios-projeto/{id_vinculo}/encaminhamentos", summary="Listar encaminhamentos à rede externa")
def listar_encaminhamentos_endpoint(id_vinculo: int, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    beneficiarios.exigir_membro_da_equipe_do_vinculo(db, usuario=usuario, id_vinculo=id_vinculo)
    return [
        {"id_encaminhamento": e.id_encaminhamento, "tipo_rede": e.tipo_rede, "descricao": e.descricao, "data_encaminhamento": e.data_encaminhamento}
        for e in beneficiarios.listar_encaminhamentos(db, id_vinculo=id_vinculo)
    ]


# ==========================================
# FREQUÊNCIA/PARTICIPAÇÃO (motor de presença único, v4.0 - sem mecanismo próprio aqui)
# ==========================================
@router.get("/api/beneficiarios-projeto/{id_vinculo}/presencas", summary="Frequência do beneficiário no projeto (via motor de presença, v4.0)")
def listar_presencas_do_vinculo_endpoint(id_vinculo: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    from app.services.presenca import listar_presencas

    vinculo = beneficiarios.obter_vinculo(db, id_vinculo)
    beneficiario = beneficiarios.obter_beneficiario(db, vinculo.id_beneficiario)
    registros = listar_presencas(db, contexto_tipo="Projeto", id_contexto=vinculo.id_projeto)
    return [
        {"id_registro": r.id_registro, "hora_entrada": r.hora_entrada, "hora_saida": r.hora_saida, "meio_registro": r.meio_registro}
        for r in registros
        if r.id_pessoa == beneficiario.id_pessoa
    ]
