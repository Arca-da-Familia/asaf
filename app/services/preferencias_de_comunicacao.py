"""v6.2b (FASE 6) - preferências de contato e o descadastro de verdade (ver app/models/preferencias_de_comunicacao.py).

O que este módulo garante:
  - só os e-mails NÃO obrigatórios se desligam (avisos fora das categorias obrigatórias, lembretes de mensalidade, avisos de evento); convocação e mudança de regra não aparecem
    como opção (decisão do Presidente, 2026-10-20);
  - o link "não quero mais receber" é ASSINADO com o segredo do servidor (`descadastro|<pessoa>|<tipo>`): não guarda token nem senha, não serve para outra pessoa nem para outro
    tipo, e não revela nada da pessoa (a página só diz qual tipo de e-mail aquele link controla); o mesmo link deixa voltar a receber;
  - toda mudança vai para a Auditoria (pelo link: sem usuário, com o IP; pelo painel: com o usuário), com o tipo, a escolha e de onde veio;
  - quem envia pergunta aqui antes de cada e-mail não obrigatório (`quem_nao_recebe`)."""
from __future__ import annotations

import hashlib
import hmac
import re
from datetime import datetime
from typing import Iterable, Optional

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import security
from app.auditoria import registrar_auditoria
from app.models.associados import Associado
from app.models.preferencias_de_comunicacao import (
    AVISOS,
    EVENTOS,
    LEMBRETES_DE_MENSALIDADE,
    ORIGEM_LINK,
    ORIGEM_PAINEL,
    TIPOS,
    PreferenciaDeComunicacao,
)
from app.models.core import Usuario
from app.services.site_publico import url_base_do_site

ROTULOS = {
    AVISOS: "Avisos do mural da ASAF que não são obrigatórios (por e-mail)",
    LEMBRETES_DE_MENSALIDADE: "Lembretes de mensalidade",
    EVENTOS: "Avisos sobre eventos em que você se inscreveu (mudança de data, adiamento, cancelamento)",
}
OBRIGATORIAS = "Convocação de assembleia e mudança de regra: são comunicações obrigatórias da associação e não podem ser desligadas."
_TOKEN = re.compile(r"^(\d{1,12})\.([a-z_]{1,40})\.([0-9a-f]{32})$")


def _assinatura(id_pessoa: int, tipo: str) -> str:
    security._checar_jwt_secret_configurado()
    return hmac.new(security.JWT_SECRET.encode("utf-8"), f"descadastro|{id_pessoa}|{tipo}".encode("utf-8"), hashlib.sha256).hexdigest()[:32]


def token_de(id_pessoa: int, tipo: str) -> str:
    return f"{id_pessoa}.{tipo}.{_assinatura(id_pessoa, tipo)}"


def ler_token(token: str) -> tuple[int, str]:
    """(pessoa, tipo) de um link válido; qualquer coisa errada (formato, tipo, assinatura) é o mesmo 404, sem dizer o quê."""
    achado = _TOKEN.match((token or "").strip())
    if achado is None or achado.group(2) not in TIPOS:
        raise HTTPException(status_code=404, detail="Link inválido ou incompleto.")
    id_pessoa, tipo = int(achado.group(1)), achado.group(2)
    if not hmac.compare_digest(achado.group(3), _assinatura(id_pessoa, tipo)):
        raise HTTPException(status_code=404, detail="Link inválido ou incompleto.")
    return id_pessoa, tipo


def link_para_descadastrar(db: Session, id_pessoa: int, tipo: str) -> str:
    return f"{url_base_do_site(db)}/descadastrar/?token={token_de(id_pessoa, tipo)}"


def rodape(db: Session, id_pessoa: int, tipo: str) -> tuple[str, dict]:
    """O texto do fim do e-mail não obrigatório e o cabeçalho `List-Unsubscribe` (o botão "cancelar inscrição" dos programas de e-mail)."""
    link = link_para_descadastrar(db, id_pessoa, tipo)
    texto = f"\n\nNão quer mais receber este tipo de e-mail? Acesse: {link}"
    return texto, {"List-Unsubscribe": f"<{link}>"}


def recebe(db: Session, id_pessoa: Optional[int], tipo: str) -> bool:
    if id_pessoa is None:
        return True
    linha = db.query(PreferenciaDeComunicacao).filter(PreferenciaDeComunicacao.id_pessoa == id_pessoa, PreferenciaDeComunicacao.tipo == tipo).first()
    return linha is None or linha.recebe


def quem_nao_recebe(db: Session, ids_pessoas: Iterable[Optional[int]], tipo: str) -> set[int]:
    """As pessoas, entre as dadas, que desligaram este tipo de e-mail."""
    ids = sorted({i for i in ids_pessoas if i is not None})
    fora: set[int] = set()
    for inicio in range(0, len(ids), 500):
        fora |= {
            i for (i,) in db.query(PreferenciaDeComunicacao.id_pessoa).filter(
                PreferenciaDeComunicacao.id_pessoa.in_(ids[inicio:inicio + 500]), PreferenciaDeComunicacao.tipo == tipo, PreferenciaDeComunicacao.recebe.is_(False),
            ).all()
        }
    return fora


def alterar(db: Session, *, id_pessoa: int, tipo: str, recebe_: bool, origem: str, usuario: Optional[Usuario] = None, ip: Optional[str] = None) -> bool:
    """Grava a escolha (só quando muda) e a Auditoria. Devolve a escolha que vale agora."""
    if tipo not in TIPOS:
        raise HTTPException(status_code=422, detail="Tipo de e-mail inválido.")
    linha = db.query(PreferenciaDeComunicacao).filter(PreferenciaDeComunicacao.id_pessoa == id_pessoa, PreferenciaDeComunicacao.tipo == tipo).first()
    atual = linha is None or linha.recebe
    if atual == recebe_:
        return atual
    if linha is None:
        linha = PreferenciaDeComunicacao(id_pessoa=id_pessoa, tipo=tipo)
        db.add(linha)
    linha.recebe, linha.origem, linha.alterado_em = recebe_, origem, datetime.utcnow()
    try:
        db.flush()
    except IntegrityError:
        # dois cliques ao mesmo tempo na primeira escolha: o outro gravou primeiro; vale a escolha dele, que é a mesma
        db.rollback()
        return recebe(db, id_pessoa, tipo)
    registrar_auditoria(
        db, usuario, "preferencias_de_comunicacao", "PREFERENCIA_DE_COMUNICACAO_ALTERADA", id_registro_afetado=id_pessoa,
        dados_depois={"tipo": tipo, "recebe": recebe_, "origem": origem}, ip_origem=ip,
    )
    return recebe_


def resumo_publico(db: Session, token: str) -> dict:
    """O que a página do site mostra: o tipo de e-mail e se a pessoa recebe. Nada que identifique a pessoa."""
    id_pessoa, tipo = ler_token(token)
    return {"tipo": tipo, "rotulo": ROTULOS[tipo], "recebe": recebe(db, id_pessoa, tipo)}


def mudar_pelo_link(db: Session, token: str, recebe_: bool, ip: str) -> dict:
    id_pessoa, tipo = ler_token(token)
    agora = alterar(db, id_pessoa=id_pessoa, tipo=tipo, recebe_=recebe_, origem=ORIGEM_LINK, ip=ip)
    return {"tipo": tipo, "rotulo": ROTULOS[tipo], "recebe": agora}


# ------------------------------------------------------------------------------------------------ no painel (a própria pessoa)
def _pessoa_do_usuario(db: Session, usuario: Usuario) -> Optional[int]:
    associado = db.query(Associado).filter(Associado.id_usuario == usuario.id_usuario).first()
    return associado.id_pessoa if associado is not None else None


def minhas(db: Session, usuario: Usuario) -> dict:
    """As preferências de quem está no painel. Sem cadastro de pessoa (usuário só de equipe), não há o que escolher."""
    from app.services.conta_de_visitante import codigo_de_teste_na_resposta

    id_pessoa = _pessoa_do_usuario(db, usuario)
    if id_pessoa is None:
        return {"tem_cadastro": False, "obrigatorias": OBRIGATORIAS, "tipos": []}
    fora = {t for t in TIPOS if not recebe(db, id_pessoa, t)}
    tipos = [{"tipo": t, "rotulo": ROTULOS[t], "recebe": t not in fora} for t in TIPOS]
    if codigo_de_teste_na_resposta():
        # SÓ na homologação (sem e-mail e com a variável de teste): o robô não lê e-mail, então recebe o próprio link para provar a página do site
        for item in tipos:
            item["link_de_teste"] = link_para_descadastrar(db, id_pessoa, item["tipo"])
    return {"tem_cadastro": True, "obrigatorias": OBRIGATORIAS, "tipos": tipos}


def mudar_no_painel(db: Session, usuario: Usuario, tipo: str, recebe_: bool) -> dict:
    id_pessoa = _pessoa_do_usuario(db, usuario)
    if id_pessoa is None:
        raise HTTPException(status_code=409, detail="Seu login não está ligado a um cadastro de associado: não há preferências de e-mail para escolher.")
    alterar(db, id_pessoa=id_pessoa, tipo=tipo, recebe_=recebe_, origem=ORIGEM_PAINEL, usuario=usuario)
    return minhas(db, usuario)
