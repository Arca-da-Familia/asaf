"""v1.8 (FASE 1) - qualidade permanente da base: detector de duplicidade contínuo, fila de
revisão (mesclagem nunca acontece sozinha) e higienização de contato. Reaproveita a permissão
`associados`, mesma equipe que já cuida de filiação/situação/família/voluntariado."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.core import Usuario
from app.models.pessoas import Pessoa
from app.models.qualidade_cadastro import PENDENTE, FilaRevisaoCadastro
from app.schemas.qualidade_cadastro import MarcarEmailSuspeitoRequest, MesclarPessoasRequest
from app.security import exigir_permissao
from app.services.duplicidade import escanear_duplicidade_continua
from app.services.higienizacao_contato import escanear_telefones_invalidos, marcar_email_suspeito
from app.services.mesclagem import mesclar_pessoas

router = APIRouter()
_permissao_associados = exigir_permissao("associados")


def _buscar_pessoa_ou_404(db: Session, id_pessoa: int) -> Pessoa:
    pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa).first()
    if not pessoa:
        raise HTTPException(status_code=404, detail="Pessoa não encontrada.")
    return pessoa


@router.post("/api/pessoas/duplicidade/escanear", summary="Varrer toda a base por duplicidade de nome+nascimento")
def escanear_duplicidade(db: Session = Depends(get_db), _usuario: Usuario = Depends(_permissao_associados)):
    novos = escanear_duplicidade_continua(db)
    return {"mensagem": f"{novos} novo(s) candidato(s) a duplicidade adicionado(s) à fila.", "novos": novos}


@router.post("/api/pessoas/higienizar-contatos", summary="Varrer telefones com formato inválido")
def higienizar_contatos(db: Session = Depends(get_db), _usuario: Usuario = Depends(_permissao_associados)):
    novos = escanear_telefones_invalidos(db)
    return {"mensagem": f"{novos} telefone(s) com formato inválido adicionado(s) à fila.", "novos": novos}


@router.post("/api/pessoas/{id_pessoa}/marcar-contato-suspeito", summary="Reportar e-mail devolvido (bounce) manualmente")
def reportar_email_suspeito(
    id_pessoa: int, dados: MarcarEmailSuspeitoRequest,
    db: Session = Depends(get_db), _usuario: Usuario = Depends(_permissao_associados),
):
    # Não há infraestrutura de envio de e-mail ainda (pendência da v6.2) - sem ela, não existe
    # detecção automática de bounce. Este é o caminho manual, pra quando alguém descobre por
    # fora do sistema que um e-mail voltou.
    pessoa = _buscar_pessoa_ou_404(db, id_pessoa)
    entrada = marcar_email_suspeito(db, pessoa, dados.motivo)
    return {"mensagem": "Contato marcado como suspeito.", "id_fila": entrada.id_fila}


@router.get("/api/pessoas/fila-revisao", summary="Listar itens pendentes na fila de revisão de cadastro")
def listar_fila_revisao(status: str = PENDENTE, db: Session = Depends(get_db), _usuario: Usuario = Depends(_permissao_associados)):
    itens = db.query(FilaRevisaoCadastro).filter(FilaRevisaoCadastro.status == status).order_by(FilaRevisaoCadastro.criado_em.desc()).all()
    resultado = []
    for item in itens:
        pessoa_a = db.query(Pessoa).filter(Pessoa.id_pessoa == item.id_pessoa_a).first()
        pessoa_b = db.query(Pessoa).filter(Pessoa.id_pessoa == item.id_pessoa_b).first() if item.id_pessoa_b else None
        resultado.append({
            "id_fila": item.id_fila, "tipo_sinal": item.tipo_sinal, "detalhe": item.detalhe,
            "status": item.status, "criado_em": item.criado_em,
            "id_pessoa_a": item.id_pessoa_a, "nome_pessoa_a": pessoa_a.nome_completo if pessoa_a else None,
            "id_pessoa_b": item.id_pessoa_b, "nome_pessoa_b": pessoa_b.nome_completo if pessoa_b else None,
        })
    return resultado


@router.post("/api/pessoas/fila-revisao/{id_fila}/ignorar", summary="Marcar item da fila como não sendo um problema real")
def ignorar_item_fila(id_fila: int, db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_associados)):
    item = db.query(FilaRevisaoCadastro).filter(FilaRevisaoCadastro.id_fila == id_fila).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item da fila não encontrado.")
    item.status = "ignorado"
    item.resolvido_em = datetime.utcnow()
    item.id_usuario_resolveu = usuario.id_usuario
    db.commit()
    return {"mensagem": "Item marcado como ignorado."}


@router.post("/api/pessoas/{id_pessoa_mantida}/mesclar", summary="Mesclar duas Pessoas duplicadas (irreversível)")
def mesclar(
    id_pessoa_mantida: int, dados: MesclarPessoasRequest,
    db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_associados),
):
    resultado = mesclar_pessoas(db, id_pessoa_mantida, dados.id_pessoa_absorvida, dados.nome_confirmacao, usuario=usuario)

    # Qualquer entrada pendente na fila que envolvia qualquer uma das duas pessoas fica
    # desatualizada depois da mesclagem - resolve automaticamente, sem deixar pendência morta.
    pendentes = db.query(FilaRevisaoCadastro).filter(
        FilaRevisaoCadastro.status == PENDENTE,
        (FilaRevisaoCadastro.id_pessoa_a.in_([id_pessoa_mantida, dados.id_pessoa_absorvida]))
        | (FilaRevisaoCadastro.id_pessoa_b.in_([id_pessoa_mantida, dados.id_pessoa_absorvida])),
    ).all()
    for item in pendentes:
        item.status = "mesclado"
        item.resolvido_em = datetime.utcnow()
        item.id_usuario_resolveu = usuario.id_usuario
    db.commit()

    return {"mensagem": "Pessoas mescladas com sucesso.", **resultado}
