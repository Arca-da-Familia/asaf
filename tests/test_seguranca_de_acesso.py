"""v9.6s - segurança de acesso (achados A1 a A4 da revisão de 23/11/2026, provados pelo revisor num banco próprio).

A1. Quem só cuida do cadastro (permissão `associados`) concedia acesso escolhendo o nível da conta nova: uma secretaria criava assim uma conta
    de nível Presidente, com a senha que ela mesma escolhia. Agora só quem gerencia os níveis de acesso escolhe o nível; os demais dão o nível
    padrão (o que a tela "Conceder acesso" sempre deu) e a recusa é igual para o associado e o nível que existem e os que não existem.
    O mesmo furo existia nas permissões que o CARGO dá pelo mandato (`metadados.permissoes` do catálogo `titulo_cargo`, gerido por
    `governanca`): mudar essa lista agora também é de quem gerencia os níveis de acesso."""
import time
import uuid

import pyotp
import pytest

from app.models.associados import Associado
from app.models.core import NivelAcesso, Usuario
from tests.apoio_auth import cabecalho_admin, usuario_com_permissoes
from tests.test_conceder_acesso import _criar_ficha

RECUSA_DO_NIVEL = "Só quem gerencia os níveis de acesso pode escolher o nível da conta. Sem escolher, a conta nasce no nível Associado."


def _id_do_nivel(db, nome: str) -> int:
    return db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == nome).one().id_nivel


def _conceder(client, cabecalho, id_associado, email, **extra):
    return client.post(
        f"/api/associados/{id_associado}/conceder-acesso", json={"email": email, "senha_provisoria": "SenhaDaSecretaria99", **extra}, headers=cabecalho,
    )


def test_a1_quem_so_cuida_do_cadastro_nao_escolhe_o_nivel_da_conta_e_nada_e_gravado(client, db):
    secretaria, _ = usuario_com_permissoes(db, "associados")
    # a Diretoria também tem `associados` sem gerenciar os níveis (e exige o segundo passo, aqui já cadastrado)
    diretoria, _ = usuario_com_permissoes(db, nome_nivel="Diretoria", mfa_ativado=True)
    id_associado, cpf = _criar_ficha(client)
    email = f"{cpf}@nivel.example.com"
    niveis = (_id_do_nivel(db, "Presidente"), _id_do_nivel(db, "Associado"), 987654321)  # existe e é alto, é o padrão, não existe

    for quem in (secretaria, diretoria):
        for id_nivel in niveis:
            r = _conceder(client, quem, id_associado, email, id_nivel=id_nivel)
            assert r.status_code == 403, (id_nivel, r.text)
            assert r.json()["detail"] == RECUSA_DO_NIVEL
        # um associado que não existe dá a MESMA recusa (não se descobre quem existe nem quais níveis existem)
        r = _conceder(client, quem, 987654321, email, id_nivel=niveis[0])
        assert r.status_code == 403 and r.json()["detail"] == RECUSA_DO_NIVEL

    db.expire_all()
    assert db.get(Associado, id_associado).id_usuario is None
    assert db.query(Usuario).filter(Usuario.email == email).first() is None

    # sem escolher o nível, a concessão segue como a tela faz: nível Associado, senha provisória
    r = _conceder(client, secretaria, id_associado, email)
    assert r.status_code == 200, r.text
    db.expire_all()
    conta = db.get(Usuario, r.json()["id_usuario"])
    assert conta.id_nivel == niveis[1] and conta.senha_provisoria is True


def test_a1_quem_gerencia_os_niveis_continua_escolhendo_o_nivel(client, db):
    admin = cabecalho_admin(client)
    id_associado, cpf = _criar_ficha(client)
    nao_existe = _conceder(client, admin, id_associado, f"{cpf}@gerente.example.com", id_nivel=987654321)
    assert nao_existe.status_code == 404
    r = _conceder(client, admin, id_associado, f"{cpf}@gerente.example.com", id_nivel=_id_do_nivel(db, "Conselho Fiscal"))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(Usuario, r.json()["id_usuario"]).id_nivel == _id_do_nivel(db, "Conselho Fiscal")


def _opcao_do_cargo(client, admin, codigo):
    opcoes = client.get("/api/catalogos/titulo_cargo/opcoes?incluir_inativos=true", headers=admin).json()
    return next(o for o in opcoes if o["codigo"] == codigo)


def test_a1_quem_cuida_da_governanca_nao_muda_as_permissoes_que_o_cargo_da(client, db):
    """O cargo em mandato vigente dá permissão (`metadados.permissoes`). Quem só tem `governanca` (o 1º Secretário, pelo cargo) editava o
    catálogo de cargos e podia pôr `gerenciar_acesso` no próprio cargo; agora mudar essa lista é de quem gerencia os níveis de acesso."""
    admin = cabecalho_admin(client)
    governanca, _ = usuario_com_permissoes(db, "governanca")
    secretario = _opcao_do_cargo(client, admin, "SECRETARIO")
    antes = secretario["metadados"]
    com_mais_poder = {**(antes or {}), "permissoes": [*(antes or {}).get("permissoes", []), "gerenciar_acesso"]}

    r = client.put(f"/api/opcoes-catalogo/{secretario['id_opcao']}", json={"metadados": com_mais_poder}, headers=governanca)
    assert r.status_code == 403, r.text
    assert r.json()["detail"] == "Só quem gerencia os níveis de acesso pode mudar as permissões que um cargo dá."
    r = client.post(
        "/api/catalogos/titulo_cargo/opcoes",
        json={"codigo": f"CARGO_{uuid.uuid4().hex[:6].upper()}", "rotulo": "Cargo novo", "metadados": {"permissoes": ["gerenciar_acesso"]}},
        headers=governanca,
    )
    assert r.status_code == 403, r.text
    assert _opcao_do_cargo(client, admin, "SECRETARIO")["metadados"] == antes

    # o resto da opção continua com a governança (rótulo, ordem), e quem gerencia os níveis muda as permissões
    assert client.put(f"/api/opcoes-catalogo/{secretario['id_opcao']}", json={"rotulo": secretario["rotulo"]}, headers=governanca).status_code == 200
    assert client.put(f"/api/opcoes-catalogo/{secretario['id_opcao']}", json={"metadados": antes}, headers=admin).status_code == 200


# ==========================================================================================================================================
# A2. O segundo passo do login (MFA): respeita o bloqueio por tentativas, nunca o limpa numa conta bloqueada e não aceita o mesmo código duas
#     vezes. O relógio do código é fixado pelo teste (`app.security._instante_atual`): sem isso, um teste que pede dois códigos seguidos
#     falharia sozinho quando os dois caem em janelas de 30 segundos diferentes.
# ==========================================================================================================================================
SENHA_DEFINITIVA = "SenhaDefinitiva2026"


@pytest.fixture()
def relogio(monkeypatch):
    """Um instante fixo no MEIO de uma janela de 30 s; `avancar(n)` anda n janelas."""
    import app.security

    estado = {"instante": (time.time() // 30) * 30 + 15}
    monkeypatch.setattr(app.security, "_instante_atual", lambda: estado["instante"])

    class Relogio:
        def codigo(self, segredo, janelas=0):
            return pyotp.TOTP(segredo).at(estado["instante"] + 30 * janelas)

        def avancar(self, janelas=1):
            estado["instante"] += 30 * janelas

    return Relogio()


def _conta_com_mfa(client, db) -> tuple[str, str]:
    """Uma conta como a da Diretoria: acesso concedido pela secretaria, senha trocada pelo dono, segundo passo cadastrado pelas rotas."""
    id_associado, cpf = _criar_ficha(client)
    r = _conceder(client, cabecalho_admin(client), id_associado, f"{cpf}@mfa.example.com")
    assert r.status_code == 200, r.text
    token = client.post("/auth/login", json={"cpf": cpf, "senha": "SenhaDaSecretaria99"}).json()["access_token"]
    dono = {"Authorization": f"Bearer {token}"}
    assert client.post("/auth/senha/alterar", json={"senha_atual": "SenhaDaSecretaria99", "senha_nova": SENHA_DEFINITIVA}, headers=dono).status_code == 200
    segredo = pyotp.parse_uri(client.post("/auth/mfa/ativar", headers=dono).json()["otpauth_uri"]).secret
    assert client.post("/auth/mfa/confirmar", json={"codigo_totp": pyotp.TOTP(segredo).now()}, headers=dono).status_code == 200
    return cpf, segredo


def _passo_1(client, cpf):
    r = client.post("/auth/login", json={"cpf": cpf, "senha": SENHA_DEFINITIVA})
    assert r.status_code == 200 and r.json()["requer_mfa"] is True, r.text
    return r.json()["login_temp_token"]


def _passo_2(client, cpf, temp, codigo=None, recuperacao=None):
    return client.post("/auth/login/mfa", json={"cpf": cpf, "login_temp_token": temp, "codigo_totp": codigo, "codigo_recuperacao": recuperacao})


def _errado(certo: str, i: int = 0) -> str:
    return f"{(int(certo) + 7 + i) % 1000000:06d}"


def _usuario_do_cpf(db, cpf) -> Usuario:
    db.expire_all()
    return db.query(Usuario).join(Associado, Associado.id_usuario == Usuario.id_usuario).filter(Associado.cpf == cpf).one()


def test_a2_o_segundo_passo_respeita_o_bloqueio_e_nao_o_limpa(client, db, relogio):
    cpf, segredo = _conta_com_mfa(client, db)
    temp = _passo_1(client, cpf)
    certo = relogio.codigo(segredo)
    respostas = [_passo_2(client, cpf, temp, _errado(certo, i)).status_code for i in range(8)]
    assert respostas[:5] == [401] * 5 and respostas[5:] == [429] * 3, respostas

    no_passo_1 = client.post("/auth/login", json={"cpf": cpf, "senha": SENHA_DEFINITIVA})
    assert no_passo_1.status_code == 429
    # o código CERTO, com o token temporário de antes, também recebe a recusa do bloqueio, igual à do 1º passo
    com_o_certo = _passo_2(client, cpf, temp, certo)
    assert com_o_certo.status_code == 429 and "access_token" not in com_o_certo.json()
    assert com_o_certo.json() == no_passo_1.json() and com_o_certo.headers.get("retry-after")
    assert _passo_2(client, cpf, temp, recuperacao="AAAA-BBBB-CCCC").status_code == 429
    conta = _usuario_do_cpf(db, cpf)
    assert conta.bloqueado_ate is not None and conta.tentativas_falhas >= 5, "a conta bloqueada nunca é desbloqueada pelo 2º passo"


def test_a2_acertar_a_senha_no_primeiro_passo_nao_zera_os_codigos_errados(client, db, relogio):
    """Sem isso, quem sabe a senha refazia o 1º passo a cada 4 códigos errados e nunca era bloqueado."""
    cpf, segredo = _conta_com_mfa(client, db)
    certo = relogio.codigo(segredo)
    temp = _passo_1(client, cpf)
    assert [_passo_2(client, cpf, temp, _errado(certo, i)).status_code for i in range(4)] == [401] * 4
    temp = _passo_1(client, cpf)  # a senha certa de novo
    assert _usuario_do_cpf(db, cpf).tentativas_falhas == 4
    assert _passo_2(client, cpf, temp, _errado(certo, 9)).status_code == 401
    assert _passo_2(client, cpf, temp, certo).status_code == 429


def test_a2_o_mesmo_codigo_nao_vale_duas_vezes(client, db, relogio):
    cpf, segredo = _conta_com_mfa(client, db)
    certo = relogio.codigo(segredo)
    primeiro = _passo_2(client, cpf, _passo_1(client, cpf), certo)
    assert primeiro.status_code == 200 and primeiro.json()["access_token"], primeiro.text

    de_novo = _passo_2(client, cpf, _passo_1(client, cpf), certo)
    assert de_novo.status_code == 401 and "access_token" not in de_novo.json()
    # nem o código da janela anterior (que a tolerância de relógio aceitaria) volta a valer depois de um código mais novo
    assert _passo_2(client, cpf, _passo_1(client, cpf), relogio.codigo(segredo, janelas=-1)).status_code == 401

    relogio.avancar()
    seguinte = _passo_2(client, cpf, _passo_1(client, cpf), relogio.codigo(segredo))
    assert seguinte.status_code == 200, seguinte.text
    assert _usuario_do_cpf(db, cpf).tentativas_falhas == 0  # o acerto completo (senha e código) zera as tentativas


def test_a2_o_codigo_vale_uma_vez_mesmo_em_duas_requisicoes_ao_mesmo_tempo(db):
    """A marca do último código aceito é gravada com uma condição no próprio banco: das duas gravações do mesmo passo, só a primeira vale."""
    from app.security import registrar_passo_totp

    _, id_usuario = usuario_com_permissoes(db, mfa_ativado=True)
    conta = db.get(Usuario, id_usuario)
    assert registrar_passo_totp(db, conta, 1000) is True
    assert registrar_passo_totp(db, conta, 1000) is False
    assert registrar_passo_totp(db, conta, 999) is False
    assert registrar_passo_totp(db, conta, 1001) is True


# ==========================================================================================================================================
# A3 e A4. A senha provisória e o segundo passo obrigatório do nível eram cobrados só pela TELA: pela API, a conta com a senha que a secretaria
#          conhece (e a de nível Presidente sem o segundo passo) fazia tudo. Agora o SERVIDOR cobra: enquanto a senha for a provisória, a conta só
#          vê quem é (`/auth/me`) e troca a senha; depois, enquanto o segundo passo obrigatório não estiver cadastrado, só vê quem é e o cadastra.
#          O resto recebe a mesma recusa 403, exista o registro ou não. Sair (`/auth/logout`) não depende de login.
# ==========================================================================================================================================
RECUSA_SENHA_PROVISORIA = "A sua senha ainda é a provisória, que outra pessoa definiu. Troque a senha para continuar."
RECUSA_MFA_PENDENTE = "O seu nível de acesso exige a verificação em duas etapas. Cadastre o aplicativo autenticador para continuar."
LIBERADAS_COM_A_SENHA_PROVISORIA = {("GET", "/auth/me"), ("POST", "/auth/senha/alterar")}
LIBERADAS_SEM_O_SEGUNDO_PASSO = {("GET", "/auth/me"), ("POST", "/auth/mfa/ativar"), ("POST", "/auth/mfa/confirmar")}


def _entrar(client, cpf, senha):
    r = client.post("/auth/login", json={"cpf": cpf, "senha": senha})
    assert r.status_code == 200 and r.json()["access_token"], r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_a3_e_a4_a_conta_de_nivel_presidente_so_opera_depois_de_trocar_a_senha_e_cadastrar_o_segundo_passo(client, db):
    """O caminho da prova do revisor: a conta nova de nível Presidente, com a senha que outra pessoa escolheu, abria exercício contábil."""
    id_associado, cpf = _criar_ficha(client)
    r = _conceder(client, cabecalho_admin(client), id_associado, f"{cpf}@presidente.example.com", id_nivel=_id_do_nivel(db, "Presidente"))
    assert r.status_code == 200, r.text
    conta = _entrar(client, cpf, "SenhaDaSecretaria99")
    ano = 2040 + int(uuid.uuid4().int % 50)

    eu = client.get("/auth/me", headers=conta).json()
    assert eu["senha_provisoria"] is True and eu["mfa_pendente"] is True
    for metodo, rota, corpo in (("POST", "/api/exercicios/", {"ano": ano}), ("GET", "/api/auditoria/?limite=1", None),
                                ("GET", "/api/niveis-acesso/", None), ("POST", "/auth/mfa/ativar", None)):
        r = client.request(metodo, rota, json=corpo, headers=conta)
        assert r.status_code == 403 and r.json()["detail"] == RECUSA_SENHA_PROVISORIA, (rota, r.text)

    trocou = client.post("/auth/senha/alterar", json={"senha_atual": "SenhaDaSecretaria99", "senha_nova": SENHA_DEFINITIVA}, headers=conta)
    assert trocou.status_code == 200, trocou.text
    for metodo, rota, corpo in (("POST", "/api/exercicios/", {"ano": ano}), ("GET", "/api/auditoria/?limite=1", None),
                                ("POST", "/auth/senha/alterar", {"senha_atual": SENHA_DEFINITIVA, "senha_nova": "OutraSenhaBoa2026"})):
        r = client.request(metodo, rota, json=corpo, headers=conta)
        assert r.status_code == 403 and r.json()["detail"] == RECUSA_MFA_PENDENTE, (rota, r.text)

    segredo = pyotp.parse_uri(client.post("/auth/mfa/ativar", headers=conta).json()["otpauth_uri"]).secret
    assert client.post("/auth/mfa/confirmar", json={"codigo_totp": pyotp.TOTP(segredo).now()}, headers=conta).status_code == 200
    # agora opera como Presidente (só leitura aqui: abrir um exercício depende de não haver outro aberto na suíte)
    for rota in ("/api/auditoria/?limite=1", "/api/niveis-acesso/"):
        assert client.get(rota, headers=conta).status_code == 200, rota
    assert client.get("/auth/me", headers=conta).json()["mfa_pendente"] is False


def test_a3_quem_nao_precisa_do_segundo_passo_opera_depois_de_trocar_a_senha(client, db):
    id_associado, cpf = _criar_ficha(client)
    assert _conceder(client, cabecalho_admin(client), id_associado, f"{cpf}@associado.example.com").status_code == 200
    conta = _entrar(client, cpf, "SenhaDaSecretaria99")
    assert client.get("/auth/perfil", headers=conta).json()["detail"] == RECUSA_SENHA_PROVISORIA
    trocou = client.post("/auth/senha/alterar", json={"senha_atual": "SenhaDaSecretaria99", "senha_nova": SENHA_DEFINITIVA}, headers=conta)
    assert trocou.status_code == 200, trocou.text
    assert client.get("/auth/perfil", headers=conta).status_code == 200  # o mesmo token, já sem a senha provisória


# Rotas que não usam o login do painel (o Bearer da pessoa): as públicas de propósito (a lista mantida em test_rotas_sem_login), a renovação
# da sessão, que lê o cookie do refresh (o access token que ela devolve continua passando por este portão em toda rota), a conta de visitante
# do site (entra por um código mandado ao e-mail, com sessão própria) e a portaria do evento (o token do evento, sem login de quem opera).
SEM_O_LOGIN_DO_PAINEL = {
    ("POST", "/auth/refresh"),
    ("GET", "/api/visitante/minha-conta"), ("GET", "/api/visitante/pedidos/{protocolo}/relatorio"), ("POST", "/api/visitante/sair"),
    ("POST", "/api/visitante/pedir-apagamento"),
    ("GET", "/portaria/evento"), ("POST", "/portaria/checkin"), ("POST", "/portaria/checkout"),
}


def _rotas_que_pedem_login():
    """Toda rota da API (o mesmo esquema que o painel e a varredura sem login usam), menos as que não dependem do login do painel."""
    from app.main import app
    from tests.test_rotas_sem_login import ABERTAS_DE_PROPOSITO, PREFIXOS_PUBLICOS

    for caminho, metodos in app.openapi()["paths"].items():
        for metodo in metodos:
            metodo = metodo.upper()
            if metodo not in ("GET", "POST", "PUT", "PATCH", "DELETE") or caminho.startswith(PREFIXOS_PUBLICOS):
                continue
            if (metodo, caminho) in ABERTAS_DE_PROPOSITO or (metodo, caminho) in SEM_O_LOGIN_DO_PAINEL:
                continue
            yield metodo, caminho


def _varrer(client, cabecalho, liberadas, recusa):
    import re

    recusadas, fora_da_regra, vistas = 0, [], set()
    for metodo, caminho in _rotas_que_pedem_login():
        vistas.add((metodo, caminho))
        url = re.sub(r"\{[^}]+\}", "987654321", caminho)  # um número que não existe em nenhum lugar
        r = client.request(metodo, url, json={} if metodo in ("POST", "PUT", "PATCH") else None, headers=cabecalho)
        if (metodo, caminho) in liberadas:
            if r.status_code == 403:
                fora_da_regra.append(f"{metodo} {caminho}: recusada ({r.text[:120]})")
        elif r.status_code != 403 or r.json().get("detail") != recusa:
            fora_da_regra.append(f"{metodo} {caminho}: {r.status_code} {r.text[:120]}")
        else:
            recusadas += 1
    assert liberadas <= vistas, liberadas - vistas
    assert fora_da_regra == [], "\n".join(fora_da_regra)
    assert recusadas > 400, recusadas  # a API inteira passou pela varredura (são mais de 500 rotas com login)


def test_a3_com_a_senha_provisoria_toda_a_api_recusa_igual_menos_ver_quem_e_e_trocar_a_senha(client, db):
    cabecalho, _ = usuario_com_permissoes(db, nome_nivel="Presidente", mfa_ativado=True, senha_provisoria=True)
    _varrer(client, cabecalho, LIBERADAS_COM_A_SENHA_PROVISORIA, RECUSA_SENHA_PROVISORIA)


def test_a4_sem_o_segundo_passo_obrigatorio_toda_a_api_recusa_igual_menos_ver_quem_e_e_cadastra_lo(client, db):
    cabecalho, _ = usuario_com_permissoes(db, nome_nivel="Presidente")
    _varrer(client, cabecalho, LIBERADAS_SEM_O_SEGUNDO_PASSO, RECUSA_MFA_PENDENTE)


def test_a4_a_recusa_e_igual_para_o_registro_que_existe_e_o_que_nao_existe(client, db):
    id_associado, _ = _criar_ficha(client)
    cabecalho, _ = usuario_com_permissoes(db, "associados", exige_mfa=True)
    existe = client.get(f"/api/associados/{id_associado}", headers=cabecalho)
    nao_existe = client.get("/api/associados/987654321", headers=cabecalho)
    assert existe.status_code == nao_existe.status_code == 403
    assert existe.json() == nao_existe.json() == {"detail": RECUSA_MFA_PENDENTE}


def test_a4_quem_ja_cadastrou_o_segundo_passo_e_quem_nao_precisa_dele_seguem_normalmente(client, db):
    com_o_segundo_passo, _ = usuario_com_permissoes(db, "associados", exige_mfa=True, mfa_ativado=True)
    nivel_sem_exigencia, _ = usuario_com_permissoes(db, "associados")
    for cabecalho in (com_o_segundo_passo, nivel_sem_exigencia):
        assert client.get("/api/associados/", headers=cabecalho).status_code == 200


def test_a4_o_ver_como_nao_tira_a_exigencia_do_nivel_real(client, db):
    """Quem gerencia os níveis e ainda não cadastrou o segundo passo não escapa dele "vendo como" um nível que não o exige."""
    from app.security import criar_access_token

    _, id_usuario = usuario_com_permissoes(db, "gerenciar_acesso", exige_mfa=True)
    token = criar_access_token(db.get(Usuario, id_usuario), id_nivel_impersonado=_id_do_nivel(db, "Associado"))
    r = client.get("/auth/perfil", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403 and r.json()["detail"] == RECUSA_MFA_PENDENTE
