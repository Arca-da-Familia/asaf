"""v9.2c - a paginação no servidor das listas que crescem (app/paginacao.py): a peça comum com dados de verdade, e as quatro listas devolvendo a página pedida
com o total no cabeçalho X-Total-Count (que o painel, em outro endereço, só consegue ler porque o CORS o expõe)."""
import pytest
import sqlalchemy as sa
from fastapi import Response
from sqlalchemy.orm import Session, declarative_base

from app import paginacao
from app.main import _origens

Base = declarative_base()


class Coisa(Base):
    __tablename__ = "coisas"
    id = sa.Column(sa.Integer, primary_key=True)


@pytest.fixture()
def sessao():
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor)
    with Session(motor) as s:
        s.add_all([Coisa(id=i) for i in range(1, 13)])
        s.commit()
        yield s


def test_com_pagina_devolve_so_ela_e_o_total_no_cabecalho(sessao):
    resposta = Response()
    consulta = sessao.query(Coisa).order_by(Coisa.id.desc())
    assert [c.id for c in paginacao.aplicar(consulta, 2, 5, resposta)] == [7, 6, 5, 4, 3]
    assert resposta.headers[paginacao.CABECALHO_DO_TOTAL] == "12"
    ultima = Response()
    assert [c.id for c in paginacao.aplicar(consulta, 3, 5, ultima)] == [2, 1]
    assert [c.id for c in paginacao.aplicar(consulta, 4, 5, Response())] == []


def test_sem_pagina_devolve_tudo_e_nao_manda_total(sessao):
    resposta = Response()
    assert len(paginacao.aplicar(sessao.query(Coisa), None, 5, resposta)) == 12
    assert paginacao.CABECALHO_DO_TOTAL not in resposta.headers


ROTAS = ["/api/doacoes/", "/api/beneficiarios/", "/api/documentos-emitidos/", "/api/reservas-espaco/"]


@pytest.mark.parametrize("rota", ROTAS)
def test_cada_lista_que_cresce_pagina_no_servidor(client, auth_headers, rota):
    tudo = client.get(rota, headers=auth_headers)
    assert tudo.status_code == 200, tudo.text
    assert paginacao.CABECALHO_DO_TOTAL not in tudo.headers
    pagina = client.get(rota, params={"pagina": 1, "por_pagina": 1}, headers=auth_headers)
    assert pagina.status_code == 200, pagina.text
    assert int(pagina.headers[paginacao.CABECALHO_DO_TOTAL]) == len(tudo.json())
    assert len(pagina.json()) == min(1, len(tudo.json()))
    if tudo.json():
        assert pagina.json()[0] == tudo.json()[0], "a 1ª página começa pelo mesmo item da lista inteira (mesma ordem)"


@pytest.mark.parametrize("rota", ROTAS)
def test_pagina_invalida_e_recusada(client, auth_headers, rota):
    assert client.get(rota, params={"pagina": 0}, headers=auth_headers).status_code == 422
    assert client.get(rota, params={"pagina": 1, "por_pagina": 500}, headers=auth_headers).status_code == 422


def test_o_painel_em_outro_endereco_consegue_ler_o_total(client, auth_headers):
    origem = _origens[0]
    r = client.get("/api/doacoes/", params={"pagina": 1}, headers={**auth_headers, "Origin": origem})
    assert "x-total-count" in r.headers.get("access-control-expose-headers", "").lower()
