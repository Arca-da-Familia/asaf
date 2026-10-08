"""v5.4h - Registrar saída: o sistema é só o REGISTRO do que já aconteceu (decisão do Presidente, 2026-10-08). Um formulário só lança o título e dá a
baixa, com categoria, nota fiscal e comprovante; sem fila de assinatura. Se a baixa é recusada o título não fica para trás; saída lançada
muito depois do pagamento é marcada como tardia; a Auditoria financeira do Conselho Fiscal abre a nota e o comprovante."""
import json
import uuid
from datetime import date, datetime, timedelta

from tests.test_antifraude import _criar_conta
from tests.test_compras import _criar_fornecedor, _criar_usuario_com_mandato

_ROTA = "/api/saidas/registrar"


def _anexo(client, auth_headers) -> str:
    r = client.post("/api/comprovantes/", files={"arquivo": ("nota.pdf", b"%PDF-1.4 conteudo de teste " + uuid.uuid4().bytes, "application/pdf")}, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["comprovante"]


def _pedido(client, auth_headers, conta_despesa, conta_banco, fornecedor, **ajustes):
    base = {
        "id_conta_contabil": conta_despesa, "descricao": f"Material de limpeza {uuid.uuid4().hex[:6]}", "valor": "123.45",
        "data_despesa": date.today().isoformat(), "data_pagamento": date.today().isoformat(), "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": conta_banco, "id_fornecedor": fornecedor,
        "nota_fiscal": _anexo(client, auth_headers), "comprovante": _anexo(client, auth_headers),
    }
    base.update(ajustes)
    return base


def _preparo(client, auth_headers):
    return (
        _criar_conta(client, auth_headers, "Despesa"), _criar_conta(client, auth_headers, "Ativo"),
        _criar_fornecedor(client, auth_headers, uuid.uuid4().int % 90000 + 10000),
    )


def test_a_saida_entra_ja_paga_com_nota_comprovante_e_rastro(client, auth_headers, exercicio_financeiro_aberto):
    despesa, banco, fornecedor = _preparo(client, auth_headers)
    pedido = _pedido(client, auth_headers, despesa, banco, fornecedor)
    r = client.post(_ROTA, json=pedido, headers=auth_headers)
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["lancamento_tardio"] is False and corpo["dias_ate_o_lancamento"] == 0

    titulo = next(t for t in client.get("/api/titulos/", headers=auth_headers).json() if t["id_titulo"] == corpo["id_titulo"])
    assert titulo["tipo_titulo"] == "A Pagar" and titulo["status"] == "Pago" and titulo["nota_fiscal"] == pedido["nota_fiscal"]
    assert float(titulo["valor_original"]) == 123.45 and float(titulo["saldo_devedor"]) == 0

    razao = client.get("/api/livro-caixa/", headers=auth_headers).json()["lancamentos"]
    lancamento = next(l for l in razao if l["id_lancamento"] == corpo["id_lancamento"])
    assert lancamento["comprovante"] == pedido["comprovante"] and lancamento["forma_pagamento"] == "Pix"

    trilha = client.get("/api/auditoria/?tabela_afetada=titulos_financeiros&acao=REGISTRAR_SAIDA&por_pagina=50", headers=auth_headers).json()["entradas"]
    dados = next(json.loads(e["dados_depois"]) for e in trilha if e["id_registro_afetado"] == corpo["id_titulo"])
    assert dados["valor"] == "123.45" and dados["forma_pagamento"] == "Pix" and dados["lancamento_tardio"] is False


def test_o_que_falta_ou_esta_errado_e_recusado_em_portugues(client, auth_headers, exercicio_financeiro_aberto):
    despesa, banco, fornecedor = _preparo(client, auth_headers)
    cobrancas = {
        "sem nota fiscal": ({"nota_fiscal": ""}, "nota fiscal"),
        "sem comprovante": ({"comprovante": ""}, "comprovante"),
        "sem forma de pagamento": ({"forma_pagamento": " "}, "forma de pagamento"),
        "valor zero": ({"valor": "0"}, "maior que zero"),
        "descrição curta": ({"descricao": "ab"}, "Descreva"),
        "data no futuro": ({"data_despesa": (date.today() + timedelta(days=5)).isoformat()}, "futuro"),
        "sem quem recebeu": ({"id_fornecedor": None}, "quem recebeu"),
        "dois destinatários": ({"id_associado": 1}, "quem recebeu"),
    }
    for nome, (ajuste, trecho) in cobrancas.items():
        r = client.post(_ROTA, json=_pedido(client, auth_headers, despesa, banco, fornecedor, **ajuste), headers=auth_headers)
        assert r.status_code == 422, (nome, r.text)
        assert trecho.lower() in r.text.lower(), (nome, r.text)


def test_se_a_baixa_e_recusada_o_titulo_nao_fica_para_tras(client, auth_headers, exercicio_financeiro_aberto):
    despesa, banco, fornecedor = _preparo(client, auth_headers)
    outra_despesa = _criar_conta(client, auth_headers, "Despesa")
    descricao = f"Saída que não pode ser paga {uuid.uuid4().hex[:6]}"
    # a contrapartida (de onde saiu o dinheiro) precisa ser conta de Ativo: com uma de Despesa a baixa é recusada
    r = client.post(_ROTA, json=_pedido(client, auth_headers, despesa, outra_despesa, fornecedor, descricao=descricao), headers=auth_headers)
    assert r.status_code == 400 and "Ativo" in r.json()["detail"]
    achados = [t for t in client.get("/api/titulos/?busca=" + descricao.replace(" ", "%20"), headers=auth_headers).json() if t["descricao"] == descricao]
    assert achados == [], "o título criado para a baixa foi desfeito"
    # categoria que não é de Despesa
    r = client.post(_ROTA, json=_pedido(client, auth_headers, banco, banco, fornecedor), headers=auth_headers)
    assert r.status_code == 400 and "Despesa" in r.json()["detail"]
    # quem recebeu que não existe
    assert client.post(_ROTA, json=_pedido(client, auth_headers, despesa, banco, 99999999), headers=auth_headers).status_code == 404


def test_saida_lancada_muito_depois_do_pagamento_e_marcada_como_tardia(client, auth_headers, exercicio_financeiro_aberto):
    despesa, banco, fornecedor = _preparo(client, auth_headers)
    antiga = (date.today() - timedelta(days=20)).isoformat()
    r = client.post(_ROTA, json=_pedido(client, auth_headers, despesa, banco, fornecedor, data_despesa=antiga, data_pagamento=antiga), headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["lancamento_tardio"] is True and r.json()["dias_ate_o_lancamento"] == 20
    recente = (date.today() - timedelta(days=2)).isoformat()
    r = client.post(_ROTA, json=_pedido(client, auth_headers, despesa, banco, fornecedor, data_despesa=recente, data_pagamento=recente), headers=auth_headers)
    assert r.json()["lancamento_tardio"] is False and r.json()["dias_ate_o_lancamento"] == 2


def test_so_quem_tem_o_financeiro_registra(client, auth_headers, exercicio_financeiro_aberto):
    despesa, banco, fornecedor = _preparo(client, auth_headers)
    pedido = _pedido(client, auth_headers, despesa, banco, fornecedor)
    assert client.post(_ROTA, json=pedido).status_code == 401
    _, secretario = _criar_usuario_com_mandato(client, auth_headers, "SECRETARIO")
    assert client.post(_ROTA, json=pedido, headers=secretario).status_code == 403


def test_a_auditoria_financeira_abre_a_nota_o_comprovante_e_diz_quando_foi_lancada(client, auth_headers, exercicio_financeiro_aberto):
    despesa, banco, fornecedor = _preparo(client, auth_headers)
    oito_dias = date.today() - timedelta(days=8)
    pedido = _pedido(client, auth_headers, despesa, banco, fornecedor, data_despesa=oito_dias.isoformat(), data_pagamento=oito_dias.isoformat())
    id_titulo = client.post(_ROTA, json=pedido, headers=auth_headers).json()["id_titulo"]
    mes = oito_dias.strftime("%Y-%m")
    itens = client.get(f"/api/conselho-fiscal/auditoria-financeira/?mes={mes}&por_pagina=200", headers=auth_headers).json()["itens"]
    item = next(i for i in itens if i["id_titulo"] == id_titulo)
    assert item["nota_fiscal"] == pedido["nota_fiscal"] and item["comprovantes"] == [pedido["comprovante"]]
    assert item["dias_ate_o_lancamento"] == 8 and item["lancamento_tardio"] is True
    # título que não é saída registrada não tem nota nem contagem
    outro = _titulo_simples(client, auth_headers, despesa)
    simples = next(i for i in client.get(f"/api/conselho-fiscal/auditoria-financeira/?mes={datetime.utcnow().strftime('%Y-%m')}&por_pagina=200", headers=auth_headers).json()["itens"] if i["id_titulo"] == outro)
    assert simples["nota_fiscal"] is None and simples["dias_ate_o_lancamento"] is None and simples["lancamento_tardio"] is False


def _titulo_simples(client, auth_headers, conta_despesa) -> int:
    r = client.post("/titulos/", json={
        "tipo_titulo": "A Pagar", "id_conta_contabil": conta_despesa, "descricao": f"Título simples {uuid.uuid4().hex[:6]}", "valor_original": 10,
        "data_vencimento": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S"),
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_titulo"]
