"""v2.0 - leitura de `RegraEstatutaria` por vigência: o helper central que qualquer fluxo que
precise de um número estatutário (quórum, prazo, mandato...) deve chamar, em vez de embutir a
constante no código. Sem cache de processo como `app.config_cache` (v0.3.4) de propósito: aqui o
que importa é sempre bater no histórico certo, inclusive no passado (`em=<data>`, para
reconstituir a regra vigente numa assembleia antiga) - cache invalidado por escrita teria a
mesma limitação multi-réplica do config_cache, sem o mesmo ganho (regra estatutária muda bem
menos vezes que configuração geral)."""
import math
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models.estatuto import RegraEstatutaria


def obter_regra_vigente(
    db: Session, parametro: str, padrao: Optional[str] = None, em: Optional[datetime] = None
) -> Optional[str]:
    """Valor de `parametro` vigente no momento `em` (padrão: agora). Devolve `padrao` se não
    houver nenhuma linha vigente naquele momento - nunca lança erro, para não derrubar um fluxo
    inteiro por causa de um parâmetro ainda não semeado."""
    momento = em or datetime.utcnow()
    regra = (
        db.query(RegraEstatutaria)
        .filter(
            RegraEstatutaria.parametro == parametro,
            RegraEstatutaria.vigencia_inicio <= momento,
            (RegraEstatutaria.vigencia_fim.is_(None)) | (RegraEstatutaria.vigencia_fim > momento),
        )
        .order_by(RegraEstatutaria.vigencia_inicio.desc())
        .first()
    )
    return regra.valor if regra else padrao


def avaliar_quorum_minimo(valor: str, base: int) -> int:
    """Converte um valor de `RegraEstatutaria` de quórum ("2/3", "1/2+1", "totalidade", "6") na
    quantidade mínima de pessoas exigida sobre uma base - usado pela apuração de quórum em tempo
    real (v2.3) e pelo motor de votação (v2.4). Nunca arredonda pra baixo: fração de gente exige
    o próximo inteiro (2/3 de 10 = 6,66 → 7) - arredondar pra baixo contaria quórum como atingido
    um voto antes da hora, o erro mais caro possível aqui."""
    valor = valor.strip().lower()
    if valor == "totalidade":
        return base
    extra = 0
    fracao_str = valor
    if "+" in valor:
        fracao_str, extra_str = valor.split("+", 1)
        extra = int(extra_str.strip())
    if "/" in fracao_str:
        numerador, denominador = fracao_str.split("/")
        fracao = int(numerador) / int(denominador)
        return math.ceil(base * fracao) + extra
    return int(fracao_str) + extra


def reformar_regra(
    db: Session, parametro: str, novo_valor: str, id_usuario: Optional[int] = None,
    artigo_origem: Optional[str] = None, descricao: Optional[str] = None,
    id_documento_estatuto: Optional[int] = None, quando: Optional[datetime] = None,
) -> RegraEstatutaria:
    """Reforma de estatuto: NUNCA faz UPDATE no valor de uma linha vigente - fecha a vigência
    atual (`vigencia_fim`) e insere uma nova linha, herdando `tipo`/`categoria`/`descricao`/
    `artigo_origem` da regra anterior quando o chamador não informar um novo. Preserva o
    histórico completo mesmo que o parâmetro nunca tenha existido antes (primeira linha)."""
    momento = quando or datetime.utcnow()
    atual = (
        db.query(RegraEstatutaria)
        .filter(RegraEstatutaria.parametro == parametro, RegraEstatutaria.vigencia_fim.is_(None))
        .order_by(RegraEstatutaria.vigencia_inicio.desc())
        .first()
    )
    if atual is not None:
        atual.vigencia_fim = momento

    nova = RegraEstatutaria(
        parametro=parametro,
        valor=novo_valor,
        tipo=atual.tipo if atual else "texto",
        categoria=atual.categoria if atual else "regras",
        descricao=descricao if descricao is not None else (atual.descricao if atual else None),
        artigo_origem=artigo_origem if artigo_origem is not None else (atual.artigo_origem if atual else None),
        id_documento_estatuto=id_documento_estatuto if id_documento_estatuto is not None else (atual.id_documento_estatuto if atual else None),
        vigencia_inicio=momento,
        id_usuario_criacao=id_usuario,
    )
    db.add(nova)
    db.flush()
    return nova
