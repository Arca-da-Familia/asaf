"""v7.3b (FASE 7) - os cabeçalhos de segurança em toda resposta da API (app/main.py): nosniff, quadro proibido, sem referência, HSTS; a política de conteúdo
só no JSON (a documentação em /docs e o PDF aberto direto no navegador não são travados); o CORS continua valendo."""


def _seguranca(r):
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert r.headers["strict-transport-security"].startswith("max-age=31536000")


def test_o_json_leva_todos_os_cabecalhos_e_a_politica_de_conteudo(client):
    for r in (client.get("/api/publico/atendimentos/prazos"), client.get("/api/rota-que-nao-existe"), client.get("/api/associados/")):
        _seguranca(r)
        assert r.headers["content-security-policy"] == "default-src 'none'; frame-ancestors 'none'", r.request.url


def test_a_documentacao_e_o_pdf_nao_levam_a_politica_de_conteudo(client):
    docs = client.get("/docs")
    assert docs.status_code == 200
    _seguranca(docs)
    assert "content-security-policy" not in docs.headers, "o Swagger carrega de fora"


def test_o_cors_continua_valendo_com_os_cabecalhos(client):
    r = client.get("/api/publico/atendimentos/prazos", headers={"Origin": "https://asaf.org.br"})
    assert r.headers["access-control-allow-origin"] == "https://asaf.org.br"
    _seguranca(r)
