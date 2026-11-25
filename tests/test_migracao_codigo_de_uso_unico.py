"""A migração b4d6f8a0c2e9 (v9.6s) só roda na homologação e na produção. Aqui ela é EXECUTADA num SQLite temporário e o resultado é comparado com
o MODELO: a coluna `usuarios.mfa_ultimo_passo_totp` (a janela do último código do autenticador aceito no login), vazia para quem já existia.
Nenhum usuário, senha ou segredo muda, e o downgrade volta ao que era."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.database import Base

_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "b4d6f8a0c2e9_v9_6s_codigo_do_autenticador_de_uso_unico.py"


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_codigo_de_uso_unico", _CAMINHO)
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
    return {c["name"] for c in sa.inspect(motor).get_columns("usuarios")}


def test_a_migracao_cria_so_o_que_o_modelo_descreve():
    motor = _banco_antes()
    assert "mfa_ultimo_passo_totp" not in _colunas(motor)
    _rodar(motor, _carregar().upgrade)
    assert "mfa_ultimo_passo_totp" in _colunas(motor)
    coluna = next(c for c in sa.inspect(motor).get_columns("usuarios") if c["name"] == "mfa_ultimo_passo_totp")
    assert coluna["nullable"] is True and isinstance(coluna["type"], sa.Integer)
    with motor.connect() as conexao:
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
    sobre_o_novo = [repr(d) for item in diferencas for d in (item if isinstance(item, list) else [item]) if "mfa_ultimo_passo_totp" in repr(d)]
    assert sobre_o_novo == [], "a migração e o modelo divergem:\n" + "\n".join(sobre_o_novo)


def test_quem_ja_existia_nao_muda_e_o_downgrade_volta_ao_que_era():
    motor = _banco_antes()
    with motor.begin() as c:
        c.execute(sa.text(
            "INSERT INTO usuarios (id_usuario, email, senha_hash, ativo, tentativas_falhas, mfa_secret, mfa_ativado, senha_provisoria) "
            "VALUES (1, 'antigo@teste.local', 'hash-antigo', 1, 0, 'SEGREDOANTIGO', 1, 0)"
        ))
    migracao = _carregar()
    _rodar(motor, migracao.upgrade)
    with motor.connect() as c:
        assert tuple(c.execute(sa.text("SELECT email, senha_hash, mfa_secret, mfa_ativado, mfa_ultimo_passo_totp FROM usuarios")).one()) == (
            "antigo@teste.local", "hash-antigo", "SEGREDOANTIGO", 1, None,
        )
    _rodar(motor, migracao.downgrade)
    assert "mfa_ultimo_passo_totp" not in _colunas(motor)
    with motor.connect() as c:
        assert tuple(c.execute(sa.text("SELECT email, mfa_secret, mfa_ativado FROM usuarios")).one()) == ("antigo@teste.local", "SEGREDOANTIGO", 1)
