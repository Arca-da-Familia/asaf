"""Os testes compartilham um só banco, então sobram mandatos vigentes de testes anteriores. Desde a v5.4d cada cargo tem um titular (três
no Conselho Fiscal), então quem precisa dar posse num cargo libera o cargo antes."""


def liberar_cargo(client, auth_headers, orgao_codigo, cargo_codigo):
    """Encerra, pela API, todo mandato vigente do cargo (renúncia): o próximo posse não esbarra na regra de vagas."""
    vigentes = client.get(f"/api/mandatos/?orgao_codigo={orgao_codigo}&apenas_vigentes=true", headers=auth_headers).json()
    for mandato in vigentes:
        if mandato["cargo_codigo"] == cargo_codigo:
            r = client.post(f"/api/mandatos/{mandato['id_mandato']}/encerrar", headers=auth_headers, json={"motivo": "Renúncia"})
            assert r.status_code == 200, r.text
