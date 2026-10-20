"""v5.7g - o atalho "Editar o site" (Directus) tem permissão PRÓPRIA, `editar_site`: a secretaria ou a comunicação a recebe pela tela Níveis e permissões sem ganhar poder sobre o acesso do sistema.

As promessas que estes testes travam:
  1. por padrão a Presidência (nível e cargo) tem `editar_site` e nenhum outro nível ou cargo a tem; ter `gerenciar_acesso` não dá `editar_site` a quem é criado depois;
  2. a migração c4a8e2f6d913, EXECUTADA num SQLite temporário com os dados de um banco que já existe, dá `editar_site` a todo nível e a todo cargo que tinha `gerenciar_acesso` (o atalho de quem já o via
     não some) e NADA mais muda; rodar de novo não duplica; se o semeador já criou a permissão, ela não duplica; num banco novo sem nível nem cargo não falha; o downgrade desfaz;
  3. quem só tem `editar_site` não ganha nenhuma permissão de administração do acesso."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.database import Base
from app.models.core import Catalogo, NivelAcesso, OpcaoCatalogo, PermissaoSistema, perfil_permissao

_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "c4a8e2f6d913_v5_7g_editar_site_permissao_propria.py"
_TABELAS = ("permissoes_sistema", "niveis_acesso", "perfil_permissao", "catalogos", "opcoes_catalogo")


# ------------------------------------------------------------------------------------------------ 1. o que o sistema semeia
def test_a_presidencia_tem_a_permissao_nova_por_padrao_e_ninguem_mais(client, db):
    permissao = db.query(PermissaoSistema).filter(PermissaoSistema.codigo_permissao == "editar_site").one()
    assert permissao.modulo == "core" and "Directus" in permissao.descricao
    donos = {
        nome for (nome,) in db.query(NivelAcesso.nome_nivel)
        .join(perfil_permissao, perfil_permissao.c.id_nivel == NivelAcesso.id_nivel)
        .filter(perfil_permissao.c.id_permissao == permissao.id_permissao).all()
    }
    assert donos == {"Presidente"}, donos
    opcao = (
        db.query(OpcaoCatalogo).join(Catalogo, Catalogo.id_catalogo == OpcaoCatalogo.id_catalogo)
        .filter(Catalogo.chave == "titulo_cargo", OpcaoCatalogo.codigo == "PRESIDENTE").one()
    )
    assert "editar_site" in opcao.metadados["permissoes"] and "gerenciar_acesso" in opcao.metadados["permissoes"]
    outros = (
        db.query(OpcaoCatalogo).join(Catalogo, Catalogo.id_catalogo == OpcaoCatalogo.id_catalogo)
        .filter(Catalogo.chave == "titulo_cargo", OpcaoCatalogo.codigo != "PRESIDENTE").all()
    )
    assert [o.codigo for o in outros if "editar_site" in (o.metadados or {}).get("permissoes", [])] == []


def test_o_usuario_da_presidencia_recebe_a_permissao_em_auth_me(client, auth_headers):
    me = client.get("/auth/me", headers=auth_headers)
    assert me.status_code == 200, me.text
    assert "editar_site" in me.json()["permissoes"]


# ------------------------------------------------------------------------------------------------ 2. a migração
def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_editar_site", _CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def _rodar(motor, funcao):
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            funcao()


def _banco_com_dados(com_dados: bool = True):
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[Base.metadata.tables[t] for t in _TABELAS])
    if not com_dados:
        return motor
    with motor.begin() as c:
        for codigo in ("gerenciar_acesso", "associados", "atendimento"):
            c.execute(sa.insert(PermissaoSistema), {"modulo": "x", "codigo_permissao": codigo, "descricao": codigo})
        ids = {codigo: c.execute(sa.select(PermissaoSistema.id_permissao).where(PermissaoSistema.codigo_permissao == codigo)).scalar() for codigo in ("gerenciar_acesso", "associados", "atendimento")}
        for nome in ("Presidente", "Secretaria de acesso", "Diretoria"):
            c.execute(sa.insert(NivelAcesso), {"nome_nivel": nome, "descricao": nome, "exige_mfa": False})
        niveis = {nome: c.execute(sa.select(NivelAcesso.id_nivel).where(NivelAcesso.nome_nivel == nome)).scalar() for nome in ("Presidente", "Secretaria de acesso", "Diretoria")}
        for nome, codigos in (("Presidente", ("gerenciar_acesso", "associados")), ("Secretaria de acesso", ("gerenciar_acesso",)), ("Diretoria", ("associados", "atendimento"))):
            for codigo in codigos:
                c.execute(sa.insert(perfil_permissao).values(id_nivel=niveis[nome], id_permissao=ids[codigo]))
        c.execute(sa.insert(Catalogo), {"chave": "titulo_cargo", "nome_exibido": "Título de cargo"})
        id_catalogo = c.execute(sa.select(Catalogo.id_catalogo)).scalar()
        c.execute(sa.insert(OpcaoCatalogo), {"id_catalogo": id_catalogo, "codigo": "PRESIDENTE", "rotulo": "Presidente", "metadados": {"permissoes": ["gerenciar_acesso", "associados"]}})
        c.execute(sa.insert(OpcaoCatalogo), {"id_catalogo": id_catalogo, "codigo": "SECRETARIO", "rotulo": "1º Secretário", "metadados": {"permissoes": ["associados", "atendimento"]}})
    return motor


def _do_nivel(motor, nome: str) -> set[str]:
    with motor.connect() as c:
        linhas = c.execute(
            sa.select(PermissaoSistema.codigo_permissao)
            .join(perfil_permissao, perfil_permissao.c.id_permissao == PermissaoSistema.id_permissao)
            .join(NivelAcesso, NivelAcesso.id_nivel == perfil_permissao.c.id_nivel)
            .where(NivelAcesso.nome_nivel == nome)
        ).all()
    return {codigo for (codigo,) in linhas}


def _do_cargo(motor, codigo: str) -> set[str]:
    with motor.connect() as c:
        metadados = c.execute(sa.select(OpcaoCatalogo.metadados).where(OpcaoCatalogo.codigo == codigo)).scalar()
    return set(metadados["permissoes"])


def test_quem_ja_tinha_o_atalho_continua_com_ele_e_nada_mais_muda():
    motor = _banco_com_dados()
    _rodar(motor, _carregar().upgrade)
    assert _do_nivel(motor, "Presidente") == {"gerenciar_acesso", "associados", "editar_site"}
    assert _do_nivel(motor, "Secretaria de acesso") == {"gerenciar_acesso", "editar_site"}, "todo nível com gerenciar_acesso ganha"
    assert _do_nivel(motor, "Diretoria") == {"associados", "atendimento"}, "quem não tinha gerenciar_acesso não ganha"
    assert _do_cargo(motor, "PRESIDENTE") == {"gerenciar_acesso", "associados", "editar_site"}
    assert _do_cargo(motor, "SECRETARIO") == {"associados", "atendimento"}, "outro cargo não é tocado"
    with motor.connect() as c:
        assert c.execute(sa.select(sa.func.count()).select_from(PermissaoSistema)).scalar() == 4, "só a permissão nova foi criada"


def test_rodar_de_novo_nao_duplica_e_a_permissao_ja_semeada_nao_duplica():
    motor = _banco_com_dados()
    with motor.begin() as c:
        c.execute(sa.insert(PermissaoSistema), {"modulo": "core", "codigo_permissao": "editar_site", "descricao": "já semeada"})
    migracao = _carregar()
    _rodar(motor, migracao.upgrade)
    _rodar(motor, migracao.upgrade)
    with motor.connect() as c:
        assert c.execute(sa.select(sa.func.count()).select_from(PermissaoSistema).where(PermissaoSistema.codigo_permissao == "editar_site")).scalar() == 1
        assert c.execute(sa.select(sa.func.count()).select_from(perfil_permissao)).scalar() == 5 + 2, "2 níveis ganharam, uma vez cada"
    assert _do_cargo(motor, "PRESIDENTE") == {"gerenciar_acesso", "associados", "editar_site"}


def test_num_banco_novo_sem_nivel_nem_cargo_a_migracao_nao_falha():
    motor = _banco_com_dados(com_dados=False)
    _rodar(motor, _carregar().upgrade)
    with motor.connect() as c:
        assert c.execute(sa.select(PermissaoSistema.codigo_permissao)).scalars().all() == ["editar_site"]


def test_o_downgrade_tira_a_permissao_de_tudo_e_a_apaga():
    motor = _banco_com_dados()
    migracao = _carregar()
    _rodar(motor, migracao.upgrade)
    _rodar(motor, migracao.downgrade)
    assert _do_nivel(motor, "Presidente") == {"gerenciar_acesso", "associados"}
    assert _do_nivel(motor, "Secretaria de acesso") == {"gerenciar_acesso"}
    assert _do_cargo(motor, "PRESIDENTE") == {"gerenciar_acesso", "associados"}
    with motor.connect() as c:
        assert c.execute(sa.select(sa.func.count()).select_from(PermissaoSistema).where(PermissaoSistema.codigo_permissao == "editar_site")).scalar() == 0


def test_a_migracao_continua_a_cadeia_do_alembic_sem_segunda_cabeca():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parent.parent / "alembic"))
    diretorio = ScriptDirectory.from_config(config)
    assert len(diretorio.get_heads()) == 1, diretorio.get_heads()
    assert diretorio.get_revision("c4a8e2f6d913").down_revision == "b9e2c5a7d014"
