from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.governanca import Assembleia, RegistroVoto
from app.schemas.governanca import AssembleiaCriar, VotoRegistrar

router = APIRouter()

@router.post("/assembleias/", summary="7. Agendar Assembleia")
def agendar_assembleia(dados: AssembleiaCriar, db: Session = Depends(get_db)):
    nova_assembleia = Assembleia(titulo_edital=dados.titulo_edital, pauta_principal=dados.pauta_principal, data_realizacao=dados.data_realizacao)
    db.add(nova_assembleia)
    db.commit()
    db.refresh(nova_assembleia)
    return {"mensagem": "Assembleia agendada.", "id_assembleia": nova_assembleia.id_assembleia}


@router.post("/votar/", summary="8. Registrar Voto")
def registrar_voto(dados: VotoRegistrar, db: Session = Depends(get_db)):
    voto = RegistroVoto(
        id_assembleia=dados.id_assembleia, id_associado=dados.id_associado,
        decisao=dados.decisao, tipo_assinatura=dados.tipo_assinatura, protocolo_autenticacao=dados.protocolo_autenticacao
    )
    db.add(voto)
    db.commit()
    return {"mensagem": "Voto computado com sucesso!"}

