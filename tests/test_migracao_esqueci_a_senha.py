"""A migração d3f6b2c8e571 (Esqueci a minha senha) só roda em produção. Aqui ela é EXECUTADA num SQLite temporário e o resultado é comparado com o MODELO (tabela, colunas, índices, chave
estrangeira): se alguém mudar o modelo sem a migração, o banco real ficaria diferente do que o código espera. Ela só cria `codigos_de_nova_senha`."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.database import Base

_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "d3f6b2c8e571_esqueci_a_senha.py"
_TABELA = "codigos_de_nova_senha"


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_esqueci_a_senha", _CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def _banco_antes():
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[t for nome, t in Base.metadata.tables.items() if nome != _TABELA])
    return motor


def _rodar(motor, funcao):
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            funcao()


def test_a_migracao_cria_exatamente_o_que_o_modelo_descreve():
    motor = _banco_antes()
    _rodar(motor, _carregar().upgrade)
    inspetor = sa.inspect(motor)
    assert _TABELA in inspetor.get_table_names()
    with motor.connect() as conexao:
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
    sobre_ela = [repr(d) for item in diferencas for d in (item if isinstance(item, list) else [item]) if _TABELA in repr(d)]
    assert sobre_ela == [], "a migração e o modelo divergem:\n" + "\n".join(sobre_ela)
    chaves = inspetor.get_foreign_keys(_TABELA)
    assert [(c["name"], c["referred_table"]) for c in chaves] == [("fk_codigos_de_nova_senha_id_usuario", "usuarios")]


def test_a_migracao_continua_a_cadeia_do_alembic_sem_segunda_cabeca():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parent.parent / "alembic"))
    diretorio = ScriptDirectory.from_config(config)
    assert len(diretorio.get_heads()) == 1, diretorio.get_heads()
    assert diretorio.get_revision("d3f6b2c8e571").down_revision == "c9e5a1b3d468"


def test_o_downgrade_desfaz_so_o_que_a_migracao_fez():
    motor = _banco_antes()
    antes = set(sa.inspect(motor).get_table_names())
    migracao = _carregar()
    _rodar(motor, migracao.upgrade)
    _rodar(motor, migracao.downgrade)
    assert set(sa.inspect(motor).get_table_names()) == antes
