"""v1.3 - detecção de duplicidade na importação em massa: CPF exato (mesmo dado que já bloqueia
cadastro avulso) e similaridade de nome + data de nascimento (pega o caso real de planilha
antiga com o mesmo associado digitado duas vezes, com acentuação/espaçamento diferente, sem
CPF batendo por erro de digitação)."""
import unicodedata
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models.associados import Associado
from app.models.pessoas import Pessoa


def normalizar_nome(nome: str) -> str:
    sem_acento = unicodedata.normalize("NFKD", nome or "").encode("ascii", "ignore").decode("ascii")
    return " ".join(sem_acento.lower().split())


def verificar_duplicidade(db: Session, nome_completo: str, cpf: str, data_nascimento: Optional[datetime]) -> dict:
    """Retorna {"tipo": "cpf_exato"|"nome_e_nascimento"|None, "id_associado": int|None,
    "nome_encontrado": str|None} - "cpf_exato" é bloqueio automático de qualquer forma
    (mesma regra de sempre); "nome_e_nascimento" é sinal pra tela de resolução decidir."""
    por_cpf = (
        db.query(Associado)
        .join(Pessoa, Associado.id_pessoa == Pessoa.id_pessoa)
        .filter(Pessoa.cpf == cpf)
        .first()
    )
    if por_cpf:
        return {"tipo": "cpf_exato", "id_associado": por_cpf.id_associado, "nome_encontrado": por_cpf.nome_completo}

    if data_nascimento:
        nome_normalizado = normalizar_nome(nome_completo)
        candidatos = (
            db.query(Associado)
            .join(Pessoa, Associado.id_pessoa == Pessoa.id_pessoa)
            .filter(Pessoa.data_nascimento == data_nascimento)
            .all()
        )
        for candidato in candidatos:
            if normalizar_nome(candidato.nome_completo) == nome_normalizado:
                return {"tipo": "nome_e_nascimento", "id_associado": candidato.id_associado, "nome_encontrado": candidato.nome_completo}

    return {"tipo": None, "id_associado": None, "nome_encontrado": None}
