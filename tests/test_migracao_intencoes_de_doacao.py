"""A migração d5a2b8c1e7f3 só roda em produção. Aqui ela é EXECUTADA num SQLite temporário e o resultado é comparado com o MODELO (tabela `intencoes_de_doacao`, índices, chaves estrangeiras): se alguém
mudar o modelo sem a migração, o banco real ficaria diferente do que o código espera. Também se confere que o downgrade volta ao que era."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.database import Base

_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "d5a2b8c1e7f3_v5_6a_intencoes_de_doacao.py"
_TABELA = "intencoes_de_doacao"


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_intencoes_de_doacao", _CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def _rodar(motor, funcao):
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            funcao()


def _banco_antes():
    """O banco como estava antes da migração: o modelo inteiro, menos a tabela nova (a volta é feita pelo próprio `downgrade`)."""
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor)
    _rodar(motor, _carregar().downgrade)
    return motor


def _da_tabela(d) -> bool:
    operacao = d[0]
    if operacao in ("add_table", "remove_table"):
        return d[1].name == _TABELA
    if operacao in ("add_column", "remove_column"):
        return d[2] == _TABELA
    if operacao.startswith("modify_"):
        return d[2] == _TABELA
    objeto = d[1]  # índice, chave estrangeira ou restrição
    return getattr(getattr(objeto, "table", None), "name", None) == _TABELA


def test_a_migracao_cria_exatamente_o_que_o_modelo_descreve():
    motor = _banco_antes()
    assert _TABELA not in sa.inspect(motor).get_table_names()
    _rodar(motor, _carregar().upgrade)
    inspetor = sa.inspect(motor)
    assert _TABELA in inspetor.get_table_names()
    # o protocolo é único (nunca dois pedidos com o mesmo número) e as chaves estrangeiras existem de verdade
    assert any(i["column_names"] == ["protocolo"] and i["unique"] for i in inspetor.get_indexes(_TABELA))
    destinos = {(tuple(fk["constrained_columns"]), fk["referred_table"]) for fk in inspetor.get_foreign_keys(_TABELA)}
    assert destinos == {(("id_campanha",), "campanhas_arrecadacao"), (("id_doacao",), "doacoes"), (("id_usuario_resolucao",), "usuarios")}
    with motor.connect() as conexao:
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
    achadas = [repr(d) for item in diferencas for d in (item if isinstance(item, list) else [item]) if _da_tabela(d)]
    assert achadas == [], "a migração e o modelo divergem:\n" + "\n".join(achadas)


def test_o_downgrade_volta_ao_que_era_sem_tocar_em_nada_mais():
    motor = _banco_antes()
    antes = set(sa.inspect(motor).get_table_names())
    migracao = _carregar()
    _rodar(motor, migracao.upgrade)
    _rodar(motor, migracao.downgrade)
    assert set(sa.inspect(motor).get_table_names()) == antes
