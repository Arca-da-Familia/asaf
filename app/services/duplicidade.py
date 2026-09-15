"""v1.3 - detecção de duplicidade na importação em massa: CPF exato (mesmo dado que já bloqueia
cadastro avulso) e similaridade de nome + data de nascimento (pega o caso real de planilha
antiga com o mesmo associado digitado duas vezes, com acentuação/espaçamento diferente, sem
CPF batendo por erro de digitação).

v1.8 acrescenta `escanear_duplicidade_continua`: a mesma comparação nome+nascimento, mas
rodando contra TODAS as `Pessoa`s do sistema (não só a linha que está sendo importada agora),
alimentando a fila de revisão - nunca mescla nada sozinho, só sinaliza."""
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


def escanear_duplicidade_continua(db: Session) -> int:
    """Agrupa todas as Pessoas com nome normalizado + data de nascimento iguais - cada grupo
    com mais de uma pessoa vira um par candidato na fila de revisão (uma entrada por par, nunca
    duplicada se já existir uma pendente para o mesmo par). Devolve quantas entradas NOVAS foram
    criadas nesta varredura."""
    from app.models.qualidade_cadastro import DUPLICIDADE_NOME_NASCIMENTO, FilaRevisaoCadastro, PENDENTE

    candidatas = db.query(Pessoa).filter(Pessoa.data_nascimento.isnot(None)).all()
    grupos: dict[tuple, list[Pessoa]] = {}
    for pessoa in candidatas:
        chave = (normalizar_nome(pessoa.nome_completo), pessoa.data_nascimento)
        grupos.setdefault(chave, []).append(pessoa)

    novos = 0
    for grupo in grupos.values():
        if len(grupo) < 2:
            continue
        for i in range(len(grupo)):
            for j in range(i + 1, len(grupo)):
                id_a, id_b = sorted((grupo[i].id_pessoa, grupo[j].id_pessoa))
                ja_existe = (
                    db.query(FilaRevisaoCadastro)
                    .filter(
                        FilaRevisaoCadastro.tipo_sinal == DUPLICIDADE_NOME_NASCIMENTO,
                        FilaRevisaoCadastro.id_pessoa_a == id_a, FilaRevisaoCadastro.id_pessoa_b == id_b,
                        FilaRevisaoCadastro.status == PENDENTE,
                    )
                    .first()
                )
                if ja_existe:
                    continue
                db.add(FilaRevisaoCadastro(
                    tipo_sinal=DUPLICIDADE_NOME_NASCIMENTO, id_pessoa_a=id_a, id_pessoa_b=id_b,
                    detalhe=f"Nome e data de nascimento coincidentes: '{grupo[i].nome_completo}'.",
                ))
                novos += 1
    db.commit()
    return novos
