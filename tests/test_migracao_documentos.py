"""A migração a7c1e9d3f0b2 só roda em produção (a suíte cria o schema por `create_all`). Aqui ela é EXECUTADA de
verdade, num SQLite temporário com o catálogo de cargos como já existe em produção, para provar o que importa:
acrescenta as permissões novas aos cargos CERTOS, nunca remove o que a diretoria ajustou e cria a tabela."""
import importlib.util
import json
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "a7c1e9d3f0b2_v5_4a_documentos_institucionais.py"


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_documentos", _CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def _banco(permissoes_por_cargo: dict):
    motor = sa.create_engine("sqlite://")
    with motor.begin() as c:
        c.execute(sa.text("CREATE TABLE usuarios (id_usuario INTEGER PRIMARY KEY)"))
        c.execute(sa.text("CREATE TABLE catalogos (id_catalogo INTEGER PRIMARY KEY, chave TEXT)"))
        c.execute(sa.text("CREATE TABLE opcoes_catalogo (id_opcao INTEGER PRIMARY KEY, id_catalogo INTEGER, codigo TEXT, metadados JSON)"))
        c.execute(sa.text("INSERT INTO catalogos VALUES (1, 'titulo_cargo'), (2, 'outro_catalogo')"))
        for codigo, metadados in permissoes_por_cargo.items():
            c.execute(sa.text("INSERT INTO opcoes_catalogo (id_catalogo, codigo, metadados) VALUES (1, :c, :m)"),
                      {"c": codigo, "m": json.dumps(metadados) if metadados is not None else None})
        # um catálogo que NÃO é de cargo, com um código igual: não pode ser tocado
        c.execute(sa.text("INSERT INTO opcoes_catalogo (id_catalogo, codigo, metadados) VALUES (2, 'PRESIDENTE', :m)"), {"m": json.dumps({"permissoes": ["x"]})})
    return motor


def _rodar(motor, funcao):
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            funcao()


def _permissoes(motor, id_catalogo=1):
    with motor.connect() as c:
        linhas = c.execute(sa.text("SELECT codigo, metadados FROM opcoes_catalogo WHERE id_catalogo = :i"), {"i": id_catalogo}).fetchall()
    return {codigo: (json.loads(m).get("permissoes") if m else None) for codigo, m in linhas}


def test_acrescenta_aos_cargos_certos_sem_remover_nada_do_que_a_diretoria_ajustou():
    migracao = _carregar()
    motor = _banco({
        "PRESIDENTE": {"permissoes": ["gerenciar_acesso", "financeiro"]},
        "SECRETARIO": {"permissoes": ["associados", "governanca", "permissao_que_a_diretoria_deu"]},
        "VICE_SECRETARIO": {"permissoes": ["associados"]},
        "TESOUREIRO": {"permissoes": ["financeiro"]},
        "CONSELHO_FISCAL": {"permissoes": ["financeiro", "auditoria"]},
        "DIRETOR_DE_PATRIMONIO": {},
    })
    _rodar(motor, migracao.upgrade)
    p = _permissoes(motor)
    assert p["PRESIDENTE"] == ["gerenciar_acesso", "financeiro", "documentos", "documentos_originais", "aprovar_publicacao", "parcerias"]
    assert p["SECRETARIO"] == ["associados", "governanca", "permissao_que_a_diretoria_deu", "documentos", "documentos_originais", "aprovar_publicacao"]
    assert p["VICE_SECRETARIO"] == ["associados", "documentos"] and p["TESOUREIRO"] == ["financeiro", "parcerias"]
    assert p["CONSELHO_FISCAL"] == ["financeiro", "auditoria"]  # não está na lista: intocado
    assert p["DIRETOR_DE_PATRIMONIO"] is None or "aprovar_publicacao" not in p["DIRETOR_DE_PATRIMONIO"]
    assert _permissoes(motor, 2)["PRESIDENTE"] == ["x"]  # mesmo código em OUTRO catálogo: não é tocado
    # o downgrade só remove a tabela: permissão acrescentada fica (tirar poderia cortar acesso que a diretoria ajustou)
    _rodar(motor, migracao.downgrade)
    assert "aprovar_publicacao" in _permissoes(motor)["PRESIDENTE"]


def test_so_presidente_e_secretario_ganham_aprovacao_de_publicacao():
    migracao = _carregar()
    assert [c for c, p in migracao._ACRESCENTAR_POR_CARGO.items() if "aprovar_publicacao" in p] == ["PRESIDENTE", "SECRETARIO"]


def test_nao_duplica_se_a_permissao_ja_existe_e_nao_quebra_sem_o_catalogo():
    migracao = _carregar()
    motor = _banco({"PRESIDENTE": {"permissoes": ["documentos", "aprovar_publicacao"]}})
    _rodar(motor, migracao.upgrade)
    assert _permissoes(motor)["PRESIDENTE"] == ["documentos", "aprovar_publicacao", "documentos_originais", "parcerias"]

    sem_catalogo = sa.create_engine("sqlite://")
    with sem_catalogo.begin() as c:
        c.execute(sa.text("CREATE TABLE usuarios (id_usuario INTEGER PRIMARY KEY)"))
        c.execute(sa.text("CREATE TABLE catalogos (id_catalogo INTEGER PRIMARY KEY, chave TEXT)"))
        c.execute(sa.text("CREATE TABLE opcoes_catalogo (id_opcao INTEGER PRIMARY KEY, id_catalogo INTEGER, codigo TEXT, metadados JSON)"))
    _rodar(sem_catalogo, migracao.upgrade)  # banco novo sem o catálogo ainda: só cria a tabela


def test_cria_a_tabela_com_as_colunas_e_indices_e_o_downgrade_a_remove():
    migracao = _carregar()
    motor = _banco({})
    _rodar(motor, migracao.upgrade)
    inspetor = sa.inspect(motor)
    colunas = {c["name"] for c in inspetor.get_columns("documentos_institucionais")}
    assert {"id_documento", "tipo", "classificacao", "original_nome", "publico_nome", "verificacao_json", "situacao",
            "id_usuario_envio_revisao", "id_usuario_aprovacao", "grupo_versao", "vigente"} <= colunas
    indices = {i["name"] for i in inspetor.get_indexes("documentos_institucionais")}
    assert "ix_documentos_institucionais_situacao" in indices and "ix_documentos_institucionais_tipo" in indices
    _rodar(motor, migracao.downgrade)
    assert not sa.inspect(motor).has_table("documentos_institucionais")


def test_o_seed_novo_ja_nasce_igual_a_migracao():
    """Banco novo (seed) e banco existente (migração) têm que chegar no MESMO resultado."""
    import re

    import app.database as banco

    codigo = Path(banco.__file__).read_text(encoding="utf-8")
    migracao = _carregar()
    for cargo, acrescentar in migracao._ACRESCENTAR_POR_CARGO.items():
        linha = next(l for l in codigo.splitlines() if f'("{cargo}",' in l)
        permissoes = re.search(r'"permissoes": \[(.*?)\]', linha).group(1)
        for permissao in acrescentar:
            assert f'"{permissao}"' in permissoes, f"{cargo}: {permissao} está na migração mas não no seed"
