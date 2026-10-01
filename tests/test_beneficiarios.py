"""v4.2 (FASE 4) - Beneficiários e atendimento: beneficiário como papel de Pessoa, vínculo N:N a
projeto com papel, prontuário de atendimento visível só pra equipe ATIVA daquele projeto
específico (dado sensível), consulta auditada, e encaminhamento à rede externa."""
import uuid
from datetime import datetime, timedelta

from app.models.associados import Associado, DependenteFamiliar, Pessoa
from app.security import decodificar_access_token

_ISO = "%Y-%m-%dT%H:%M:%S"


def _associado_do_token(db, auth_headers) -> Associado:
    token = auth_headers["Authorization"].split(" ")[1]
    id_usuario = decodificar_access_token(token)["id_usuario"]
    associado = db.query(Associado).filter(Associado.id_usuario == id_usuario).first()
    assert associado is not None, "bootstrap-admin deveria ter criado um Associado vinculado"
    return associado


def _criar_projeto(client, auth_headers) -> int:
    r = client.post("/projetos/", json={
        "nome_projeto": f"Projeto Beneficiários {uuid.uuid4().hex[:6]}", "tipo_foco": "Assistencial",
        "necessita_alvara_bombeiros": False,
        "data_inicio": datetime.utcnow().strftime(_ISO), "data_fim_prevista": (datetime.utcnow() + timedelta(days=90)).strftime(_ISO),
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_projeto"]


def _criar_beneficiario(client, auth_headers, nome=None) -> int:
    r = client.post("/api/beneficiarios/", json={"nome_completo": nome or f"Beneficiário Teste {uuid.uuid4().hex[:6]}"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_beneficiario"]


def _vincular(client, auth_headers, id_beneficiario, id_projeto, papel="ATENDIDO", atendimento_por_familia=False) -> int:
    r = client.post("/api/beneficiarios-projeto/", json={
        "id_beneficiario": id_beneficiario, "id_projeto": id_projeto, "papel": papel, "atendimento_por_familia": atendimento_por_familia,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_vinculo"]


def test_criar_beneficiario_com_pessoa_nova_e_recusa_duplicidade(client, auth_headers, db):
    id_beneficiario = _criar_beneficiario(client, auth_headers)

    beneficiarios = client.get("/api/beneficiarios/", headers=auth_headers).json()
    encontrado = next(b for b in beneficiarios if b["id_beneficiario"] == id_beneficiario)
    id_pessoa = encontrado["id_pessoa"]

    r = client.post("/api/beneficiarios/", json={"id_pessoa": id_pessoa}, headers=auth_headers)
    assert r.status_code == 400
    assert "já é beneficiária" in r.json()["detail"].lower()


def test_criar_beneficiario_exige_id_pessoa_ou_nome(client, auth_headers):
    r = client.post("/api/beneficiarios/", json={}, headers=auth_headers)
    assert r.status_code == 422


def test_nucleo_familiar_reaproveita_dependente_familiar(client, auth_headers, db):
    id_beneficiario = _criar_beneficiario(client, auth_headers, nome="Criança Teste Núcleo")
    beneficiario_api = next(b for b in client.get("/api/beneficiarios/", headers=auth_headers).json() if b["id_beneficiario"] == id_beneficiario)
    id_pessoa_beneficiario = beneficiario_api["id_pessoa"]

    mae = Pessoa(nome_completo=f"Mãe Teste {uuid.uuid4().hex[:6]}")
    db.add(mae)
    db.commit()
    db.refresh(mae)
    db.add(DependenteFamiliar(id_pessoa_titular=mae.id_pessoa, id_pessoa_vinculada=id_pessoa_beneficiario, grau_parentesco="FILHO"))
    db.commit()

    nucleo = client.get(f"/api/beneficiarios/{id_beneficiario}/nucleo-familiar", headers=auth_headers).json()
    assert len(nucleo) == 1
    assert nucleo[0]["id_pessoa_titular"] == mae.id_pessoa


def test_vincular_a_projeto_valida_papel_e_recusa_duplicidade(client, auth_headers):
    id_projeto = _criar_projeto(client, auth_headers)
    id_beneficiario = _criar_beneficiario(client, auth_headers)

    r = client.post("/api/beneficiarios-projeto/", json={
        "id_beneficiario": id_beneficiario, "id_projeto": id_projeto, "papel": "PAPEL_INVALIDO",
    }, headers=auth_headers)
    assert r.status_code == 422

    _vincular(client, auth_headers, id_beneficiario, id_projeto, papel="ALUNO")

    r = client.post("/api/beneficiarios-projeto/", json={
        "id_beneficiario": id_beneficiario, "id_projeto": id_projeto, "papel": "ATENDIDO",
    }, headers=auth_headers)
    assert r.status_code == 400

    vinculos = client.get(f"/api/projetos/{id_projeto}/beneficiarios", headers=auth_headers).json()
    assert len(vinculos) == 1
    assert vinculos[0]["papel"] == "ALUNO"


def test_prontuario_e_visivel_so_pra_equipe_ativa_do_projeto_e_consulta_e_auditada(client, auth_headers, db):
    id_projeto = _criar_projeto(client, auth_headers)
    id_beneficiario = _criar_beneficiario(client, auth_headers)
    id_vinculo = _vincular(client, auth_headers, id_beneficiario, id_projeto)

    # o admin (Presidente) que CRIOU o projeto não está na equipe dele - deve ser recusado, sem
    # exceção por nível/permissão geral de "projetos".
    r = client.post(f"/api/beneficiarios-projeto/{id_vinculo}/atendimentos", json={"relato": "Tentativa sem estar na equipe."}, headers=auth_headers)
    assert r.status_code == 403
    assert "equipe" in r.json()["detail"].lower()

    r = client.get(f"/api/beneficiarios-projeto/{id_vinculo}/atendimentos", headers=auth_headers)
    assert r.status_code == 403

    # descobre o id_associado do próprio admin e o adiciona à equipe do projeto.
    associado_admin = _associado_do_token(db, auth_headers)

    r = client.post(f"/api/projetos/{id_projeto}/equipe", json={"id_associado": associado_admin.id_associado, "papel": "COORDENADOR"}, headers=auth_headers)
    assert r.status_code == 200, r.text

    r = client.post(f"/api/beneficiarios-projeto/{id_vinculo}/atendimentos", json={"relato": "Atendimento registrado após entrar na equipe."}, headers=auth_headers)
    assert r.status_code == 200, r.text

    r = client.get(f"/api/beneficiarios-projeto/{id_vinculo}/atendimentos", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert len(r.json()) == 1

    auditoria = client.get("/api/auditoria/?limite=10", headers=auth_headers).json()
    entradas = [e for e in auditoria["entradas"] if e["tabela_afetada"] == "registros_atendimento" and e["acao"] == "CONSULTA_PRONTUARIO"]
    assert entradas, "esperava entrada de auditoria de CONSULTA_PRONTUARIO"


def test_encaminhamento_rede_externa_valida_catalogo(client, auth_headers, db):
    id_projeto = _criar_projeto(client, auth_headers)
    id_beneficiario = _criar_beneficiario(client, auth_headers)
    id_vinculo = _vincular(client, auth_headers, id_beneficiario, id_projeto)

    associado_admin = _associado_do_token(db, auth_headers)
    client.post(f"/api/projetos/{id_projeto}/equipe", json={"id_associado": associado_admin.id_associado, "papel": "COORDENADOR"}, headers=auth_headers)

    r = client.post(f"/api/beneficiarios-projeto/{id_vinculo}/encaminhamentos", json={
        "tipo_rede": "REDE_INEXISTENTE", "descricao": "Encaminhamento de teste",
    }, headers=auth_headers)
    assert r.status_code == 422

    r = client.post(f"/api/beneficiarios-projeto/{id_vinculo}/encaminhamentos", json={
        "tipo_rede": "CRAS", "descricao": "Encaminhado ao CRAS por vulnerabilidade social.",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    encaminhamentos = client.get(f"/api/beneficiarios-projeto/{id_vinculo}/encaminhamentos", headers=auth_headers).json()
    assert len(encaminhamentos) == 1
    assert encaminhamentos[0]["tipo_rede"] == "CRAS"


# ==========================================
# TELA CROSS-PROJETO (v4.10) - busca/filtro/edição/exportação. Antes só dava pra ver beneficiário
# aninhado dentro de UM projeto por vez.
# ==========================================
def test_listar_beneficiarios_filtra_por_busca_e_projeto(client, auth_headers):
    id_projeto = _criar_projeto(client, auth_headers)
    id_ana = _criar_beneficiario(client, auth_headers, nome=f"Ana Beneficiária {uuid.uuid4().hex[:6]}")
    id_bia = _criar_beneficiario(client, auth_headers, nome=f"Bia Beneficiária {uuid.uuid4().hex[:6]}")
    _vincular(client, auth_headers, id_ana, id_projeto)

    r = client.get("/api/beneficiarios/?busca=Ana", headers=auth_headers)
    assert r.status_code == 200, r.text
    encontrados = [b["id_beneficiario"] for b in r.json()]
    assert id_ana in encontrados and id_bia not in encontrados

    r = client.get(f"/api/beneficiarios/?id_projeto={id_projeto}", headers=auth_headers)
    encontrados = [b["id_beneficiario"] for b in r.json()]
    assert encontrados == [id_ana]


def test_atualizar_beneficiario_edita_dados_de_pessoa_e_consentimento(client, auth_headers, db):
    id_beneficiario = _criar_beneficiario(client, auth_headers, nome="Nome Antigo")

    r = client.put(f"/api/beneficiarios/{id_beneficiario}", json={
        "nome_completo": "Nome Corrigido", "consentimento_lgpd_registrado": True, "observacao_consentimento": "Assinado em papel",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    atualizado = next(b for b in client.get("/api/beneficiarios/", headers=auth_headers).json() if b["id_beneficiario"] == id_beneficiario)
    assert atualizado["nome_completo"] == "Nome Corrigido"
    assert atualizado["consentimento_lgpd_registrado"] is True
    assert atualizado["observacao_consentimento"] == "Assinado em papel"
    assert atualizado["data_consentimento"] is not None


def test_exportar_beneficiarios_exige_permissao_propria_e_grava_auditoria(client, auth_headers):
    from tests.test_eventos import _criar_associado_com_acesso

    _criar_beneficiario(client, auth_headers)
    headers_sem_permissao = _criar_associado_com_acesso(client, auth_headers)

    r = client.get("/api/beneficiarios/exportar", headers=headers_sem_permissao)
    assert r.status_code == 403

    r = client.get("/api/beneficiarios/exportar", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert len(r.json()) >= 1
    assert "nome_completo" in r.json()[0]


def test_frequencia_do_beneficiario_usa_motor_de_presenca_v40(client, auth_headers):
    id_projeto = _criar_projeto(client, auth_headers)
    id_beneficiario = _criar_beneficiario(client, auth_headers)
    id_vinculo = _vincular(client, auth_headers, id_beneficiario, id_projeto)

    beneficiario_api = next(b for b in client.get("/api/beneficiarios/", headers=auth_headers).json() if b["id_beneficiario"] == id_beneficiario)

    r = client.post("/api/presencas/entrada", json={
        "contexto_tipo": "Projeto", "id_contexto": id_projeto, "id_pessoa": beneficiario_api["id_pessoa"], "meio_registro": "Manual",
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    presencas = client.get(f"/api/beneficiarios-projeto/{id_vinculo}/presencas", headers=auth_headers).json()
    assert len(presencas) == 1
