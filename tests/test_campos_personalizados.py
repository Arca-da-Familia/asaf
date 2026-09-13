"""v0.3.3 - campos personalizados sem deploy. Cobre criação de definição, validação por tipo e
o ciclo de escrita/leitura de valor por registro."""
import uuid


def test_criar_definicao_e_listar(client, auth_headers):
    rotulo = f"Campo teste {uuid.uuid4().hex[:6]}"
    resposta = client.post(
        "/api/campos-personalizados/", headers=auth_headers,
        json={"entidade": "associado", "rotulo": rotulo, "tipo": "texto", "obrigatorio": False},
    )
    assert resposta.status_code == 200, resposta.text
    id_definicao = resposta.json()["id_definicao"]

    listagem = client.get("/api/campos-personalizados/associado", headers=auth_headers)
    assert any(d["id_definicao"] == id_definicao for d in listagem.json())


def test_campo_numero_recusa_valor_nao_numerico(client, auth_headers):
    definicao = client.post(
        "/api/campos-personalizados/", headers=auth_headers,
        json={"entidade": "associado", "rotulo": "Idade teste", "tipo": "numero"},
    ).json()

    resposta = client.put(
        f"/api/campos-personalizados/associado/1/valores", headers=auth_headers,
        json={"valores": [{"id_definicao": definicao["id_definicao"], "valor": "não é número"}]},
    )
    assert resposta.status_code == 422


def test_campo_numero_aceita_valor_valido_e_le_de_volta(client, auth_headers):
    definicao = client.post(
        "/api/campos-personalizados/", headers=auth_headers,
        json={"entidade": "associado", "rotulo": "Peso teste", "tipo": "numero"},
    ).json()
    id_definicao = definicao["id_definicao"]
    id_registro = 42

    escrita = client.put(
        f"/api/campos-personalizados/associado/{id_registro}/valores", headers=auth_headers,
        json={"valores": [{"id_definicao": id_definicao, "valor": "73.5"}]},
    )
    assert escrita.status_code == 200, escrita.text

    leitura = client.get(f"/api/campos-personalizados/associado/{id_registro}/valores", headers=auth_headers)
    assert leitura.json()[str(id_definicao)] == "73.5"


def test_campo_obrigatorio_recusa_valor_vazio(client, auth_headers):
    definicao = client.post(
        "/api/campos-personalizados/", headers=auth_headers,
        json={"entidade": "associado", "rotulo": "Campo obrigatório teste", "tipo": "texto", "obrigatorio": True},
    ).json()

    resposta = client.put(
        "/api/campos-personalizados/associado/1/valores", headers=auth_headers,
        json={"valores": [{"id_definicao": definicao["id_definicao"], "valor": ""}]},
    )
    assert resposta.status_code == 422


def test_campo_selecao_exige_catalogo(client, auth_headers):
    resposta = client.post(
        "/api/campos-personalizados/", headers=auth_headers,
        json={"entidade": "associado", "rotulo": "Seleção sem catálogo", "tipo": "selecao"},
    )
    assert resposta.status_code == 422
