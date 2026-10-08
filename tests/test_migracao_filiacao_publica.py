"""A migração e7c3d9a4b158 só roda em produção. Aqui ela é EXECUTADA num SQLite temporário (partindo de uma `propostas_filiacao` sem as três colunas novas) e o
resultado é comparado com o MODELO: se alguém mudar o modelo sem a migração, o banco real ficaria diferente do que o código espera."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.database import Base

_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "e7c3d9a4b158_v5_4h_filiacao_publica_declaracoes.py"
_COLUNAS = ("consentimento_lgpd_em", "consentimento_lgpd_versao", "autorizacao_responsavel_declarada")


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_filiacao_publica", _CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def _colunas(motor) -> set[str]:
    return {c["name"] for c in sa.inspect(motor).get_columns("propostas_filiacao")}


def _rodar(motor, funcao):
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            funcao()


def _banco_antes():
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor)
    with motor.begin() as conexao:
        for coluna in _COLUNAS:
            conexao.execute(sa.text(f"ALTER TABLE propostas_filiacao DROP COLUMN {coluna}"))
    assert not set(_COLUNAS) & _colunas(motor)
    return motor


def test_a_migracao_acrescenta_exatamente_o_que_o_modelo_descreve():
    motor = _banco_antes()
    _rodar(motor, _carregar().upgrade)
    assert set(_COLUNAS) <= _colunas(motor)
    with motor.connect() as conexao:
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
    sobre_a_tabela = []
    for item in diferencas:
        for d in item if isinstance(item, list) else [item]:
            if "propostas_filiacao" in repr(d):
                sobre_a_tabela.append(repr(d))
    assert sobre_a_tabela == [], "a migração e o modelo divergem:\n" + "\n".join(sobre_a_tabela)


def test_o_downgrade_remove_so_as_tres_colunas():
    motor = _banco_antes()
    antes = _colunas(motor)
    migracao = _carregar()
    _rodar(motor, migracao.upgrade)
    _rodar(motor, migracao.downgrade)
    assert _colunas(motor) == antes


def test_os_pedidos_que_ja_existem_continuam_intactos_depois_da_migracao():
    motor = _banco_antes()
    with motor.begin() as conexao:
        conexao.execute(sa.text("INSERT INTO propostas_filiacao (nome_completo, cpf, status) VALUES ('Antigo', '12345678909', 'Pendente')"))
    _rodar(motor, _carregar().upgrade)
    with motor.connect() as conexao:
        linha = conexao.execute(sa.text("SELECT nome_completo, consentimento_lgpd_em, autorizacao_responsavel_declarada FROM propostas_filiacao")).one()
    assert tuple(linha) == ("Antigo", None, None)
