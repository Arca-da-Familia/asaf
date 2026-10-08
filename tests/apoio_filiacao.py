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
