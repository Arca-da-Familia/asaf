"""Cabeçalho de administrador para os testes que chamam, de propósito, rotas que exigem login.

Contexto (v5.4c, achado AO VIVO ao varrer a API sem login, 2026-10-05): várias rotas antigas do protótipo (cadastro direto de associado,
busca, dependentes, carteirinha, autoatendimento) funcionavam SEM login, e a própria suíte dependia disso. Fechadas as rotas, os
testes que as usam passam o cabeçalho do administrador da sessão: `headers=cabecalho_admin(client)`.

O administrador é criado uma vez por sessão (o `bootstrap-admin` só funciona num banco sem usuário nenhum) e é reaproveitado pelo
fixture `admin_token` do conftest."""
import uuid

_credenciais: tuple[str, str] | None = None


def token_admin(client) -> str:
    global _credenciais
    if _credenciais is None:
        cpf = str(uuid.uuid4().int)[:11]
        senha = "SenhaForte123456"
        resposta = client.post(
            "/auth/bootstrap-admin",
            json={"cpf": cpf, "nome_completo": "Admin de Teste", "email": f"{cpf}@teste.local", "senha": senha},
        )
        assert resposta.status_code == 200, resposta.text
        _credenciais = (cpf, senha)
    cpf, senha = _credenciais
    login = client.post("/auth/login", json={"cpf": cpf, "senha": senha})
    assert login.status_code == 200, login.text
    assert login.json()["requer_mfa"] is False  # bootstrap-admin não ativa MFA
    return login.json()["access_token"]


def cabecalho_admin(client) -> dict:
    return {"Authorization": f"Bearer {token_admin(client)}"}
