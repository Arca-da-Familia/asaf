"""A migração e8a2c4f6b913 (v6.3b, as contas no site) só roda em produção. Aqui ela é EXECUTADA num SQLite temporário e comparada com o MODELO: ela só
acrescenta `documentos_institucionais.dados_publicos_json` e `lancamentos_contabeis.registrado_em` (nulas no que já existe)."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.database import Base

_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "e8a2c4f6b913_v6_3b_contas_no_site.py"


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_contas_no_site", _CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def _banco_antes():
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor)
    with motor.begin() as conexao:
        conexao.execute(sa.text("INSERT INTO documentos_institucionais (tipo, titulo, classificacao, publicar_no_site, grupo_versao, versao, vigente, situacao) "
                                "VALUES ('ATA', 'Documento que já existia', 'Interna', 0, 'g', 1, 1, 'Rascunho')"))
        conexao.execute(sa.text("ALTER TABLE documentos_institucionais DROP COLUMN dados_publicos_json"))
        conexao.execute(sa.text("ALTER TABLE lancamentos_contabeis DROP COLUMN registrado_em"))
    return motor


def _rodar(motor, funcao):
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            funcao()


def test_a_migracao_acrescenta_a_coluna_e_bate_com_o_modelo_sem_tocar_no_que_existe():
    motor = _banco_antes()
    _rodar(motor, _carregar().upgrade)
    assert "dados_publicos_json" in {c["name"] for c in sa.inspect(motor).get_columns("documentos_institucionais")}
    assert "registrado_em" in {c["name"] for c in sa.inspect(motor).get_columns("lancamentos_contabeis")}
    with motor.connect() as conexao:
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
        assert conexao.execute(sa.text("SELECT titulo, dados_publicos_json FROM documentos_institucionais")).one() == ("Documento que já existia", None)
    sobre_ela = [repr(d) for item in diferencas for d in (item if isinstance(item, list) else [item]) if "dados_publicos_json" in repr(d) or "registrado_em" in repr(d)]
    assert sobre_ela == [], "a migração e o modelo divergem:\n" + "\n".join(sobre_ela)


def test_a_migracao_continua_a_cadeia_do_alembic_sem_segunda_cabeca():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parent.parent / "alembic"))
    diretorio = ScriptDirectory.from_config(config)
    assert len(diretorio.get_heads()) == 1, diretorio.get_heads()
    assert diretorio.get_revision("e8a2c4f6b913").down_revision == "d3f6b2c8e571"


def test_o_downgrade_tira_so_as_colunas():
    motor = _banco_antes()
    migracao = _carregar()
    _rodar(motor, migracao.upgrade)
    _rodar(motor, migracao.downgrade)
    assert "dados_publicos_json" not in {c["name"] for c in sa.inspect(motor).get_columns("documentos_institucionais")}
    assert "registrado_em" not in {c["name"] for c in sa.inspect(motor).get_columns("lancamentos_contabeis")}
    with motor.connect() as conexao:
        assert conexao.execute(sa.text("SELECT titulo FROM documentos_institucionais")).scalar() == "Documento que já existia"
