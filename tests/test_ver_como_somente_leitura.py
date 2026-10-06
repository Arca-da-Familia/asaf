"""v5.4d (achado ao vivo na homologação): no modo "ver como" a escrita é recusada (403, "somente leitura"), mas essa recusa saía do
intermediário que ficava POR FORA do CORS, sem os cabeçalhos de acesso: o navegador (painel e API em endereços diferentes) não deixava a
tela ler a resposta, o `fetch` falhava e o painel dizia "Sem conexão com o servidor" em vez da explicação."""
from app.models.core import NivelAcesso, Usuario
from app.security import criar_access_token

ORIGEM_DO_PAINEL = "https://painel.asaf.org.br"


def _cabecalho_ver_como(client, auth_headers, db) -> dict:
    id_usuario = client.get("/auth/me", headers=auth_headers).json()["id_usuario"]
    usuario = db.query(Usuario).filter(Usuario.id_usuario == id_usuario).first()
    nivel = db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == "Associado").first()
    token = criar_access_token(usuario, id_nivel_impersonado=nivel.id_nivel)
    return {"Authorization": f"Bearer {token}", "Origin": ORIGEM_DO_PAINEL}


def test_escrita_no_ver_como_e_recusada_e_a_recusa_leva_os_cabecalhos_de_cors(client, auth_headers, db):
    cabecalho = _cabecalho_ver_como(client, auth_headers, db)

    r = client.post("/api/mandatos/", headers=cabecalho, json={"id_associado": 1, "orgao_codigo": "X", "cargo_codigo": "Y", "data_inicio": "2026-01-01"})

    assert r.status_code == 403
    assert "somente leitura" in r.json()["detail"]
    # sem estes cabeçalhos o navegador esconde a resposta da tela ("Failed to fetch")
    assert r.headers.get("access-control-allow-origin") == ORIGEM_DO_PAINEL
    assert r.headers.get("access-control-allow-credentials") == "true"


def test_leitura_no_ver_como_continua_funcionando_com_cors(client, auth_headers, db):
    cabecalho = _cabecalho_ver_como(client, auth_headers, db)

    r = client.get("/auth/me", headers=cabecalho)

    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == ORIGEM_DO_PAINEL
