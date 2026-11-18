"""v9.5i - a CREDENCIAL do associado (a carteirinha) com QR que vale SEMPRE (decisão do Presidente, 14/11/2026: "a carteira tem que ser atualizada em
tempo real... não existe negócio de não vale mais devido ao tempo"). Revoga a regra de 15/10 (o QR vencia em 15 dias).

O QR leva o endereço da página de conferência com o código sorteado da credencial (`/credencial/<código>` no painel). Quem lê vê a situação de AGORA,
não a do dia em que o cartão foi impresso:
  - verde, "Associado em dia" (ou "em experiência"): pode usar o que é de associado;
  - ouro, "Associado com pendência" (mensalidade em atraso), "suspenso" ou "licenciado": é associado, mas com uma restrição;
  - cinza, "Esta credencial não vale": foi substituída por outra (quem perdeu o cartão) ou a pessoa não é mais associada — sem foto e sem nome.
O mesmo código serve à portaria dos eventos e ao credenciamento das assembleias (`app.services.carteirinha.decodificar` aceita o código, o endereço
lido do QR e, até vencerem, os QR antigos)."""
import re
import secrets
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.models.associados import Associado
from app.models.credencial import JUNCAO, PERDA_OU_TROCA, Credencial
from app.models.pessoas import Papel, Pessoa

CAMINHO_DA_PAGINA = "/credencial/"
_FORMATO = re.compile(r"^[A-Za-z0-9_-]{16,40}$")

DESLIGADO = "Desligado"
EM_DIA = "em_dia"
PENDENCIA = "pendencia"
NAO_VALE = "nao_vale"

# a situação do cadastro -> (estado, título em letras grandes, a linha de baixo)
_POR_SITUACAO = {
    "Ativo - Em Dia": (EM_DIA, "Associado em dia", "Situação conferida agora"),
    "Em Experiência": (EM_DIA, "Associado em experiência", "No período de experiência do Estatuto"),
    "Ativo - Inadimplente": (PENDENCIA, "Associado com pendência", "Mensalidade em atraso"),
    "Suspenso (Estatuto)": (PENDENCIA, "Associado suspenso", "Suspenso conforme o Estatuto"),
    "Licenciado": (PENDENCIA, "Associado licenciado", "Em licença"),
}
_NAO_VALE = (NAO_VALE, "Esta credencial não vale", "Foi substituída por outra, ou a pessoa não é mais associada")


def gerar_codigo() -> str:
    """22 letras e números sorteados (128 bits): ninguém adivinha nem percorre."""
    return secrets.token_urlsafe(16)


def codigo_lido(texto: Optional[str]) -> Optional[str]:
    """O que chega da câmera ou do leitor: o endereço completo da página (`https://painel.asaf.org.br/credencial/<código>`), só o código, com espaço ou
    barra no fim. Devolve o código ou None (não é um código de credencial)."""
    t = (texto or "").strip()
    if CAMINHO_DA_PAGINA in t:
        t = t.split(CAMINHO_DA_PAGINA, 1)[1]
    t = t.split("?", 1)[0].split("#", 1)[0].strip().strip("/")
    return t if _FORMATO.match(t) else None


def parece_credencial(texto: Optional[str]) -> bool:
    """O QR antigo era um JWT (três partes separadas por ponto); a credencial nova é o código ou o endereço da página."""
    t = (texto or "").strip()
    return CAMINHO_DA_PAGINA in t or ("." not in t and codigo_lido(t) is not None)


def valendo(db: Session, id_associado: int) -> Optional[Credencial]:
    return (
        db.query(Credencial)
        .filter(Credencial.id_associado == id_associado, Credencial.substituida_em.is_(None))
        .order_by(Credencial.id_credencial.desc())
        .first()
    )


def _nova(db: Session, id_associado: int, id_usuario: Optional[int]) -> Credencial:
    credencial = Credencial(id_associado=id_associado, codigo=gerar_codigo(), id_usuario_emissao=id_usuario)
    db.add(credencial)
    db.flush()
    return credencial


def atual(db: Session, associado: Associado, id_usuario: Optional[int] = None) -> Credencial:
    """A credencial que vale do associado; nasce na primeira vez que é aberta (quem abriu fica registrado). Quem chama faz o commit."""
    return valendo(db, associado.id_associado) or _nova(db, associado.id_associado, id_usuario)


def emitir_outra(db: Session, associado: Associado, id_usuario: Optional[int]) -> tuple[Optional[Credencial], Credencial]:
    """Quem perdeu o cartão: a que valia deixa de valer NA HORA (o QR dela passa a mostrar "não vale") e nasce outra com código novo."""
    anterior = valendo(db, associado.id_associado)
    if anterior is not None:
        anterior.substituida_em = datetime.utcnow()
        anterior.motivo_substituicao = PERDA_OU_TROCA
    return anterior, _nova(db, associado.id_associado, id_usuario)


def substituir_na_juncao(db: Session, id_associado_que_sai: int) -> int:
    """Na junção de dois cadastros, a credencial do cadastro juntado deixa de valer (a pessoa fica com a do cadastro que fica). Devolve quantas."""
    quantas = 0
    for credencial in db.query(Credencial).filter(Credencial.id_associado == id_associado_que_sai, Credencial.substituida_em.is_(None)):
        credencial.substituida_em = datetime.utcnow()
        credencial.motivo_substituicao = JUNCAO
        quantas += 1
    return quantas


def por_codigo(db: Session, codigo: Optional[str]) -> Optional[Credencial]:
    if not codigo:
        return None
    return db.query(Credencial).filter(Credencial.codigo == codigo).first()


def associado_da_credencial(db: Session, credencial: Optional[Credencial]) -> Optional[Associado]:
    """O associado de uma credencial que não foi substituída (sem olhar a situação)."""
    if credencial is None or credencial.substituida_em is not None:
        return None
    return db.query(Associado).filter(Associado.id_associado == credencial.id_associado).first()


def dono_que_vale(db: Session, credencial: Optional[Credencial]) -> Optional[tuple[Associado, Pessoa]]:
    """O associado e a pessoa da credencial, só se ela vale: não foi substituída, o papel de associado está ativo e a situação não é Desligado."""
    associado = associado_da_credencial(db, credencial)
    if associado is None or associado.status_arrolamento == DESLIGADO:
        return None
    pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == associado.id_pessoa).first()
    papel = (
        db.query(Papel).filter(Papel.id_pessoa == associado.id_pessoa, Papel.tipo_papel == "associado", Papel.ativo.is_(True)).first()
        if pessoa else None
    )
    if pessoa is None or papel is None:
        return None
    return associado, pessoa


def situacao_publica(db: Session, codigo: Optional[str], tem_foto) -> dict:
    """O que a página de quem lê o QR mostra. Nunca CPF, endereço, telefone ou e-mail. Quando não vale, nem o nome nem a foto (e o motivo é o mesmo texto
    para código inexistente, substituído ou de quem saiu: a página não diz qual)."""
    conferido_em = datetime.now(timezone.utc).isoformat()
    dono = dono_que_vale(db, por_codigo(db, codigo))
    if dono is None:
        estado, titulo, detalhe = _NAO_VALE
        return {"estado": estado, "titulo": titulo, "detalhe": detalhe, "conferido_em": conferido_em}
    associado, pessoa = dono
    situacao = associado.status_arrolamento or ""
    estado, titulo, detalhe = _POR_SITUACAO.get(situacao, (PENDENCIA, "Associado", situacao or "Situação não informada"))
    return {
        "estado": estado,
        "titulo": titulo,
        "detalhe": detalhe,
        "conferido_em": conferido_em,
        "nome_completo": pessoa.nome_completo,
        "matricula": associado.numero_matricula,
        "categoria": associado.categoria,
        "situacao": situacao,
        "foto": f"/api/publico/credencial/{codigo}/foto" if tem_foto(pessoa) else None,
    }
