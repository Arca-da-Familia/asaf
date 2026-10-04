"""A migração b5e2d8f1a436 só roda em produção (a suíte cria o schema por `create_all`). Aqui ela é EXECUTADA de
verdade num SQLite temporário e o resultado é comparado com os MODELOS: se alguém mudar um modelo sem escrever a
migração (ou o contrário), o banco real de produção ficaria diferente do que o código espera - e só se descobriria
no deploy."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401  (registra todos os modelos em Base.metadata)
from app.database import Base

_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "b5e2d8f1a436_v5_4a_parcerias_e_emendas.py"
_TABELAS_NOVAS = ("parcerias", "parcelas_parceria", "etapas_parceria", "relatorios_parceria", "lancamentos_parceria")


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_parcerias", _CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def _banco_antes_da_migracao():
    motor = sa.create_engine("sqlite://")
    anteriores = [t for nome, t in Base.metadata.tables.items() if nome not in _TABELAS_NOVAS]
    Base.metadata.create_all(motor, tables=anteriores)
    return motor


def _rodar(motor, funcao):
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            funcao()


def test_a_migracao_cria_exatamente_o_que_os_modelos_descrevem():
    migracao = _carregar()
    motor = _banco_antes_da_migracao()
    _rodar(motor, migracao.upgrade)
    assert set(_TABELAS_NOVAS) <= set(sa.inspect(motor).get_table_names())

    with motor.connect() as conexao:
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
    sobre_as_tabelas_novas = []
    for item in diferencas:
        itens = item if isinstance(item, list) else [item]
        for d in itens:
            texto = repr(d)
            if any(tabela in texto for tabela in _TABELAS_NOVAS):
                sobre_as_tabelas_novas.append(texto)
    assert sobre_as_tabelas_novas == [], "a migração e os modelos divergem:\n" + "\n".join(sobre_as_tabelas_novas)


def test_o_downgrade_remove_as_cinco_tabelas_e_so_elas():
    migracao = _carregar()
    motor = _banco_antes_da_migracao()
    antes = set(sa.inspect(motor).get_table_names())
    _rodar(motor, migracao.upgrade)
    _rodar(motor, migracao.downgrade)
    assert set(sa.inspect(motor).get_table_names()) == antes


def test_a_cadeia_de_migracoes_tem_um_unico_head_depois_desta():
    migracao = _carregar()
    assert migracao.down_revision == "a7c1e9d3f0b2"
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))
    config.set_main_option("script_location", str(Path(__file__).resolve().parent.parent / "alembic"))
    assert ScriptDirectory.from_config(config).get_heads() == ["b5e2d8f1a436"]
