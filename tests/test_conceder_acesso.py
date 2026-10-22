"""v3.0.1 (achado 2026-09-15) - cadastrar ficha nunca deu login pro associado; este é o teste
do endpoint que fecha esse buraco (`POST /api/associados/{id}/conceder-acesso`), a senha
provisória forçando troca no primeiro login, e o novo mínimo de senha (8 caracteres, reduzido
de 10)."""
from tests.test_pessoas import _cpf_unico
from tests.apoio_auth import cabecalho_admin

_PAYLOAD_BASE = {
    "email_contato": "x@x.com", "telefone_whatsapp": "11900000000", "categoria": "Efetivo",
    "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
    "cidade": "Sao Paulo", "estado": "SP",
}


def _criar_ficha(client, **overrides):
    cpf = _cpf_unico()
    payload = {**_PAYLOAD_BASE, "nome_completo": f"Pessoa Teste Acesso {cpf[-8:]}", "cpf": cpf, "email_contato": f"{cpf}@x.com", **overrides}
    resposta = client.post("/associados-master/", json=payload, headers=cabecalho_admin(client))
    assert resposta.status_code == 200, resposta.text
    return resposta.json()["id_associado"], cpf


def test_listar_associados_exige_permissao_e_mostra_tem_acesso(client, auth_headers):
    assert client.get("/api/associados/").status_code == 401

    id_associado, cpf = _criar_ficha(client)
    listagem = client.get("/api/associados/", headers=auth_headers).json()
    item = next(a for a in listagem if a["id_associado"] == id_associado)
    assert item["tem_acesso"] is False

    client.post(
        f"/api/associados/{id_associado}/conceder-acesso",
        json={"email": f"{cpf}@lista.example.com", "senha_provisoria": "Provisoria1"},
        headers=auth_headers,
    )
    listagem = client.get("/api/associados/", headers=auth_headers).json()
    item = next(a for a in listagem if a["id_associado"] == id_associado)
    assert item["tem_acesso"] is True


def test_conceder_acesso_exige_permissao(client):
    id_associado, _ = _criar_ficha(client)
    r = client.post(f"/api/associados/{id_associado}/conceder-acesso", json={"email": "a@a.com", "senha_provisoria": "SenhaOk123"})
    assert r.status_code == 401


def test_senha_com_8_caracteres_agora_e_aceita(client, auth_headers):
    id_associado, cpf = _criar_ficha(client)
    r = client.post(
        f"/api/associados/{id_associado}/conceder-acesso",
        json={"email": f"{cpf}@acesso.example.com", "senha_provisoria": "Oito123"[:8]},
        headers=auth_headers,
    )
    # "Oito123"[:8] tem 7 caracteres de propósito, pra confirmar que 7 ainda é recusado.
    assert r.status_code == 400
    assert "8 caracteres" in r.json()["detail"]

    r = client.post(
        f"/api/associados/{id_associado}/conceder-acesso",
        json={"email": f"{cpf}@acesso.example.com", "senha_provisoria": "Oitocar1"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text


def test_fluxo_completo_concede_acesso_login_forca_troca_de_senha(client, auth_headers):
    id_associado, cpf = _criar_ficha(client)

    r = client.post(
        f"/api/associados/{id_associado}/conceder-acesso",
        json={"email": f"{cpf}@acesso.example.com", "senha_provisoria": "Provisoria1"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    # não pode conceder de novo pro mesmo associado.
    r = client.post(
        f"/api/associados/{id_associado}/conceder-acesso",
        json={"email": f"{cpf}@acesso2.example.com", "senha_provisoria": "Provisoria1"},
        headers=auth_headers,
    )
    assert r.status_code == 400

    login = client.post("/auth/login", json={"cpf": cpf, "senha": "Provisoria1"})
    assert login.status_code == 200, login.text
    corpo = login.json()
    assert corpo["senha_provisoria"] is True
    token_provisorio = corpo["access_token"]

    r = client.post(
        "/auth/senha/alterar",
        json={"senha_atual": "Provisoria1", "senha_nova": "SenhaDefinitivaOk1"},
        headers={"Authorization": f"Bearer {token_provisorio}"},
    )
    assert r.status_code == 200, r.text

    login_depois = client.post("/auth/login", json={"cpf": cpf, "senha": "SenhaDefinitivaOk1"})
    assert login_depois.status_code == 200, login_depois.text
    assert login_depois.json()["senha_provisoria"] is False


def test_o_me_diz_que_a_senha_e_provisoria_ate_ser_trocada_e_a_nova_nao_pode_ser_igual(client, auth_headers):
    """Achado da v6.2d: a tela "Conceder acesso" promete que o associado é obrigado a trocar a senha no primeiro login; o painel obriga
    pelo `senha_provisoria` do `/auth/me` (a guarda manda para a tela de troca, como o MFA obrigatório)."""
    id_associado, cpf = _criar_ficha(client)
    r = client.post(
        f"/api/associados/{id_associado}/conceder-acesso",
        json={"email": f"{cpf}@provisoria.example.com", "senha_provisoria": "Provisoria1"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    token = client.post("/auth/login", json={"cpf": cpf, "senha": "Provisoria1"}).json()["access_token"]
    cabecalho = {"Authorization": f"Bearer {token}"}
    assert client.get("/auth/me", headers=cabecalho).json()["senha_provisoria"] is True

    # a mesma senha não serve de "troca": ela continuaria sendo a que a secretaria conhece
    igual = client.post("/auth/senha/alterar", json={"senha_atual": "Provisoria1", "senha_nova": "Provisoria1"}, headers=cabecalho)
    assert igual.status_code == 400 and igual.json()["detail"] == "A senha nova precisa ser diferente da atual."
    assert client.get("/auth/me", headers=cabecalho).json()["senha_provisoria"] is True

    trocou = client.post("/auth/senha/alterar", json={"senha_atual": "Provisoria1", "senha_nova": "MinhaSenhaNova9"}, headers=cabecalho)
    assert trocou.status_code == 200, trocou.text
    assert client.get("/auth/me", headers=cabecalho).json()["senha_provisoria"] is False


def test_quem_nao_recebeu_senha_provisoria_nao_e_mandado_para_a_troca(client, auth_headers):
    assert client.get("/auth/me", headers=auth_headers).json()["senha_provisoria"] is False


def test_o_roteiro_da_homologacao_das_contas_do_cofre_recusa_outro_banco(monkeypatch):
    import importlib.util

    import pytest

    import app.database

    esp = importlib.util.spec_from_file_location("hml_contas", "scripts/hml_contas_do_cofre_definitivas.py")
    roteiro = importlib.util.module_from_spec(esp)
    esp.loader.exec_module(roteiro)
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:s@servidor/asaf?sslmode=require")
    with pytest.raises(SystemExit, match="RECUSADO"):
        roteiro.main()

    class Resultado:
        def scalar(self):
            return "asaf"

    class SessaoDeOutroBanco:
        def execute(self, *_a, **_k):
            return Resultado()

        def query(self, *_a, **_k):
            raise AssertionError("consultou o banco errado")

        def commit(self):
            raise AssertionError("escreveu no banco errado")

        def close(self):
            pass

    monkeypatch.setattr(app.database, "SessaoLocal", SessaoDeOutroBanco)
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:s@servidor/asaf_hml?sslmode=require")
    with pytest.raises(SystemExit, match="RECUSADO"):
        roteiro.main()


def test_o_roteiro_da_homologacao_acerta_so_as_contas_do_cofre_e_pode_rodar_de_novo(client, auth_headers, db):
    import importlib.util

    from app.models.core import Usuario

    esp = importlib.util.spec_from_file_location("hml_contas", "scripts/hml_contas_do_cofre_definitivas.py")
    roteiro = importlib.util.module_from_spec(esp)
    esp.loader.exec_module(roteiro)
    contas = {}
    for email in ("conselheiro_3@homologacao.example.com", "login.robo@homologacao.example.com"):
        id_associado, _cpf = _criar_ficha(client)
        r = client.post(f"/api/associados/{id_associado}/conceder-acesso", json={"email": email, "senha_provisoria": "Provisoria1"}, headers=auth_headers)
        assert r.status_code == 200, r.text
        contas[email] = r.json()["id_usuario"]

    assert roteiro.acertar(db) >= 1  # (o banco é da sessão inteira: outra conta do cofre criada por outro teste também conta)
    db.expire_all()
    assert db.get(Usuario, contas["conselheiro_3@homologacao.example.com"]).senha_provisoria is False
    assert db.get(Usuario, contas["login.robo@homologacao.example.com"]).senha_provisoria is True  # a conta que o robô cria prova a troca obrigatória
    assert roteiro.acertar(db) == 0
