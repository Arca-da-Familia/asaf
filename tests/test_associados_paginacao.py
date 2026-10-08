"""v5.4h - a lista de associados é paginada e filtrada NO SERVIDOR (nenhuma tela carrega "todos os associados" de uma vez): busca por nome, CPF, e-mail, telefone ou
matrícula, filtro por situação e categoria, total e divisão por situação/categoria no resumo; sem `pagina`, a lista segue devolvendo todos (os seletores e conferências antigas)."""
import uuid

from tests.apoio_auth import cabecalho_admin
from tests.test_pessoas import _cpf_unico

_BASE = {
    "email_contato": "x@x.com", "telefone_whatsapp": "11900000000", "categoria": "Efetivo",
    "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro", "cidade": "Sao Paulo", "estado": "SP",
}


def _criar(client, nome: str, **extra) -> dict:
    cpf = _cpf_unico()
    corpo = {**_BASE, "nome_completo": nome, "cpf": cpf, "email_contato": f"{cpf}@pag.example.com", **extra}
    r = client.post("/associados-master/", json=corpo, headers=cabecalho_admin(client))
    assert r.status_code == 200, r.text
    return {"id": r.json()["id_associado"], "cpf": cpf, "nome": nome}


def _grupo(client, n=7, categoria="Efetivo"):
    marca = uuid.uuid4().hex[:8]
    return marca, [_criar(client, f"Paginacao {marca} Pessoa {i:02d}", categoria=categoria) for i in range(n)]


def test_a_pagina_traz_so_o_pedido_na_ordem_do_nome_e_as_paginas_cobrem_todos_sem_repetir(client, auth_headers):
    marca, criados = _grupo(client, 7)
    paginas = []
    for pagina in (1, 2, 3):
        r = client.get(f"/api/associados/?busca={marca}&pagina={pagina}&por_pagina=3", headers=auth_headers)
        assert r.status_code == 200, r.text
        paginas.append([a["nome_completo"] for a in r.json()])
    assert [len(p) for p in paginas] == [3, 3, 1]
    todos = [n for p in paginas for n in p]
    assert todos == sorted(todos) and len(set(todos)) == 7
    assert client.get(f"/api/associados/?busca={marca}&pagina=4&por_pagina=3", headers=auth_headers).json() == []


def test_sem_pagina_devolve_todos_como_sempre(client, auth_headers):
    marca, criados = _grupo(client, 4)
    todos = client.get("/api/associados/", headers=auth_headers).json()
    nomes = {a["nome_completo"] for a in todos}
    assert {c["nome"] for c in criados} <= nomes
    filtrados = client.get(f"/api/associados/?busca={marca}", headers=auth_headers).json()
    assert len(filtrados) == 4


def test_a_busca_acha_por_nome_cpf_email_telefone_e_matricula_e_nao_acha_o_que_nao_tem(client, auth_headers):
    marca, criados = _grupo(client, 3)
    alvo = criados[1]

    def ids(busca):
        return [a["id_associado"] for a in client.get("/api/associados/", params={"busca": busca}, headers=auth_headers).json()]

    assert ids(f"{marca} Pessoa 01") == [alvo["id"]]
    assert ids(alvo["cpf"]) == [alvo["id"]]
    assert ids(f"{alvo['cpf'][:3]}.{alvo['cpf'][3:6]}.{alvo['cpf'][6:9]}-{alvo['cpf'][9:]}") == [alvo["id"]]  # CPF com pontuação
    assert ids(f"{alvo['cpf']}@pag.example.com") == [alvo["id"]]
    assert ids(f"nao-existe-{uuid.uuid4().hex}") == []
    # a matrícula: só quando a busca é um número inteiro
    detalhe = client.get(f"/api/associados/{alvo['id']}", headers=auth_headers).json()
    matricula = detalhe.get("numero_matricula")
    if matricula:
        assert alvo["id"] in ids(str(matricula))


def test_filtro_por_situacao_e_por_categoria(client, auth_headers):
    marca, criados = _grupo(client, 3, categoria="Contribuinte")
    por_categoria = client.get(f"/api/associados/?busca={marca}&categoria=Contribuinte", headers=auth_headers).json()
    assert len(por_categoria) == 3 and {a["categoria"] for a in por_categoria} == {"Contribuinte"}
    assert client.get(f"/api/associados/?busca={marca}&categoria=Fundador", headers=auth_headers).json() == []
    situacao = por_categoria[0]["status_arrolamento"]
    assert len(client.get("/api/associados/", params={"busca": marca, "situacao": situacao}, headers=auth_headers).json()) == 3
    assert client.get("/api/associados/", params={"busca": marca, "situacao": "Desligado"}, headers=auth_headers).json() == []


def test_o_resumo_conta_pelos_mesmos_filtros_e_divide_por_situacao_e_categoria(client, auth_headers):
    marca, _ = _grupo(client, 5, categoria="Contribuinte")
    resumo = client.get(f"/api/associados/resumo?busca={marca}", headers=auth_headers).json()
    assert resumo["total"] == 5
    assert resumo["por_categoria"] == {"Contribuinte": 5}
    assert sum(resumo["por_situacao"].values()) == 5
    # o total respeita a categoria pedida; a divisão por categoria continua mostrando o que há em cada uma (só a busca vale)
    outro = client.get(f"/api/associados/resumo?busca={marca}&categoria=Fundador", headers=auth_headers).json()
    assert outro["total"] == 0 and outro["por_categoria"] == {"Contribuinte": 5}
    tudo = client.get("/api/associados/resumo", headers=auth_headers).json()
    assert tudo["total"] >= 5 and sum(tudo["por_categoria"].values()) == tudo["total"]


def test_limites_da_pagina_e_permissao(client, auth_headers):
    assert client.get("/api/associados/?pagina=0", headers=auth_headers).status_code == 422
    assert client.get("/api/associados/?pagina=1&por_pagina=0", headers=auth_headers).status_code == 422
    assert client.get("/api/associados/?pagina=1&por_pagina=201", headers=auth_headers).status_code == 422
    assert client.get("/api/associados/?pagina=1&por_pagina=200", headers=auth_headers).status_code == 200
    assert client.get("/api/associados/resumo").status_code == 401
    assert client.get("/api/associados/?pagina=1").status_code == 401


# ---------------------------------------------------------------------------------------------------------------- Razão Contábil
def test_o_razao_pagina_busca_e_mantem_o_saldo_de_todos_os_lancamentos(client, auth_headers, exercicio_financeiro_aberto):
    from tests.test_registrar_saida import _pedido, _preparo, _ROTA

    despesa, banco, fornecedor = _preparo(client, auth_headers)
    descricoes = []
    for _ in range(3):
        pedido = _pedido(client, auth_headers, despesa, banco, fornecedor)
        assert client.post(_ROTA, json=pedido, headers=auth_headers).status_code == 200
        descricoes.append(pedido["descricao"])
    completo = client.get("/api/livro-caixa/", headers=auth_headers).json()
    assert "total" not in completo and len(completo["lancamentos"]) >= 3

    pagina1 = client.get("/api/livro-caixa/?pagina=1&por_pagina=2", headers=auth_headers).json()
    pagina2 = client.get("/api/livro-caixa/?pagina=2&por_pagina=2", headers=auth_headers).json()
    assert pagina1["total"] == len(completo["lancamentos"]) and pagina1["pagina"] == 1 and pagina1["por_pagina"] == 2
    assert len(pagina1["lancamentos"]) == 2
    # do mais novo para o mais antigo, sem repetir entre as páginas, e igual ao extrato inteiro (que também vem do mais novo para o mais antigo)
    ids_pagina = [l["id_lancamento"] for l in pagina1["lancamentos"] + pagina2["lancamentos"]]
    assert ids_pagina == [l["id_lancamento"] for l in completo["lancamentos"]][:4]
    # o saldo é o de TODOS os lançamentos, em qualquer página
    assert pagina1["saldo_contas_ativo"] == completo["saldo_contas_ativo"] == pagina2["saldo_contas_ativo"]

    achado = client.get("/api/livro-caixa/", params={"busca": descricoes[0], "pagina": 1}, headers=auth_headers).json()
    assert achado["total"] == 1 and descricoes[0].lower() in achado["lancamentos"][0]["historico"].lower()
    um = completo["lancamentos"][0]
    por_numero = client.get(f"/api/livro-caixa/?busca=%23{um['numero_sequencial']}&pagina=1", headers=auth_headers).json()
    assert um["id_lancamento"] in [l["id_lancamento"] for l in por_numero["lancamentos"]]
    assert client.get("/api/livro-caixa/?busca=nada-disso-existe-xyz&pagina=1", headers=auth_headers).json()["total"] == 0
    assert client.get("/api/livro-caixa/?pagina=0", headers=auth_headers).status_code == 422
    assert client.get("/api/livro-caixa/?pagina=1").status_code == 401
