"""v2.8 (FASE 2) - roteiro de dissolução (Art. 31): deliberação -> liquidação -> destinação de
patrimônio -> baixa cadastral, sequencial e auditado. Destinação exige confirmar os três
critérios do Art. 31, Parágrafo Único (sede em Parauapebas/PA, +2 anos, credenciada)."""
from datetime import datetime, timedelta

_ISO = "%Y-%m-%dT%H:%M:%S"


def _criar_ata(client, auth_headers) -> int:
    r = client.post(
        "/api/assembleias/", headers=auth_headers,
        json={"tipo": "Extraordinária", "pauta": "Dissolução da ASAF", "data_hora_convocacao": (datetime.utcnow() + timedelta(days=20)).strftime(_ISO)},
    )
    id_assembleia = r.json()["id_assembleia"]
    client.post(f"/api/assembleias/{id_assembleia}/convocar", headers=auth_headers)
    client.post(f"/api/assembleias/{id_assembleia}/abrir-sessao", headers=auth_headers)
    return client.post(f"/api/assembleias/{id_assembleia}/ata", headers=auth_headers).json()["id_ata"]


def _criar_deliberacao_dissolucao(client, auth_headers, id_ata, concluir=True) -> int:
    r = client.post(f"/api/atas/{id_ata}/deliberacoes", headers=auth_headers, json={"tipo": "Dissolução", "texto": "Dissolução da ASAF por carência de recursos financeiros e humanos."})
    id_deliberacao = r.json()["id_deliberacao"]
    if concluir:
        client.post(f"/api/deliberacoes/{id_deliberacao}/concluir", headers=auth_headers, json={"observacao": "Aprovada por 2/3 dos presentes conforme Art. 31."})
    return id_deliberacao


def _abrir_processo(client, auth_headers) -> int:
    r = client.post("/api/processos-dissolucao/", headers=auth_headers, json={"motivo": "Impossibilidade de manutenção dos objetivos sociais por carência de recursos."})
    assert r.status_code == 200, r.text
    return r.json()["id_processo_dissolucao"]


def test_deliberar_exige_tipo_dissolucao_e_deliberacao_concluida(client, auth_headers):
    id_ata = _criar_ata(client, auth_headers)
    id_deliberacao_generica = client.post(f"/api/atas/{id_ata}/deliberacoes", headers=auth_headers, json={"tipo": "Genérica", "texto": "Deliberação qualquer, não de dissolução."}).json()["id_deliberacao"]
    id_processo = _abrir_processo(client, auth_headers)

    r_tipo_errado = client.post(f"/api/processos-dissolucao/{id_processo}/deliberar", headers=auth_headers, json={"id_deliberacao": id_deliberacao_generica})
    assert r_tipo_errado.status_code == 400
    assert "Dissolução" in r_tipo_errado.json()["detail"]

    id_deliberacao_pendente = _criar_deliberacao_dissolucao(client, auth_headers, id_ata, concluir=False)
    r_pendente = client.post(f"/api/processos-dissolucao/{id_processo}/deliberar", headers=auth_headers, json={"id_deliberacao": id_deliberacao_pendente})
    assert r_pendente.status_code == 400
    assert "concluída" in r_pendente.json()["detail"].lower()


def test_nao_pode_pular_etapa(client, auth_headers):
    id_processo = _abrir_processo(client, auth_headers)
    r = client.post(f"/api/processos-dissolucao/{id_processo}/concluir-liquidacao", headers=auth_headers, json={"observacao": "Tentativa de pular a etapa de deliberação."})
    assert r.status_code == 400


def test_destinar_patrimonio_sem_confirmar_criterios_falha(client, auth_headers):
    id_ata = _criar_ata(client, auth_headers)
    id_deliberacao = _criar_deliberacao_dissolucao(client, auth_headers, id_ata)
    id_processo = _abrir_processo(client, auth_headers)
    client.post(f"/api/processos-dissolucao/{id_processo}/deliberar", headers=auth_headers, json={"id_deliberacao": id_deliberacao})
    client.post(f"/api/processos-dissolucao/{id_processo}/concluir-liquidacao", headers=auth_headers, json={"observacao": "Todo o passivo foi quitado com os recursos remanescentes em caixa."})

    r = client.post(
        f"/api/processos-dissolucao/{id_processo}/destinar-patrimonio", headers=auth_headers,
        json={
            "entidade_nome": "Associação Congênere de Parauapebas", "justificativa": "Entidade com atuação reconhecida na região.",
            "confirma_sede_parauapebas": True, "confirma_anos_minimos": False, "confirma_credenciada": True,
        },
    )
    assert r.status_code == 400
    assert "Art. 31" in r.json()["detail"]


def test_fluxo_completo_de_dissolucao(client, auth_headers):
    id_ata = _criar_ata(client, auth_headers)
    id_deliberacao = _criar_deliberacao_dissolucao(client, auth_headers, id_ata)
    id_processo = _abrir_processo(client, auth_headers)

    r_deliberar = client.post(f"/api/processos-dissolucao/{id_processo}/deliberar", headers=auth_headers, json={"id_deliberacao": id_deliberacao})
    assert r_deliberar.status_code == 200, r_deliberar.text
    assert r_deliberar.json()["status"] == "Deliberada"

    r_liquidacao = client.post(f"/api/processos-dissolucao/{id_processo}/concluir-liquidacao", headers=auth_headers, json={"observacao": "Todo o passivo foi quitado com os recursos remanescentes em caixa."})
    assert r_liquidacao.json()["status"] == "Liquidação concluída"

    r_destinacao = client.post(
        f"/api/processos-dissolucao/{id_processo}/destinar-patrimonio", headers=auth_headers,
        json={
            "entidade_nome": "Associação Congênere de Parauapebas", "entidade_cnpj": "12.345.678/0001-90",
            "justificativa": "Entidade com sede em Parauapebas/PA, fundada em 2015, devidamente credenciada junto ao CMDCA local.",
            "confirma_sede_parauapebas": True, "confirma_anos_minimos": True, "confirma_credenciada": True,
        },
    )
    assert r_destinacao.status_code == 200, r_destinacao.text
    assert r_destinacao.json()["status"] == "Patrimônio destinado"
    assert r_destinacao.json()["entidade_destinataria_nome"] == "Associação Congênere de Parauapebas"

    r_baixa = client.post(f"/api/processos-dissolucao/{id_processo}/baixa-cadastral", headers=auth_headers, json={"observacao": "Baixa cadastral realizada junto à Receita Federal e ao Cartório de Registro Civil."})
    assert r_baixa.status_code == 200
    assert r_baixa.json()["status"] == "Baixa cadastral concluída"

    # roteiro concluído não aceita mais cancelamento nem repetição de etapa.
    r_cancelar_depois = client.post(f"/api/processos-dissolucao/{id_processo}/cancelar", headers=auth_headers, json={"motivo": "Tentativa de cancelar processo já concluído."})
    assert r_cancelar_depois.status_code == 400


def test_cancelar_processo_aberto(client, auth_headers):
    id_processo = _abrir_processo(client, auth_headers)
    r = client.post(f"/api/processos-dissolucao/{id_processo}/cancelar", headers=auth_headers, json={"motivo": "Associação recuperou a viabilidade financeira, dissolução não é mais necessária."})
    assert r.status_code == 200
    assert r.json()["status"] == "Cancelado"

    r_de_novo = client.post(f"/api/processos-dissolucao/{id_processo}/cancelar", headers=auth_headers, json={"motivo": "Tentativa de cancelar duas vezes."})
    assert r_de_novo.status_code == 400
