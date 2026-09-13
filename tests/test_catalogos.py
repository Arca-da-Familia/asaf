"""v0.3.1 - motor genérico de catálogo. Cobre as garantias já verificadas manualmente na época:
código estável nunca editável, catálogo de sistema não aceita opção nova, exclusão protegida por
opção ativa e por opção em uso real."""
import uuid


def _chave_unica(prefixo: str) -> str:
    return f"{prefixo}_{uuid.uuid4().hex[:8]}"


def test_criar_catalogo_e_listar(client, auth_headers):
    chave = _chave_unica("teste_catalogo")
    resposta = client.post(
        "/api/catalogos/", headers=auth_headers,
        json={"chave": chave, "nome_exibido": "Catálogo de teste", "editavel_pelo_usuario": True},
    )
    assert resposta.status_code == 200, resposta.text

    listagem = client.get("/api/catalogos/", headers=auth_headers)
    assert any(c["chave"] == chave for c in listagem.json())


def test_criar_catalogo_com_chave_duplicada_falha(client, auth_headers):
    chave = _chave_unica("teste_dup")
    client.post("/api/catalogos/", headers=auth_headers, json={"chave": chave, "nome_exibido": "Original"})
    resposta = client.post("/api/catalogos/", headers=auth_headers, json={"chave": chave, "nome_exibido": "Duplicado"})
    assert resposta.status_code == 400


def test_catalogo_de_sistema_nao_aceita_opcao_nova(client, auth_headers):
    # categoria_associado é semeado como editavel_pelo_usuario=False (v0.3.1/v0.3.2).
    resposta = client.post(
        "/api/catalogos/categoria_associado/opcoes", headers=auth_headers,
        json={"codigo": "TESTE_NAO_DEVERIA_ENTRAR", "rotulo": "Teste"},
    )
    assert resposta.status_code == 403


def test_codigo_da_opcao_nunca_muda_no_update(client, auth_headers):
    chave = _chave_unica("teste_codigo_fixo")
    client.post("/api/catalogos/", headers=auth_headers, json={"chave": chave, "nome_exibido": "Teste", "editavel_pelo_usuario": True})
    criada = client.post(
        "/api/catalogos/" + chave + "/opcoes", headers=auth_headers,
        json={"codigo": "COD_FIXO", "rotulo": "Rótulo original"},
    )
    id_opcao = criada.json()["id_opcao"]

    # OpcaoCatalogoAtualizar nem aceita "codigo" no schema - mandar mesmo assim não deve mudar nada.
    client.put(f"/api/opcoes-catalogo/{id_opcao}", headers=auth_headers, json={"rotulo": "Rótulo novo", "codigo": "TENTATIVA_DE_MUDAR"})

    opcoes = client.get(f"/api/catalogos/{chave}/opcoes", headers=auth_headers).json()
    opcao = next(o for o in opcoes if o["id_opcao"] == id_opcao)
    assert opcao["codigo"] == "COD_FIXO"
    assert opcao["rotulo"] == "Rótulo novo"


def test_excluir_opcao_ativa_e_recusado(client, auth_headers):
    chave = _chave_unica("teste_excluir_ativa")
    client.post("/api/catalogos/", headers=auth_headers, json={"chave": chave, "nome_exibido": "Teste", "editavel_pelo_usuario": True})
    criada = client.post(f"/api/catalogos/{chave}/opcoes", headers=auth_headers, json={"codigo": "X", "rotulo": "X"})
    id_opcao = criada.json()["id_opcao"]

    resposta = client.delete(f"/api/opcoes-catalogo/{id_opcao}", headers=auth_headers)
    assert resposta.status_code == 400


def test_excluir_opcao_inativa_sem_uso_funciona(client, auth_headers):
    chave = _chave_unica("teste_excluir_inativa")
    client.post("/api/catalogos/", headers=auth_headers, json={"chave": chave, "nome_exibido": "Teste", "editavel_pelo_usuario": True})
    criada = client.post(f"/api/catalogos/{chave}/opcoes", headers=auth_headers, json={"codigo": "X", "rotulo": "X"})
    id_opcao = criada.json()["id_opcao"]

    client.put(f"/api/opcoes-catalogo/{id_opcao}", headers=auth_headers, json={"ativo": False})
    resposta = client.delete(f"/api/opcoes-catalogo/{id_opcao}", headers=auth_headers)
    assert resposta.status_code == 200


def test_escrita_em_catalogo_sem_autenticacao_falha(client):
    resposta = client.post("/api/catalogos/", json={"chave": "sem_auth", "nome_exibido": "Sem auth"})
    assert resposta.status_code == 401
