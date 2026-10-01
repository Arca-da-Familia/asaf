"""v5.0 - o site institucional (https://asaf.org.br) chama a API do navegador para o dado
dinâmico das ilhas (eventos abertos, transparência), então a origem dele precisa estar no CORS.

Sem isso a ilha de eventos falharia em produção só no navegador - a API responderia 200, o
`curl` funcionaria, e o `fetch` do site seria bloqueado pelo navegador. Foi exatamente a
lacuna encontrada ao desenhar a v5.0: `GET /api/publico/eventos` já existia (v4.5), mas só o
painel estava liberado.
"""


def _cors(client, origem: str, caminho: str = "/api/publico/eventos"):
    return client.get(caminho, headers={"Origin": origem})


def test_site_institucional_pode_ler_eventos_publicos(client):
    r = _cors(client, "https://asaf.org.br")
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == "https://asaf.org.br"


def test_preflight_do_site_para_rota_publica(client):
    r = client.options(
        "/api/publico/eventos",
        headers={
            "Origin": "https://asaf.org.br",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == "https://asaf.org.br"


def test_dev_local_do_site_astro_tambem_liberado(client):
    r = _cors(client, "http://localhost:4321")
    assert r.headers.get("access-control-allow-origin") == "http://localhost:4321"


def test_painel_continua_liberado(client):
    r = _cors(client, "https://painel.asaf.org.br")
    assert r.headers.get("access-control-allow-origin") == "https://painel.asaf.org.br"


def test_origem_desconhecida_nao_e_liberada(client):
    """Liberar o site não pode virar liberar qualquer origem (nunca "*", ver app/main.py)."""
    r = _cors(client, "https://site-malicioso.example")
    assert "access-control-allow-origin" not in r.headers
