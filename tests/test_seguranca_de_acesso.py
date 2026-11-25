"""v9.6s - segurança de acesso (achados A1 a A4 da revisão de 23/11/2026, provados pelo revisor num banco próprio).

A1. Quem só cuida do cadastro (permissão `associados`) concedia acesso escolhendo o nível da conta nova: uma secretaria criava assim uma conta
    de nível Presidente, com a senha que ela mesma escolhia. Agora só quem gerencia os níveis de acesso escolhe o nível; os demais dão o nível
    padrão (o que a tela "Conceder acesso" sempre deu) e a recusa é igual para o associado e o nível que existem e os que não existem.
    O mesmo furo existia nas permissões que o CARGO dá pelo mandato (`metadados.permissoes` do catálogo `titulo_cargo`, gerido por
    `governanca`): mudar essa lista agora também é de quem gerencia os níveis de acesso."""
import uuid

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
