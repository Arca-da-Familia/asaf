"""v1.6 (FASE 1) - voluntário (Lei 9.608/1998) e funcionário (cadastro mínimo). Reaproveita a
permissão `associados` (mesma que já gere filiação/situação) - é a mesma equipe (secretaria/
diretoria) cuidando do ciclo de vida de qualquer pessoa no sistema, não um módulo à parte."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.core import Usuario
from app.models.pessoas import Papel, Pessoa
from app.models.voluntariado import Funcionario, RegistroHorasVoluntariado, TermoAdesaoVoluntario
from app.schemas.voluntariado import FuncionarioCriar, HorasVoluntariadoCriar, TermoAdesaoCriar
from app.security import exigir_permissao
from app.services.linha_do_tempo import publicar_evento_linha_do_tempo
from app.services.voluntariado import criar_termo_adesao, termo_vigente
from app.services.voluntariado import registrar_horas_voluntariado as servico_registrar_horas_voluntariado

router = APIRouter()
_permissao_associados = exigir_permissao("associados")


def _buscar_pessoa_ou_404(db: Session, id_pessoa: int) -> Pessoa:
    pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa).first()
    if not pessoa:
        raise HTTPException(status_code=404, detail="Pessoa não encontrada.")
    return pessoa


@router.post("/api/pessoas/{id_pessoa}/termo-voluntariado", summary="Registrar (ou renovar) termo de adesão de voluntário")
def registrar_termo_voluntariado(
    id_pessoa: int, dados: TermoAdesaoCriar,
    db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_associados),
):
    pessoa = _buscar_pessoa_ou_404(db, id_pessoa)
    novo = criar_termo_adesao(
        db, pessoa, atividade=dados.atividade, carga_horaria_semanal=dados.carga_horaria_semanal,
        data_inicio=datetime.combine(dados.data_inicio, datetime.min.time()),
        data_fim_vigencia=datetime.combine(dados.data_fim_vigencia, datetime.min.time()),
        local=dados.local, documento_referencia=dados.documento_referencia,
        autorizacao_responsavel_referencia=dados.autorizacao_responsavel_referencia,
        id_usuario_registrou=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "termos_adesao_voluntario", "TERMO_REGISTRADO", id_registro_afetado=novo.id_termo,
        dados_depois={"atividade": dados.atividade, "versao": novo.versao},
    )
    publicar_evento_linha_do_tempo(
        db, id_pessoa, "voluntariado", "TERMO_VOLUNTARIADO_REGISTRADO",
        f"Termo de adesão de voluntário registrado ({dados.atividade})",
        descricao=f"Vigência até {dados.data_fim_vigencia.isoformat()}.", data_evento=novo.data_inicio,
    )
    return {"mensagem": "Termo de adesão registrado.", "id_termo": novo.id_termo, "versao": novo.versao}


@router.get("/api/pessoas/{id_pessoa}/termo-voluntariado/vigente", summary="Consultar o termo de adesão vigente")
def obter_termo_vigente(id_pessoa: int, db: Session = Depends(get_db), _usuario: Usuario = Depends(_permissao_associados)):
    _buscar_pessoa_ou_404(db, id_pessoa)
    termo = termo_vigente(db, id_pessoa)
    if not termo:
        return {"vigente": False}
    return {
        "vigente": True, "id_termo": termo.id_termo, "atividade": termo.atividade,
        "carga_horaria_semanal": termo.carga_horaria_semanal, "data_fim_vigencia": termo.data_fim_vigencia,
        "versao": termo.versao,
    }


@router.post("/api/pessoas/{id_pessoa}/horas-voluntariado", summary="Registrar horas de voluntariado (exige termo vigente)")
def registrar_horas_voluntariado(
    id_pessoa: int, dados: HorasVoluntariadoCriar,
    db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_associados),
):
    _buscar_pessoa_ou_404(db, id_pessoa)
    registro = servico_registrar_horas_voluntariado(
        db, id_pessoa=id_pessoa, data=datetime.combine(dados.data, datetime.min.time()), horas=dados.horas,
        descricao_atividade=dados.descricao_atividade, id_projeto=dados.id_projeto, id_alocacao=dados.id_alocacao,
        id_usuario=usuario.id_usuario,
    )
    publicar_evento_linha_do_tempo(
        db, id_pessoa, "voluntariado", "HORAS_VOLUNTARIADO_REGISTRADAS",
        f"{dados.horas:g}h de voluntariado registradas",
        descricao=dados.descricao_atividade, data_evento=registro.data,
    )
    return {"mensagem": "Horas registradas.", "id_registro": registro.id_registro, "status": registro.status}


@router.get("/api/pessoas/{id_pessoa}/horas-voluntariado", summary="Listar horas de voluntariado registradas")
def listar_horas_voluntariado(id_pessoa: int, db: Session = Depends(get_db), _usuario: Usuario = Depends(_permissao_associados)):
    _buscar_pessoa_ou_404(db, id_pessoa)
    registros = (
        db.query(RegistroHorasVoluntariado)
        .join(TermoAdesaoVoluntario, RegistroHorasVoluntariado.id_termo == TermoAdesaoVoluntario.id_termo)
        .filter(TermoAdesaoVoluntario.id_pessoa == id_pessoa)
        .order_by(RegistroHorasVoluntariado.data.desc())
        .all()
    )
    return {
        # v4.4 - só horas APROVADAS contam pro total (lastro de certificado/score futuro) -
        # PENDENTE/RECUSADO aparecem na lista, mas não somam.
        "total_horas": sum(r.horas for r in registros if r.status == "APROVADO"),
        "registros": [
            {
                "id_registro": r.id_registro, "data": r.data, "horas": r.horas,
                "descricao_atividade": r.descricao_atividade, "id_projeto": r.id_projeto,
                "id_alocacao": r.id_alocacao, "status": r.status,
            }
            for r in registros
        ],
    }


@router.post("/api/pessoas/{id_pessoa}/funcionario", summary="Cadastrar pessoa como funcionário (cadastro mínimo, sem folha/ponto/eSocial)")
def cadastrar_funcionario(
    id_pessoa: int, dados: FuncionarioCriar,
    db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_associados),
):
    pessoa = _buscar_pessoa_ou_404(db, id_pessoa)
    if db.query(Funcionario).filter(Funcionario.id_pessoa == id_pessoa).first():
        raise HTTPException(status_code=400, detail="Esta pessoa já está cadastrada como funcionária.")

    funcionario = Funcionario(
        id_pessoa=id_pessoa, cargo=dados.cargo, id_conta_centro_custo=dados.id_conta_centro_custo,
        data_admissao=datetime.combine(dados.data_admissao, datetime.min.time()),
    )
    db.add(funcionario)

    papel = db.query(Papel).filter(Papel.id_pessoa == id_pessoa, Papel.tipo_papel == "funcionario").first()
    if papel:
        papel.ativo = True
    else:
        db.add(Papel(id_pessoa=id_pessoa, tipo_papel="funcionario"))
    db.commit()
    db.refresh(funcionario)

    registrar_auditoria(
        db, usuario, "funcionarios", "FUNCIONARIO_CADASTRADO", id_registro_afetado=funcionario.id_funcionario,
        dados_depois={"cargo": dados.cargo},
    )
    publicar_evento_linha_do_tempo(
        db, id_pessoa, "voluntariado", "FUNCIONARIO_CADASTRADO", f"Cadastrado(a) como funcionário(a): {dados.cargo}",
        data_evento=funcionario.data_admissao,
    )
    return {"mensagem": "Funcionário cadastrado.", "id_funcionario": funcionario.id_funcionario}


@router.get("/api/funcionarios/", summary="Listar funcionários cadastrados")
def listar_funcionarios(db: Session = Depends(get_db), _usuario: Usuario = Depends(_permissao_associados)):
    funcionarios = db.query(Funcionario).order_by(Funcionario.data_admissao.desc()).all()
    return [
        {
            "id_funcionario": f.id_funcionario, "id_pessoa": f.id_pessoa, "cargo": f.cargo,
            "id_conta_centro_custo": f.id_conta_centro_custo, "data_admissao": f.data_admissao,
            "ativo": f.ativo,
        }
        for f in funcionarios
    ]
