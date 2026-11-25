"""Cabeçalho de administrador para os testes que chamam, de propósito, rotas que exigem login.

Contexto (v5.4c, achado AO VIVO ao varrer a API sem login, 2026-10-05): várias rotas antigas do protótipo (cadastro direto de associado,
busca, dependentes, carteirinha, autoatendimento) funcionavam SEM login, e a própria suíte dependia disso. Fechadas as rotas, os
testes que as usam passam o cabeçalho do administrador da sessão: `headers=cabecalho_admin(client)`.

O administrador é criado uma vez por sessão (o `bootstrap-admin` só funciona num banco sem usuário nenhum) e é reaproveitado pelo
fixture `admin_token` do conftest.

v9.6s (achados A3 e A4 da revisão de 23/11/2026): o servidor passou a cobrar o segundo passo obrigatório do nível em toda rota, e o
administrador é do nível Presidente (que o exige). Por isso ele cadastra o segundo passo UMA vez por sessão, pelas rotas de verdade (como a
pessoa faz na tela), e a partir daí recebe o token direto (`criar_access_token`), sem passar pelo login a cada teste: o código do aplicativo
autenticador vale uma vez só (achado A2), então entrar de novo na mesma janela de 30 segundos seria recusado."""
import uuid

import pyotp

_credenciais: tuple[str, str] | None = None
_admin: tuple[int, int] | None = None  # (id_usuario, id_nivel) do administrador, depois do segundo passo cadastrado


class _UsuarioDoToken:
    """Só o que `criar_access_token` lê do usuário."""

    def __init__(self, id_usuario: int, id_nivel: int):
        self.id_usuario, self.id_nivel = id_usuario, id_nivel


def token_admin(client) -> str:
    global _credenciais, _admin
    from app.security import criar_access_token

    if _credenciais is None:
        cpf = str(uuid.uuid4().int)[:11]
        senha = "SenhaForte123456"
        resposta = client.post(
            "/auth/bootstrap-admin",
            json={"cpf": cpf, "nome_completo": "Admin de Teste", "email": f"{cpf}@teste.local", "senha": senha},
        )
        assert resposta.status_code == 200, resposta.text
        _credenciais = (cpf, senha)
    if _admin is None:
        cpf, senha = _credenciais
        login = client.post("/auth/login", json={"cpf": cpf, "senha": senha})
        assert login.status_code == 200, login.text
        assert login.json()["requer_mfa"] is False  # bootstrap-admin não ativa MFA: o Presidente o cadastra agora, como na tela
        cabecalho = {"Authorization": f"Bearer {login.json()['access_token']}"}
        eu = client.get("/auth/me", headers=cabecalho).json()
        assert eu["mfa_pendente"] is True, eu
        segredo = pyotp.parse_uri(client.post("/auth/mfa/ativar", headers=cabecalho).json()["otpauth_uri"]).secret
        confirmado = client.post("/auth/mfa/confirmar", json={"codigo_totp": pyotp.TOTP(segredo).now()}, headers=cabecalho)
        assert confirmado.status_code == 200, confirmado.text
        from app.database import SessaoLocal
        from app.models.core import Usuario

        with SessaoLocal() as db:
            usuario = db.get(Usuario, eu["id_usuario"])
            _admin = (usuario.id_usuario, usuario.id_nivel)
    return criar_access_token(_UsuarioDoToken(*_admin))


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


SENHA_DEFINITIVA_DOS_TESTES = "SenhaDefinitivaDoTeste2026"


def entrar_trocando_a_senha_provisoria(client, cpf: str, senha_provisoria: str) -> dict:
    """v9.6s (achado A3) - a conta que acabou de ganhar acesso entra com a senha provisória e, como a pessoa faz na tela, troca a senha antes
    de operar: o servidor recusa todo o resto enquanto ela for a provisória. Devolve o cabeçalho da conta, já com a senha definitiva."""
    login = client.post("/auth/login", json={"cpf": cpf, "senha": senha_provisoria})
    assert login.status_code == 200, login.text
    cabecalho = {"Authorization": f"Bearer {login.json()['access_token']}"}
    troca = client.post(
        "/auth/senha/alterar", json={"senha_atual": senha_provisoria, "senha_nova": SENHA_DEFINITIVA_DOS_TESTES}, headers=cabecalho,
    )
    assert troca.status_code == 200, troca.text
    return cabecalho


def com_o_segundo_passo_se_o_nivel_exige(db, usuario) -> None:
    """v9.6s - para os testes que criam direto no banco uma conta de nível que exige o segundo passo (Presidente, Diretoria...): na vida real
    ela só opera depois de cadastrá-lo (o servidor cobra desde a v9.6s), então a conta do teste nasce com ele cadastrado."""
    from app.models.core import NivelAcesso

    nivel = db.query(NivelAcesso).filter(NivelAcesso.id_nivel == usuario.id_nivel).first()
    if nivel is not None and nivel.exige_mfa and not usuario.mfa_ativado:
        usuario.mfa_ativado, usuario.mfa_secret = True, pyotp.random_base32()
        db.commit()
