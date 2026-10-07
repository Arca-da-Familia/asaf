"""Módulo "Instituição": os dados da própria associação (nome, CNPJ, endereço, contatos, redes, Pix...) num lugar só do painel, cada campo
marcado "vai para o site" ou "só interno". Nada de tabela nova: os valores são as `ConfiguracaoInstitucional` de sempre e a marca de
visibilidade de cada campo é outra configuração booleana (`PUBLICO__<CHAVE>`), de modo que quem administra liga e desliga sem mexer em código.

Só os campos com `pode_ser_publico` podem ir para o site: o que é interno de verdade (e-mail remetente do sistema, texto de rodapé de documento)
nunca sai pela rota pública, mesmo que alguém grave a marca por engano."""
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.core import ConfiguracaoInstitucional
from app.validadores import validar_cnpj

PREFIXO_PUBLICO = "PUBLICO__"

# (chave, grupo, rótulo, ajuda, pode_ser_publico, publico_por_padrao)
CAMPOS: list[tuple[str, str, str, str, bool, bool]] = [
    ("NOME_INSTITUICAO", "Identidade", "Nome da instituição", "Nome oficial; aparece no cabeçalho dos documentos e no site.", True, True),
    ("CNPJ", "Identidade", "CNPJ", "Os 14 dígitos, com ou sem pontuação.", True, True),
    ("ENDERECO", "Identidade", "Endereço da sede", "Rua, número, bairro, cidade e estado.", True, True),
    ("DESCRICAO_INSTITUCIONAL", "Identidade", "Quem somos (texto curto)", "Duas ou três frases sobre a associação. Sem dados de pessoas.", True, True),
    ("TELEFONE_INSTITUCIONAL", "Contato", "Telefone / WhatsApp", "O número que o público pode ligar.", True, True),
    ("EMAIL_INSTITUCIONAL", "Contato", "E-mail de contato", "O e-mail que o público pode escrever.", True, True),
    ("HORARIO_ATENDIMENTO", "Contato", "Horário de atendimento", "Ex.: segunda a sexta, das 8h às 17h.", True, True),
    ("SITE_INSTAGRAM", "Redes", "Instagram", "@perfil ou o endereço completo.", True, True),
    ("SITE_FACEBOOK", "Redes", "Facebook", "O endereço completo da página.", True, True),
    ("LOGO_URL", "Aparência", "Endereço do logo", "Endereço (URL) da imagem do logo.", True, True),
    ("COR_PRIMARIA", "Aparência", "Cor primária", "No formato #RRGGBB.", True, True),
    ("COR_SECUNDARIA", "Aparência", "Cor secundária", "No formato #RRGGBB.", True, True),
    ("CHAVE_PIX", "Financeiro", "Chave Pix", "CNPJ, e-mail, telefone ou chave aleatória; gera o Pix Copia e Cola das cobranças.", True, False),
    ("NOME_BENEFICIARIO_PIX", "Financeiro", "Nome no Pix", "Até 25 caracteres, sem acento.", True, False),
    ("CIDADE_BENEFICIARIO_PIX", "Financeiro", "Cidade no Pix", "Até 15 caracteres, sem acento.", True, False),
    ("DADOS_BANCARIOS", "Financeiro", "Dados bancários", "Banco, agência e conta para recebimento.", True, False),
    ("EMAIL_REMETENTE", "Sistema", "E-mail remetente das notificações", "Só interno: de quem o sistema envia os avisos.", False, False),
    ("TEXTO_PADRAO_DOCUMENTO", "Sistema", "Texto de rodapé dos documentos", "Só interno: aviso legal que sai nos documentos gerados.", False, False),
]
_POR_CHAVE = {c[0]: c for c in CAMPOS}
_TAMANHO_MAXIMO = {"NOME_BENEFICIARIO_PIX": 25, "CIDADE_BENEFICIARIO_PIX": 15, "CHAVE_PIX": 77}


def chaves_de_visibilidade() -> list[tuple[str, bool]]:
    """As chaves `PUBLICO__X` a semear (com o valor padrão), uma por campo que pode ir para o site."""
    return [(PREFIXO_PUBLICO + c[0], c[5]) for c in CAMPOS if c[4]]


def _mapa(db: Session) -> dict[str, ConfiguracaoInstitucional]:
    return {c.chave_configuracao: c for c in db.query(ConfiguracaoInstitucional).all()}


def _publico(mapa: dict, chave: str) -> bool:
    campo = _POR_CHAVE[chave]
    if not campo[4]:
        return False
    marca = mapa.get(PREFIXO_PUBLICO + chave)
    return (marca.valor_configuracao == "true") if marca and marca.valor_configuracao in ("true", "false") else campo[5]


def listar_campos(db: Session) -> list[dict]:
    mapa = _mapa(db)
    resultado = []
    for chave, grupo, rotulo, ajuda, pode_ser_publico, _padrao in CAMPOS:
        config = mapa.get(chave)
        resultado.append({
            "chave": chave, "grupo": grupo, "rotulo": rotulo, "ajuda": ajuda,
            "tipo": config.tipo if config else "texto", "valor": (config.valor_configuracao or "") if config else "",
            "pode_ser_publico": pode_ser_publico, "publico": _publico(mapa, chave),
            "atualizado_em": config.atualizado_em if config else None,
        })
    return resultado


def validar_valor(chave: str, valor: str) -> str:
    """Devolve o valor limpo ou levanta 422 em português."""
    valor = (valor or "").strip()
    if chave == "CNPJ" and valor and not validar_cnpj(valor):
        raise HTTPException(status_code=422, detail="CNPJ inválido: os dígitos verificadores não conferem. Confira o número.")
    limite = _TAMANHO_MAXIMO.get(chave, 500)
    if len(valor) > limite:
        raise HTTPException(status_code=422, detail=f"Este campo aceita no máximo {limite} caracteres.")
    return valor


def atualizar_campo(db: Session, *, chave: str, valor: Optional[str], publico: Optional[bool], id_usuario: int) -> dict:
    """Grava o valor e/ou a marca "vai para o site" de um campo. Devolve o antes e o depois para a Auditoria."""
    from datetime import datetime

    from app.config_cache import invalidar_cache_configuracao
    from app.routers.core import _validar_valor_configuracao

    campo = _POR_CHAVE.get(chave)
    if campo is None:
        raise HTTPException(status_code=404, detail="Campo da instituição não encontrado.")
    mapa = _mapa(db)
    config = mapa.get(chave)
    if config is None:
        raise HTTPException(status_code=404, detail="Este campo ainda não foi criado no banco: reinicie o sistema para semear as configurações.")
    antes = {"valor": config.valor_configuracao, "publico": _publico(mapa, chave)}
    if publico is not None and not campo[4] and publico:
        raise HTTPException(status_code=400, detail="Este campo é só interno e não pode ir para o site.")
    if valor is not None:
        limpo = validar_valor(chave, valor)
        try:
            _validar_valor_configuracao(config, limpo)
        except HTTPException as erro:
            # a regra genérica das configurações fala pela chave técnica ('COR_PRIMARIA'); aqui o usuário vê o nome do campo na tela
            raise HTTPException(status_code=erro.status_code, detail=str(erro.detail).replace(f"'{chave}'", f"“{campo[2]}”"))
        config.valor_configuracao = limpo
        config.atualizado_em = datetime.utcnow()
        config.id_usuario_atualizacao = id_usuario
        invalidar_cache_configuracao(chave)
    if publico is not None and campo[4]:
        marca = mapa.get(PREFIXO_PUBLICO + chave)
        if marca is None:
            raise HTTPException(status_code=404, detail="A marca de visibilidade deste campo ainda não foi criada no banco.")
        marca.valor_configuracao = "true" if publico else "false"
        marca.atualizado_em = datetime.utcnow()
        marca.id_usuario_atualizacao = id_usuario
        invalidar_cache_configuracao(PREFIXO_PUBLICO + chave)
    db.commit()
    mapa = _mapa(db)
    return {"antes": antes, "depois": {"valor": mapa[chave].valor_configuracao, "publico": _publico(mapa, chave)}}


def campos_publicos(db: Session) -> dict[str, str]:
    """O que o site pode mostrar: só os campos marcados "vai para o site" e preenchidos, por chave."""
    mapa = _mapa(db)
    saida = {}
    for chave, *_resto in CAMPOS:
        config = mapa.get(chave)
        if config and (config.valor_configuracao or "").strip() and _publico(mapa, chave):
            saida[chave] = config.valor_configuracao.strip()
    return saida
