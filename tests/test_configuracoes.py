"""v0.3.4 - configuração institucional tipada. Cobre validação por tipo, auditoria na escrita
e o bloqueio de chave desconhecida (chaves são fixas, semeadas - nunca criadas via API)."""


def test_listar_configuracoes_traz_as_chaves_semeadas(client, auth_headers):
    resposta = client.get("/api/configuracoes/", headers=auth_headers)
    assert resposta.status_code == 200
    assert len(resposta.json()) == 25  # 13 v0.3.4 + PRAZO_EXPERIENCIA_DIAS (v1.2) + PRAZO_RETENCAO_DESLIGADO_DIAS (v1.4) + PRAZO_RECADASTRAMENTO_DIAS (v1.8) + DATA_MAGNA/VERSICULOS_BASE/ORACAO_OFICIAL (v2.0) + CHAVE_PIX/NOME_BENEFICIARIO_PIX/CIDADE_BENEFICIARIO_PIX (v3.2) + DIAS_LEMBRETE_MENSALIDADE (v3.2.1 adaptado) + DIAS_ATRASO_LEMBRETE (v3.2.2) + VALOR_MINIMO_EXIGE_COTACAO (v3.3)


def test_atualizar_configuracao_tipo_numero_valido(client, auth_headers):
    resposta = client.put("/api/configuracoes/TETO_ALCADA_FINANCEIRA", headers=auth_headers, json={"valor": "2500"})
    assert resposta.status_code == 200
    assert client.get("/api/configuracoes/TETO_ALCADA_FINANCEIRA", headers=auth_headers).json()["valor"] == "2500"


def test_atualizar_configuracao_tipo_numero_invalido(client, auth_headers):
    resposta = client.put("/api/configuracoes/TETO_ALCADA_FINANCEIRA", headers=auth_headers, json={"valor": "não é número"})
    assert resposta.status_code == 422


def test_atualizar_configuracao_tipo_cor_invalida(client, auth_headers):
    resposta = client.put("/api/configuracoes/COR_PRIMARIA", headers=auth_headers, json={"valor": "vermelho"})
    assert resposta.status_code == 422


def test_atualizar_configuracao_tipo_email_invalido(client, auth_headers):
    resposta = client.put("/api/configuracoes/EMAIL_REMETENTE", headers=auth_headers, json={"valor": "não-e-email"})
    assert resposta.status_code == 422


def test_atualizar_chave_inexistente_404(client, auth_headers):
    resposta = client.put("/api/configuracoes/CHAVE_QUE_NAO_EXISTE", headers=auth_headers, json={"valor": "x"})
    assert resposta.status_code == 404


def test_atualizar_configuracao_gera_entrada_de_auditoria(client, auth_headers):
    client.put("/api/configuracoes/FUSO_HORARIO", headers=auth_headers, json={"valor": "America/Bahia"})
    auditoria = client.get("/api/auditoria/?limite=5", headers=auth_headers).json()
    entradas = [e for e in auditoria["entradas"] if e["tabela_afetada"] == "configuracoes_institucionais"]
    assert entradas, "esperava ao menos uma entrada de auditoria para configuracoes_institucionais"
    assert entradas[0]["acao"] == "UPDATE"


def test_atualizar_configuracao_sem_autenticacao_falha(client):
    resposta = client.put("/api/configuracoes/FUSO_HORARIO", json={"valor": "x"})
    assert resposta.status_code == 401
