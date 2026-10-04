"""A migração a7d2f4c8b931 só roda em produção. Aqui ela é EXECUTADA num SQLite temporário e o resultado é comparado com o
MODELO (colunas, índices, FKs): se alguém mudar o modelo sem a migração, o banco real ficaria diferente do que o código espera.
Também se confere que ela não toca em dado existente (projeto e evento antigos ficam sem destaque e sem projeto)."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.database import Base

_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "a7d2f4c8b931_v5_5_projeto_em_destaque_e_contexto_do_evento.py"
_TABELA_NOVA = "fotos_evento"


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_projeto_destaque", _CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def _rodar(motor, funcao):
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            funcao()


def _banco_antes():
    """O banco como estava antes da migração: sem a tabela nova e sem as duas colunas novas (o modelo inteiro, menos o que ela
    traz — o SQLite não apaga coluna com chave estrangeira, então a volta é feita pelo próprio `downgrade`, que usa `batch`)."""
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor)
    _rodar(motor, _carregar().downgrade)
    return motor


def _diferencas_sobre(motor, nomes):
    with motor.connect() as conexao:
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
    achadas = []
    for item in diferencas:
        for d in item if isinstance(item, list) else [item]:
            if any(nome in repr(d) for nome in nomes):
                achadas.append(repr(d))
    return achadas


def test_a_migracao_cria_exatamente_o_que_o_modelo_descreve():
    motor = _banco_antes()
    _rodar(motor, _carregar().upgrade)
    inspetor = sa.inspect(motor)
    assert _TABELA_NOVA in inspetor.get_table_names()
    assert "id_projeto" in {c["name"] for c in inspetor.get_columns("eventos")}
    assert "destaque_no_site" in {c["name"] for c in inspetor.get_columns("projetos_eventos")}
    achadas = _diferencas_sobre(motor, (_TABELA_NOVA, "id_projeto", "destaque_no_site"))
    assert achadas == [], "a migração e o modelo divergem:\n" + "\n".join(achadas)


def test_projeto_e_evento_antigos_nao_mudam():
    motor = _banco_antes()
    with motor.begin() as conexao:
        conexao.execute(sa.text(
            "INSERT INTO projetos_eventos (nome_projeto, tipo_foco, fase_pdca, status_liberacao, status, visibilidade, necessita_alvara_bombeiros) "
            "VALUES ('Projeto antigo', 'Social', 'Plan', 'Não Aplicável', 'PLANEJAMENTO', 'Pública', 0)"
        ))
        conexao.execute(sa.text(
            "INSERT INTO eventos (titulo, categoria, data_hora_inicio, vagas_ocupadas, gratuito, visibilidade, prazo_cancelamento_horas) "
            "VALUES ('Evento antigo', 'PALESTRA', '2026-01-01 10:00:00', 0, 1, 'Pública', 24)"
        ))
    _rodar(motor, _carregar().upgrade)
    with motor.connect() as conexao:
        projeto = conexao.execute(sa.text("SELECT nome_projeto, destaque_no_site FROM projetos_eventos")).one()
        evento = conexao.execute(sa.text("SELECT titulo, id_projeto FROM eventos")).one()
    assert tuple(projeto) == ("Projeto antigo", 0), "o projeto antigo nasce SEM destaque"
    assert tuple(evento) == ("Evento antigo", None), "o evento antigo nasce sem projeto"


def test_o_downgrade_volta_ao_que_era():
    motor = _banco_antes()
    antes_tabelas = set(sa.inspect(motor).get_table_names())
    antes_eventos = {c["name"] for c in sa.inspect(motor).get_columns("eventos")}
    antes_projetos = {c["name"] for c in sa.inspect(motor).get_columns("projetos_eventos")}
    migracao = _carregar()
    _rodar(motor, migracao.upgrade)
    _rodar(motor, migracao.downgrade)
    inspetor = sa.inspect(motor)
    assert set(inspetor.get_table_names()) == antes_tabelas
    assert {c["name"] for c in inspetor.get_columns("eventos")} == antes_eventos
    assert {c["name"] for c in inspetor.get_columns("projetos_eventos")} == antes_projetos
