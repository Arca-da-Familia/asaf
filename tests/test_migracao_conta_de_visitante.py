"""A migração e6b3c9d2f8a4 (v5.6b) só roda em produção. Aqui ela é EXECUTADA num SQLite temporário e o resultado é comparado com o MODELO (tabelas, colunas, índices): se alguém mudar o modelo sem a
migração, o banco real ficaria diferente do que o código espera. Ela cria `codigos_de_visitante` e `sessoes_de_visitante` e acrescenta `inscricoes.email_da_inscricao` (com índice)."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.database import Base

_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "e6b3c9d2f8a4_v5_6b_conta_de_visitante.py"
_TABELAS_NOVAS = ("codigos_de_visitante", "sessoes_de_visitante")


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_conta_de_visitante", _CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def _banco_antes():
    """O banco como era antes da v5.6b: sem as duas tabelas e sem a coluna nova de `inscricoes`."""
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[t for nome, t in Base.metadata.tables.items() if nome not in _TABELAS_NOVAS])
    with motor.begin() as conexao:
        conexao.execute(sa.text("DROP INDEX ix_inscricoes_email_da_inscricao"))
        conexao.execute(sa.text("ALTER TABLE inscricoes DROP COLUMN email_da_inscricao"))
    return motor


def _rodar(motor, funcao):
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            funcao()


def test_a_migracao_cria_exatamente_o_que_o_modelo_descreve():
    motor = _banco_antes()
    assert "email_da_inscricao" not in {c["name"] for c in sa.inspect(motor).get_columns("inscricoes")}
    _rodar(motor, _carregar().upgrade)
    inspetor = sa.inspect(motor)
    assert set(_TABELAS_NOVAS) <= set(inspetor.get_table_names())
    assert "email_da_inscricao" in {c["name"] for c in inspetor.get_columns("inscricoes")}
    with motor.connect() as conexao:
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
    sobre_o_que_ela_mexe = []
    for item in diferencas:
        for d in item if isinstance(item, list) else [item]:
            if any(nome in repr(d) for nome in (*_TABELAS_NOVAS, "email_da_inscricao")):
                sobre_o_que_ela_mexe.append(repr(d))
    assert sobre_o_que_ela_mexe == [], "a migração e o modelo divergem:\n" + "\n".join(sobre_o_que_ela_mexe)
    # a sessão é única pelo que o banco guarda (a impressão), não só na lógica
    indices = {i["name"]: i for i in inspetor.get_indexes("sessoes_de_visitante")}
    assert indices["ix_sessoes_de_visitante_token_hash"]["unique"] in (1, True)
    assert "ix_inscricoes_email_da_inscricao" in {i["name"] for i in inspetor.get_indexes("inscricoes")}


def test_a_migracao_continua_a_cadeia_do_alembic_sem_segunda_cabeca():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parent.parent / "alembic"))
    diretorio = ScriptDirectory.from_config(config)
    assert len(diretorio.get_heads()) == 1, diretorio.get_heads()
    assert diretorio.get_revision("e6b3c9d2f8a4").down_revision == "d5a2b8c1e7f3"


def test_o_downgrade_desfaz_so_o_que_a_migracao_fez_e_nao_toca_nas_inscricoes():
    motor = _banco_antes()
    with motor.begin() as conexao:
        conexao.execute(sa.text("INSERT INTO pessoas (id_pessoa, nome_completo) VALUES (1, 'Pessoa de Teste')"))
        conexao.execute(sa.text("INSERT INTO inscricoes (contexto_tipo, id_contexto, id_pessoa, status) VALUES ('Evento', 1, 1, 'Confirmado')"))
    antes = set(sa.inspect(motor).get_table_names())
    migracao = _carregar()
    _rodar(motor, migracao.upgrade)
    _rodar(motor, migracao.downgrade)
    inspetor = sa.inspect(motor)
    assert set(inspetor.get_table_names()) == antes
    assert "email_da_inscricao" not in {c["name"] for c in inspetor.get_columns("inscricoes")}
    with motor.connect() as conexao:
        assert conexao.execute(sa.text("SELECT status FROM inscricoes")).scalar() == "Confirmado", "a inscrição que já existia continua intacta"
