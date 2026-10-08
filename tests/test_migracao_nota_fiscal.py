"""A migração c4f9a1e6b270 só roda em produção. Aqui ela é EXECUTADA num SQLite temporário e o resultado é comparado com o MODELO: se alguém mudar o
modelo sem a migração, o banco real ficaria diferente do que o código espera. Também se confere que título antigo não muda (fica sem nota)."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.database import Base

_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "c4f9a1e6b270_v5_4h_nota_fiscal_do_titulo.py"


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_nota_fiscal", _CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def _rodar(motor, funcao):
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            funcao()


def _banco_antes():
    """O banco como era antes da migração: o modelo inteiro, sem a coluna nova (a volta é feita pelo próprio `downgrade`)."""
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor)
    _rodar(motor, _carregar().downgrade)
    return motor


def _colunas(motor):
    return {c["name"] for c in sa.inspect(motor).get_columns("titulos_financeiros")}


def test_a_migracao_cria_so_a_coluna_que_o_modelo_descreve():
    motor = _banco_antes()
    assert "nota_fiscal" not in _colunas(motor)
    _rodar(motor, _carregar().upgrade)
    assert "nota_fiscal" in _colunas(motor)
    with motor.connect() as conexao:
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
    sobre_a_coluna = []
    for item in diferencas:
        for d in item if isinstance(item, list) else [item]:
            if "nota_fiscal" in repr(d):
                sobre_a_coluna.append(repr(d))
    assert sobre_a_coluna == [], "a migração e o modelo divergem:\n" + "\n".join(sobre_a_coluna)


def test_titulo_antigo_nao_muda_e_o_downgrade_volta_ao_que_era():
    motor = _banco_antes()
    with motor.begin() as conexao:
        conexao.execute(sa.text("INSERT INTO titulos_financeiros (tipo_titulo, descricao, status) VALUES ('A Pagar', 'Título antigo', 'Pago')"))
    migracao = _carregar()
    _rodar(motor, migracao.upgrade)
    with motor.connect() as conexao:
        linha = conexao.execute(sa.text("SELECT descricao, status, nota_fiscal FROM titulos_financeiros")).one()
    assert tuple(linha) == ("Título antigo", "Pago", None)
    _rodar(motor, migracao.downgrade)
    assert "nota_fiscal" not in _colunas(motor)
