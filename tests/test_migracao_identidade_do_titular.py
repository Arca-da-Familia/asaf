"""A migração b9e2c5a7d014 (v5.7f) só roda em produção. Aqui ela é EXECUTADA num SQLite temporário e o resultado é comparado com o MODELO: sem este teste, o banco real poderia ficar diferente do que
o código espera (e a Deploy API só descobriria na primeira solicitação de titular). Ela acrescenta quatro colunas VAZIAS a `atendimentos` e não mexe em nenhuma linha que já existe."""
import importlib.util
from datetime import datetime
from pathlib import Path

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.database import Base

_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "b9e2c5a7d014_v5_7f_identidade_de_quem_pede_dado_pessoal.py"
_COLUNAS_NOVAS = ("identidade_validacao", "identidade_validada_em", "id_usuario_validacao", "identidade_nota", "motivo_visivel_ao_titular")


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_identidade_do_titular", _CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def _rodar(motor, funcao):
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            funcao()


def _colunas(motor) -> set[str]:
    return {c["name"] for c in sa.inspect(motor).get_columns("atendimentos")}


def _banco_antes():
    """O banco como era antes da v5.7f: o esquema atual do modelo, depois de desfeita a migração (o `downgrade` tira exatamente as quatro colunas)."""
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor)
    _rodar(motor, _carregar().downgrade)
    return motor


def test_a_migracao_acrescenta_exatamente_o_que_o_modelo_descreve():
    motor = _banco_antes()
    assert not set(_COLUNAS_NOVAS) & _colunas(motor)
    _rodar(motor, _carregar().upgrade)
    assert set(_COLUNAS_NOVAS) <= _colunas(motor)
    with motor.connect() as conexao:
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
    sobre_o_que_ela_mexe = []
    for item in diferencas:
        for d in item if isinstance(item, list) else [item]:
            if "atendimentos" in repr(d) and any(nome in repr(d) for nome in _COLUNAS_NOVAS):
                sobre_o_que_ela_mexe.append(repr(d))
    assert sobre_o_que_ela_mexe == [], "a migração e o modelo divergem:\n" + "\n".join(sobre_o_que_ela_mexe)
    chaves = [fk for fk in sa.inspect(motor).get_foreign_keys("atendimentos") if fk["constrained_columns"] == ["id_usuario_validacao"]]
    assert chaves and chaves[0]["referred_table"] == "usuarios"


def test_o_pedido_que_ja_existe_continua_igual_com_as_colunas_novas_vazias_e_o_downgrade_devolve_o_banco():
    motor = _banco_antes()
    agora = datetime(2026, 10, 19, 12, 0, 0)
    with motor.begin() as conexao:
        conexao.execute(
            sa.text(
                "INSERT INTO atendimentos (protocolo, tipo, subtipo, mensagem, nome_completo, email_contato, origem, status, prazo_dias, prazo_em, criado_em, atualizado_em) "
                "VALUES ('ASAF-2026-00001', 'TITULAR_LGPD', 'ACESSO', 'Quero ver os meus dados.', 'Pessoa Antiga', 'antiga@example.com', 'site', 'Novo', 15, :prazo, :agora, :agora)"
            ),
            {"prazo": datetime(2026, 11, 3, 12, 0, 0), "agora": agora},
        )
    _rodar(motor, _carregar().upgrade)
    with motor.connect() as conexao:
        linha = conexao.execute(sa.text("SELECT protocolo, nome_completo, status, identidade_validacao, identidade_validada_em, id_usuario_validacao, identidade_nota, motivo_visivel_ao_titular FROM atendimentos")).one()
    assert tuple(linha) == ("ASAF-2026-00001", "Pessoa Antiga", "Novo", None, None, None, None, None)
    _rodar(motor, _carregar().downgrade)
    assert not set(_COLUNAS_NOVAS) & _colunas(motor)
    with motor.connect() as conexao:
        assert conexao.execute(sa.text("SELECT COUNT(*) FROM atendimentos")).scalar() == 1, "o downgrade não apaga pedido"
