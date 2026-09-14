"""v1.2 (FASE 1) - Filiação: da intenção ao associado efetivo. Ver docstring de
app/models/filiacao.py para o que fica de fora de propósito (aprovação por assembleia, termo
assinado eletronicamente, boas-vindas por e-mail de verdade - cada um com a pendência registrada
na versão/fase que vai resolver, no PLANO_PROJETO.md)."""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.config_cache import obter_configuracao
from app.database import get_db
from app.models.associados import Associado
from app.models.filiacao import APROVADA, EM_CONFERENCIA, PENDENTE, RECUSADA, PropostaFiliacao
from app.models.pessoas import Papel, Pessoa
from app.schemas.filiacao import PropostaAprovar, PropostaFiliacaoCriar, PropostaRecusar
from app.security import exigir_permissao, get_current_user
from app.services.categoria_associado import ATIVO_EM_DIA, EM_EXPERIENCIA, calcular_categoria
from app.services.linha_do_tempo import publicar_evento_linha_do_tempo
from app.services.matricula import proximo_numero_matricula

router = APIRouter()
_permissao_associados = exigir_permissao("associados")


@router.post("/api/filiacao/propor", summary="Propor filiação (público - sem autenticação)")
def propor_filiacao(dados: PropostaFiliacaoCriar, db: Session = Depends(get_db)):
    if db.query(Pessoa).filter(Pessoa.cpf == dados.cpf).join(Associado, Associado.id_pessoa == Pessoa.id_pessoa).first():
        raise HTTPException(status_code=400, detail="Já existe associado cadastrado com este CPF.")
    if db.query(PropostaFiliacao).filter(
        PropostaFiliacao.cpf == dados.cpf, PropostaFiliacao.status.in_([PENDENTE, EM_CONFERENCIA])
    ).first():
        raise HTTPException(status_code=400, detail="Já existe uma proposta em andamento para este CPF.")

    proposta = PropostaFiliacao(
        nome_completo=dados.nome_completo, cpf=dados.cpf, email_contato=dados.email_contato,
        telefone_whatsapp=dados.telefone_whatsapp,
        data_nascimento=datetime.combine(dados.data_nascimento, datetime.min.time()) if dados.data_nascimento else None,
    )
    db.add(proposta)
    db.commit()
    db.refresh(proposta)
    return {"mensagem": "Proposta de filiação recebida.", "id_proposta": proposta.id_proposta}


@router.get("/api/filiacao/propostas", summary="Listar propostas de filiação")
def listar_propostas(status: str = None, db: Session = Depends(get_db), _usuario=Depends(_permissao_associados)):
    consulta = db.query(PropostaFiliacao)
    if status:
        consulta = consulta.filter(PropostaFiliacao.status == status)
    propostas = consulta.order_by(PropostaFiliacao.criado_em.desc()).all()
    return [
        {
            "id_proposta": p.id_proposta, "nome_completo": p.nome_completo, "cpf": p.cpf,
            "email_contato": p.email_contato, "telefone_whatsapp": p.telefone_whatsapp,
            "status": p.status, "motivo_recusa": p.motivo_recusa,
            "id_associado_efetivado": p.id_associado_efetivado, "criado_em": p.criado_em,
        }
        for p in propostas
    ]


def _buscar_proposta_ou_404(db: Session, id_proposta: int) -> PropostaFiliacao:
    proposta = db.query(PropostaFiliacao).filter(PropostaFiliacao.id_proposta == id_proposta).first()
    if not proposta:
        raise HTTPException(status_code=404, detail="Proposta não encontrada.")
    return proposta


@router.post("/api/filiacao/propostas/{id_proposta}/conferir", summary="Marcar documentação conferida")
def conferir_proposta(id_proposta: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_associados)):
    proposta = _buscar_proposta_ou_404(db, id_proposta)
    if proposta.status != PENDENTE:
        raise HTTPException(status_code=400, detail=f"Proposta está '{proposta.status}', não '{PENDENTE}'.")
    proposta.status = EM_CONFERENCIA
    db.commit()
    registrar_auditoria(
        db, usuario, "propostas_filiacao", "CONFERIDA", id_registro_afetado=id_proposta,
        ip_origem=request.client.host if request.client else None,
    )
    return {"mensagem": "Documentação marcada como conferida."}


@router.post("/api/filiacao/propostas/{id_proposta}/recusar", summary="Recusar proposta de filiação")
def recusar_proposta(
    id_proposta: int, dados: PropostaRecusar, request: Request,
    db: Session = Depends(get_db), usuario=Depends(_permissao_associados),
):
    proposta = _buscar_proposta_ou_404(db, id_proposta)
    if proposta.status in (APROVADA, RECUSADA):
        raise HTTPException(status_code=400, detail=f"Proposta já está '{proposta.status}'.")
    proposta.status = RECUSADA
    proposta.motivo_recusa = dados.motivo
    db.commit()
    registrar_auditoria(
        db, usuario, "propostas_filiacao", "RECUSADA", id_registro_afetado=id_proposta,
        dados_depois={"motivo": dados.motivo}, ip_origem=request.client.host if request.client else None,
    )
    return {"mensagem": "Proposta recusada."}


@router.post("/api/filiacao/propostas/{id_proposta}/aprovar", summary="Aprovar e efetivar associado")
def aprovar_proposta(
    id_proposta: int, dados: PropostaAprovar, request: Request,
    db: Session = Depends(get_db), usuario=Depends(_permissao_associados),
):
    proposta = _buscar_proposta_ou_404(db, id_proposta)
    if proposta.status != EM_CONFERENCIA:
        raise HTTPException(status_code=400, detail=f"Proposta precisa estar '{EM_CONFERENCIA}' antes de aprovar (está '{proposta.status}').")

    prazo_dias = int(obter_configuracao(db, "PRAZO_EXPERIENCIA_DIAS", "90") or "90")
    novo_associado = Associado(
        nome_completo=proposta.nome_completo, cpf=proposta.cpf, email_contato=proposta.email_contato,
        telefone_whatsapp=proposta.telefone_whatsapp, data_nascimento=proposta.data_nascimento,
        categoria=dados.categoria,
        numero_matricula=proximo_numero_matricula(db),
        data_fim_experiencia=(datetime.utcnow() + timedelta(days=prazo_dias)) if prazo_dias > 0 else None,
    )
    novo_associado.status_arrolamento = EM_EXPERIENCIA if prazo_dias > 0 else ATIVO_EM_DIA
    db.add(novo_associado)
    db.commit()
    db.refresh(novo_associado)

    db.add(Papel(id_pessoa=novo_associado.id_pessoa, tipo_papel="associado"))
    proposta.status = APROVADA
    proposta.id_associado_efetivado = novo_associado.id_associado
    db.commit()

    registrar_auditoria(
        db, usuario, "propostas_filiacao", "APROVADA", id_registro_afetado=id_proposta,
        dados_depois={"id_associado_efetivado": novo_associado.id_associado, "numero_matricula": novo_associado.numero_matricula},
        ip_origem=request.client.host if request.client else None,
    )
    # v1.2 - "boas-vindas automáticas": sem infra de envio de e-mail ainda (pendência
    # registrada na v6.2), o evento fica gravado na auditoria - é o registro que garante que
    # a efetivação "avisou" alguém, mesmo que o e-mail de verdade venha depois.
    registrar_auditoria(
        db, usuario, "associados", "BOAS_VINDAS_REGISTRADAS", id_registro_afetado=novo_associado.id_associado,
        ip_origem=request.client.host if request.client else None,
    )
    publicar_evento_linha_do_tempo(
        db, novo_associado.id_associado, "filiacao", "FILIACAO_APROVADA", "Filiação aprovada",
        descricao=f"Matrícula {novo_associado.numero_matricula} atribuída.",
    )
    return {
        "mensagem": "Associado efetivado com sucesso.",
        "id_associado": novo_associado.id_associado,
        "numero_matricula": novo_associado.numero_matricula,
        "status_arrolamento": novo_associado.status_arrolamento,
    }
