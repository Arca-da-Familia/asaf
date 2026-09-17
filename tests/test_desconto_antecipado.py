"""v3.2.3 (FASE 3) - desconto configurável por pagamento antecipado em bloco (semestral/anual):
campanha versionada (nunca edita a anterior), título-bloco único (um PIX, um pagamento) cujo
`id_conta_contabil` aponta pra uma conta de Passivo de receita diferida - o dinheiro entra
INTEIRO no caixa na baixa, e a Receita real só é reconhecida depois, mês a mês, pela mesma
rotina de "Gerar Cobranças" que já existe."""
from datetime import datetime, timedelta

from tests.test_contribuicoes import _criar_conta, _criar_plano
from tests.test_situacao import _criar_associado


def _criar_campanha(client, auth_headers, conta_passivo, percentual=80, quantidade_meses=6, meses_gatilho=(1, 7), motivo="Ata da assembleia de teste"):
    r = client.post("/api/campanhas-desconto-antecipado/", json={
        "percentual_desconto": percentual, "quantidade_meses": quantidade_meses,
        "meses_gatilho": list(meses_gatilho), "id_conta_contabil_receita_diferida": conta_passivo,
        "motivo": motivo,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_campanha"]


def test_campanha_e_versionada_nunca_edita_a_anterior(client, auth_headers):
    conta_passivo = _criar_conta(client, auth_headers, "2.1.9800", "Receita Diferida Teste v3.2.3", tipo="Passivo")
    _criar_campanha(client, auth_headers, conta_passivo, percentual=80)

    campanhas = client.get("/api/campanhas-desconto-antecipado/", headers=auth_headers).json()
    vigente_antes = next(c for c in campanhas if c["data_vigencia_fim"] is None)
    assert vigente_antes["percentual_desconto"] == 80.0

    _criar_campanha(client, auth_headers, conta_passivo, percentual=50)
    campanhas = client.get("/api/campanhas-desconto-antecipado/", headers=auth_headers).json()
    antiga = next(c for c in campanhas if c["id_campanha"] == vigente_antes["id_campanha"])
    nova_vigente = next(c for c in campanhas if c["data_vigencia_fim"] is None)

    assert antiga["data_vigencia_fim"] is not None  # encerrada, nunca apagada nem editada
    assert antiga["percentual_desconto"] == 80.0  # histórico preservado
    assert nova_vigente["percentual_desconto"] == 50.0


def test_gerar_bloco_recusa_mes_que_nao_e_gatilho(client, auth_headers):
    conta_receita = _criar_conta(client, auth_headers, "3.2.9800", "Mensalidade Bloco Teste", tipo="Receita")
    conta_passivo = _criar_conta(client, auth_headers, "2.1.9801", "Receita Diferida Teste 2", tipo="Passivo")
    categoria = f"CategoriaBloco{conta_receita}"
    _criar_plano(client, auth_headers, conta_receita, categoria=categoria, valor_inicial=100)
    _criar_campanha(client, auth_headers, conta_passivo, meses_gatilho=(1, 7))
    associado = _criar_associado(client, categoria=categoria)

    plano_id = client.get("/api/planos-contribuicao/", headers=auth_headers).json()
    id_plano = next(p for p in plano_id if p["categoria"] == categoria)["id_plano"]

    r = client.post("/api/titulos/gerar-cobranca-bloco", json={
        "id_associado": associado["id_associado"], "id_plano_contribuicao": id_plano,
        "competencia_inicio": "2099-03",  # março não é mês-gatilho (1 ou 7)
    }, headers=auth_headers)
    assert r.status_code == 400
    assert "gatilho" in r.json()["detail"].lower()


def test_gerar_bloco_cria_titulo_unico_com_desconto_na_conta_de_receita_diferida(client, auth_headers):
    conta_receita = _criar_conta(client, auth_headers, "3.2.9802", "Mensalidade Bloco Teste 2", tipo="Receita")
    conta_passivo = _criar_conta(client, auth_headers, "2.1.9803", "Receita Diferida Teste 3", tipo="Passivo")
    categoria = f"CategoriaBloco2{conta_receita}"
    _criar_plano(client, auth_headers, conta_receita, categoria=categoria, valor_inicial=100)
    _criar_campanha(client, auth_headers, conta_passivo, percentual=80, quantidade_meses=6, meses_gatilho=(1, 7))
    associado = _criar_associado(client, categoria=categoria)

    planos = client.get("/api/planos-contribuicao/", headers=auth_headers).json()
    id_plano = next(p for p in planos if p["categoria"] == categoria)["id_plano"]

    r = client.post("/api/titulos/gerar-cobranca-bloco", json={
        "id_associado": associado["id_associado"], "id_plano_contribuicao": id_plano,
        "competencia_inicio": "2099-07",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    resultado = r.json()
    assert resultado["competencia"] == "2099-07"
    assert resultado["competencia_fim"] == "2099-12"
    # 6 meses x R$100 = 600, com 80% de desconto = 120.
    assert resultado["valor_original"] == 120.0

    titulos = client.get("/api/titulos/", headers=auth_headers).json()
    titulo = next(t for t in titulos if t["id_titulo"] == resultado["id_titulo"])
    assert titulo["competencia"] == "2099-07"
    assert titulo["competencia_fim"] == "2099-12"
    # um único título pro bloco inteiro - não seis.
    assert len([t for t in titulos if t["id_associado"] == associado["id_associado"] and t["competencia"] == "2099-07"]) == 1


def test_gerar_bloco_recusa_sobreposicao_com_titulo_existente(client, auth_headers):
    conta_receita = _criar_conta(client, auth_headers, "3.2.9804", "Mensalidade Bloco Teste 3", tipo="Receita")
    conta_passivo = _criar_conta(client, auth_headers, "2.1.9805", "Receita Diferida Teste 4", tipo="Passivo")
    categoria = f"CategoriaBloco3{conta_receita}"
    _criar_plano(client, auth_headers, conta_receita, categoria=categoria, valor_inicial=100)
    _criar_campanha(client, auth_headers, conta_passivo, quantidade_meses=6, meses_gatilho=(1, 7))
    associado = _criar_associado(client, categoria=categoria)

    planos = client.get("/api/planos-contribuicao/", headers=auth_headers).json()
    id_plano = next(p for p in planos if p["categoria"] == categoria)["id_plano"]

    # já existe cobrança normal de um mês dentro do intervalo do bloco pretendido (jul-dez).
    r = client.post("/api/contribuicoes/gerar-cobrancas/", json={"competencia": "2099-09", "confirmar": True}, headers=auth_headers)
    assert r.status_code == 200, r.text

    r = client.post("/api/titulos/gerar-cobranca-bloco", json={
        "id_associado": associado["id_associado"], "id_plano_contribuicao": id_plano,
        "competencia_inicio": "2099-07",
    }, headers=auth_headers)
    assert r.status_code == 400
    assert "já existe título" in r.json()["detail"].lower() or "ja existe" in r.json()["detail"].lower() or "cobrindo" in r.json()["detail"].lower()


def test_geracao_mensal_normal_pula_quem_ja_esta_coberto_por_bloco(client, auth_headers):
    conta_receita = _criar_conta(client, auth_headers, "3.2.9806", "Mensalidade Bloco Teste 4", tipo="Receita")
    conta_passivo = _criar_conta(client, auth_headers, "2.1.9807", "Receita Diferida Teste 5", tipo="Passivo")
    categoria = f"CategoriaBloco4{conta_receita}"
    _criar_plano(client, auth_headers, conta_receita, categoria=categoria, valor_inicial=100)
    _criar_campanha(client, auth_headers, conta_passivo, quantidade_meses=6, meses_gatilho=(1, 7))
    associado = _criar_associado(client, categoria=categoria)

    planos = client.get("/api/planos-contribuicao/", headers=auth_headers).json()
    id_plano = next(p for p in planos if p["categoria"] == categoria)["id_plano"]

    client.post("/api/titulos/gerar-cobranca-bloco", json={
        "id_associado": associado["id_associado"], "id_plano_contribuicao": id_plano,
        "competencia_inicio": "2098-07",
    }, headers=auth_headers)

    # agosto de 2098 já está coberto pelo bloco (jul-dez) - geração mensal normal pula o associado.
    r = client.post("/api/contribuicoes/gerar-cobrancas/", json={"competencia": "2098-08", "confirmar": True}, headers=auth_headers)
    assert r.status_code == 200, r.text
    resultado = r.json()
    assert not any(d["id_associado"] == associado["id_associado"] for d in resultado["detalhes"])
    assert resultado["total_cobertos_por_bloco"] >= 1


def test_baixa_do_bloco_entra_inteira_no_caixa_e_receita_e_reconhecida_mes_a_mes(client, auth_headers, exercicio_financeiro_aberto, db):
    conta_receita = _criar_conta(client, auth_headers, "3.2.9808", "Mensalidade Bloco Teste 5", tipo="Receita")
    conta_passivo = _criar_conta(client, auth_headers, "2.1.9809", "Receita Diferida Teste 6", tipo="Passivo")
    conta_caixa = _criar_conta(client, auth_headers, "1.1.9810", "Caixa Bloco Teste", tipo="Ativo")
    categoria = f"CategoriaBloco5{conta_receita}"
    _criar_plano(client, auth_headers, conta_receita, categoria=categoria, valor_inicial=100)
    _criar_campanha(client, auth_headers, conta_passivo, percentual=50, quantidade_meses=3, meses_gatilho=(1, 7))
    associado = _criar_associado(client, categoria=categoria)

    planos = client.get("/api/planos-contribuicao/", headers=auth_headers).json()
    id_plano = next(p for p in planos if p["categoria"] == categoria)["id_plano"]

    r = client.post("/api/titulos/gerar-cobranca-bloco", json={
        "id_associado": associado["id_associado"], "id_plano_contribuicao": id_plano,
        "competencia_inicio": "2097-07",
    }, headers=auth_headers)
    bloco = r.json()
    # 3 meses x 100 = 300, 50% de desconto = 150.
    assert bloco["valor_original"] == 150.0

    from app.services import contabilidade

    saldo_caixa_antes = contabilidade.saldo_conta(db, conta_caixa)
    db.rollback()

    # baixa em julho, cobrindo o bloco inteiro (jul-set) de uma vez - dinheiro entra inteiro AGORA.
    r = client.post("/baixar-titulo/", json={
        "id_titulo": bloco["id_titulo"], "valor_pago": 150, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": conta_caixa,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    saldo_caixa_depois = contabilidade.saldo_conta(db, conta_caixa)
    db.rollback()
    assert saldo_caixa_depois - saldo_caixa_antes == 150

    # mês do pagamento (julho): gerar-cobrancas roda a rotina mensal normal e já reconhece a
    # fatia de julho (1/3 = 50) da receita diferida - sem mexer em caixa de novo.
    r = client.post("/api/contribuicoes/gerar-cobrancas/", json={"competencia": "2097-07", "confirmar": True}, headers=auth_headers)
    reconhecimentos = r.json()["reconhecimentos_receita_diferida"]
    assert any(rec["id_titulo"] == bloco["id_titulo"] and rec["valor"] == 50.0 for rec in reconhecimentos)

    saldo_caixa_apos_reconhecimento = contabilidade.saldo_conta(db, conta_caixa)
    db.rollback()
    assert saldo_caixa_apos_reconhecimento == saldo_caixa_depois  # reconhecimento nunca mexe em caixa

    # rodar de novo pro MESMO mês não duplica o reconhecimento.
    r = client.post("/api/contribuicoes/gerar-cobrancas/", json={"competencia": "2097-07", "confirmar": True}, headers=auth_headers)
    assert not r.json()["reconhecimentos_receita_diferida"]

    # agosto: reconhece mais 50.
    client.post("/api/contribuicoes/gerar-cobrancas/", json={"competencia": "2097-08", "confirmar": True}, headers=auth_headers)
    # setembro (último mês do bloco): absorve o arredondamento - soma total bate exatamente com 150.
    r = client.post("/api/contribuicoes/gerar-cobrancas/", json={"competencia": "2097-09", "confirmar": True}, headers=auth_headers)
    reconhecimentos_set = r.json()["reconhecimentos_receita_diferida"]
    assert any(rec["id_titulo"] == bloco["id_titulo"] and rec["valor"] == 50.0 for rec in reconhecimentos_set)

    from app.models.financeiro import ReconhecimentoReceitaDiferida
    total_reconhecido = sum(
        (r.valor for r in db.query(ReconhecimentoReceitaDiferida).filter(ReconhecimentoReceitaDiferida.id_titulo == bloco["id_titulo"]).all()),
    )
    db.rollback()
    assert total_reconhecido == 150


def test_mudar_campanha_nao_afeta_bloco_ja_gerado(client, auth_headers):
    conta_receita = _criar_conta(client, auth_headers, "3.2.9811", "Mensalidade Bloco Teste 6", tipo="Receita")
    conta_passivo = _criar_conta(client, auth_headers, "2.1.9812", "Receita Diferida Teste 7", tipo="Passivo")
    categoria = f"CategoriaBloco6{conta_receita}"
    _criar_plano(client, auth_headers, conta_receita, categoria=categoria, valor_inicial=100)
    _criar_campanha(client, auth_headers, conta_passivo, percentual=80, quantidade_meses=6, meses_gatilho=(1, 7))
    associado = _criar_associado(client, categoria=categoria)

    planos = client.get("/api/planos-contribuicao/", headers=auth_headers).json()
    id_plano = next(p for p in planos if p["categoria"] == categoria)["id_plano"]

    r = client.post("/api/titulos/gerar-cobranca-bloco", json={
        "id_associado": associado["id_associado"], "id_plano_contribuicao": id_plano,
        "competencia_inicio": "2096-07",
    }, headers=auth_headers)
    id_titulo_antigo = r.json()["id_titulo"]
    assert r.json()["valor_original"] == 120.0  # 600 com 80% de desconto

    # diretoria muda a campanha (nova vigência, desconto menor).
    _criar_campanha(client, auth_headers, conta_passivo, percentual=20, quantidade_meses=6, meses_gatilho=(1, 7))

    titulos = client.get("/api/titulos/", headers=auth_headers).json()
    titulo_antigo = next(t for t in titulos if t["id_titulo"] == id_titulo_antigo)
    assert titulo_antigo["valor_original"] == 120.0  # nunca recalculado retroativamente
