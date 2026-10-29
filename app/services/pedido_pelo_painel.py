"""v7.2e (FASE 7) - a solicitação do titular feita de DENTRO do painel (Meu Perfil), pela pessoa sobre o próprio cadastro (LGPD, art. 18, § 3º: o pedido se
faz "mediante requerimento expresso do titular"; o painel é um dos canais, ao lado do formulário do site e da Minha conta - PLANO, item "Canal único").

O pedido já sai ligado ao cadastro dela (o do associado ligado à conta). A identidade nasce validada (IDENTIDADE_PAINEL) só quando a conta tem o segundo
passo ligado e a senha não é mais a provisória: o servidor não exige o segundo passo de todo nível, e a senha sozinha vale o mesmo que o e-mail (o "esqueci a
senha" a troca) - sem isso, a equipe confere a identidade à mão, como no pedido do site (revisão da v7.2e). O pedido entra na mesma fila, com o mesmo prazo, o
mesmo responsável (o pedido sobre o Presidente fica com o 1º Vice) e a mesma confirmação simples na hora; a pessoa lê a resposta, o resultado e o fundamento no
painel e baixa ali o relatório liberado (v7.2c). O pedido feito pelo painel NÃO aparece na Minha conta do site: o e-mail do cadastro pode ser de outra pessoa da
família; o e-mail só avisa que há novidade e diz para ler no painel."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import textos_de_privacidade
from app.models.atendimento import IDENTIDADE_PAINEL, TITULAR_LGPD, Atendimento
from app.models.associados import Associado
from app.models.pessoas import Pessoa
from app.services import atendimento as atendimentos

PONTO_DO_AVISO = "ATENDIMENTO_TITULAR"
ORIGEM = "painel"
LIMITE_POR_DIA = 5  # pedidos feitos pelo painel por pessoa em 24 horas (cada um avisa a fila inteira)


def pessoa_da_conta(db: Session, usuario) -> Pessoa:
    """O cadastro da pessoa que está no painel: o do associado ligado à conta. Conta sem cadastro (técnica) não faz pedido sobre dados de alguém."""
    pessoa = (db.query(Pessoa).join(Associado, Associado.id_pessoa == Pessoa.id_pessoa).filter(Associado.id_usuario == usuario.id_usuario)
              .order_by(Associado.id_associado).first())
    if pessoa is None:
        raise HTTPException(status_code=400, detail="A sua conta do painel não está ligada a um cadastro de associado: use o formulário do site (Privacidade).")
    return pessoa


def aviso() -> dict:
    t = textos_de_privacidade.atual(PONTO_DO_AVISO)
    return {"ponto": PONTO_DO_AVISO, "versao": t.versao, "texto": textos_de_privacidade.sem_links(t.texto)}


def meus_pedidos(db: Session, pessoa: Pessoa) -> list[dict]:
    from app.services.conta_de_visitante import item_do_pedido_do_titular

    pedidos = (
        db.query(Atendimento)
        .filter(Atendimento.tipo == TITULAR_LGPD, Atendimento.id_pessoa == pessoa.id_pessoa, Atendimento.origem == ORIGEM)
        .order_by(Atendimento.criado_em.desc(), Atendimento.id_atendimento.desc())
        .all()
    )
    return [item_do_pedido_do_titular(db, a) for a in pedidos]


def meu_pedido(db: Session, pessoa: Pessoa, protocolo: str) -> Optional[Atendimento]:
    return db.query(Atendimento).filter(Atendimento.tipo == TITULAR_LGPD, Atendimento.id_pessoa == pessoa.id_pessoa, Atendimento.origem == ORIGEM,
                                        Atendimento.protocolo == protocolo).first()


def identidade_forte(usuario) -> bool:
    """A entrada no painel prova quem é só com o segundo passo ligado e a senha definitiva."""
    return bool(getattr(usuario, "mfa_ativado", False)) and not bool(getattr(usuario, "senha_provisoria", False))


def registrar(db: Session, usuario, pessoa: Pessoa, *, subtipo: str, mensagem: str, versao_do_aviso: str,
              agora: Optional[datetime] = None) -> tuple[Atendimento, bool]:
    agora = agora or datetime.utcnow()
    if versao_do_aviso != textos_de_privacidade.versao_atual(PONTO_DO_AVISO):
        raise HTTPException(status_code=422, detail="O aviso de privacidade foi atualizado: recarregue a página, leia e aceite a versão atual.")
    recentes = db.query(Atendimento.id_atendimento).filter(Atendimento.id_pessoa == pessoa.id_pessoa, Atendimento.origem == ORIGEM,
                                                          Atendimento.criado_em >= agora - timedelta(days=1)).count()
    if recentes >= LIMITE_POR_DIA:
        raise HTTPException(status_code=429, detail="Você já fez vários pedidos hoje: aguarde a resposta deles ou tente de novo amanhã.")
    return atendimentos.registrar_pelo_site(
        db, tipo=TITULAR_LGPD, subtipo=subtipo, assunto="Pedido feito pelo painel", mensagem=mensagem,
        nome_completo=pessoa.nome_completo or "Associado(a)",
        # o e-mail só leva o AVISO de que há novidade (o pedido é lido no painel); sem e-mail no cadastro, o de entrada no painel
        email=pessoa.email_contato or getattr(usuario, "email", None), telefone=None, cpf=pessoa.cpf, versao_do_aviso=versao_do_aviso,
        identidade=IDENTIDADE_PAINEL if identidade_forte(usuario) else None, id_pessoa=pessoa.id_pessoa, origem=ORIGEM, agora=agora,
    )
