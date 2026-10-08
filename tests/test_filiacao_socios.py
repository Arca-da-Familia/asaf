"""v5.4h - Filiação proposta por 3 sócios (Estatuto Art. 12, par. único VI): cada sócio apto é avisado no sino do painel, propõe ou recusa (recusar pede o
motivo), não vê CPF, e-mail nem telefone do candidato, a Diretoria vê quem propôs e só aprova com 3 que propõem; sem prazo (sem resposta fica pendente)."""
import uuid

from app.models.associados import Associado
from tests.test_conselho_fiscal import _criar_associado, _headers
from tests.test_filiacao import _propor
from tests.test_pessoas import _cpf_unico

_PARA_PROPOR = "/api/filiacao/para-propor"


def _socio(db, nome, status="Ativo - Em Dia"):
    associado, usuario = _criar_associado(db, f"{nome} {uuid.uuid4().hex[:6]}")
    associado.status_arrolamento = status
    db.commit()
    return associado, usuario


def _propor_como(client, usuario, id_proposta, decisao="Propõe", observacao=None):
    corpo = {"decisao": decisao}
    if observacao is not None:
        corpo["observacao"] = observacao
    return client.post(f"/api/filiacao/propostas/{id_proposta}/propor", json=corpo, headers=_headers(usuario))


def test_cada_socio_apto_e_avisado_no_sino_quando_chega_um_pedido(client, auth_headers, db):
    em_dia, u_em_dia = _socio(db, "Socio Em Dia")
    experiencia, u_exp = _socio(db, "Socio Em Experiencia", "Em Experiência")
    inadimplente, u_inad = _socio(db, "Socio Inadimplente", "Ativo - Inadimplente")
    proposta = _propor(client, nome_completo=f"Candidato Do Sino {uuid.uuid4().hex[:6]}").json()

    avisos = client.get("/api/minhas-notificacoes/", headers=_headers(u_em_dia)).json()
    aviso = next(a for a in avisos["avisos"] if a["tipo"] == "filiacao_proposta" and "Candidato Do Sino" in a["texto"])
    assert aviso["link"] == "/filiacao/para-propor" and aviso["lida"] is False and avisos["nao_lidas"] >= 1
    assert any("Candidato Do Sino" in a["texto"] for a in client.get("/api/minhas-notificacoes/", headers=_headers(u_exp)).json()["avisos"])
    assert not any("Candidato Do Sino" in a["texto"] for a in client.get("/api/minhas-notificacoes/", headers=_headers(u_inad)).json()["avisos"]), "inadimplente não é chamado a propor"
    assert proposta["id_proposta"]


def test_o_socio_ve_o_pedido_sem_dado_pessoal_e_so_o_apto_ve(client, auth_headers, db):
    _, u_apto = _socio(db, "Socio Que Ve")
    _, u_inad = _socio(db, "Socio Que Nao Ve", "Ativo - Inadimplente")
    proposta = _propor(client, nome_completo=f"Candidata Visivel {uuid.uuid4().hex[:6]}", telefone_whatsapp="11977776666").json()

    lista = client.get(_PARA_PROPOR, headers=_headers(u_apto)).json()
    pedido = next(p for p in lista if p["id_proposta"] == proposta["id_proposta"])
    assert pedido["nome_completo"].startswith("Candidata Visivel") and pedido["total_propoem"] == 0 and pedido["faltam"] == 3 and pedido["minha_decisao"] is None
    assert not {"cpf", "email_contato", "telefone_whatsapp"} & set(pedido), "o sócio não recebe CPF, e-mail nem telefone do candidato"
    assert client.get(_PARA_PROPOR).status_code == 401
    assert client.get(_PARA_PROPOR, headers=_headers(u_inad)).status_code == 403
    r = _propor_como(client, u_inad, proposta["id_proposta"])
    assert r.status_code == 403 and "ativo e em dia" in r.json()["detail"]


def test_tres_socios_propondo_liberam_a_aprovacao_e_a_diretoria_ve_quem_foi(client, auth_headers, db):
    socios = [_socio(db, f"Proponente {i}")[1] for i in range(3)]
    proposta = _propor(client).json()
    id_proposta = proposta["id_proposta"]
    client.post(f"/api/filiacao/propostas/{id_proposta}/conferir", headers=auth_headers)

    for i, usuario in enumerate(socios[:2]):
        r = _propor_como(client, usuario, id_proposta)
        assert r.status_code == 200 and r.json()["total_propoem"] == i + 1 and r.json()["faltam"] == 2 - i
    r = client.post(f"/api/filiacao/propostas/{id_proposta}/aprovar", headers=auth_headers, json={})
    assert r.status_code == 400 and "até agora 2 propuseram" in r.json()["detail"] and "Faltam 1" in r.json()["detail"]

    assert _propor_como(client, socios[2], id_proposta).json()["faltam"] == 0
    listagem = client.get("/api/filiacao/propostas", headers=auth_headers).json()
    item = next(p for p in listagem if p["id_proposta"] == id_proposta)
    assert item["total_propoem"] == 3 and item["exigidos"] == 3 and {d["decisao"] for d in item["proponentes"]} == {"Propõe"}
    assert all(d["socio"].startswith("Proponente") for d in item["proponentes"])
    aprovado = client.post(f"/api/filiacao/propostas/{id_proposta}/aprovar", headers=auth_headers, json={})
    assert aprovado.status_code == 200 and aprovado.json()["numero_matricula"] > 0


def test_recusar_pede_o_motivo_so_quem_propoe_conta_e_a_decisao_pode_mudar(client, auth_headers, db):
    (_, u1), (_, u2), (_, u3), (_, u4) = (_socio(db, f"Decide {i}") for i in range(4))
    id_proposta = _propor(client).json()["id_proposta"]
    r = _propor_como(client, u1, id_proposta, "Recusa")
    assert r.status_code == 422 and "motivo" in r.json()["detail"]
    r = _propor_como(client, u1, id_proposta, "Recusa", "Não conheço a família.")
    assert r.status_code == 200 and r.json()["total_propoem"] == 0, "quem recusa não conta para os 3"
    assert _propor_como(client, u2, id_proposta).json()["total_propoem"] == 1
    assert _propor_como(client, u3, id_proposta).json()["total_propoem"] == 2
    # o mesmo sócio muda de ideia: passa a propor (continua uma decisão só por sócio)
    assert _propor_como(client, u1, id_proposta).json()["total_propoem"] == 3
    # decisão inválida
    assert _propor_como(client, u4, id_proposta, "Talvez").status_code == 422

    item = next(p for p in client.get("/api/filiacao/propostas", headers=auth_headers).json() if p["id_proposta"] == id_proposta)
    assert len(item["proponentes"]) == 3 and item["total_propoem"] == 3
    recusa_que_virou_proposta = next(d for d in item["proponentes"] if d["socio"].startswith("Decide 0"))
    assert recusa_que_virou_proposta["decisao"] == "Propõe"


def test_pedido_ja_decidido_nao_recebe_mais_propostas_e_ninguem_propoe_a_si_mesmo(client, auth_headers, db):
    associado, usuario = _socio(db, "Candidato Que Virou Socio")
    # o pedido chegou ANTES de a pessoa virar sócia (o CPF dela só entra no cadastro depois): ela não pode propor o próprio pedido
    cpf_dele = _cpf_unico()
    proposta_dele = _propor(client, cpf=cpf_dele).json()
    associado.pessoa.cpf = cpf_dele
    db.commit()
    r = _propor_como(client, usuario, proposta_dele["id_proposta"])
    assert r.status_code == 403 and "própria filiação" in r.json()["detail"]
    assert not any(p["id_proposta"] == proposta_dele["id_proposta"] for p in client.get(_PARA_PROPOR, headers=_headers(usuario)).json())

    proposta = _propor(client).json()
    client.post(f"/api/filiacao/propostas/{proposta['id_proposta']}/recusar", headers=auth_headers, json={"motivo": "documentação incompleta"})
    _, outro = _socio(db, "Socio Atrasado")
    r = _propor_como(client, outro, proposta["id_proposta"])
    assert r.status_code == 409 and "não recebe mais propostas" in r.json()["detail"]
    assert not any(p["id_proposta"] == proposta["id_proposta"] for p in client.get(_PARA_PROPOR, headers=_headers(outro)).json())
    assert client.post("/api/filiacao/propostas/99999999/propor", json={"decisao": "Propõe"}, headers=_headers(outro)).status_code == 404


def test_a_decisao_do_socio_fica_na_auditoria(client, auth_headers, db):
    _, usuario = _socio(db, "Socio Auditado")
    id_proposta = _propor(client).json()["id_proposta"]
    assert _propor_como(client, usuario, id_proposta).status_code == 200
    trilha = client.get("/api/auditoria/?tabela_afetada=propostas_de_socios&acao=PROPOSTA_DO_SOCIO&por_pagina=50", headers=auth_headers).json()["entradas"]
    assert any(f'"id_proposta": {id_proposta}' in (e["dados_depois"] or "") for e in trilha)
