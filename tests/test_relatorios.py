"""v3.6 (FASE 3) - demonstrativos financeiros (balancete, receitas x despesas, inadimplência,
extrato por conta financeira, por projeto) e prestação de contas do exercício, versionada, com o
parecer do Conselho Fiscal (v2.6) já emitido anexado."""
import uuid
from datetime import datetime, timedelta

from app.models.associados import Associado
from app.models.core import NivelAcesso, Usuario
from app.models.pessoas import Pessoa
from app.security import criar_access_token, hash_senha
from tests.test_situacao import _criar_associado as _criar_associado_via_api

_ISO = "%Y-%m-%dT%H:%M:%S"


def _criar_conta(client, auth_headers, tipo):
    r = client.post("/plano-contas/", json={
        "codigo_contabil": f"C{uuid.uuid4().hex[:8]}", "descricao_conta": f"Conta {tipo} teste relatorios", "tipo": tipo,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_conta"]


def _criar_conselheiro(db) -> Usuario:
    nivel = db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == "Conselho Fiscal").first()
    pessoa = Pessoa(nome_completo=f"Conselheiro Teste {uuid.uuid4().hex[:6]}")
    db.add(pessoa)
    db.flush()
    usuario = Usuario(email=f"conselheiro.{uuid.uuid4().hex[:8]}@teste.local", senha_hash=hash_senha("SenhaForte123456"), id_nivel=nivel.id_nivel, ativo=True)
    db.add(usuario)
    db.flush()
    db.add(Associado(id_pessoa=pessoa.id_pessoa, id_usuario=usuario.id_usuario))
    db.commit()
    return usuario


def test_balancete_e_receitas_despesas_refletem_baixa_real(client, auth_headers, exercicio_financeiro_aberto):
    conta_receita = _criar_conta(client, auth_headers, "Receita")
    conta_caixa = _criar_conta(client, auth_headers, "Ativo")
    hoje = datetime.utcnow()
    inicio = hoje.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)
    fim = hoje + timedelta(days=1)

    r = client.post("/titulos/", json={
        "tipo_titulo": "A Receber", "id_conta_contabil": conta_receita,
        "descricao": "Receita de teste relatórios", "valor_original": 500,
        "data_vencimento": (hoje + timedelta(days=5)).strftime(_ISO),
    }, headers=auth_headers)
    id_titulo = r.json()["id_titulo"]
    r = client.post("/baixar-titulo/", json={
        "id_titulo": id_titulo, "valor_pago": 500, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": conta_caixa,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    balancete = client.get(
        f"/api/relatorios/balancete?data_inicio={inicio.strftime(_ISO)}&data_fim={fim.strftime(_ISO)}", headers=auth_headers,
    ).json()
    linha_receita = next(l for l in balancete if l["id_conta"] == conta_receita)
    assert linha_receita["saldo_anterior"] == 0
    assert linha_receita["saldo_atual"] == 500.0

    receitas_despesas = client.get(
        f"/api/relatorios/receitas-despesas?data_inicio={inicio.strftime(_ISO)}&data_fim={fim.strftime(_ISO)}", headers=auth_headers,
    ).json()
    linha = next(l for l in receitas_despesas if l["id_conta"] == conta_receita)
    assert linha["valor_periodo"] == 500.0
    assert linha["tipo"] == "Receita"


def test_relatorio_inadimplencia_lista_associado_com_titulo_vencido(client, auth_headers):
    conta_receita = _criar_conta(client, auth_headers, "Receita")
    associado = _criar_associado_via_api(client)
    r = client.post("/titulos/", json={
        "tipo_titulo": "A Receber", "id_conta_contabil": conta_receita, "id_associado": associado["id_associado"],
        "descricao": "Mensalidade vencida - teste relatório", "valor_original": 150,
        "data_vencimento": "2020-01-01T00:00:00",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    inadimplencia = client.get("/api/relatorios/inadimplencia", headers=auth_headers).json()
    linha = next(l for l in inadimplencia if l["id_associado"] == associado["id_associado"])
    assert linha["total_devido"] == 150.0
    assert linha["quantidade_titulos_vencidos"] == 1
    assert linha["dias_atraso_maximo"] > 1000


def test_extrato_conta_financeira_calcula_saldo_corrente(client, auth_headers, exercicio_financeiro_aberto):
    conta_despesa = _criar_conta(client, auth_headers, "Despesa")
    conta_ativo = _criar_conta(client, auth_headers, "Ativo")
    r = client.post("/api/contas-financeiras/", json={"id_conta": conta_ativo, "tipo_conta_financeira": "Caixa"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_conta_financeira = r.json()["id_conta_financeira"]

    r = client.post(
        "/api/comprovantes/", files={"arquivo": ("nota.pdf", b"%PDF-1.4 conteudo", "application/pdf")}, headers=auth_headers,
    )
    comprovante = r.json()["comprovante"]

    r = client.post("/titulos/", json={
        "tipo_titulo": "A Pagar", "id_conta_contabil": conta_despesa,
        "descricao": "Despesa de teste extrato", "valor_original": 200,
        "data_vencimento": (datetime.utcnow() + timedelta(days=5)).strftime(_ISO),
    }, headers=auth_headers)
    id_titulo = r.json()["id_titulo"]
    r = client.post("/baixar-titulo/", json={
        "id_titulo": id_titulo, "valor_pago": 200, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": conta_ativo, "comprovante": comprovante,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    extrato = client.get(f"/api/relatorios/extrato-conta-financeira/{id_conta_financeira}", headers=auth_headers).json()
    assert extrato["saldo_atual"] == -200.0
    assert len(extrato["movimentos"]) == 1
    assert extrato["movimentos"][0]["tipo_partida"] == "Credito"


def test_relatorio_por_projeto_agrupa_pelo_centro_de_custo_vinculado(client, auth_headers, exercicio_financeiro_aberto):
    r = client.post("/projetos/", json={
        "nome_projeto": "Projeto Teste Relatório", "tipo_foco": "Educacional",
        "necessita_alvara_bombeiros": False,
        "data_inicio": datetime.utcnow().strftime(_ISO), "data_fim_prevista": (datetime.utcnow() + timedelta(days=90)).strftime(_ISO),
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_projeto = r.json()["id_projeto"]

    r = client.post("/api/centros-custo/", json={"codigo": f"CC{uuid.uuid4().hex[:8]}", "nome": "Centro do Projeto Teste", "id_projeto": id_projeto}, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_centro_custo = r.json()["id_centro_custo"]

    conta_receita = _criar_conta(client, auth_headers, "Receita")
    conta_caixa = _criar_conta(client, auth_headers, "Ativo")
    r = client.post("/titulos/", json={
        "tipo_titulo": "A Receber", "id_conta_contabil": conta_receita,
        "descricao": "Receita do projeto teste", "valor_original": 400,
        "data_vencimento": (datetime.utcnow() + timedelta(days=5)).strftime(_ISO),
    }, headers=auth_headers)
    id_titulo = r.json()["id_titulo"]
    r = client.post("/baixar-titulo/", json={
        "id_titulo": id_titulo, "valor_pago": 400, "forma_pagamento": "Pix",
        "id_conta_contabil_contrapartida": conta_caixa, "id_centro_custo": id_centro_custo,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    hoje = datetime.utcnow()
    inicio = (hoje - timedelta(days=1)).strftime(_ISO)
    fim = (hoje + timedelta(days=1)).strftime(_ISO)
    relatorio = client.get(f"/api/relatorios/por-projeto?data_inicio={inicio}&data_fim={fim}", headers=auth_headers).json()
    linha = next(l for l in relatorio if l["id_projeto"] == id_projeto)
    assert linha["receitas"] == 400.0
    assert linha["resultado"] == 400.0


def test_prestacao_de_contas_versiona_e_anexa_parecer(client, auth_headers, db):
    ano = 2088
    conselheiro = _criar_conselheiro(db)
    headers_conselheiro = {"Authorization": f"Bearer {criar_access_token(conselheiro)}"}
    r = client.post(
        "/api/conselho-fiscal/pareceres", headers=headers_conselheiro,
        json={"ano_exercicio": ano, "tipo": "Favorável", "texto": "Contas do exercício conferidas, sem ressalvas."},
    )
    assert r.status_code == 200, r.text
    id_parecer = r.json()["id_parecer"]

    r = client.post("/api/prestacoes-de-contas/", json={"ano_exercicio": ano}, headers=auth_headers)
    assert r.status_code == 200, r.text
    primeira = r.json()
    assert primeira["versao"] == 1
    assert primeira["id_parecer"] == id_parecer
    assert "Contas do exercício conferidas" in primeira["conteudo"]

    r = client.post("/api/prestacoes-de-contas/", json={"ano_exercicio": ano}, headers=auth_headers)
    assert r.status_code == 200, r.text
    segunda = r.json()
    assert segunda["versao"] == 2

    historico = client.get(f"/api/prestacoes-de-contas/?ano_exercicio={ano}", headers=auth_headers).json()
    versoes = sorted(p["versao"] for p in historico)
    assert versoes == [1, 2]
