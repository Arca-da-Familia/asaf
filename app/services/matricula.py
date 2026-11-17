"""v1.2 - matrícula sequencial: número voltado pro humano (carteirinha, ofício, ata), separado
do id_associado interno. Simples incremento do maior número já atribuído - suficiente pro
volume desta associação; não é pensado pra alta concorrência (não usa sequence de banco
dedicada), mas commits de criação de associado não são um caminho de escrita concorrente aqui."""
from sqlalchemy.orm import Session

from app.models.associados import Associado


def proximo_numero_matricula(db: Session) -> int:
    """v9.5 (decisão do Presidente, 13/11/2026): quando dois cadastros duplicados de associado são juntados, fica a matrícula mais antiga e o número
    que fica livre vai para o PRÓXIMO associado que entrar ("vai ter que dar esse número 41 para uma nova pessoa que está chegando"); os números dos
    outros nunca mudam. Por isso o número novo é o MENOR que nenhum cadastro de associado usa (desligado e anonimizado continuam usando o seu);
    sem buraco, é o maior + 1, como sempre foi."""
    usados = {n for (n,) in db.query(Associado.numero_matricula).filter(Associado.numero_matricula.isnot(None)).all()}
    numero = 1
    while numero in usados:
        numero += 1
    return numero
