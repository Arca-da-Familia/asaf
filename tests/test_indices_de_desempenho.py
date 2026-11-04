"""v9.2b - os índices de desempenho: a lista do modelo e a da migração são a mesma, cada tabela e coluna existe, o banco criado pelos modelos tem os índices,
e a migração cria e apaga todos (no SQLite; o Postgres do CI roda a migração de verdade, descendo e subindo)."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory

from app.database import Base
from app.models import indices_de_desempenho

RAIZ = Path(__file__).resolve().parent.parent
CAMINHO = RAIZ / "alembic" / "versions" / "63e4f4c4065a_v9_2b_indices_de_desempenho.py"


def _migracao():
    especificacao = importlib.util.spec_from_file_location("migracao_indices", CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def test_a_lista_do_modelo_e_a_da_migracao_sao_iguais():
    assert _migracao().INDICES == indices_de_desempenho.INDICES


def test_cada_tabela_e_coluna_existe_e_o_modelo_tem_o_indice():
    for nome, tabela, colunas in indices_de_desempenho.INDICES:
        t = Base.metadata.tables[tabela]
        assert all(c in t.c for c in colunas), (tabela, colunas)
        indice = next(ix for ix in t.indexes if ix.name == nome)
        assert [c.name for c in indice.columns] == colunas


def test_os_nomes_sao_unicos():
    nomes = [n for n, _, _ in indices_de_desempenho.INDICES]
    assert len(nomes) == len(set(nomes))


def test_a_migracao_cria_e_apaga(tmp_path):
    motor = sa.create_engine(f"sqlite:///{(tmp_path / 'm.db').as_posix()}")
    tabelas = {t for _, t, _ in indices_de_desempenho.INDICES}
    nomes = {n for n, _, _ in indices_de_desempenho.INDICES}
    # o banco inteiro pelos modelos e, depois, SEM os índices novos (como estava antes da migração)
    Base.metadata.create_all(motor)
    with motor.begin() as conexao:
        for nome in nomes:
            conexao.exec_driver_sql(f"DROP INDEX {nome}")
    migracao = _migracao()
    with motor.begin() as conexao, Operations.context(MigrationContext.configure(conexao)):
        migracao.upgrade()
    criados = {ix["name"] for t in tabelas for ix in sa.inspect(motor).get_indexes(t)}
    assert nomes <= criados
    with motor.begin() as conexao, Operations.context(MigrationContext.configure(conexao)):
        migracao.downgrade()
    sobraram = {ix["name"] for t in tabelas for ix in sa.inspect(motor).get_indexes(t)}
    assert not (nomes & sobraram)


def test_e_a_cabeca_unica_das_migracoes():
    config = Config()
    config.set_main_option("script_location", str(RAIZ / "alembic"))
    diretorio = ScriptDirectory.from_config(config)
    assert len(diretorio.get_heads()) == 1 and diretorio.get_revision("63e4f4c4065a").down_revision == "ccf5cbf31408"
