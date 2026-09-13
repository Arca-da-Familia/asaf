def test_pagina_inicial_responde(client):
    resposta = client.get("/")
    assert resposta.status_code == 200


def test_login_exige_autenticacao_em_rota_protegida(client):
    resposta = client.get("/api/configuracoes/")
    assert resposta.status_code == 401


def test_admin_token_funciona(client, auth_headers):
    resposta = client.get("/api/configuracoes/", headers=auth_headers)
    assert resposta.status_code == 200
    assert len(resposta.json()) == 15  # 13 v0.3.4 + PRAZO_EXPERIENCIA_DIAS (v1.2) + PRAZO_RETENCAO_DESLIGADO_DIAS (v1.4)
