"""v5.7g - a Transparência do destino por campanha: além do RECEBIDO, a página pública mostra o APLICADO, que sai do centro de custo da campanha.

As promessas que estes testes travam:
  1. `valor_aplicado` é o que já foi GASTO no centro de custo da campanha (despesas líquidas do razão: o estorno subtrai), a mesma conta do relatório "Receitas x despesas por centro de custo";
  2. gasto de outro centro de custo e receita não entram; campanha com centro e sem gasto mostra 0; campanha SEM centro de custo mostra vazio (o gasto dela não é acompanhado à parte);
  3. o que sai é só o total: nada do centro de custo (nem o número, nem o nome) nem de lançamento, fornecedor ou data."""
from datetime import datetime
from decimal import Decimal

import pytest

from app.models.financeiro import Exercicio
from app.services import relatorios
from tests.test_doacao_online import _campanha, _criar_centro_custo, pix  # noqa: F401  (a fixture `pix`)
from tests.test_parcerias import Razao


@pytest.fixture()
def livro(db, exercicio_financeiro_aberto):
    exercicio = db.query(Exercicio).filter(Exercicio.status == "Aberto").first()
    assert exercicio is not None
    return Razao(db, exercicio)


def _publica(client, id_campanha: int) -> dict:
    r = client.get("/api/publico/doacao")
    assert r.status_code == 200, r.text
    return {c["id_campanha"]: c for c in r.json()["campanhas"]}[id_campanha]


def test_campanha_com_centro_de_custo_e_sem_gasto_mostra_zero_e_sem_centro_mostra_vazio(client, auth_headers, pix, livro):
    centro = _criar_centro_custo(client, auth_headers)
    com_centro = _campanha(client, auth_headers, id_centro_custo=centro)
    sem_centro = _campanha(client, auth_headers)
    assert _publica(client, com_centro)["valor_aplicado"] == 0
    assert _publica(client, sem_centro)["valor_aplicado"] is None


def test_o_aplicado_e_o_gasto_liquido_do_centro_o_estorno_subtrai_e_so_despesa_conta(client, auth_headers, db, pix, livro):
    centro, outro = _criar_centro_custo(client, auth_headers), _criar_centro_custo(client, auth_headers)
    campanha = _campanha(client, auth_headers, id_centro_custo=centro)
    primeiro = livro.pagar(centro, "120.50", historico="Compra de cestas")
    livro.pagar(centro, "30.25", historico="Frete")
    assert Decimal(str(_publica(client, campanha)["valor_aplicado"])) == Decimal("150.75")
    # o estorno devolve: o aplicado cai pelo valor estornado (o razão tem o original E o estorno)
    livro.estornar(primeiro)
    assert Decimal(str(_publica(client, campanha)["valor_aplicado"])) == Decimal("30.25")
    # gasto de OUTRO centro e receita do MESMO centro não entram
    livro.pagar(outro, "999.00")
    livro.receber(centro, "500.00")
    assert Decimal(str(_publica(client, campanha)["valor_aplicado"])) == Decimal("30.25")


def test_o_aplicado_bate_com_o_relatorio_de_receitas_e_despesas_por_centro_de_custo(client, auth_headers, db, pix, livro):
    centro = _criar_centro_custo(client, auth_headers)
    campanha = _campanha(client, auth_headers, id_centro_custo=centro)
    livro.pagar(centro, "77.77")
    livro.pagar(centro, "22.23")
    linhas = relatorios.receitas_e_despesas_por_centro_custo(db, data_inicio=datetime(1900, 1, 1), data_fim=datetime(2999, 12, 31))
    do_centro = next(l for l in linhas if l["id_centro_custo"] == centro)
    assert Decimal(str(_publica(client, campanha)["valor_aplicado"])) == do_centro["despesas"] == Decimal("100.00")


def test_a_pagina_publica_so_mostra_o_total_e_nada_do_centro_de_custo(client, auth_headers, pix, livro):
    centro = _criar_centro_custo(client, auth_headers)
    campanha = _campanha(client, auth_headers, id_centro_custo=centro)
    livro.pagar(centro, "10.00", historico="Pagamento com o nome de um fornecedor")
    dados = _publica(client, campanha)
    assert set(dados) == {"id_campanha", "titulo", "descricao", "meta_valor", "valor_arrecadado", "valor_aplicado", "percentual", "prazo"}
    texto = client.get("/api/publico/doacao").text
    assert "id_centro_custo" not in texto and "fornecedor" not in texto.lower() and "Pagamento com o nome" not in texto
