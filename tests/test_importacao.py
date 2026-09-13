"""v1.3 - importação em lote (dedup por CPF exato e nome+nascimento, lote desfazível) e
exportação de dados pessoais (permissão própria, auditada)."""
from tests.test_pessoas import _cpf_unico


def test_verificar_duplicidade_cpf_exato(client, auth_headers):
    cpf = _cpf_unico()
    client.post(
        "/associados-master/",
        json={
            "nome_completo": "Pessoa Existente", "cpf": cpf, "email_contato": "x@x.com",
            "telefone_whatsapp": "11900000000", "categoria": "Efetivo",
            "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
            "cidade": "Sao Paulo", "estado": "SP",
        },
    )
    resposta = client.post(
        "/api/associados/verificar-duplicidade", headers=auth_headers,
        json={"linhas": [{"nome_completo": "Outro Nome Qualquer", "cpf": cpf}]},
    )
    assert resposta.status_code == 200
    assert resposta.json()["resultados"][0]["tipo"] == "cpf_exato"


def test_verificar_duplicidade_nome_e_nascimento(client, auth_headers):
    client.post(
        "/associados-master/",
        json={
            "nome_completo": "João da Silva Sauro", "cpf": _cpf_unico(), "email_contato": "x@x.com",
            "telefone_whatsapp": "11900000000", "categoria": "Efetivo",
            "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
            "cidade": "Sao Paulo", "estado": "SP", "data_nascimento": "1990-05-10",
        },
    )
    resposta = client.post(
        "/api/associados/verificar-duplicidade", headers=auth_headers,
        json={"linhas": [{"nome_completo": "joao da silva sauro", "cpf": _cpf_unico(), "data_nascimento": "1990-05-10"}]},
    )
    assert resposta.json()["resultados"][0]["tipo"] == "nome_e_nascimento"


def test_importar_lote_cria_associados_com_matricula(client, auth_headers):
    linhas = [
        {"nome_completo": "Lote Um", "cpf": _cpf_unico(), "categoria": "Efetivo", "resolucao": "nova"},
        {"nome_completo": "Lote Dois", "cpf": _cpf_unico(), "categoria": "Efetivo", "resolucao": "nova"},
    ]
    resposta = client.post("/api/associados/importar-lote", headers=auth_headers, json={"linhas": linhas})
    assert resposta.status_code == 200, resposta.text
    corpo = resposta.json()
    assert corpo["criados"] == 2
    assert corpo["ignorados"] == 0
    assert corpo["erros"] == []
    assert corpo["id_lote"] > 0


def test_importar_lote_com_duplicidade_gera_erro_e_nao_trava_o_resto(client, auth_headers):
    cpf_existente = _cpf_unico()
    client.post(
        "/associados-master/",
        json={
            "nome_completo": "Já Cadastrado", "cpf": cpf_existente, "email_contato": "x@x.com",
            "telefone_whatsapp": "11900000000", "categoria": "Efetivo",
            "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
            "cidade": "Sao Paulo", "estado": "SP",
        },
    )
    linhas = [
        {"nome_completo": "Duplicado", "cpf": cpf_existente, "categoria": "Efetivo", "resolucao": "nova"},
        {"nome_completo": "Linha Boa", "cpf": _cpf_unico(), "categoria": "Efetivo", "resolucao": "nova"},
    ]
    resposta = client.post("/api/associados/importar-lote", headers=auth_headers, json={"linhas": linhas})
    corpo = resposta.json()
    assert corpo["criados"] == 1
    assert len(corpo["erros"]) == 1
    assert corpo["erros"][0]["indice"] == 0


def test_importar_lote_ignorar_linha(client, auth_headers):
    linhas = [{"nome_completo": "Vou Ser Ignorado", "cpf": _cpf_unico(), "resolucao": "ignorar"}]
    resposta = client.post("/api/associados/importar-lote", headers=auth_headers, json={"linhas": linhas})
    corpo = resposta.json()
    assert corpo["criados"] == 0
    assert corpo["ignorados"] == 1


def test_desfazer_lote_remove_associados_criados(client, auth_headers):
    linhas = [{"nome_completo": "Desfazer Teste", "cpf": _cpf_unico(), "categoria": "Efetivo", "resolucao": "nova"}]
    importado = client.post("/api/associados/importar-lote", headers=auth_headers, json={"linhas": linhas}).json()
    id_lote = importado["id_lote"]

    resposta = client.post(f"/api/associados/importar-lote/{id_lote}/desfazer", headers=auth_headers)
    assert resposta.status_code == 200, resposta.text

    busca = client.get("/api/associados/busca-simples").json()
    assert not any(a["nome_completo"] == "Desfazer Teste" for a in busca)

    segunda_vez = client.post(f"/api/associados/importar-lote/{id_lote}/desfazer", headers=auth_headers)
    assert segunda_vez.status_code == 400


def test_exportar_funciona_para_quem_tem_a_permissao(client, auth_headers):
    resposta = client.get("/api/associados/exportar?colunas=nome_completo,cpf", headers=auth_headers)
    assert resposta.status_code == 200, resposta.text
    corpo = resposta.json()
    assert corpo["colunas"] == ["nome_completo", "cpf"]
    assert isinstance(corpo["linhas"], list)


def test_exportar_e_negado_para_nivel_sem_a_permissao_propria(client, auth_headers):
    # Diretoria (id_nivel=2 no seed padrão) tem "associados" mas NÃO "exportar_dados_pessoais"
    # de propósito (v1.3 - permissão separada, mais restrita) - "ver como" Diretoria confirma
    # que o próprio nível não alcança a exportação, sem precisar criar um segundo usuário.
    impersonar = client.post("/auth/impersonar/2", headers=auth_headers)
    assert impersonar.status_code == 200, impersonar.text
    token_impersonado = impersonar.json()["access_token"]
    resposta = client.get(
        "/api/associados/exportar?colunas=nome_completo",
        headers={"Authorization": f"Bearer {token_impersonado}"},
    )
    assert resposta.status_code == 403


def test_exportar_coluna_desconhecida_e_recusada(client, auth_headers):
    resposta = client.get("/api/associados/exportar?colunas=nome_completo,senha_hash", headers=auth_headers)
    assert resposta.status_code == 422


def test_exportar_sem_autenticacao_falha(client):
    resposta = client.get("/api/associados/exportar?colunas=nome_completo")
    assert resposta.status_code == 401
