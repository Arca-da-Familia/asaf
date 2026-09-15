"""v2.0 (FASE 2) - RegraEstatutaria: cobre o seed com os valores reais do ESTATUTO_ASAF.txt, a
reforma (fecha a vigência atual, abre uma nova sem apagar histórico) e o Ponto de Revisão da
FASE 2 (1/3): "mudar o parâmetro muda o comportamento sem deploy", provado consultando
`obter_regra_vigente` antes/depois da reforma e também num instante do passado."""
from datetime import datetime, timedelta

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
