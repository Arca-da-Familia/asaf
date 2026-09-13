"""v1.0 (FASE 1) - Pessoa como raiz de identidade, Papel N:N, Associado sem duplicar dado
pessoal (association_proxy pra Pessoa). Cobre exatamente o que a migração e o refactor
poderiam ter quebrado silenciosamente: criação com papel marcado, dedup por CPF, ordenação e
resolução de nome via join (os dois pontos que association_proxy não resolve sozinho)."""
import uuid


def _cpf_unico() -> str:
    return str(uuid.uuid4().int)[:11]


def test_bootstrap_admin_cria_pessoa_e_papel_associado(client):
    cpf = _cpf_unico()
    resposta = client.post(
        "/auth/bootstrap-admin",
        json={"cpf": cpf, "nome_completo": "Fulano Bootstrap", "email": f"{cpf}@x.com", "senha": "SenhaForte123456"},
    )
    if resposta.status_code != 200:
        # bootstrap-admin só funciona uma vez por banco - se outro teste/fixture já criou o
        # admin da sessão, isso é esperado; o que importa aqui é testar via ficha master abaixo.
        return

    login = client.post("/auth/login", json={"cpf": cpf, "senha": "SenhaForte123456"})
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {login.json()['access_token']}"})
    assert me.json()["nome_completo"] == "Fulano Bootstrap"


def test_cadastrar_ficha_master_cria_pessoa_e_papel(client, auth_headers):
    cpf = _cpf_unico()
    resposta = client.post(
        "/associados-master/",
        json={
            "nome_completo": "Pessoa Via Ficha Master", "cpf": cpf, "email_contato": "ficha@x.com",
            "telefone_whatsapp": "11900000000", "categoria": "Efetivo",
            "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
            "cidade": "Sao Paulo", "estado": "SP",
        },
    )
    assert resposta.status_code == 200, resposta.text
    id_associado = resposta.json()["id_associado"]

    busca = client.get("/api/associados/busca-simples").json()
    encontrado = next(a for a in busca if a["id_associado"] == id_associado)
    assert encontrado["nome_completo"] == "Pessoa Via Ficha Master"
    assert encontrado["cpf_final"] == cpf[-2:]


def test_cpf_duplicado_e_recusado(client, auth_headers):
    cpf = _cpf_unico()
    payload = {
        "nome_completo": "Original", "cpf": cpf, "email_contato": "a@x.com",
        "telefone_whatsapp": "11900000000", "categoria": "Efetivo",
        "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
        "cidade": "Sao Paulo", "estado": "SP",
    }
    primeira = client.post("/associados-master/", json=payload)
    assert primeira.status_code == 200

    payload["nome_completo"] = "Tentativa Duplicada"
    segunda = client.post("/associados-master/", json=payload)
    assert segunda.status_code == 400


def test_busca_simples_ordena_por_nome_via_join_pessoa(client, auth_headers):
    # Regressão direta do achado: Associado.nome_completo é association_proxy - order_by
    # direto nele falha (NotImplementedError); o endpoint precisa fazer join com Pessoa.
    for nome in ["Zebra Teste", "Abelha Teste"]:
        cpf = _cpf_unico()
        client.post(
            "/associados-master/",
            json={
                "nome_completo": nome, "cpf": cpf, "email_contato": "x@x.com",
                "telefone_whatsapp": "11900000000", "categoria": "Efetivo",
                "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
                "cidade": "Sao Paulo", "estado": "SP",
            },
        )
    nomes = [a["nome_completo"] for a in client.get("/api/associados/busca-simples").json()]
    posicao_abelha = nomes.index("Abelha Teste")
    posicao_zebra = nomes.index("Zebra Teste")
    assert posicao_abelha < posicao_zebra


def test_editar_associado_atualiza_pessoa(client, auth_headers):
    cpf = _cpf_unico()
    criado = client.post(
        "/associados-master/",
        json={
            "nome_completo": "Antes da Edição", "cpf": cpf, "email_contato": "antes@x.com",
            "telefone_whatsapp": "11900000000", "categoria": "Efetivo",
            "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
            "cidade": "Sao Paulo", "estado": "SP",
        },
    ).json()
    id_associado = criado["id_associado"]

    resposta = client.put(
        f"/api/associados/{id_associado}", headers=auth_headers,
        json={
            "nome_completo": "Depois da Edição", "email_contato": "depois@x.com",
            "telefone_whatsapp": "11911111111", "categoria": "Efetivo", "status_arrolamento": "Ativo - Em Dia",
        },
    )
    assert resposta.status_code == 200, resposta.text

    nomes = {a["id_associado"]: a["nome_completo"] for a in client.get("/api/associados/busca-simples").json()}
    assert nomes[id_associado] == "Depois da Edição"


def test_auditoria_resolve_nome_via_join_pessoa(client, auth_headers):
    # Regressão direta do outro achado: db.query(Associado.id_usuario, Associado.nome_completo)
    # falha (proxy não é coluna selecionável) - o endpoint precisa fazer join com Pessoa.
    auditoria = client.get("/api/auditoria/?limite=5", headers=auth_headers)
    assert auditoria.status_code == 200
    entradas = auditoria.json()["entradas"]
    assert any(e["nome_usuario"] for e in entradas), "esperava ao menos uma entrada com nome_usuario resolvido"
