"""v1.5 (FASE 1) - Ficha 360º e linha do tempo. Confere que os eventos que cada módulo já
publica (filiação aprovada, licença, desligamento, readmissão, cargo) aparecem juntos na ficha,
na ordem certa, e que tanto o admin (/api/associados/{id}/ficha-360) quanto o próprio associado
(/auth/me/ficha-360) enxergam a mesma montagem."""
from datetime import date, timedelta

from tests.test_pessoas import _cpf_unico


def _criar_associado(client, **overrides):
    payload = {
        "nome_completo": "Pessoa Ficha 360", "cpf": _cpf_unico(), "email_contato": "ficha360@x.com",
        "telefone_whatsapp": "11900000000", "categoria": "Efetivo",
        "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
        "cidade": "Sao Paulo", "estado": "SP",
        **overrides,
    }
    return client.post("/associados-master/", json=payload).json()


def test_ficha_360_exige_autenticacao(client):
    r = client.get("/api/associados/1/ficha-360")
    assert r.status_code == 401


def test_ficha_360_associado_inexistente_e_404(client, auth_headers):
    r = client.get("/api/associados/999999/ficha-360", headers=auth_headers)
    assert r.status_code == 404


def test_ficha_360_reune_dados_financeiro_cargos_e_linha_do_tempo(client, auth_headers):
    associado = _criar_associado(client)
    id_associado = associado["id_associado"]

    # Cargo: posse e depois saída - os dois viram evento na linha do tempo.
    cargo = client.post(
        f"/api/associados/{id_associado}/cargos", headers=auth_headers,
        json={"titulo_cargo": "Tesoureiro", "data_posse": str(date.today() - timedelta(days=10))},
    ).json()
    client.put(
        f"/api/cargos/{cargo['id_historico']}/encerrar", headers=auth_headers,
        json={"data_saida": str(date.today())},
    )

    # Licença: também vira evento, e some da "situação financeira" (não é o que estamos
    # testando aqui, mas confirma que o fluxo inteiro continua funcionando junto).
    client.post(
        f"/api/associados/{id_associado}/licenca", headers=auth_headers,
        json={"motivo": "SAUDE", "data_inicio": str(date.today()), "data_fim_prevista": str(date.today() + timedelta(days=30))},
    )

    r = client.get(f"/api/associados/{id_associado}/ficha-360", headers=auth_headers)
    assert r.status_code == 200, r.text
    ficha = r.json()

    assert ficha["dados"]["id_associado"] == id_associado
    assert ficha["dados"]["nome_completo"] == "Pessoa Ficha 360"

    assert ficha["situacao_financeira"]["quantidade_titulos_pendentes"] == 0
    assert ficha["situacao_financeira"]["saldo_devedor_total"] == 0

    assert len(ficha["cargos"]) == 1
    assert ficha["cargos"][0]["titulo_cargo"] == "Tesoureiro"
    assert ficha["cargos"][0]["atual"] is False

    tipos = [e["tipo"] for e in ficha["linha_do_tempo"]]
    assert "CARGO_INICIADO" in tipos
    assert "CARGO_ENCERRADO" in tipos
    assert "LICENCA_REGISTRADA" in tipos
    # Ordem: mais recente primeiro.
    datas = [e["data_evento"] for e in ficha["linha_do_tempo"]]
    assert datas == sorted(datas, reverse=True)


def test_ficha_360_registra_filiacao_aprovada_na_linha_do_tempo(client, auth_headers):
    cpf = _cpf_unico()
    proposta = client.post(
        "/api/filiacao/propor",
        json={
            "nome_completo": "Filiado Ficha 360", "cpf": cpf, "email_contato": "filiado@x.com",
            "telefone_whatsapp": "11900000000",
        },
    ).json()
    client.post(f"/api/filiacao/propostas/{proposta['id_proposta']}/conferir", headers=auth_headers)
    aprovacao = client.post(
        f"/api/filiacao/propostas/{proposta['id_proposta']}/aprovar", headers=auth_headers,
        json={"categoria": "Efetivo"},
    ).json()

    ficha = client.get(f"/api/associados/{aprovacao['id_associado']}/ficha-360", headers=auth_headers).json()
    evento = next(e for e in ficha["linha_do_tempo"] if e["tipo"] == "FILIACAO_APROVADA")
    assert str(aprovacao["numero_matricula"]) in evento["descricao"]


def test_minha_ficha_360_espelha_a_do_admin(client, auth_headers):
    # A própria conta de teste (bootstrap-admin) é quem chama - compara a ficha de si mesma
    # pelas duas rotas (admin x autoatendimento), não a de um associado criado à parte.
    meu_id_associado = client.get("/auth/me", headers=auth_headers).json()["id_associado"]
    ficha_admin = client.get(f"/api/associados/{meu_id_associado}/ficha-360", headers=auth_headers).json()
    ficha_propria = client.get("/auth/me/ficha-360", headers=auth_headers).json()
    assert ficha_admin["dados"]["id_associado"] == ficha_propria["dados"]["id_associado"] == meu_id_associado
