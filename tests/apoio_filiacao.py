"""Apoio dos testes de filiação: desde a v5.4h o pedido só é aprovado com 3 sócios propondo (Estatuto Art. 12, par. único VI). Os testes que só querem um
associado novo (matrícula, ficha 360, cadastro duplicado) usam isto para dar os 3 votos sem refazer o fluxo dos sócios, que tem testes próprios."""
import uuid

from app.models.associados import Associado
from app.models.filiacao import PROPOE, PropostaDeSocio
from app.models.pessoas import Pessoa


def novo_socio(db) -> Associado:
    pessoa = Pessoa(nome_completo=f"Sócio Proponente {uuid.uuid4().hex[:8]}")
    db.add(pessoa)
    db.flush()
    associado = Associado(id_pessoa=pessoa.id_pessoa)
    db.add(associado)
    db.commit()
    db.refresh(associado)
    return associado


def tres_socios_propoem(db, id_proposta: int) -> list[int]:
    """Cria 3 sócios e registra que os 3 propõem o pedido; devolve os ids dos sócios."""
    ids = []
    for _ in range(3):
        socio = novo_socio(db)
        db.add(PropostaDeSocio(id_proposta=id_proposta, id_associado=socio.id_associado, decisao=PROPOE))
        ids.append(socio.id_associado)
    db.commit()
    return ids


def corpo_do_pedido(**sobrescritas) -> dict:
    """Corpo de um pedido de filiação do formulário público: dados completos, adulto, com o aviso de privacidade aceito (versão atual)."""
    from datetime import date

    from app.services.filiacao_publica import VERSAO_AVISO_DE_PRIVACIDADE_FILIACAO

    hoje = date.today()
    corpo = {
        "email_contato": f"pedido.{uuid.uuid4().hex[:12]}@example.com",
        "data_nascimento": str(date(hoje.year - 30, hoje.month, 1)),
        "consentimento_lgpd": True,
        "versao_texto_consentimento": VERSAO_AVISO_DE_PRIVACIDADE_FILIACAO,
    }
    corpo.update(sobrescritas)
    return corpo


def propor_pedido(client, ip: str | None = None, **sobrescritas):
    """Envia o pedido pela rota pública. Cada chamada vem de um IP próprio (o limite por IP não atrapalha os testes que mandam vários pedidos)."""
    ip = ip or f"198.51.100.{uuid.uuid4().int % 250 + 1}"
    return client.post("/api/filiacao/propor", json=corpo_do_pedido(**sobrescritas), headers={"X-Forwarded-For": ip})
