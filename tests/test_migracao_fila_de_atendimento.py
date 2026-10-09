"""A migração f2b7d9e4a613 só roda em produção. Aqui ela é EXECUTADA num SQLite temporário e o resultado é comparado com o MODELO (colunas, índices, FKs): se alguém
mudar o modelo sem a migração, o banco real ficaria diferente do que o código espera."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.database import Base

_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "f2b7d9e4a613_v5_5a_fila_unica_de_atendimento.py"
_TABELAS = ("atendimentos",)


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_fila_de_atendimento", _CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def _banco_antes():
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[t for nome, t in Base.metadata.tables.items() if nome not in _TABELAS])
    return motor


def _rodar(motor, funcao):
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            funcao()


def test_a_migracao_cria_exatamente_o_que_o_modelo_descreve():
    motor = _banco_antes()
    _rodar(motor, _carregar().upgrade)
    assert set(_TABELAS) <= set(sa.inspect(motor).get_table_names())
    with motor.connect() as conexao:
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
    sobre_a_tabela = []
    for item in diferencas:
        for d in item if isinstance(item, list) else [item]:
            if any(tabela in repr(d) for tabela in _TABELAS):
                sobre_a_tabela.append(repr(d))
    assert sobre_a_tabela == [], "a migração e o modelo divergem:\n" + "\n".join(sobre_a_tabela)
    # o protocolo é único no banco, não só na lógica
    indices = {i["name"]: i for i in sa.inspect(motor).get_indexes("atendimentos")}
    assert indices["ix_atendimentos_protocolo"]["unique"] in (1, True)


def test_a_migracao_continua_a_cadeia_do_alembic_sem_segunda_cabeca():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parent.parent / "alembic"))
    diretorio = ScriptDirectory.from_config(config)
    assert len(diretorio.get_heads()) == 1, diretorio.get_heads()
    assert diretorio.get_revision("f2b7d9e4a613").down_revision == "e7c3d9a4b158"


def test_o_downgrade_remove_so_a_tabela_da_fila():
    motor = _banco_antes()
    antes = set(sa.inspect(motor).get_table_names())
    migracao = _carregar()
    _rodar(motor, migracao.upgrade)
    _rodar(motor, migracao.downgrade)
    assert set(sa.inspect(motor).get_table_names()) == antes
