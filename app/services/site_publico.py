"""v5.5c - onde fica o site público da ASAF, para os e-mails que levam a pessoa até ele (cancelar a inscrição, confirmar a vaga da lista de espera).

A configuração `URL_BASE_SITE_PUBLICO` (Configurações) vale primeiro; sem ela, a variável de ambiente de mesmo nome (a homologação aponta para o site de teste); sem nenhuma das
duas, o site de produção. Assim o link funciona sem ninguém ter de configurar nada, e o ambiente de teste nunca manda uma pessoa para o site de verdade."""
import os

from sqlalchemy.orm import Session

from app.config_cache import obter_configuracao

SITE_DE_PRODUCAO = "https://asaf.org.br"


def url_base_do_site(db: Session) -> str:
    valor = (obter_configuracao(db, "URL_BASE_SITE_PUBLICO", "") or "").strip()
    if not valor:
        valor = os.environ.get("URL_BASE_SITE_PUBLICO", "").strip()
    return (valor or SITE_DE_PRODUCAO).rstrip("/")


def link_para_cancelar_inscricao(db: Session, token: str) -> str:
    return f"{url_base_do_site(db)}/cancelar-inscricao/?token={token}"


def link_para_confirmar_inscricao(db: Session, token: str) -> str:
    return f"{url_base_do_site(db)}/confirmar-inscricao/?token={token}"
