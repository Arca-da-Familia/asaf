"""A migração d5a2b8c3e641 só roda em produção. Aqui ela é EXECUTADA num SQLite temporário e o resultado é comparado com o MODELO (colunas, índices,
FKs, restrição única): se alguém mudar o modelo sem a migração, o banco real ficaria diferente do que o código espera."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.database import Base

_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "d5a2b8c3e641_v5_4h_filiacao_proposta_por_socios_e_notificacoes.py"
_TABELAS = ("propostas_de_socios", "notificacoes_painel")


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_filiacao_socios", _CAMINHO)
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
    sobre_as_tabelas = []
    for item in diferencas:
        for d in item if isinstance(item, list) else [item]:
            if any(tabela in repr(d) for tabela in _TABELAS):
                sobre_as_tabelas.append(repr(d))
    assert sobre_as_tabelas == [], "a migração e o modelo divergem:\n" + "\n".join(sobre_as_tabelas)
    # o mesmo sócio não decide duas vezes sobre o mesmo pedido: a restrição existe no banco, não só na lógica
    unicas = sa.inspect(motor).get_unique_constraints("propostas_de_socios")
    assert any(set(u["column_names"]) == {"id_proposta", "id_associado"} for u in unicas)


def test_o_downgrade_remove_so_as_duas_tabelas():
    motor = _banco_antes()
    antes = set(sa.inspect(motor).get_table_names())
    migracao = _carregar()
    _rodar(motor, migracao.upgrade)
    _rodar(motor, migracao.downgrade)
    assert set(sa.inspect(motor).get_table_names()) == antes
