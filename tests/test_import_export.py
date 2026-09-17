"""v0.3.5 - importação/exportação. Cobre upsert por chave/código (nunca apaga o que não está no
arquivo), chave de configuração desconhecida sendo ignorada (nunca criada) e o round-trip
export -> import ser idempotente."""
import uuid


def test_exportar_traz_catalogos_e_configuracoes(client, auth_headers):
    resposta = client.get("/api/configuracoes/exportar", headers=auth_headers)
    assert resposta.status_code == 200
    corpo = resposta.json()
    assert "catalogos" in corpo and "configuracoes" in corpo
    assert len(corpo["configuracoes"]) == 26  # ver tests/test_configuracoes.py para a decomposição
    assert len(corpo["catalogos"]) > 0


def test_importar_cria_catalogo_novo_e_ignora_chave_de_config_desconhecida(client, auth_headers):
    chave = f"import_teste_{uuid.uuid4().hex[:8]}"
    payload = {
        "catalogos": [
            {
                "chave": chave, "nome_exibido": "Catálogo via import", "editavel_pelo_usuario": True,
                "opcoes": [{"codigo": "A", "rotulo": "Opção A", "ordem": 0, "ativo": True}],
            }
        ],
        "configuracoes": [{"chave": "CHAVE_QUE_NAO_EXISTE", "valor": "x"}],
    }
    resposta = client.post("/api/configuracoes/importar", headers=auth_headers, json=payload)
    assert resposta.status_code == 200
    resumo = resposta.json()
    assert resumo["catalogos_criados"] == 1
    assert resumo["opcoes_criadas"] == 1
    assert resumo["configuracoes_ignoradas"] == ["CHAVE_QUE_NAO_EXISTE"]

    opcoes = client.get(f"/api/catalogos/{chave}/opcoes", headers=auth_headers).json()
    assert opcoes[0]["codigo"] == "A"


def test_reimportar_export_completo_e_idempotente(client, auth_headers):
    exportado = client.get("/api/configuracoes/exportar", headers=auth_headers).json()

    resposta = client.post("/api/configuracoes/importar", headers=auth_headers, json=exportado)
    assert resposta.status_code == 200
    resumo = resposta.json()

    assert resumo["catalogos_criados"] == 0
    assert resumo["opcoes_criadas"] == 0
    assert resumo["configuracoes_ignoradas"] == []
    assert resumo["catalogos_atualizados"] == len(exportado["catalogos"])


def test_importar_sem_autenticacao_falha(client):
    resposta = client.post("/api/configuracoes/importar", json={"catalogos": [], "configuracoes": []})
    assert resposta.status_code == 401
