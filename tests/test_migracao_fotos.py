"""A migração f5c1d9e7a283 só roda em produção. Aqui ela é EXECUTADA num SQLite temporário e o resultado é comparado com o
MODELO (colunas, índices, FKs): se alguém mudar o modelo sem a migração, o banco real ficaria diferente do que o código espera."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.database import Base

_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "f5c1d9e7a283_v5_4b_fotos_das_etapas.py"
_TABELA = "fotos_etapa_parceria"


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_fotos", _CAMINHO)
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
    assert _TABELA in sa.inspect(motor).get_table_names()
    with motor.connect() as conexao:
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
    sobre_a_tabela = []
    for item in diferencas:
        for d in item if isinstance(item, list) else [item]:
            if _TABELA in repr(d):
                sobre_a_tabela.append(repr(d))
    assert sobre_a_tabela == [], "a migração e o modelo divergem:\n" + "\n".join(sobre_a_tabela)


def test_o_downgrade_remove_so_a_tabela_das_fotos():
    motor = _banco_antes()
    antes = set(sa.inspect(motor).get_table_names())
    migracao = _carregar()
    _rodar(motor, migracao.upgrade)
    _rodar(motor, migracao.downgrade)
    assert set(sa.inspect(motor).get_table_names()) == antes
