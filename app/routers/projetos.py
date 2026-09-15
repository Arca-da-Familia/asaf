from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.associados import Associado
from app.models.projetos import ProjetoEvento, AlocacaoVoluntario
from app.schemas.projetos import ProjetoCriar, VoluntarioAlocar
from app.services.voluntariado import termo_vigente

router = APIRouter()

@router.post("/projetos/", summary="9. Criar Projeto (PDCA)")
def criar_projeto(dados: ProjetoCriar, db: Session = Depends(get_db)):
    projeto = ProjetoEvento(
        nome_projeto=dados.nome_projeto, tipo_foco=dados.tipo_foco,
        necessita_alvara_bombeiros=dados.necessita_alvara_bombeiros,
        data_inicio=dados.data_inicio, data_fim_prevista=dados.data_fim_prevista
    )
    if projeto.necessita_alvara_bombeiros:
        projeto.status_liberacao = "Pendente de Vistoria"
    db.add(projeto)
    db.commit()
    db.refresh(projeto)
    return {"mensagem": "Projeto inicializado.", "id_projeto": projeto.id_projeto}


@router.post("/projetos/alocar/", summary="10. Alocar Voluntário")
def alocar_voluntario(dados: VoluntarioAlocar, db: Session = Depends(get_db)):
    associado = db.query(Associado).filter(Associado.id_associado == dados.id_associado).first()
    if not associado:
        raise HTTPException(status_code=404, detail="Associado não encontrado.")
    # v1.6 - trava real (não aviso): sem termo de adesão de voluntário vigente (Lei 9.608/1998),
    # a pessoa não pode ser alocada em nenhum projeto.
    if not termo_vigente(db, associado.id_pessoa):
        raise HTTPException(
            status_code=403,
            detail="Voluntário sem termo de adesão vigente - não pode ser alocado em projeto.",
        )
    alocacao = AlocacaoVoluntario(id_projeto=dados.id_projeto, id_associado=dados.id_associado, funcao_desempenhada=dados.funcao_desempenhada)
    db.add(alocacao)
    db.commit()
    return {"mensagem": "Voluntário escalado com sucesso!"}
# ==========================================
# ROTAS VISUAIS (FRONTEND DINÂMICO ENTERPRISE)
# ==========================================
