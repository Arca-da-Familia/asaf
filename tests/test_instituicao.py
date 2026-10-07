"""Módulo "Instituição": os dados da própria associação num lugar só, cada campo marcado "vai para o site" ou "só interno". Só quem administra
edita; a rota pública devolve apenas o que está marcado e preenchido; o que é interno de verdade nunca sai."""
import json

from tests.apoio_cnpj import cnpj_valido
from tests.test_compras import _criar_usuario_com_mandato


def _campo(client, auth_headers, chave):
    return next(c for c in client.get("/api/instituicao/", headers=auth_headers).json() if c["chave"] == chave)


def test_so_quem_administra_ve_e_edita_os_dados_da_instituicao(client, auth_headers):
    _, headers_secretario = _criar_usuario_com_mandato(client, auth_headers, "SECRETARIO")
    assert client.get("/api/instituicao/").status_code == 401
    assert client.get("/api/instituicao/", headers=headers_secretario).status_code == 403
    assert client.put("/api/instituicao/CNPJ", json={"valor": cnpj_valido(1)}, headers=headers_secretario).status_code == 403
    assert client.get("/api/instituicao/", headers=auth_headers).status_code == 200


def test_a_lista_traz_grupos_rotulos_e_se_vai_para_o_site(client, auth_headers):
    campos = client.get("/api/instituicao/", headers=auth_headers).json()
    chaves = {c["chave"] for c in campos}
    assert {"NOME_INSTITUICAO", "CNPJ", "ENDERECO", "TELEFONE_INSTITUCIONAL", "EMAIL_INSTITUCIONAL", "SITE_INSTAGRAM", "CHAVE_PIX", "EMAIL_REMETENTE"} <= chaves
    assert {c["grupo"] for c in campos} >= {"Identidade", "Contato", "Redes", "Aparência", "Financeiro", "Sistema"}
    assert _campo(client, auth_headers, "NOME_INSTITUICAO")["publico"] is True  # nome vai para o site por padrão
    assert _campo(client, auth_headers, "CHAVE_PIX")["publico"] is False  # a chave Pix só vai se alguém decidir
    interno = _campo(client, auth_headers, "EMAIL_REMETENTE")
    assert interno["pode_ser_publico"] is False and interno["publico"] is False


def test_editar_valida_em_portugues_e_grava_na_auditoria(client, auth_headers):
    r = client.put("/api/instituicao/CNPJ", json={"valor": "11.111.111/1111-11"}, headers=auth_headers)
    assert r.status_code == 422 and "CNPJ inválido" in r.json()["detail"]
    assert client.put("/api/instituicao/EMAIL_INSTITUCIONAL", json={"valor": "sem-arroba"}, headers=auth_headers).status_code == 422
    assert client.put("/api/instituicao/COR_PRIMARIA", json={"valor": "azul"}, headers=auth_headers).status_code == 422
    r = client.put("/api/instituicao/NOME_BENEFICIARIO_PIX", json={"valor": "x" * 30}, headers=auth_headers)
    assert r.status_code == 422 and "no máximo 25" in r.json()["detail"]
    assert client.put("/api/instituicao/NAO_EXISTE", json={"valor": "x"}, headers=auth_headers).status_code == 404

    cnpj = cnpj_valido(12345678)
    r = client.put("/api/instituicao/CNPJ", json={"valor": cnpj}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["valor"] == cnpj
    assert _campo(client, auth_headers, "CNPJ")["valor"] == cnpj
    trilha = client.get("/api/auditoria/?tabela_afetada=configuracoes_institucionais&acao=UPDATE_INSTITUICAO&por_pagina=50", headers=auth_headers).json()
    assert any(json.loads(e["dados_depois"] or "{}").get("campo") == "CNPJ" for e in trilha["entradas"])


def test_a_rota_publica_so_devolve_o_que_esta_marcado_e_preenchido(client, auth_headers):
    assert client.put("/api/instituicao/TELEFONE_INSTITUCIONAL", json={"valor": "(91) 98888-7777"}, headers=auth_headers).status_code == 200
    assert client.put("/api/instituicao/CHAVE_PIX", json={"valor": "chave-pix-do-teste@asaf.example.com"}, headers=auth_headers).status_code == 200
    publico = client.get("/api/publico/instituicao").json()  # sem login
    assert publico["TELEFONE_INSTITUCIONAL"] == "(91) 98888-7777"
    assert "CHAVE_PIX" not in publico, "a chave Pix preenchida, mas só interna, não sai"
    assert "EMAIL_REMETENTE" not in publico and "TEXTO_PADRAO_DOCUMENTO" not in publico

    # a marca "vai para o site" liga e desliga
    r = client.put("/api/instituicao/CHAVE_PIX", json={"publico": True}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["publico"] is True
    assert client.get("/api/publico/instituicao").json()["CHAVE_PIX"] == "chave-pix-do-teste@asaf.example.com"
    client.put("/api/instituicao/CHAVE_PIX", json={"publico": False}, headers=auth_headers)
    assert "CHAVE_PIX" not in client.get("/api/publico/instituicao").json()
    client.put("/api/instituicao/TELEFONE_INSTITUCIONAL", json={"publico": False}, headers=auth_headers)
    assert "TELEFONE_INSTITUCIONAL" not in client.get("/api/publico/instituicao").json()
    client.put("/api/instituicao/TELEFONE_INSTITUCIONAL", json={"publico": True}, headers=auth_headers)

    # o que é interno de verdade não pode ser marcado para o site
    r = client.put("/api/instituicao/EMAIL_REMETENTE", json={"publico": True}, headers=auth_headers)
    assert r.status_code == 400 and "só interno" in r.json()["detail"]
    assert "EMAIL_REMETENTE" not in client.get("/api/publico/instituicao").json()


def test_valor_vazio_limpa_o_campo_e_ele_some_do_site(client, auth_headers):
    client.put("/api/instituicao/HORARIO_ATENDIMENTO", json={"valor": "Segunda a sexta, 8h às 17h"}, headers=auth_headers)
    assert client.get("/api/publico/instituicao").json()["HORARIO_ATENDIMENTO"].startswith("Segunda")
    client.put("/api/instituicao/HORARIO_ATENDIMENTO", json={"valor": ""}, headers=auth_headers)
    assert "HORARIO_ATENDIMENTO" not in client.get("/api/publico/instituicao").json()
