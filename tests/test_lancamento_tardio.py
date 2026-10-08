"""v5.4h - lançamento tardio: a saída registrada muito depois do pagamento entra no relatório de exceção mensal do Conselho Fiscal (padrões suspeitos), e o
limite de dias é uma configuração (`DIAS_ALERTA_LANCAMENTO_TARDIO`, padrão 5) que vale igual no registro, no cartão da Auditoria financeira e no relatório."""
from datetime import date, datetime, timedelta

from app.services.lancamento_tardio import CHAVE_DO_LIMITE, LIMITE_PADRAO_EM_DIAS
from tests.test_registrar_saida import _pedido, _preparo, _ROTA


def _registrar(client, auth_headers, dias_atras: int, despesa_dias_atras: int | None = None) -> int:
    despesa, banco, fornecedor = _preparo(client, auth_headers)
    pago = (date.today() - timedelta(days=dias_atras)).isoformat()
    gasto = (date.today() - timedelta(days=despesa_dias_atras if despesa_dias_atras is not None else dias_atras)).isoformat()
    r = client.post(_ROTA, json=_pedido(client, auth_headers, despesa, banco, fornecedor, data_despesa=gasto, data_pagamento=pago), headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_titulo"]


def _achados(client, auth_headers) -> list[dict]:
    competencia = datetime.utcnow().strftime("%Y-%m")
    r = client.get(f"/api/antifraude/padroes-suspeitos?competencia={competencia}", headers=auth_headers)
    assert r.status_code == 200, r.text
    return [a for a in r.json() if a["tipo"] == "LANCAMENTO_TARDIO"]


def _item_do_cartao(client, auth_headers, id_titulo: int, dias_atras: int) -> dict:
    # o cartão lista os títulos pelo mês da data da despesa (o vencimento do título)
    mes = (date.today() - timedelta(days=dias_atras)).strftime("%Y-%m")
    itens = client.get(f"/api/conselho-fiscal/auditoria-financeira/?mes={mes}&por_pagina=200", headers=auth_headers).json()["itens"]
    return next(i for i in itens if i["id_titulo"] == id_titulo)


def test_o_limite_e_uma_configuracao_com_padrao_de_5_dias(client, auth_headers):
    r = client.get(f"/api/configuracoes/{CHAVE_DO_LIMITE}", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["valor"] == str(LIMITE_PADRAO_EM_DIAS) == "5"
    assert r.json()["tipo"] == "numero"
    recusa = client.put(f"/api/configuracoes/{CHAVE_DO_LIMITE}", headers=auth_headers, json={"valor": "muitos"})
    assert recusa.status_code == 422


def test_a_saida_tardia_entra_no_relatorio_de_excecao_e_a_em_dia_nao(client, auth_headers, exercicio_financeiro_aberto):
    tardia = _registrar(client, auth_headers, dias_atras=20)
    em_dia = _registrar(client, auth_headers, dias_atras=2)
    achados = _achados(client, auth_headers)
    da_tardia = [a for a in achados if a["id_titulo"] == tardia]
    assert len(da_tardia) == 1
    assert da_tardia[0]["dias_ate_o_lancamento"] == 20
    assert "20 dia(s) depois do pagamento" in da_tardia[0]["descricao"] and "limite é de 5" in da_tardia[0]["descricao"]
    assert all(a["id_titulo"] != em_dia for a in achados)


def test_o_limite_vale_igual_no_registro_no_cartao_e_no_relatorio(client, auth_headers, exercicio_financeiro_aberto):
    id_titulo = _registrar(client, auth_headers, dias_atras=10)
    assert _item_do_cartao(client, auth_headers, id_titulo, 10)["lancamento_tardio"] is True
    assert any(a["id_titulo"] == id_titulo for a in _achados(client, auth_headers))
    try:
        assert client.put(f"/api/configuracoes/{CHAVE_DO_LIMITE}", headers=auth_headers, json={"valor": "30"}).status_code == 200
        # com o limite em 30 dias, 10 dias não é mais tardio: nem no cartão, nem no relatório, nem no registro novo
        assert _item_do_cartao(client, auth_headers, id_titulo, 10)["lancamento_tardio"] is False
        assert all(a["id_titulo"] != id_titulo for a in _achados(client, auth_headers))
        despesa, banco, fornecedor = _preparo(client, auth_headers)
        dez = (date.today() - timedelta(days=10)).isoformat()
        novo = client.post(_ROTA, json=_pedido(client, auth_headers, despesa, banco, fornecedor, data_despesa=dez, data_pagamento=dez), headers=auth_headers)
        assert novo.json()["lancamento_tardio"] is False and novo.json()["dias_ate_o_lancamento"] == 10
        # e com o limite em 0 até o lançamento de ontem é tardio
        assert client.put(f"/api/configuracoes/{CHAVE_DO_LIMITE}", headers=auth_headers, json={"valor": "0"}).status_code == 200
        ontem = _registrar(client, auth_headers, dias_atras=1)
        assert _item_do_cartao(client, auth_headers, ontem, 1)["lancamento_tardio"] is True
        assert any(a["id_titulo"] == ontem for a in _achados(client, auth_headers))
    finally:
        client.put(f"/api/configuracoes/{CHAVE_DO_LIMITE}", headers=auth_headers, json={"valor": str(LIMITE_PADRAO_EM_DIAS)})


def test_o_que_conta_e_a_data_do_pagamento_nao_a_da_despesa(client, auth_headers, exercicio_financeiro_aberto):
    # a despesa é de 12 dias atrás, mas foi PAGA hoje (cartão, boleto): lançada no mesmo dia do pagamento, não é tardia
    id_titulo = _registrar(client, auth_headers, dias_atras=0, despesa_dias_atras=12)
    item = _item_do_cartao(client, auth_headers, id_titulo, 12)
    assert item["dias_ate_o_lancamento"] == 0 and item["lancamento_tardio"] is False
    assert all(a["id_titulo"] != id_titulo for a in _achados(client, auth_headers))


def test_o_relatorio_so_olha_saidas_registradas_com_nota_fiscal(client, auth_headers, exercicio_financeiro_aberto):
    # um título comum (sem nota fiscal) velho não vira alerta de lançamento tardio
    from tests.test_registrar_saida import _titulo_simples
    from tests.test_antifraude import _criar_conta

    simples = _titulo_simples(client, auth_headers, _criar_conta(client, auth_headers, "Despesa"))
    assert all(a["id_titulo"] != simples for a in _achados(client, auth_headers))
