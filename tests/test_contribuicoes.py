"""v3.2 (FASE 3) - mensalidades e cobrança recorrente: PlanoDeContribuicao com valor vigente
versionado, geração de cobrança em lote idempotente por competência, isenção, cobrança por
família, Pix estático (BR Code) e pagamento a maior (crédito de associado)."""
from datetime import datetime, timedelta

from tests.test_situacao import _criar_associado


def _criar_conta(client, auth_headers, codigo, descricao, tipo):
    r = client.post("/plano-contas/", json={"codigo_contabil": codigo, "descricao_conta": descricao, "tipo": tipo}, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_conta"]


def _criar_plano(client, auth_headers, conta_receita, categoria="Efetivo", valor_inicial=100, cobranca_por_nucleo_familiar=False):
    r = client.post("/api/planos-contribuicao/", json={
        "categoria": categoria, "descricao": f"Mensalidade {categoria}", "periodicidade": "Mensal",
        "dia_vencimento": 10, "cobranca_por_nucleo_familiar": cobranca_por_nucleo_familiar,
        "id_conta_contabil": conta_receita, "valor_inicial": valor_inicial,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_plano"]


def test_valor_vigente_e_reajuste_preserva_historico(client, auth_headers):
    conta_receita = _criar_conta(client, auth_headers, "3.2.9001", "Mensalidade Teste v3.2", tipo="Receita")
    id_plano = _criar_plano(client, auth_headers, conta_receita, categoria=f"CategoriaTeste{conta_receita}", valor_inicial=50)

    planos = client.get("/api/planos-contribuicao/", headers=auth_headers).json()
    plano = next(p for p in planos if p["id_plano"] == id_plano)
    assert plano["valor_vigente"] == 50.0

    vigencia_futura = (datetime.utcnow() + timedelta(days=365)).strftime("%Y-%m-%dT%H:%M:%S")
    r = client.post(f"/api/planos-contribuicao/{id_plano}/reajustar", json={
        "valor": 60, "data_vigencia_inicio": vigencia_futura, "motivo": "Reajuste anual pelo IPCA",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    # valor vigente HOJE continua o antigo - o reajuste só vale a partir da vigência futura.
    planos = client.get("/api/planos-contribuicao/", headers=auth_headers).json()
    plano = next(p for p in planos if p["id_plano"] == id_plano)
    assert plano["valor_vigente"] == 50.0

    # reajustar com vigência igual/anterior à atual é recusado (nunca reabre um período já fechado).
    r = client.post(f"/api/planos-contribuicao/{id_plano}/reajustar", json={
        "valor": 70, "data_vigencia_inicio": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S"), "motivo": "Tentativa inválida",
    }, headers=auth_headers)
    assert r.status_code == 400


def test_geracao_de_cobrancas_e_idempotente_por_competencia(client, auth_headers):
    conta_receita = _criar_conta(client, auth_headers, "3.2.9002", "Mensalidade Idempotencia", tipo="Receita")
    categoria = f"CategoriaGeracao{conta_receita}"
    id_plano = _criar_plano(client, auth_headers, conta_receita, categoria=categoria, valor_inicial=80)
    associado = _criar_associado(client, categoria=categoria)

    competencia = "2099-03"

    # prévia (confirmar=false, padrão) não grava nada.
    r = client.post("/api/contribuicoes/gerar-cobrancas/", json={"competencia": competencia}, headers=auth_headers)
    assert r.status_code == 200, r.text
    previa = r.json()
    assert previa["confirmado"] is False
    assert previa["total_gerados"] >= 1
    assert any(d["id_associado"] == associado["id_associado"] for d in previa["detalhes"])

    titulos_antes = client.get("/api/titulos/", headers=auth_headers).json()
    assert not any(t["descricao"].endswith(f"competência {competencia}") for t in titulos_antes)

    # confirmar de fato grava.
    r = client.post("/api/contribuicoes/gerar-cobrancas/", json={"competencia": competencia, "confirmar": True}, headers=auth_headers)
    assert r.status_code == 200, r.text
    resultado = r.json()
    assert resultado["confirmado"] is True
    total_gerado_primeira_rodada = resultado["total_gerados"]
    assert total_gerado_primeira_rodada >= 1

    # rodar de novo na MESMA competência não duplica - idempotência de verdade, trava no banco.
    r = client.post("/api/contribuicoes/gerar-cobrancas/", json={"competencia": competencia, "confirmar": True}, headers=auth_headers)
    assert r.status_code == 200, r.text
    resultado2 = r.json()
    assert resultado2["total_gerados"] == 0
    assert resultado2["total_ja_existentes"] >= total_gerado_primeira_rodada

    titulos_depois = client.get("/api/titulos/", headers=auth_headers).json()
    gerados = [t for t in titulos_depois if t["descricao"] == f"Mensalidade {categoria} — competência {competencia}"]
    assert len(gerados) == 1  # nunca duplicado mesmo com a geração rodada duas vezes
    assert gerados[0]["valor_original"] == 80.0


def test_isencao_reduz_ou_zera_a_cobranca_gerada(client, auth_headers):
    conta_receita = _criar_conta(client, auth_headers, "3.2.9003", "Mensalidade Isencao", tipo="Receita")
    categoria = f"CategoriaIsencao{conta_receita}"
    id_plano = _criar_plano(client, auth_headers, conta_receita, categoria=categoria, valor_inicial=100)
    associado_meio = _criar_associado(client, categoria=categoria)
    associado_total = _criar_associado(client, categoria=categoria)

    client.post("/api/isencoes-contribuicao/", json={
        "id_associado": associado_meio["id_associado"], "id_plano": id_plano,
        "motivo": "DIFICULDADE_FINANCEIRA", "percentual_desconto": 50,
    }, headers=auth_headers)
    client.post("/api/isencoes-contribuicao/", json={
        "id_associado": associado_total["id_associado"], "id_plano": id_plano,
        "motivo": "FUNDADOR", "percentual_desconto": 100,
    }, headers=auth_headers)

    competencia = "2099-04"
    r = client.post("/api/contribuicoes/gerar-cobrancas/", json={"competencia": competencia, "confirmar": True}, headers=auth_headers)
    detalhes = r.json()["detalhes"]

    linha_meio = next(d for d in detalhes if d["id_associado"] == associado_meio["id_associado"])
    assert linha_meio["valor"] == 50.0
    # isento a 100% nunca gera título de valor zero - some da lista de gerados.
    assert not any(d["id_associado"] == associado_total["id_associado"] for d in detalhes)
    assert r.json()["total_isentos_totais"] >= 1


def test_cobranca_por_familia_nao_gera_titulo_para_dependente(client, auth_headers, db):
    from tests.test_pessoas import _cpf_unico

    conta_receita = _criar_conta(client, auth_headers, "3.2.9004", "Mensalidade Familia", tipo="Receita")
    categoria = f"CategoriaFamilia{conta_receita}"
    _criar_plano(client, auth_headers, conta_receita, categoria=categoria, valor_inicial=90, cobranca_por_nucleo_familiar=True)

    titular = _criar_associado(client, categoria=categoria)
    dependente = _criar_associado(client, categoria=categoria)

    from app.models.associados import Associado as AssociadoModel
    id_pessoa_titular = db.query(AssociadoModel).filter(AssociadoModel.id_associado == titular["id_associado"]).first().id_pessoa
    id_pessoa_dependente = db.query(AssociadoModel).filter(AssociadoModel.id_associado == dependente["id_associado"]).first().id_pessoa
    db.rollback()

    r = client.post(f"/api/pessoas/{id_pessoa_titular}/dependentes", json={
        "id_pessoa_vinculada": id_pessoa_dependente, "grau_parentesco": "CONJUGE",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    competencia = "2099-05"
    r = client.post("/api/contribuicoes/gerar-cobrancas/", json={"competencia": competencia, "confirmar": True}, headers=auth_headers)
    detalhes = r.json()["detalhes"]
    assert any(d["id_associado"] == titular["id_associado"] for d in detalhes)
    assert not any(d["id_associado"] == dependente["id_associado"] for d in detalhes)
    assert r.json()["total_dependentes_pulados"] >= 1


def test_pix_copia_e_cola_tem_estrutura_valida(client, auth_headers, db):
    from app.models.core import ConfiguracaoInstitucional

    for chave, valor in [("CHAVE_PIX", "12345678000199"), ("NOME_BENEFICIARIO_PIX", "ASAF Teste"), ("CIDADE_BENEFICIARIO_PIX", "Sao Paulo")]:
        config = db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao == chave).first()
        assert config is not None, f"config canônica '{chave}' deveria existir (seed_configuracoes_institucionais)"
        config.valor_configuracao = valor
    db.commit()

    conta_receita = _criar_conta(client, auth_headers, "3.2.9005", "Receita Pix Teste", tipo="Receita")
    associado = _criar_associado(client)
    titulo = client.post("/titulos/", json={
        "tipo_titulo": "A Receber", "id_conta_contabil": conta_receita, "id_associado": associado["id_associado"],
        "descricao": "Cobranca Pix teste", "valor_original": 25.5,
        "data_vencimento": (datetime.utcnow() + timedelta(days=5)).strftime("%Y-%m-%dT%H:%M:%S"),
    }, headers=auth_headers).json()

    r = client.get(f"/api/titulos/{titulo['id_titulo']}/pix", headers=auth_headers)
    assert r.status_code == 200, r.text
    payload = r.json()["payload"]
    assert payload.startswith("000201")
    assert "br.gov.bcb.pix" in payload
    assert "540525.50" in payload  # campo 54 (valor) = "25.50"
    assert payload[-8:-4] == "6304"  # marcador do campo do CRC, logo antes dos 4 dígitos finais
    crc = payload[-4:]
    assert len(crc) == 4 and all(c in "0123456789ABCDEF" for c in crc)


def test_pagamento_a_maior_gera_credito_e_credito_e_aplicavel(client, auth_headers, exercicio_financeiro_aberto):
    conta_receita = _criar_conta(client, auth_headers, "3.2.9006", "Receita Credito Teste", tipo="Receita")
    conta_receita2 = _criar_conta(client, auth_headers, "3.2.9007", "Receita Credito Teste 2", tipo="Receita")
    conta_caixa = _criar_conta(client, auth_headers, "1.1.9700", "Caixa Credito Teste", tipo="Ativo")
    conta_adiantamento = _criar_conta(client, auth_headers, "2.1.9700", "Adiantamento de Associados", tipo="Passivo")
    associado = _criar_associado(client)

    titulo = client.post("/titulos/", json={
        "tipo_titulo": "A Receber", "id_conta_contabil": conta_receita, "id_associado": associado["id_associado"],
        "descricao": "Titulo pago a maior", "valor_original": 100,
        "data_vencimento": (datetime.utcnow() + timedelta(days=5)).strftime("%Y-%m-%dT%H:%M:%S"),
    }, headers=auth_headers).json()

    # sem informar a conta de adiantamento, pagar mais que o saldo devedor é recusado.
    r = client.post("/baixar-titulo/", json={
        "id_titulo": titulo["id_titulo"], "valor_pago": 150, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": conta_caixa,
    }, headers=auth_headers)
    assert r.status_code == 400

    r = client.post("/baixar-titulo/", json={
        "id_titulo": titulo["id_titulo"], "valor_pago": 150, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": conta_caixa, "id_conta_contabil_adiantamento": conta_adiantamento,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_credito = r.json()["id_credito_gerado"]
    assert id_credito is not None

    titulos = client.get("/api/titulos/", headers=auth_headers).json()
    titulo_pago = next(t for t in titulos if t["id_titulo"] == titulo["id_titulo"])
    assert titulo_pago["status"] == "Pago"
    assert titulo_pago["saldo_devedor"] == 0.0

    creditos = client.get(f"/api/creditos-associado/{associado['id_associado']}", headers=auth_headers).json()
    credito = next(c for c in creditos if c["id_credito"] == id_credito)
    assert credito["valor"] == 50.0

    # aplica o crédito num título FUTURO do mesmo associado - sem tocar em caixa.
    titulo2 = client.post("/titulos/", json={
        "tipo_titulo": "A Receber", "id_conta_contabil": conta_receita2, "id_associado": associado["id_associado"],
        "descricao": "Titulo futuro quitado com credito", "valor_original": 30,
        "data_vencimento": (datetime.utcnow() + timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%S"),
    }, headers=auth_headers).json()

    r = client.post("/api/creditos-associado/aplicar", json={
        "id_credito": id_credito, "id_titulo": titulo2["id_titulo"], "id_conta_contabil_adiantamento": conta_adiantamento,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["valor_aplicado"] == 30.0
    assert r.json()["saldo_credito_restante"] == 20.0
    assert r.json()["saldo_devedor_titulo"] == 0.0

    titulos = client.get("/api/titulos/", headers=auth_headers).json()
    titulo2_pago = next(t for t in titulos if t["id_titulo"] == titulo2["id_titulo"])
    assert titulo2_pago["status"] == "Pago"


def test_conciliacao_importa_csv_e_sugere_correspondencia(client, auth_headers):
    conta_receita = _criar_conta(client, auth_headers, "3.2.9008", "Receita Conciliacao Teste", tipo="Receita")
    associado = _criar_associado(client)
    data_vencimento = datetime.utcnow() + timedelta(days=5)
    titulo = client.post("/titulos/", json={
        "tipo_titulo": "A Receber", "id_conta_contabil": conta_receita, "id_associado": associado["id_associado"],
        "descricao": "Titulo para conciliar", "valor_original": 77.5,
        "data_vencimento": data_vencimento.strftime("%Y-%m-%dT%H:%M:%S"),
    }, headers=auth_headers).json()

    csv_bytes = f"data,valor,descricao\n{data_vencimento.strftime('%Y-%m-%d')},77.5,PIX RECEBIDO\n".encode("utf-8")
    r = client.post(
        "/api/conciliacao/importar", files={"arquivo": ("extrato.csv", csv_bytes, "text/csv")}, headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    transacoes = r.json()["transacoes"]
    assert len(transacoes) == 1
    sugestoes = transacoes[0]["sugestoes"]
    assert any(s["id_titulo"] == titulo["id_titulo"] for s in sugestoes)
