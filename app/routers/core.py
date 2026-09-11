from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.database import get_db
from app.models.core import ConfiguracaoInstitucional, OpcaoLista
from app.schemas.core import OpcaoCriar, OpcaoAtualizar

router = APIRouter()

@router.post("/setup-cerebro/", summary="1. Inicializar Cérebro")
def setup_cerebro(db: Session = Depends(get_db)):
    configs = [
        {"chave": "NOME_INSTITUICAO", "valor": "ASAF - Associação Arca da Família"},
        {"chave": "STATUS_ARROLAMENTO_PADRAO", "valor": "Ativo - Em Dia"},
        {"chave": "MODELO_GESTAO", "valor": "Governança Terceiro Setor"}
    ]
    for c in configs:
        if not db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao == c["chave"]).first():
            db.add(ConfiguracaoInstitucional(chave_configuracao=c["chave"], valor_configuracao=c["valor"]))
    db.commit()
    return {"mensagem": "Cérebro inicializado com sucesso!"}


@router.get("/api/opcoes/{tipo_lista}", summary="Listar valores de uma lista configurável")
def listar_opcoes(tipo_lista: str, incluir_inativos: bool = False, db: Session = Depends(get_db)):
    consulta = db.query(OpcaoLista).filter(OpcaoLista.tipo_lista == tipo_lista)
    if not incluir_inativos:
        consulta = consulta.filter(OpcaoLista.ativo == True)
    opcoes = consulta.order_by(OpcaoLista.ordem, OpcaoLista.id_opcao).all()
    return [{"id_opcao": o.id_opcao, "valor": o.valor, "ativo": o.ativo} for o in opcoes]


@router.post("/api/opcoes/{tipo_lista}", summary="Adicionar valor a uma lista configurável")
def criar_opcao(tipo_lista: str, dados: OpcaoCriar, db: Session = Depends(get_db)):
    if db.query(OpcaoLista).filter(OpcaoLista.tipo_lista == tipo_lista, OpcaoLista.valor == dados.valor).first():
        raise HTTPException(status_code=400, detail="Esse valor já existe nessa lista.")
    maior_ordem = db.query(OpcaoLista).filter(OpcaoLista.tipo_lista == tipo_lista).count()
    nova = OpcaoLista(tipo_lista=tipo_lista, valor=dados.valor, ordem=maior_ordem, ativo=True)
    db.add(nova)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Esse valor já existe nessa lista.")
    db.refresh(nova)
    return {"id_opcao": nova.id_opcao, "valor": nova.valor, "ativo": nova.ativo}


@router.put("/api/opcoes/{id_opcao}", summary="Renomear/ativar/desativar valor de lista")
def atualizar_opcao(id_opcao: int, dados: OpcaoAtualizar, db: Session = Depends(get_db)):
    opcao = db.query(OpcaoLista).filter(OpcaoLista.id_opcao == id_opcao).first()
    if not opcao:
        raise HTTPException(status_code=404, detail="Opção não encontrada.")
    if dados.valor is not None:
        opcao.valor = dados.valor
    if dados.ativo is not None:
        opcao.ativo = dados.ativo
    db.commit()
    return {"mensagem": "Opção atualizada."}

# ==========================================
# ÁRVORE FAMILIAR (DEPENDENTES)
# ==========================================
