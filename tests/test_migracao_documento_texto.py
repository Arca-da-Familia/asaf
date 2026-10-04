"""A migração e8b3c5a1f720 (versão pública em TEXTO) só roda em produção. Aqui ela é EXECUTADA num SQLite temporário: a coluna
nasce nula, o que já tem PDF público guardado vira "PDF", e o downgrade tira a coluna sem tocar no original."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "e8b3c5a1f720_v5_4b_versao_publica_em_texto.py"


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_texto", _CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def _banco():
    motor = sa.create_engine("sqlite://")
    with motor.begin() as c:
        c.execute(sa.text(
            "CREATE TABLE documentos_institucionais (id_documento INTEGER PRIMARY KEY, publico_nome TEXT, publico_texto TEXT, "
            "publico_sha256 TEXT, publico_tamanho INTEGER, verificacao_ok BOOLEAN, verificacao_json TEXT, verificacao_em DATETIME, "
            "situacao TEXT, original_nome TEXT)"
        ))
        c.execute(sa.text("INSERT INTO documentos_institucionais (id_documento, publico_nome, situacao, original_nome) VALUES (1, 'abc.pdf', 'Aprovado', 'o1.pdf')"))
        c.execute(sa.text("INSERT INTO documentos_institucionais (id_documento, publico_nome, situacao, original_nome) VALUES (2, NULL, 'Rascunho', 'o2.pdf')"))
    return motor


def _rodar(motor, funcao):
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            funcao()


def test_upgrade_cria_a_coluna_e_marca_como_pdf_so_quem_ja_tem_arquivo_publico():
    motor = _banco()
    _rodar(motor, _carregar().upgrade)
    with motor.connect() as c:
        linhas = dict(c.execute(sa.text("SELECT id_documento, publico_formato FROM documentos_institucionais")).fetchall())
    assert linhas == {1: "PDF", 2: None}


def test_downgrade_tira_a_coluna_e_devolve_o_documento_so_de_texto_a_rascunho_sem_perder_o_original():
    motor = _banco()
    migracao = _carregar()
    _rodar(motor, migracao.upgrade)
    with motor.begin() as c:
        c.execute(sa.text("INSERT INTO documentos_institucionais (id_documento, publico_formato, publico_texto, situacao, original_nome) VALUES (3, 'TEXTO', 'texto publicado', 'Aprovado', 'o3.pdf')"))
    _rodar(motor, migracao.downgrade)
    colunas = {c["name"] for c in sa.inspect(motor).get_columns("documentos_institucionais")}
    assert "publico_formato" not in colunas
    with motor.connect() as c:
        tres = c.execute(sa.text("SELECT situacao, publico_texto, original_nome FROM documentos_institucionais WHERE id_documento = 3")).first()
        um = c.execute(sa.text("SELECT situacao, publico_nome FROM documentos_institucionais WHERE id_documento = 1")).first()
    assert tres == ("Rascunho", None, "o3.pdf"), "texto some, o original fica e deixa de estar publicado"
    assert um == ("Aprovado", "abc.pdf"), "o documento em PDF não é tocado"
