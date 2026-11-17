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
    criadas nesta varredura.
    v7.1 (achado ao vivo na homologação): o par que alguém julgou "não é duplicado" (ignorado) NÃO volta à fila na próxima busca - antes, só a
    entrada pendente impedia a repetição, e o par ignorado reaparecia a cada busca."""
    from app.models.qualidade_cadastro import DUPLICIDADE_NOME_NASCIMENTO, IGNORADO, FilaRevisaoCadastro, PENDENTE

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
                        FilaRevisaoCadastro.status.in_((PENDENTE, IGNORADO)),
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
    novos += _escanear_nomes_parecidos(db)
    db.commit()
    return novos


_PARTICULAS_DO_NOME = {"da", "de", "do", "das", "dos", "e"}


def primeiro_e_ultimo_nome(nome: str) -> Optional[tuple[str, str]]:
    """("raimundo", "silva") para "Raimundo N. da Silva" e "Raimundo Nonato da Silva" - sem acento, sem as partículas (da, de, do...)."""
    partes = [p.strip(".") for p in normalizar_nome(nome).split()]
    partes = [p for p in partes if p and p not in _PARTICULAS_DO_NOME]
    return (partes[0], partes[-1]) if len(partes) >= 2 else None


# mais gente que isto com o mesmo primeiro e último nome E o mesmo dado não é cadastro repetido: é o telefone (ou e-mail) da família, ou dado de
# teste repetido - apontar todos os pares encheria a fila de falsos duplicados
LIMITE_DE_PESSOAS_COM_O_MESMO_DADO = 3


def _escanear_nomes_parecidos(db: Session) -> int:
    """v9.5 (3ª conferência): a busca só achava nome IDÊNTICO com a mesma data de nascimento - "Raimundo Nonato da Silva" e "Raimundo N. da Silva",
    ou o mesmo nome sem data de nascimento, nunca entravam na fila (e cadastro de associado só se junta a partir dela). Agora também: o mesmo
    primeiro e último nome com pelo menos um dado pessoal igual (data de nascimento, telefone ou e-mail), quando esse dado é de no máximo
    `LIMITE_DE_PESSOAS_COM_O_MESMO_DADO` pessoas com esse nome. O par já apontado (pendente ou julgado "não é a mesma pessoa") não volta."""
    from app.models.qualidade_cadastro import DUPLICIDADE_NOME_NASCIMENTO, DUPLICIDADE_PARECIDA, IGNORADO, PENDENTE, FilaRevisaoCadastro

    grupos: dict[tuple, list[Pessoa]] = {}
    for pessoa in db.query(Pessoa).filter(Pessoa.nome_completo.isnot(None)).all():
        chave = primeiro_e_ultimo_nome(pessoa.nome_completo)
        if chave:
            grupos.setdefault(chave, []).append(pessoa)

    ja_apontados = {
        (item.id_pessoa_a, item.id_pessoa_b)
        for item in db.query(FilaRevisaoCadastro).filter(
            FilaRevisaoCadastro.tipo_sinal.in_((DUPLICIDADE_NOME_NASCIMENTO, DUPLICIDADE_PARECIDA)),
            FilaRevisaoCadastro.status.in_((PENDENTE, IGNORADO)),
        )
    }

    def telefone(p):
        digitos = somente_digitos(p.telefone_whatsapp or "")
        return digitos if len(digitos) >= 8 else None

    def email(p):
        return p.email_contato.strip().lower() if p.email_contato and p.email_contato.strip() else None

    dados = (("a mesma data de nascimento", lambda p: p.data_nascimento), ("o mesmo telefone", telefone), ("o mesmo e-mail", email))
    novos = 0
    for grupo in grupos.values():
        if len(grupo) < 2:
            continue
        pares: dict[tuple, tuple] = {}
        for rotulo, valor_de in dados:
            por_valor: dict = {}
            for p in grupo:
                valor = valor_de(p)
                if valor:
                    por_valor.setdefault(valor, []).append(p)
            for iguais in por_valor.values():
                if not 2 <= len(iguais) <= LIMITE_DE_PESSOAS_COM_O_MESMO_DADO:
                    continue
                for i in range(len(iguais)):
                    for j in range(i + 1, len(iguais)):
                        a, b = sorted((iguais[i], iguais[j]), key=lambda p: p.id_pessoa)
                        pares.setdefault((a.id_pessoa, b.id_pessoa), (a, b, []))[2].append(rotulo)
        for (id_a, id_b), (a, b, sinais) in pares.items():
            if a.data_nascimento and a.data_nascimento == b.data_nascimento and normalizar_nome(a.nome_completo) == normalizar_nome(b.nome_completo):
                continue  # é o outro sinal (nome e nascimento iguais)
            if (id_a, id_b) in ja_apontados:
                continue
            ja_apontados.add((id_a, id_b))
            db.add(FilaRevisaoCadastro(
                tipo_sinal=DUPLICIDADE_PARECIDA, id_pessoa_a=id_a, id_pessoa_b=id_b,
                detalhe=f"Nomes parecidos ('{a.nome_completo}' e '{b.nome_completo}') com {' e '.join(sinais)}.",
            ))
            novos += 1
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
