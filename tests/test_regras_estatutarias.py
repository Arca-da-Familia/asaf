"""v2.0 (FASE 2) - RegraEstatutaria: cobre o seed com os valores reais do ESTATUTO_ASAF.txt, a
reforma (fecha a vigência atual, abre uma nova sem apagar histórico) e o Ponto de Revisão da
FASE 2 (1/3): "mudar o parâmetro muda o comportamento sem deploy", provado consultando
`obter_regra_vigente` antes/depois da reforma e também num instante do passado."""
from datetime import datetime, timedelta

import pytest

from app.services.estatuto import obter_regra_vigente


def test_seed_traz_valores_reais_do_estatuto(client, auth_headers):
    resposta = client.get("/api/estatuto/regras", headers=auth_headers)
    assert resposta.status_code == 200
    por_parametro = {r["parametro"]: r for r in resposta.json()}

    assert por_parametro["QUORUM_1A_CONVOCACAO"]["valor"] == "2/3"
    assert por_parametro["QUORUM_1A_CONVOCACAO"]["artigo_origem"] == "Art. 6º"
    assert por_parametro["PROCURACAO_PERMITIDA"]["valor"] == "nao"
    assert por_parametro["DURACAO_MANDATO_ANOS"]["valor"] == "4"
    assert por_parametro["IDADE_MINIMA_FILIACAO_ANOS"]["valor"] == "18"
    assert por_parametro["IDADE_MINIMA_FILIACAO_COM_AUTORIZACAO_ANOS"]["valor"] == "16"
    assert por_parametro["QTD_SOCIOS_PROPONENTES_FILIACAO"]["valor"] == "3"
    assert por_parametro["QTD_MENSALIDADES_INADIMPLENCIA_EXCLUSAO"]["valor"] == "6"
    # nenhuma regra vigente tem vigencia_fim - "vigente" é sempre o topo em aberto
    assert all(r["vigencia_fim"] is None for r in por_parametro.values())


def test_historico_de_parametro_desconhecido_404(client, auth_headers):
    resposta = client.get("/api/estatuto/regras/PARAMETRO_QUE_NAO_EXISTE/historico", headers=auth_headers)
    assert resposta.status_code == 404


def test_reformar_regra_sem_autenticacao_falha(client):
    resposta = client.put("/api/estatuto/regras/DURACAO_MANDATO_ANOS", json={"valor": "5"})
    assert resposta.status_code == 401


def test_reformar_regra_fecha_vigencia_anterior_e_preserva_historico(client, auth_headers):
    antes = client.get("/api/estatuto/regras/QUORUM_3A_CONVOCACAO/historico", headers=auth_headers).json()
    assert len(antes) == 1
    assert antes[0]["valor"] == "1/4"

    resposta = client.put(
        "/api/estatuto/regras/QUORUM_3A_CONVOCACAO", headers=auth_headers,
        json={"valor": "1/5", "artigo_origem": "Art. 6º (reformado)"},
    )
    assert resposta.status_code == 200
    nova = resposta.json()
    assert nova["valor"] == "1/5"
    assert nova["vigencia_fim"] is None

    depois = client.get("/api/estatuto/regras/QUORUM_3A_CONVOCACAO/historico", headers=auth_headers).json()
    assert len(depois) == 2  # histórico preservado, não sobrescrito
    linha_antiga = next(r for r in depois if r["valor"] == "1/4")
    assert linha_antiga["vigencia_fim"] is not None  # fechada, não apagada

    vigente = client.get("/api/estatuto/regras", headers=auth_headers).json()
    valor_vigente = next(r["valor"] for r in vigente if r["parametro"] == "QUORUM_3A_CONVOCACAO")
    assert valor_vigente == "1/5"


def test_reformar_regra_gera_entrada_de_auditoria(client, auth_headers):
    client.put("/api/estatuto/regras/QUORUM_2A_CONVOCACAO", headers=auth_headers, json={"valor": "1/2"})
    auditoria = client.get("/api/auditoria/?limite=5", headers=auth_headers).json()
    entradas = [e for e in auditoria["entradas"] if e["tabela_afetada"] == "regras_estatutarias"]
    assert entradas, "esperava ao menos uma entrada de auditoria para regras_estatutarias"
    assert entradas[0]["acao"] == "REFORMA"


def test_mudar_parametro_muda_comportamento_sem_deploy(client, auth_headers, db):
    """Ponto de Revisão FASE 2 (1/3): nenhum número estatutário está em código - um fluxo que
    hoje consulte `obter_regra_vigente(db, "PROCURACAO_PERMITIDA")` muda de comportamento assim
    que a diretoria reformar o parâmetro pela API, sem qualquer alteração de código."""
    assert obter_regra_vigente(db, "PROCURACAO_PERMITIDA") == "nao"

    resposta = client.put("/api/estatuto/regras/PROCURACAO_PERMITIDA", headers=auth_headers, json={"valor": "sim"})
    assert resposta.status_code == 200

    assert obter_regra_vigente(db, "PROCURACAO_PERMITIDA") == "sim"
    # o passado continua auditável pela regra que valia então - mesma lógica de uma assembleia
    # antiga permanecer sob a regra vigente à época, mesmo depois de uma reforma futura.
    ha_um_ano = datetime.utcnow() - timedelta(days=365)
    assert obter_regra_vigente(db, "PROCURACAO_PERMITIDA", em=ha_um_ano) == "nao"


@pytest.mark.parametrize("parametro, valor", [
    ("QUORUM_1A_CONVOCACAO", "abc"),
    ("QUORUM_1A_CONVOCACAO", "2/0"),
    ("QUORUM_1A_CONVOCACAO", "5/3"),
    ("QUORUM_1A_CONVOCACAO", "0/3"),
    ("QUORUM_1A_CONVOCACAO", "2/3+"),
    ("QUORUM_1A_CONVOCACAO", "²/3"),
    ("DURACAO_MANDATO_ANOS", "0"),
    ("DURACAO_MANDATO_ANOS", "-1"),
    ("DURACAO_MANDATO_ANOS", "quatro"),
    ("DURACAO_MANDATO_ANOS", "4.5"),
    ("PROCURACAO_PERMITIDA", "talvez"),
    ("MESES_AGO_ESTATUTARIA", "13"),
    ("MESES_AGO_ESTATUTARIA", "0,8"),
    ("MESES_AGO_ESTATUTARIA", "2,2"),
    ("MESES_AGO_ESTATUTARIA", "fev,ago"),
])
def test_valor_que_quebraria_quem_le_a_regra_e_recusado_e_nada_muda(client, auth_headers, db, parametro, valor):
    # achado da v5.4d ao desenhar a tela de reforma: o servidor aceitava QUALQUER texto, e um quórum "abc" ou "2/0" derrubaria a
    # apuração de quórum (e a abertura de toda votação) até alguém reformar de novo.
    antes = client.get(f"/api/estatuto/regras/{parametro}/historico", headers=auth_headers).json()
    vigente_antes = obter_regra_vigente(db, parametro)

    resposta = client.put(f"/api/estatuto/regras/{parametro}", headers=auth_headers, json={"valor": valor})

    assert resposta.status_code == 422, resposta.text
    assert resposta.json()["detail"]
    assert client.get(f"/api/estatuto/regras/{parametro}/historico", headers=auth_headers).json() == antes
    assert obter_regra_vigente(db, parametro) == vigente_antes


@pytest.mark.parametrize("parametro, valor, guardado", [
    ("QUORUM_3A_CONVOCACAO", "1/4", "1/4"),
    ("QUORUM_2A_CONVOCACAO", "1/2+1", "1/2+1"),
    ("QUORUM_1A_CONVOCACAO", "2 / 3", "2/3"),
    ("DURACAO_MANDATO_ANOS", "4", "4"),
    ("PROCURACAO_PERMITIDA", "nao", "nao"),
    ("MESES_AGO_ESTATUTARIA", "2,8", "2,8"),
    ("MESES_AGO_ESTATUTARIA", "3", "3"),
    ("REGRA_DESEMPATE", "QUALQUER TEXTO LIVRE", "QUALQUER TEXTO LIVRE"),
])
def test_valor_valido_e_aceito_e_vira_a_regra_vigente(client, auth_headers, db, parametro, valor, guardado):
    original = obter_regra_vigente(db, parametro)
    try:
        resposta = client.put(f"/api/estatuto/regras/{parametro}", headers=auth_headers, json={"valor": valor})
        assert resposta.status_code == 200, resposta.text
        assert obter_regra_vigente(db, parametro) == guardado
    finally:
        client.put(f"/api/estatuto/regras/{parametro}", headers=auth_headers, json={"valor": original})
