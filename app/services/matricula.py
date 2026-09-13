"""v1.2 - matrícula sequencial: número voltado pro humano (carteirinha, ofício, ata), separado
do id_associado interno. Simples incremento do maior número já atribuído - suficiente pro
volume desta associação; não é pensado pra alta concorrência (não usa sequence de banco
dedicada), mas commits de criação de associado não são um caminho de escrita concorrente aqui."""
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.associados import Associado


def proximo_numero_matricula(db: Session) -> int:
    maior_atual = db.query(func.max(Associado.numero_matricula)).scalar()
    return (maior_atual or 0) + 1
