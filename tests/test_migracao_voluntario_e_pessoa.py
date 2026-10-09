"""A migração a8d4f1c7e592 só roda em produção. Aqui ela é EXECUTADA num SQLite temporário: o banco no estado ANTERIOR (sem `alocacoes_voluntarios.id_pessoa` nem
`atendimentos.data_nascimento`) recebe uma alocação antiga, a migração sobe, e o resultado é conferido (a pessoa de cada alocação vem do associado dela) e comparado com
o MODELO. Alocação sem associado não tem como descobrir a pessoa: a migração para com uma mensagem clara em vez de inventar."""
import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.database import Base

_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "a8d4f1c7e592_v5_5b_voluntario_e_pessoa.py"
_TABELAS = ("atendimentos", "alocacoes_voluntarios")


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_voluntario_e_pessoa", _CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def _rodar(motor, funcao):
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            funcao()


def _recriar_sem_a_coluna(motor, nome_tabela: str, coluna: str) -> None:
    """Refaz a tabela como ela era ANTES da migração (sem a coluna nova, com os índices e as chaves estrangeiras das outras colunas). A tabela de onde se copia o desenho
    é a do modelo; a nova vive num `MetaData` à parte que já conhece as tabelas referenciadas."""
    original = Base.metadata.tables[nome_tabela]
    meta = sa.MetaData()
    for outra in Base.metadata.sorted_tables:
        if outra.name != nome_tabela:
            outra.to_metadata(meta)
    colunas = [
        sa.Column(c.name, c.type, *[sa.ForeignKey(fk.target_fullname) for fk in c.foreign_keys], primary_key=c.primary_key, nullable=c.nullable)
        for c in original.columns if c.name != coluna
    ]
    indices = [(i.name, [c.name for c in i.columns], i.unique) for i in original.indexes if coluna not in {c.name for c in i.columns}]
    with motor.begin() as conexao:
        conexao.execute(sa.text(f"DROP TABLE {nome_tabela}"))
    tabela = sa.Table(nome_tabela, meta, *colunas)
    for nome, cols, unico in indices:
        sa.Index(nome, *[tabela.c[c] for c in cols], unique=unico)
    tabela.create(motor)


def _banco_no_estado_anterior():
    """O banco completo do modelo atual, com as duas tabelas como a produção as tem antes de subir (sem `id_pessoa` e sem `data_nascimento`)."""
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor)
    _recriar_sem_a_coluna(motor, "alocacoes_voluntarios", "id_pessoa")
    _recriar_sem_a_coluna(motor, "atendimentos", "data_nascimento")
    assert "id_pessoa" not in {c["name"] for c in sa.inspect(motor).get_columns("alocacoes_voluntarios")}
    assert "data_nascimento" not in {c["name"] for c in sa.inspect(motor).get_columns("atendimentos")}
    return motor


def _inserir_alocacao_antiga(motor, *, com_associado: bool):
    with motor.begin() as c:
        c.execute(sa.text("INSERT INTO pessoas (id_pessoa, nome_completo) VALUES (7, 'Voluntária Antiga')"))
        colunas_do_associado = {col["name"]: col for col in sa.inspect(motor).get_columns("associados")}
        obrigatorias = [n for n, col in colunas_do_associado.items() if not col["nullable"] and n not in ("id_associado", "id_pessoa") and col.get("default") is None]
        valores = {n: ("x" if str(colunas_do_associado[n]["type"]).upper().startswith(("VARCHAR", "TEXT", "STRING")) else 0) for n in obrigatorias}
        nomes = ", ".join(["id_associado", "id_pessoa", *valores])
        marcas = ", ".join([":id_associado", ":id_pessoa", *[f":{n}" for n in valores]])
        c.execute(sa.text(f"INSERT INTO associados ({nomes}) VALUES ({marcas})"), {"id_associado": 3, "id_pessoa": 7, **valores})
        c.execute(
            sa.text("INSERT INTO alocacoes_voluntarios (id_projeto, id_associado, funcao_desempenhada, status) VALUES (1, :a, 'Apoio', 'CONFIRMADA')"),
            {"a": 3 if com_associado else None},
        )


def test_a_migracao_preenche_a_pessoa_de_cada_alocacao_e_fica_igual_ao_modelo():
    motor = _banco_no_estado_anterior()
    _inserir_alocacao_antiga(motor, com_associado=True)
    _rodar(motor, _carregar().upgrade)
    with motor.connect() as c:
        linha = c.execute(sa.text("SELECT id_pessoa, id_associado FROM alocacoes_voluntarios")).one()
    assert tuple(linha) == (7, 3)
    with motor.connect() as conexao:
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
    sobre_as_tabelas = []
    for item in diferencas:
        for d in item if isinstance(item, list) else [item]:
            if any(tabela in repr(d) for tabela in _TABELAS):
                sobre_as_tabelas.append(repr(d))
    # a deriva antiga das chaves estrangeiras em ciclo (outras tabelas) não é desta migração; as DESTAS duas tabelas têm de bater
    assert sobre_as_tabelas == [], "a migração e o modelo divergem:\n" + "\n".join(sobre_as_tabelas)
    indices = {i["name"] for i in sa.inspect(motor).get_indexes("alocacoes_voluntarios")}
    assert "ix_alocacoes_voluntarios_id_pessoa" in indices


def test_alocacao_sem_associado_para_a_migracao_com_mensagem_clara_e_nao_inventa_nada():
    motor = _banco_no_estado_anterior()
    _inserir_alocacao_antiga(motor, com_associado=False)
    with pytest.raises(RuntimeError, match="sem associado"):
        _rodar(motor, _carregar().upgrade)
    # a migração roda numa transação: nada ficou pela metade
    colunas = {c["name"] for c in sa.inspect(motor).get_columns("alocacoes_voluntarios")}
    assert "id_pessoa" not in colunas


def test_o_downgrade_volta_ao_estado_anterior_num_banco_migrado_de_verdade():
    motor = _banco_no_estado_anterior()
    migracao = _carregar()
    _rodar(motor, migracao.upgrade)
    _rodar(motor, migracao.downgrade)
    assert "id_pessoa" not in {c["name"] for c in sa.inspect(motor).get_columns("alocacoes_voluntarios")}
    assert "data_nascimento" not in {c["name"] for c in sa.inspect(motor).get_columns("atendimentos")}


def test_a_migracao_continua_a_cadeia_sem_segunda_cabeca():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parent.parent / "alembic"))
    diretorio = ScriptDirectory.from_config(config)
    assert len(diretorio.get_heads()) == 1, diretorio.get_heads()
    assert diretorio.get_revision("a8d4f1c7e592").down_revision == "f2b7d9e4a613"
