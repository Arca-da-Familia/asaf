"""A migração b3e8c5a1d7f4 só roda em produção. Aqui ela é EXECUTADA num SQLite temporário e o resultado é comparado com o MODELO (as quatro colunas novas de `eventos`):
se alguém mudar o modelo sem a migração, o banco real ficaria diferente do que o código espera. Também se confere que todo evento que já existia nasce `Programado`, sem
motivo e sem data anterior, e que o downgrade volta ao que era."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.database import Base

_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "b3e8c5a1d7f4_v5_5d_status_do_evento.py"
_COLUNAS_DESTA_MIGRACAO = {"status", "motivo_status", "status_alterado_em", "data_hora_inicio_anterior"}


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_status_do_evento", _CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def _rodar(motor, funcao):
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            funcao()


def _banco_antes():
    """O banco como estava antes da migração: o modelo inteiro, menos as quatro colunas (a volta é feita pelo próprio `downgrade`)."""
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor)
    _rodar(motor, _carregar().downgrade)
    return motor


def _colunas_de_eventos(motor):
    return {c["name"] for c in sa.inspect(motor).get_columns("eventos")}


def test_a_migracao_cria_exatamente_o_que_o_modelo_descreve():
    motor = _banco_antes()
    assert not (_COLUNAS_DESTA_MIGRACAO & _colunas_de_eventos(motor))
    _rodar(motor, _carregar().upgrade)
    assert _COLUNAS_DESTA_MIGRACAO <= _colunas_de_eventos(motor)
    with motor.connect() as conexao:
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
    achadas = []
    for item in diferencas:
        for d in item if isinstance(item, list) else [item]:
            if d[0] in ("add_column", "remove_column") and d[2] == "eventos" and d[3].name in _COLUNAS_DESTA_MIGRACAO:
                achadas.append(repr(d))
            elif d[0].startswith("modify_") and d[2] == "eventos" and d[3] in _COLUNAS_DESTA_MIGRACAO:
                achadas.append(repr(d))
    assert achadas == [], "a migração e o modelo divergem:\n" + "\n".join(achadas)


def test_evento_antigo_nasce_programado_e_nada_mais_muda():
    motor = _banco_antes()
    with motor.begin() as conexao:
        conexao.execute(sa.text(
            "INSERT INTO eventos (titulo, categoria, data_hora_inicio, vagas_ocupadas, gratuito, visibilidade, prazo_cancelamento_horas) "
            "VALUES ('Evento antigo', 'PALESTRA', '2026-01-01 10:00:00', 3, 1, 'Pública', 24)"
        ))
    _rodar(motor, _carregar().upgrade)
    with motor.connect() as conexao:
        evento = conexao.execute(sa.text(
            "SELECT titulo, vagas_ocupadas, visibilidade, status, motivo_status, status_alterado_em, data_hora_inicio_anterior FROM eventos"
        )).one()
    assert tuple(evento) == ("Evento antigo", 3, "Pública", "Programado", None, None, None)


def test_o_downgrade_volta_ao_que_era():
    motor = _banco_antes()
    antes = _colunas_de_eventos(motor)
    migracao = _carregar()
    _rodar(motor, migracao.upgrade)
    _rodar(motor, migracao.downgrade)
    assert _colunas_de_eventos(motor) == antes
