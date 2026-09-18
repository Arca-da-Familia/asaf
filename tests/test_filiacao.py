"""v1.2 - filiação: proposta pública -> conferência -> aprovação (efetivação com matrícula
sequencial e período de experiência) ou recusa. Cobre também o que a v1.1 deixou pendente:
"Em Experiência" agora existe e se conecta ao cálculo de categoria."""
from tests.test_pessoas import _cpf_unico


def _propor(client, cpf=None, **overrides):
    cpf = cpf or _cpf_unico()
    # v1.8 - nome/e-mail únicos por padrão (o bloqueio de cadastro duplicado na aprovação
    # trataria duas propostas com nome+telefone iguais como a mesma pessoa, de propósito).
    payload = {
        "nome_completo": f"Candidato Filiação {cpf[-8:]}", "cpf": cpf,
        "email_contato": f"{cpf}@x.com", "telefone_whatsapp": "11900000000",
        **overrides,
    }
    return client.post("/api/filiacao/propor", json=payload)


def test_propor_sem_autenticacao_funciona(client):
    resposta = _propor(client)
    assert resposta.status_code == 200, resposta.text
    assert "id_proposta" in resposta.json()


def test_propor_cpf_invalido_e_recusado(client):
    resposta = _propor(client, cpf="11111111111")
    assert resposta.status_code == 422


def test_propor_cpf_duplicado_em_andamento_e_recusado(client):
    cpf = _cpf_unico()
    _propor(client, cpf=cpf)
    segunda = _propor(client, cpf=cpf)
    assert segunda.status_code == 400


def test_fluxo_completo_ate_aprovacao_atribui_matricula_e_experiencia(client, auth_headers):
    proposta = _propor(client).json()
    id_proposta = proposta["id_proposta"]

    # aprovar antes de conferir é recusado - ordem importa
    direto = client.post(f"/api/filiacao/propostas/{id_proposta}/aprovar", headers=auth_headers, json={"categoria": "Efetivo"})
    assert direto.status_code == 400

    conferir = client.post(f"/api/filiacao/propostas/{id_proposta}/conferir", headers=auth_headers)
    assert conferir.status_code == 200

    aprovar = client.post(f"/api/filiacao/propostas/{id_proposta}/aprovar", headers=auth_headers, json={"categoria": "Efetivo"})
    assert aprovar.status_code == 200, aprovar.text
    corpo = aprovar.json()
    assert corpo["numero_matricula"] > 0
    assert corpo["status_arrolamento"] == "Em Experiência"

    # categoria calculada confirma "Em Experiência" (prazo padrão 90 dias, ainda não passou)
    calculada = client.get(f"/api/associados/{corpo['id_associado']}/categoria-calculada").json()
    assert calculada["categoria_calculada_agora"] == "Em Experiência"


def test_matriculas_sao_sequenciais_e_unicas(client, auth_headers):
    matriculas = []
    for _ in range(2):
        proposta = _propor(client).json()
        client.post(f"/api/filiacao/propostas/{proposta['id_proposta']}/conferir", headers=auth_headers)
        aprovado = client.post(f"/api/filiacao/propostas/{proposta['id_proposta']}/aprovar", headers=auth_headers, json={}).json()
        matriculas.append(aprovado["numero_matricula"])
    assert matriculas[1] == matriculas[0] + 1


def test_recusar_proposta_com_motivo(client, auth_headers):
    proposta = _propor(client).json()
    resposta = client.post(
        f"/api/filiacao/propostas/{proposta['id_proposta']}/recusar", headers=auth_headers, json={"motivo": "Documentação incompleta"}
    )
    assert resposta.status_code == 200

    listagem = client.get("/api/filiacao/propostas?status=Recusada", headers=auth_headers).json()
    encontrada = next(p for p in listagem if p["id_proposta"] == proposta["id_proposta"])
    assert encontrada["motivo_recusa"] == "Documentação incompleta"


def test_recusar_proposta_ja_aprovada_falha(client, auth_headers):
    proposta = _propor(client).json()
    client.post(f"/api/filiacao/propostas/{proposta['id_proposta']}/conferir", headers=auth_headers)
    client.post(f"/api/filiacao/propostas/{proposta['id_proposta']}/aprovar", headers=auth_headers, json={})

    resposta = client.post(
        f"/api/filiacao/propostas/{proposta['id_proposta']}/recusar", headers=auth_headers, json={"motivo": "tarde demais"}
    )
    assert resposta.status_code == 400


def test_endpoints_administrativos_exigem_autenticacao(client):
    proposta = _propor(client).json()
    assert client.get("/api/filiacao/propostas").status_code == 401
    assert client.post(f"/api/filiacao/propostas/{proposta['id_proposta']}/conferir").status_code == 401
