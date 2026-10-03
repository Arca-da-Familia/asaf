"""A migração que corrige "II Crônicas" -> "I Crônicas" em VERSICULOS_BASE roda só em produção (a suíte
cria o schema pelo create_all). Aqui ela é EXECUTADA de verdade, num banco temporário, para provar o que
importa: troca só o valor exato do seed, nunca sobrescreve edição humana, é idempotente e reversível."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "c3f8a1d07b94_corrige_versiculos_base_i_cronicas.py"


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_versiculos", _CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def _banco(valor):
    motor = sa.create_engine("sqlite://")
    with motor.begin() as c:
        c.execute(sa.text("CREATE TABLE configuracoes_institucionais (chave_configuracao TEXT, valor_configuracao TEXT)"))
        c.execute(sa.text("INSERT INTO configuracoes_institucionais VALUES ('VERSICULOS_BASE', :v), ('OUTRA', :v)"), {"v": valor})
    return motor


def _rodar(motor, funcao):
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            funcao()


def _valores(motor):
    with motor.connect() as c:
        return dict(c.execute(sa.text("SELECT chave_configuracao, valor_configuracao FROM configuracoes_institucionais")).fetchall())


def test_troca_o_valor_exato_do_seed_e_so_dessa_chave():
    migracao = _carregar()
    motor = _banco("II Crônicas 4:9-10")
    _rodar(motor, migracao.upgrade)
    valores = _valores(motor)
    assert valores["VERSICULOS_BASE"] == "I Crônicas 4:9-10"
    assert valores["OUTRA"] == "II Crônicas 4:9-10"  # outra chave com o mesmo texto não é tocada


def test_nao_sobrescreve_valor_editado_por_uma_pessoa():
    migracao = _carregar()
    motor = _banco("Salmo 23:1")
    _rodar(motor, migracao.upgrade)
    assert _valores(motor)["VERSICULOS_BASE"] == "Salmo 23:1"


def test_e_idempotente_e_reversivel():
    migracao = _carregar()
    motor = _banco("II Crônicas 4:9-10")
    _rodar(motor, migracao.upgrade)
    _rodar(motor, migracao.upgrade)  # de novo: nada muda
    assert _valores(motor)["VERSICULOS_BASE"] == "I Crônicas 4:9-10"
    _rodar(motor, migracao.downgrade)
    assert _valores(motor)["VERSICULOS_BASE"] == "II Crônicas 4:9-10"


def test_o_seed_novo_ja_nasce_correto():
    from app.database import seed_configuracoes_institucionais  # noqa: F401  (garante que o módulo importa)
    import app.database as banco

    codigo = Path(banco.__file__).read_text(encoding="utf-8")
    assert '"valor": "I Crônicas 4:9-10"' in codigo
    assert '"valor": "II Crônicas 4:9-10"' not in codigo
