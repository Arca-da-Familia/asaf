"""v1.3 - detecção de duplicidade na importação em massa: CPF exato (mesmo dado que já bloqueia
cadastro avulso) e similaridade de nome + data de nascimento (pega o caso real de planilha
antiga com o mesmo associado digitado duas vezes, com acentuação/espaçamento diferente, sem
CPF batendo por erro de digitação).

v1.8 acrescenta `escanear_duplicidade_continua`: a mesma comparação nome+nascimento, mas
rodando contra TODAS as `Pessoa`s do sistema (não só a linha que está sendo importada agora),
alimentando a fila de revisão - nunca mescla nada sozinho, só sinaliza.

v1.8 também acrescenta `detectar_cadastro_duplicado`: **bloqueio na hora do cadastro direto**
(não só sinal na importação) - decisão do usuário depois de discutir a mesclagem de associados
já existentes: "o certo é o sistema não deixar cadastrar" em vez de mesclar depois. CPF nunca
bate por erro de digitação (é por isso que CPF sozinho não pega o caso), então o sinal aqui é
nome batendo + pelo menos UM outro dado pessoal batendo (nascimento, telefone ou e-mail) - e só
quem tem a permissão `forcar_cadastro_duplicado` (Presidente, por padrão) pode cadastrar mesmo
assim, de propósito."""
import unicodedata
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models.associados import Associado
from app.models.pessoas import Pessoa
from app.validadores import somente_digitos


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


def detectar_cadastro_duplicado(
    db: Session,
    nome_completo: str,
    data_nascimento: Optional[datetime] = None,
    telefone_whatsapp: Optional[str] = None,
    email_contato: Optional[str] = None,
    excluir_id_pessoa: Optional[int] = None,
) -> Optional[Pessoa]:
    """Bloqueio na hora do cadastro (não sinal, não sinal-que-vira-tela-depois): nome batendo
    (normalizado) + pelo menos um outro dado pessoal batendo é motivo suficiente pra recusar o
    cadastro direto, mostrando qual `Pessoa` já existente parece ser a mesma. `excluir_id_pessoa`
    existe pra edição de cadastro (não comparar a pessoa consigo mesma)."""
    nome_normalizado = normalizar_nome(nome_completo)
    if not nome_normalizado:
        return None

    telefone_normalizado = somente_digitos(telefone_whatsapp) if telefone_whatsapp else None
    email_normalizado = email_contato.strip().lower() if email_contato else None

    candidatos = db.query(Pessoa).filter(Pessoa.nome_completo.isnot(None)).all()
    for candidato in candidatos:
        if excluir_id_pessoa and candidato.id_pessoa == excluir_id_pessoa:
            continue
        if normalizar_nome(candidato.nome_completo) != nome_normalizado:
            continue

        sinais = 0
        if data_nascimento and candidato.data_nascimento and candidato.data_nascimento == data_nascimento:
            sinais += 1
        if telefone_normalizado and candidato.telefone_whatsapp and somente_digitos(candidato.telefone_whatsapp) == telefone_normalizado:
            sinais += 1
        if email_normalizado and candidato.email_contato and candidato.email_contato.strip().lower() == email_normalizado:
            sinais += 1

        if sinais >= 1:
            return candidato

    return None
