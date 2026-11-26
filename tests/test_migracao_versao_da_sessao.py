"""A migração c7e9a1b3d5f0 (v9.6s, I1 da revisão de portão) só roda na homologação e na produção. Aqui ela é EXECUTADA num SQLite temporário e o
resultado é comparado com o MODELO: a coluna `usuarios.versao_da_sessao` (sobe a cada troca de senha; o token de versão anterior deixa de valer),
obrigatória e começando em 0 para quem já existia (os tokens de antes da subida, sem a versão, valem como 0: ninguém cai fora). Nenhum usuário,
senha ou segredo muda, e o downgrade volta ao que era."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.database import Base

_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "c7e9a1b3d5f0_v9_6s_troca_da_senha_encerra_as_sessoes.py"


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_versao_da_sessao", _CAMINHO)
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


def test_a_migracao_vem_depois_da_do_codigo_de_uso_unico():
    migracao = _carregar()
    assert (migracao.revision, migracao.down_revision) == ("c7e9a1b3d5f0", "b4d6f8a0c2e9")


def test_a_migracao_cria_so_o_que_o_modelo_descreve():
    motor = _banco_antes()
    assert "versao_da_sessao" not in _colunas(motor)
    _rodar(motor, _carregar().upgrade)
    assert "versao_da_sessao" in _colunas(motor)
    coluna = next(c for c in sa.inspect(motor).get_columns("usuarios") if c["name"] == "versao_da_sessao")
    assert coluna["nullable"] is False and isinstance(coluna["type"], sa.Integer)
    with motor.connect() as conexao:
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
    sobre_o_novo = [repr(d) for item in diferencas for d in (item if isinstance(item, list) else [item]) if "versao_da_sessao" in repr(d)]
    assert sobre_o_novo == [], "a migração e o modelo divergem:\n" + "\n".join(sobre_o_novo)


def test_quem_ja_existia_comeca_na_versao_zero_e_o_downgrade_volta_ao_que_era():
    motor = _banco_antes()
    with motor.begin() as c:
        c.execute(sa.text(
            "INSERT INTO usuarios (id_usuario, email, senha_hash, ativo, tentativas_falhas, mfa_secret, mfa_ativado, senha_provisoria) "
            "VALUES (1, 'antigo@teste.local', 'hash-antigo', 1, 0, 'SEGREDOANTIGO', 1, 0)"
        ))
    migracao = _carregar()
    _rodar(motor, migracao.upgrade)
    with motor.connect() as c:
        assert tuple(c.execute(sa.text("SELECT email, senha_hash, mfa_secret, mfa_ativado, versao_da_sessao FROM usuarios")).one()) == (
            "antigo@teste.local", "hash-antigo", "SEGREDOANTIGO", 1, 0,
        )
    # quem nasce depois da subida, por um INSERT que não fala da coluna, também começa em 0
    with motor.begin() as c:
        c.execute(sa.text("INSERT INTO usuarios (id_usuario, email, senha_hash, ativo, senha_provisoria) VALUES (2, 'novo@teste.local', 'h', 1, 0)"))
        assert c.execute(sa.text("SELECT versao_da_sessao FROM usuarios WHERE id_usuario = 2")).scalar_one() == 0
    _rodar(motor, migracao.downgrade)
    assert "versao_da_sessao" not in _colunas(motor)
    with motor.connect() as c:
        assert tuple(c.execute(sa.text("SELECT email, mfa_secret, mfa_ativado FROM usuarios WHERE id_usuario = 1")).one()) == (
            "antigo@teste.local", "SEGREDOANTIGO", 1,
        )
