"""Cache em memória de ConfiguracaoInstitucional (v0.3.4).

Essas chaves são lidas em quase toda geração de documento (nome da instituição, CNPJ, textos
padrão, teto de alçada financeira etc.) - virar uma consulta a banco a cada leitura seria
desperdício. Cache simples de processo (sem TTL): invalidado explicitamente a cada escrita via
`/api/configuracoes/{chave}` (`invalidar_cache_configuracao`). Não sobrevive a múltiplas
réplicas do Container App sem invalidação cruzada - aceitável por ora (mesma limitação que
qualquer cache em memória de processo único; revisar se o app escalar para >1 réplica ativa
simultânea escrevendo configuração).
"""
from typing import Optional

from sqlalchemy.orm import Session

_cache: dict[str, Optional[str]] = {}


def obter_configuracao(db: Session, chave: str, padrao: Optional[str] = None) -> Optional[str]:
    if chave in _cache:
        return _cache[chave]
    from app.models.core import ConfiguracaoInstitucional

    config = db.query(ConfiguracaoInstitucional).filter(
        ConfiguracaoInstitucional.chave_configuracao == chave
    ).first()
    valor = config.valor_configuracao if config else padrao
    _cache[chave] = valor
    return valor


def invalidar_cache_configuracao(chave: Optional[str] = None) -> None:
    if chave is None:
        _cache.clear()
    else:
        _cache.pop(chave, None)
