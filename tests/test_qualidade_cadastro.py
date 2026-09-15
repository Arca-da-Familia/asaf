"""v1.8 (FASE 1) - qualidade permanente da base: recadastramento periódico, detector de
duplicidade contínuo (fila de revisão, nunca mescla sozinho), mesclagem com confirmação nomeada
e higienização de contato."""
from datetime import date, timedelta

from app.models.associados import Associado
from app.models.pessoas import Pessoa
from tests.test_pessoas import _cpf_unico


def _criar_associado(client, **overrides):
    cpf = _cpf_unico()
    payload = {
        # v1.8 - nome (e e-mail) únicos por padrão: o novo bloqueio de cadastro duplicado
        # (nome + outro dado pessoal batendo) trataria duas chamadas com o mesmo nome e mesmo
        # telefone como a mesma pessoa de propósito - é exatamente o que a v1.8 pediu.
        "nome_completo": f"Pessoa Qualidade Cadastro {cpf[-4:]}", "cpf": cpf, "email_contato": f"{cpf}@x.com",
        "telefone_whatsapp": "11900000000", "categoria": "Efetivo",
        "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
        "cidade": "Sao Paulo", "estado": "SP",
        **overrides,
    }
    return client.post("/associados-master/", json=payload).json()


# ---------------------------------------------------------------------------
# Recadastramento periódico
# ---------------------------------------------------------------------------
def test_confirmar_dados_registra_data_e_aparece_na_ficha_360(client, auth_headers):
    meu_id_associado = client.get("/auth/me", headers=auth_headers).json()["id_associado"]

    antes = client.get(f"/api/associados/{meu_id_associado}/ficha-360", headers=auth_headers).json()
    assert antes["dados"]["recadastramento_pendente"] is True  # nunca confirmado ainda

    r = client.post("/auth/perfil/confirmar-dados", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["data_ultima_confirmacao"] is not None

    depois = client.get(f"/api/associados/{meu_id_associado}/ficha-360", headers=auth_headers).json()
    assert depois["dados"]["recadastramento_pendente"] is False
    assert depois["dados"]["data_ultima_confirmacao"] is not None


# ---------------------------------------------------------------------------
# Detector de duplicidade contínuo + fila de revisão
# ---------------------------------------------------------------------------
def test_escanear_duplicidade_fluxo_completo(client, auth_headers, db):
    titular = _criar_associado(client)
    id_pessoa_titular = db.query(Associado).filter(Associado.id_associado == titular["id_associado"]).first().id_pessoa

    dados_comuns = {"data_nascimento": "2000-06-15", "grau_parentesco": "OUTRO"}
    r1 = client.post(
        f"/api/pessoas/{id_pessoa_titular}/dependentes", headers=auth_headers,
        json={"nome_completo": "Nome Igual Nascimento Igual", **dados_comuns},
    )
    r2 = client.post(
        f"/api/pessoas/{id_pessoa_titular}/dependentes", headers=auth_headers,
        json={"nome_completo": "nome igual nascimento igual", **dados_comuns},  # mesmo nome, caixa/acento diferentes
    )
    id_a = r1.json()["id_pessoa_vinculada"]
    id_b = r2.json()["id_pessoa_vinculada"]

    escaneio = client.post("/api/pessoas/duplicidade/escanear", headers=auth_headers)
    assert escaneio.status_code == 200
    assert escaneio.json()["novos"] >= 1

    fila = client.get("/api/pessoas/fila-revisao", headers=auth_headers).json()
    par = next(
        (i for i in fila if {i["id_pessoa_a"], i["id_pessoa_b"]} == {id_a, id_b}), None,
    )
    assert par is not None
    assert par["tipo_sinal"] == "duplicidade_nome_nascimento"

    # Rodar de novo não duplica a mesma entrada pendente.
    escaneio2 = client.post("/api/pessoas/duplicidade/escanear", headers=auth_headers)
    fila_depois = client.get("/api/pessoas/fila-revisao", headers=auth_headers).json()
    quantidade_do_par = sum(1 for i in fila_depois if {i["id_pessoa_a"], i["id_pessoa_b"]} == {id_a, id_b})
    assert quantidade_do_par == 1


def test_ignorar_item_da_fila(client, auth_headers, db):
    titular = _criar_associado(client)
    id_pessoa_titular = db.query(Associado).filter(Associado.id_associado == titular["id_associado"]).first().id_pessoa
    dados_comuns = {"data_nascimento": "1999-03-03", "grau_parentesco": "OUTRO"}
    client.post(f"/api/pessoas/{id_pessoa_titular}/dependentes", headers=auth_headers, json={"nome_completo": "Par Ignorado A", **dados_comuns})
    client.post(f"/api/pessoas/{id_pessoa_titular}/dependentes", headers=auth_headers, json={"nome_completo": "Par Ignorado A", **dados_comuns})
    client.post("/api/pessoas/duplicidade/escanear", headers=auth_headers)

    fila = client.get("/api/pessoas/fila-revisao", headers=auth_headers).json()
    item = next(i for i in fila if i["nome_pessoa_a"] == "Par Ignorado A" or i["nome_pessoa_b"] == "Par Ignorado A")

    r = client.post(f"/api/pessoas/fila-revisao/{item['id_fila']}/ignorar", headers=auth_headers)
    assert r.status_code == 200

    fila_pendente = client.get("/api/pessoas/fila-revisao?status=pendente", headers=auth_headers).json()
    assert all(i["id_fila"] != item["id_fila"] for i in fila_pendente)


# ---------------------------------------------------------------------------
# Mesclagem
# ---------------------------------------------------------------------------
def test_mesclar_pessoas_preserva_historico_e_apaga_absorvida(client, auth_headers, db):
    titular = _criar_associado(client)
    id_pessoa_titular = db.query(Associado).filter(Associado.id_associado == titular["id_associado"]).first().id_pessoa

    criado_a = client.post(
        f"/api/pessoas/{id_pessoa_titular}/dependentes", headers=auth_headers,
        json={"nome_completo": "Duplicata Para Mesclar", "data_nascimento": "1995-07-07", "grau_parentesco": "OUTRO"},
    ).json()
    id_pessoa_mantida = criado_a["id_pessoa_vinculada"]

    id_pessoa_absorvida = db.query(Pessoa).filter(Pessoa.nome_completo == "Fulano Absorvido").first()
    if id_pessoa_absorvida is None:
        pessoa_absorvida = Pessoa(nome_completo="Fulano Absorvido", email_contato="absorvido@x.com")
        db.add(pessoa_absorvida)
        db.commit()
        db.refresh(pessoa_absorvida)
        id_pessoa_absorvida = pessoa_absorvida
    id_pessoa_absorvida = id_pessoa_absorvida.id_pessoa

    r_errado = client.post(
        f"/api/pessoas/{id_pessoa_mantida}/mesclar", headers=auth_headers,
        json={"id_pessoa_absorvida": id_pessoa_absorvida, "nome_confirmacao": "Nome Errado"},
    )
    assert r_errado.status_code == 400

    r = client.post(
        f"/api/pessoas/{id_pessoa_mantida}/mesclar", headers=auth_headers,
        json={"id_pessoa_absorvida": id_pessoa_absorvida, "nome_confirmacao": "Fulano Absorvido"},
    )
    assert r.status_code == 200, r.text

    ainda_existe = db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa_absorvida).first()
    assert ainda_existe is None

    mantida = db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa_mantida).first()
    assert mantida.email_contato == "absorvido@x.com"  # preencheu o campo que estava vazio


def test_mesclar_duas_pessoas_ja_associado_bloqueado_de_verdade(client, auth_headers, db):
    a = _criar_associado(client, nome_completo="Associado Bloqueio Um")
    b = _criar_associado(client, nome_completo="Associado Bloqueio Dois")
    id_pessoa_a = db.query(Associado).filter(Associado.id_associado == a["id_associado"]).first().id_pessoa
    id_pessoa_b = db.query(Associado).filter(Associado.id_associado == b["id_associado"]).first().id_pessoa

    r = client.post(
        f"/api/pessoas/{id_pessoa_a}/mesclar", headers=auth_headers,
        json={"id_pessoa_absorvida": id_pessoa_b, "nome_confirmacao": "Associado Bloqueio Dois"},
    )
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# Higienização de contato
# ---------------------------------------------------------------------------
def test_higienizar_contatos_marca_telefone_invalido(client, auth_headers, db):
    associado = _criar_associado(client, telefone_whatsapp="11900000000")
    id_pessoa = db.query(Associado).filter(Associado.id_associado == associado["id_associado"]).first().id_pessoa
    pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa).first()
    pessoa.telefone_whatsapp = "123"  # inválido, gravado direto no banco (sem passar pelo validador de escrita)
    db.commit()

    r = client.post("/api/pessoas/higienizar-contatos", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["novos"] >= 1

    db.refresh(pessoa)
    assert pessoa.contato_suspeito is True

    fila = client.get("/api/pessoas/fila-revisao", headers=auth_headers).json()
    assert any(i["id_pessoa_a"] == id_pessoa and i["tipo_sinal"] == "contato_telefone_invalido" for i in fila)


def test_marcar_email_suspeito_manualmente(client, auth_headers, db):
    associado = _criar_associado(client)
    id_pessoa = db.query(Associado).filter(Associado.id_associado == associado["id_associado"]).first().id_pessoa

    r = client.post(
        f"/api/pessoas/{id_pessoa}/marcar-contato-suspeito", headers=auth_headers,
        json={"motivo": "E-mail voltou (bounce) - reportado pela secretaria."},
    )
    assert r.status_code == 200, r.text

    pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa).first()
    assert pessoa.contato_suspeito is True
