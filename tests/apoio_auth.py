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


def usuario_com_permissoes(db, *codigos: str, exige_mfa: bool = False, mfa_ativado: bool = False, senha_provisoria: bool = False,
                           nome_nivel: str | None = None) -> tuple[dict, int]:
    """v9.6s - cabeçalho e id de um usuário de um nível com EXATAMENTE estas permissões (ou de um nível semeado, pelo nome). Os testes de
    segurança de acesso escolhem o estado da conta: o nível exige o segundo passo? ele já foi cadastrado? a senha ainda é a provisória?"""
    from app.models.core import NivelAcesso, PermissaoSistema, Usuario, perfil_permissao
    from app.security import criar_access_token, hash_senha

    if nome_nivel:
        nivel = db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == nome_nivel).one()
    else:
        nivel = NivelAcesso(nome_nivel=f"nivel_acesso_{uuid.uuid4().hex[:8]}", descricao="teste", exige_mfa=exige_mfa)
        db.add(nivel)
        db.flush()
        for codigo in codigos:
            permissao = db.query(PermissaoSistema).filter(PermissaoSistema.codigo_permissao == codigo).one()
            db.execute(perfil_permissao.insert().values(id_nivel=nivel.id_nivel, id_permissao=permissao.id_permissao))
    usuario = Usuario(
        email=f"acesso_{uuid.uuid4().hex[:10]}@teste.local", senha_hash=hash_senha("SenhaForte123456"), id_nivel=nivel.id_nivel, ativo=True,
        mfa_ativado=mfa_ativado, mfa_secret="JBSWY3DPEHPK3PXP" if mfa_ativado else None, senha_provisoria=senha_provisoria,
    )
    db.add(usuario)
    db.commit()
    db.refresh(usuario)
    return {"Authorization": f"Bearer {criar_access_token(usuario)}"}, usuario.id_usuario
