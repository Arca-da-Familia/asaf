"""v4.1 (FASE 4) - Projeto como entidade única e configurável: tipo/status de catálogo,
cronograma com status sempre derivado, equipe com papel, orçamento via centro de custo (v3.5) e
encerramento formal versionado (mesmo padrão de PrestacaoDeContas, v3.6)."""
import uuid
from datetime import datetime, timedelta

from tests.test_situacao import _criar_associado

_ISO = "%Y-%m-%dT%H:%M:%S"


def _criar_projeto(client, auth_headers, **overrides):
    payload = {
        "nome_projeto": f"Projeto Teste {uuid.uuid4().hex[:6]}", "tipo_foco": "Social",
        "necessita_alvara_bombeiros": False,
        "data_inicio": datetime.utcnow().strftime(_ISO),
        "data_fim_prevista": (datetime.utcnow() + timedelta(days=180)).strftime(_ISO),
    }
    payload.update(overrides)
    r = client.post("/projetos/", json=payload, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_projeto"]


def test_endpoints_de_projeto_exigem_autenticacao(client):
    assert client.get("/api/projetos/").status_code == 401
    assert client.post("/projetos/", json={
        "nome_projeto": "x", "tipo_foco": "x", "necessita_alvara_bombeiros": False,
        "data_inicio": "2026-01-01T00:00:00", "data_fim_prevista": "2026-01-02T00:00:00",
    }).status_code == 401


def test_criar_projeto_valida_tipo_de_catalogo(client, auth_headers):
    r = client.post("/projetos/", json={
        "nome_projeto": "Projeto Tipo Inválido", "tipo_foco": "Social", "necessita_alvara_bombeiros": False,
        "data_inicio": datetime.utcnow().strftime(_ISO), "data_fim_prevista": (datetime.utcnow() + timedelta(days=10)).strftime(_ISO),
        "tipo_projeto": "CODIGO_QUE_NAO_EXISTE",
    }, headers=auth_headers)
    assert r.status_code == 422


def test_criar_projeto_com_responsavel_e_centro_custo(client, auth_headers):
    associado = _criar_associado(client)
    r = client.post("/api/centros-custo/", json={"codigo": f"CC{uuid.uuid4().hex[:8]}", "nome": "Centro Projeto Teste"}, headers=auth_headers)
    id_centro_custo = r.json()["id_centro_custo"]

    id_projeto = _criar_projeto(
        client, auth_headers, tipo_projeto="EDUCACIONAL", id_associado_responsavel=associado["id_associado"],
        id_centro_custo=id_centro_custo, publico_alvo="Crianças de 6 a 12 anos", visibilidade="Pública",
    )

    detalhe = client.get(f"/api/projetos/{id_projeto}", headers=auth_headers).json()
    assert detalhe["tipo_projeto"] == "EDUCACIONAL"
    assert detalhe["status"] == "PLANEJAMENTO"
    assert detalhe["visibilidade"] == "Pública"
    assert detalhe["id_centro_custo"] == id_centro_custo


def test_alterar_status_projeto_valida_catalogo(client, auth_headers):
    id_projeto = _criar_projeto(client, auth_headers)
    r = client.put(f"/api/projetos/{id_projeto}/status", json={"status": "STATUS_INVALIDO"}, headers=auth_headers)
    assert r.status_code == 422

    r = client.put(f"/api/projetos/{id_projeto}/status", json={"status": "EM_EXECUCAO"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert client.get(f"/api/projetos/{id_projeto}", headers=auth_headers).json()["status"] == "EM_EXECUCAO"


def test_cronograma_status_e_sempre_derivado_nunca_escolhido_a_mao(client, auth_headers):
    id_projeto = _criar_projeto(client, auth_headers)

    r = client.post(f"/api/projetos/{id_projeto}/cronograma", json={
        "tipo": "Marco", "titulo": "Marco vencido", "prazo": "2020-01-01T00:00:00",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_marco_vencido = r.json()["id_item"]

    r = client.post(f"/api/projetos/{id_projeto}/cronograma", json={
        "tipo": "Tarefa", "titulo": "Tarefa futura", "prazo": (datetime.utcnow() + timedelta(days=30)).strftime(_ISO),
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    cronograma = {i["titulo"]: i for i in client.get(f"/api/projetos/{id_projeto}/cronograma", headers=auth_headers).json()}
    assert cronograma["Marco vencido"]["status"] == "Atrasado"
    assert cronograma["Tarefa futura"]["status"] == "Pendente"

    r = client.post(f"/api/cronograma/{id_marco_vencido}/concluir", headers=auth_headers)
    assert r.status_code == 200, r.text
    cronograma = {i["titulo"]: i for i in client.get(f"/api/projetos/{id_projeto}/cronograma", headers=auth_headers).json()}
    assert cronograma["Marco vencido"]["status"] == "Concluído"

    r = client.post(f"/api/cronograma/{id_marco_vencido}/concluir", headers=auth_headers)
    assert r.status_code == 400


def test_equipe_recusa_membro_ativo_duplicado_mas_permite_apos_encerrar(client, auth_headers):
    id_projeto = _criar_projeto(client, auth_headers)
    associado = _criar_associado(client)

    r = client.post(f"/api/projetos/{id_projeto}/equipe", json={
        "id_associado": associado["id_associado"], "papel": "COORDENADOR",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_membro = r.json()["id_membro"]

    r = client.post(f"/api/projetos/{id_projeto}/equipe", json={
        "id_associado": associado["id_associado"], "papel": "VOLUNTARIO",
    }, headers=auth_headers)
    assert r.status_code == 400
    assert "já está ativo" in r.json()["detail"].lower()

    r = client.post(f"/api/equipe-projeto/{id_membro}/encerrar", headers=auth_headers)
    assert r.status_code == 200, r.text

    r = client.post(f"/api/projetos/{id_projeto}/equipe", json={
        "id_associado": associado["id_associado"], "papel": "VOLUNTARIO",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    equipe = client.get(f"/api/projetos/{id_projeto}/equipe", headers=auth_headers).json()
    assert len(equipe) == 2


def test_orcamento_do_projeto_reaproveita_motor_v35(client, auth_headers):
    from tests.test_orcamento import _criar_conta, _criar_deliberacao

    r = client.post("/api/centros-custo/", json={"codigo": f"CC{uuid.uuid4().hex[:8]}", "nome": "Centro Orçamento Projeto"}, headers=auth_headers)
    id_centro_custo = r.json()["id_centro_custo"]
    id_projeto = _criar_projeto(client, auth_headers, id_centro_custo=id_centro_custo)

    conta_despesa = _criar_conta(client, auth_headers, "Despesa")
    id_deliberacao = _criar_deliberacao(client, auth_headers)
    ano_atual = datetime.utcnow().year
    r = client.post("/api/orcamentos/", json={
        "ano": ano_atual, "id_conta_contabil": conta_despesa, "id_centro_custo": id_centro_custo,
        "valor_previsto": 500, "id_deliberacao": id_deliberacao,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    orcamento_projeto = client.get(f"/api/projetos/{id_projeto}/orcamento?ano={ano_atual}", headers=auth_headers).json()
    assert len(orcamento_projeto) == 1
    assert orcamento_projeto[0]["valor_previsto"] == 500.0


def test_relatorio_final_versiona_e_registra_pendencia_de_publico_atendido(client, auth_headers):
    id_projeto = _criar_projeto(client, auth_headers)

    r = client.post(f"/api/projetos/{id_projeto}/relatorio-final", headers=auth_headers)
    assert r.status_code == 200, r.text
    primeira = r.json()
    assert primeira["versao"] == 1
    assert "v4.2" in primeira["conteudo"]  # registra a pendência do motor de beneficiários

    r = client.post(f"/api/projetos/{id_projeto}/relatorio-final", headers=auth_headers)
    assert r.json()["versao"] == 2

    historico = client.get(f"/api/projetos/{id_projeto}/relatorio-final", headers=auth_headers).json()
    assert sorted(h["versao"] for h in historico) == [1, 2]
