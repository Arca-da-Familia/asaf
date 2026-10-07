"""v5.4h - Rastro de recusas: tentar aprovar, reprovar ou assinar e ser recusado também fica na Auditoria (quem tentou, rota, resultado e motivo).
Só vale para as rotas de aprovação/assinatura e para recusas (400, 403, 409) de quem estava logado: o que dá certo, o que não existe (404), o que não
é aprovação e quem nem entrou não geram esse registro."""
import json
import uuid

from app.recusas import deve_registrar, e_rota_de_aprovacao
from app.security import criar_access_token, decodificar_access_token
from tests.test_compras import _criar_usuario_com_mandato
from tests.test_conselho_fiscal import _criar_associado

_FILTRO = "/api/auditoria/?tabela_afetada=recusas&acao=RECUSA_APROVACAO&por_pagina=200"


def _id_usuario(headers) -> int:
    return decodificar_access_token(headers["Authorization"].split(" ")[1])["id_usuario"]


def _recusas_de(client, auth_headers, id_usuario=None):
    url = _FILTRO + (f"&id_usuario={id_usuario}" if id_usuario else "")
    return client.get(url, headers=auth_headers).json()["entradas"]


def test_so_as_rotas_de_aprovacao_e_so_as_recusas_contam():
    assert e_rota_de_aprovacao("POST", "/api/solicitacoes-compra/12/aprovar")
    assert e_rota_de_aprovacao("POST", "/api/reembolsos-despesa/3/reprovar")
    assert e_rota_de_aprovacao("POST", "/api/fornecedores/dados-bancarios/7/rejeitar")
    assert e_rota_de_aprovacao("POST", "/api/atas/5/assinar")
    assert e_rota_de_aprovacao("POST", "/api/conselho-fiscal/auditoria-financeira/titulos/9/decisao")
    assert e_rota_de_aprovacao("POST", "/api/conselho-fiscal/auditoria-financeira/aprovar-em-lote")
    assert not e_rota_de_aprovacao("GET", "/api/solicitacoes-compra/12/aprovar"), "leitura nunca é aprovação"
    assert not e_rota_de_aprovacao("POST", "/api/solicitacoes-compra/12/cotacoes"), "criar cotação não é aprovar"
    assert not e_rota_de_aprovacao("POST", "/titulos/")
    assert not e_rota_de_aprovacao("POST", "/api/auth/mfa/confirmar")
    assert deve_registrar("POST", "/api/solicitacoes-compra/12/aprovar", 403)
    assert deve_registrar("POST", "/api/solicitacoes-compra/12/aprovar", 400)
    assert deve_registrar("POST", "/api/solicitacoes-compra/12/aprovar", 409)
    assert not deve_registrar("POST", "/api/solicitacoes-compra/12/aprovar", 404), "o que não existe não é recusa de aprovação"
    assert not deve_registrar("POST", "/api/solicitacoes-compra/12/aprovar", 401), "quem nem entrou não tem quem tenha tentado"
    assert not deve_registrar("POST", "/api/solicitacoes-compra/12/aprovar", 200)


def test_quem_tenta_aprovar_sem_poder_deixa_o_rastro_na_auditoria(client, auth_headers):
    _, secretario = _criar_usuario_com_mandato(client, auth_headers, "SECRETARIO")
    id_secretario = _id_usuario(secretario)
    assert _recusas_de(client, auth_headers, id_secretario) == []

    r = client.post("/api/solicitacoes-compra/1/aprovar", headers=secretario)
    assert r.status_code == 403
    recusas = _recusas_de(client, auth_headers, id_secretario)
    assert len(recusas) == 1
    dados = json.loads(recusas[0]["dados_depois"])
    assert dados["rota"] == "/api/solicitacoes-compra/1/aprovar" and dados["metodo"] == "POST" and dados["status"] == 403
    assert dados["motivo"] == r.json()["detail"], "o motivo guardado é o mesmo que a pessoa leu"

    # a resposta para quem tentou não mudou
    assert r.json()["detail"]
    # cada tentativa é um registro
    client.post("/api/reembolsos-despesa/1/aprovar", headers=secretario)
    assert len(_recusas_de(client, auth_headers, id_secretario)) == 2


def test_a_recusa_da_auditoria_financeira_tambem_fica(client, auth_headers, db):
    # nível "Diretoria" tem o financeiro mas não é do Conselho Fiscal: quem lança não audita (sem mandato, para não disputar a vaga de cargo com outros testes)
    _, usuario = _criar_associado(db, f"Diretor Que Tenta Auditar {uuid.uuid4().hex[:6]}", nome_nivel="Diretoria")
    diretor = {"Authorization": f"Bearer {criar_access_token(usuario)}"}
    r = client.post("/api/conselho-fiscal/auditoria-financeira/titulos/1/decisao", json={"decisao": "Aprovado"}, headers=diretor)
    assert r.status_code == 403
    dados = [json.loads(e["dados_depois"]) for e in _recusas_de(client, auth_headers, usuario.id_usuario)]
    assert any(d["rota"].endswith("/titulos/1/decisao") and "Conselho Fiscal" in d["motivo"] for d in dados)


def test_o_que_nao_e_recusa_de_aprovacao_nao_deixa_esse_rastro(client, auth_headers):
    _, secretario = _criar_usuario_com_mandato(client, auth_headers, "SECRETARIO")
    id_secretario = _id_usuario(secretario)
    # nem login, nem rota que não é de aprovação, nem 404
    assert client.post("/api/solicitacoes-compra/1/aprovar").status_code == 401
    assert client.post("/titulos/", json={}, headers=secretario).status_code in (403, 422)
    assert client.post("/api/solicitacoes-compra/99999999/aprovar", headers=auth_headers).status_code == 404
    assert _recusas_de(client, auth_headers, id_secretario) == []
    assert not any(json.loads(e["dados_depois"])["rota"].endswith("/99999999/aprovar") for e in _recusas_de(client, auth_headers))
