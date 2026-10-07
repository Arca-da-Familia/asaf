"""Títulos (as entradas e as saídas do financeiro): filtro por MÊS de vencimento, por datas, por entradas ou saídas, por situação, por categoria
(a conta contábil) e por texto (descrição, nome do associado, razão social do fornecedor), com paginação e totais. A lista sem `pagina` continua
devolvendo tudo, como sempre (outras telas e rotinas dependem disso)."""
import uuid
from datetime import datetime

from tests.apoio_cnpj import cnpj_valido
from tests.test_situacao import _criar_associado

_ISO = "%Y-%m-%dT%H:%M:%S"


def _conta(client, auth_headers, tipo, descricao):
    r = client.post("/plano-contas/", json={"codigo_contabil": f"F{uuid.uuid4().hex[:9]}", "descricao_conta": descricao, "tipo": tipo}, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_conta"]


def _titulo(client, auth_headers, tipo, conta, descricao, valor, vence, **extra):
    r = client.post("/titulos/", json={
        "tipo_titulo": tipo, "id_conta_contabil": conta, "descricao": descricao, "valor_original": valor,
        "data_vencimento": vence.strftime(_ISO), **extra,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_titulo"]


def _montar(client, auth_headers):
    """Cinco títulos num ano que nenhum outro teste usa (2071): 2 entradas e 3 saídas, em 3 meses, com dono diferente."""
    marca = uuid.uuid4().hex[:6]
    receita = _conta(client, auth_headers, "Receita", f"Mensalidades {marca}")
    despesa = _conta(client, auth_headers, "Despesa", f"Despesas {marca}")
    associado = _criar_associado(client, nome_completo=f"Joana Mensalista {marca}")
    fornecedor = client.post("/fornecedores/", json={
        "razao_social": f"Papelaria Boa Vista {marca} LTDA", "cnpj": cnpj_valido(uuid.uuid4().int), "categoria_servico": "Outros", "telefone": "11999999999",
    }, headers=auth_headers).json()["id_fornecedor"]
    ids = {
        "e1": _titulo(client, auth_headers, "A Receber", receita, f"Mensalidade de janeiro {marca}", 60, datetime(2071, 1, 10), id_associado=associado["id_associado"]),
        "e2": _titulo(client, auth_headers, "A Receber", receita, f"Mensalidade de fevereiro {marca}", 70, datetime(2071, 2, 10), id_associado=associado["id_associado"]),
        "s1": _titulo(client, auth_headers, "A Pagar", despesa, f"Papel e toner {marca}", 120, datetime(2071, 1, 20), id_fornecedor=fornecedor),
        "s2": _titulo(client, auth_headers, "A Pagar", despesa, f"Conta de luz {marca}", 200, datetime(2071, 2, 5), id_fornecedor=fornecedor),
        "s3": _titulo(client, auth_headers, "A Pagar", despesa, f"Aluguel do salão {marca}", 300, datetime(2071, 3, 1)),
    }
    return marca, ids, {"receita": receita, "despesa": despesa, "associado": associado, "fornecedor": fornecedor}


def _ids(resposta):
    assert resposta.status_code == 200, resposta.text
    return [t["id_titulo"] for t in resposta.json()]


def test_filtra_por_mes_tipo_categoria_e_texto(client, auth_headers):
    marca, ids, ref = _montar(client, auth_headers)
    meus = set(ids.values())

    def buscar(**filtros):
        return [i for i in _ids(client.get("/api/titulos/", params={"busca": marca, **filtros}, headers=auth_headers)) if i in meus]

    assert sorted(buscar()) == sorted(meus)
    assert sorted(buscar(mes="2071-01")) == sorted([ids["e1"], ids["s1"]])
    assert sorted(buscar(mes="2071-03")) == [ids["s3"]]
    assert sorted(buscar(tipo_titulo="A Receber")) == sorted([ids["e1"], ids["e2"]])
    assert sorted(buscar(tipo_titulo="A Pagar", mes="2071-02")) == [ids["s2"]]
    assert sorted(buscar(id_conta_contabil=ref["receita"])) == sorted([ids["e1"], ids["e2"]])
    assert sorted(buscar(data_de="2071-01-15", data_ate="2071-02-05")) == sorted([ids["s1"], ids["s2"]])
    assert buscar(status="Pago") == []
    # texto: descrição, nome do associado e razão social do fornecedor
    assert client.get("/api/titulos/", params={"busca": f"Aluguel do salão {marca}"}, headers=auth_headers).json()[0]["id_titulo"] == ids["s3"]
    por_associado = _ids(client.get("/api/titulos/", params={"busca": f"Joana Mensalista {marca}"}, headers=auth_headers))
    assert sorted(por_associado) == sorted([ids["e1"], ids["e2"]])
    assert set(buscar(mes="2071-01")) <= meus
    por_fornecedor = _ids(client.get("/api/titulos/", params={"busca": f"Papelaria Boa Vista {marca}"}, headers=auth_headers))
    assert sorted(por_fornecedor) == sorted([ids["s1"], ids["s2"]])


def test_paginacao_ordem_e_totais(client, auth_headers):
    marca, ids, _ = _montar(client, auth_headers)
    base = {"busca": marca, "por_pagina": 2}
    pagina1 = client.get("/api/titulos/", params={**base, "pagina": 1, "mes": "2071-01"}, headers=auth_headers).json()
    assert [t["id_titulo"] for t in pagina1] == [ids["e1"], ids["s1"]]  # com período, por vencimento
    # sem período, a lista paginada mostra primeiro o lançado por último
    sem_periodo = client.get("/api/titulos/", params={**base, "pagina": 1}, headers=auth_headers).json()
    assert [t["id_titulo"] for t in sem_periodo] == [ids["s3"], ids["s2"]]
    segunda = client.get("/api/titulos/", params={**base, "pagina": 2}, headers=auth_headers).json()
    assert [t["id_titulo"] for t in segunda] == [ids["s1"], ids["e2"]]
    terceira = client.get("/api/titulos/", params={**base, "pagina": 3}, headers=auth_headers).json()
    assert [t["id_titulo"] for t in terceira] == [ids["e1"]]
    assert client.get("/api/titulos/", params={**base, "pagina": 4}, headers=auth_headers).json() == []

    resumo = client.get("/api/titulos/resumo", params={"busca": marca}, headers=auth_headers).json()
    assert resumo["total"] == 5 and resumo["soma_original"] == 750 and resumo["soma_saldo"] == 750
    resumo_saidas = client.get("/api/titulos/resumo", params={"busca": marca, "tipo_titulo": "A Pagar", "mes": "2071-02"}, headers=auth_headers).json()
    assert resumo_saidas == {"total": 1, "soma_original": 200, "soma_saldo": 200}
    vazio = client.get("/api/titulos/resumo", params={"busca": f"nada-{marca}"}, headers=auth_headers).json()
    assert vazio == {"total": 0, "soma_original": 0, "soma_saldo": 0}


def test_filtros_invalidos_sao_recusados_em_portugues_e_a_lista_sem_pagina_continua_inteira(client, auth_headers):
    for mes in ("2071-13", "2071-1", "janeiro", "2071/01"):
        r = client.get("/api/titulos/", params={"mes": mes}, headers=auth_headers)
        assert r.status_code == 400 and "AAAA-MM" in r.json()["detail"], (mes, r.text)
    assert client.get("/api/titulos/", params={"pagina": 0}, headers=auth_headers).status_code == 400
    assert client.get("/api/titulos/", params={"pagina": 1, "por_pagina": 500}, headers=auth_headers).status_code == 400
    marca, ids, _ = _montar(client, auth_headers)
    # sem `pagina`, devolve tudo que passa nos filtros (por vencimento), como antes de existir paginação
    tudo = client.get("/api/titulos/", params={"busca": marca, "por_pagina": 2}, headers=auth_headers).json()
    assert [t["id_titulo"] for t in tudo] == [ids["e1"], ids["s1"], ids["s2"], ids["e2"], ids["s3"]]
    assert client.get("/api/titulos/", params={"busca": marca}).status_code == 401
