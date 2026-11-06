"""v9.3j (pedido do Presidente, 06/11: nada de nome técnico na tela): a migração 9e3f1a7c5b20 troca as descrições gravadas pelo seed (com
"(v5.4a)", "FUSO_HORARIO", "/api/...") pelo texto novo, SÓ onde ainda está o texto do seed; a descrição editada por alguém fica. Executada aqui
num SQLite temporário. E a trava: nenhuma descrição que o seed grava hoje tem nome interno nem nota de versão."""
import ast
import importlib.util
import re
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

RAIZ = Path(__file__).resolve().parent.parent
_CAMINHO = RAIZ / "alembic" / "versions" / "9e3f1a7c5b20_v9_3j_descricoes_sem_nome_tecnico.py"
_TECNICO = re.compile(r"[a-z]+_[a-z_]+|[A-Z]{3,}_[A-Z_]+|\(v\d|\bv\d+\.\d|/api/|\.txt\b|\.py\b|\bPOST |\bGET ")


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_descricoes", _CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def _banco(migracao):
    motor = sa.create_engine("sqlite://")
    with motor.begin() as c:
        for tabela, coluna in {(t, col) for t, col, *_ in migracao.TROCAS}:
            c.execute(sa.text(f"CREATE TABLE {tabela} ({coluna} TEXT, descricao TEXT)"))
        for tabela, coluna, chave, antigo, _novo in migracao.TROCAS:
            c.execute(sa.text(f"INSERT INTO {tabela} ({coluna}, descricao) VALUES (:c, :d)"), {"c": chave, "d": antigo})
        # alguém já editou esta pelo painel: a migração não pode mexer
        c.execute(sa.text("UPDATE permissoes_sistema SET descricao = 'Texto escrito pela diretoria' WHERE codigo_permissao = 'parcerias'"))
    return motor


def _rodar(motor, funcao):
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            funcao()


def _descricao(motor, tabela, coluna, chave):
    with motor.connect() as c:
        return c.execute(sa.text(f"SELECT descricao FROM {tabela} WHERE {coluna} = :c"), {"c": chave}).scalar_one()


def test_upgrade_troca_o_texto_do_seed_e_nao_toca_no_editado_e_downgrade_volta():
    migracao = _carregar()
    motor = _banco(migracao)
    _rodar(motor, migracao.upgrade)
    assert _descricao(motor, "configuracoes_institucionais", "chave_configuracao", "HORA_INICIO_EXPEDIENTE").startswith(
        "Hora (0 a 23, no fuso horário da associação)"
    )
    assert "Nova votação" in _descricao(motor, "regras_estatutarias", "parametro", "REGRA_DESEMPATE")
    assert _descricao(motor, "permissoes_sistema", "codigo_permissao", "parcerias") == "Texto escrito pela diretoria"
    for tabela, coluna, chave, _antigo, novo in migracao.TROCAS:
        if chave != "parcerias":
            assert _descricao(motor, tabela, coluna, chave) == novo
    _rodar(motor, migracao.upgrade)  # idempotente
    _rodar(motor, migracao.downgrade)
    assert "FUSO_HORARIO" in _descricao(motor, "configuracoes_institucionais", "chave_configuracao", "HORA_INICIO_EXPEDIENTE")


def test_os_textos_novos_sao_os_do_seed_e_nao_tem_nome_tecnico():
    migracao = _carregar()
    fonte = (RAIZ / "app" / "database.py").read_text(encoding="utf-8")
    for *_, antigo, novo in migracao.TROCAS:
        assert not _TECNICO.search(novo), novo
        assert antigo not in fonte


def test_nenhuma_descricao_do_seed_tem_nome_interno_nem_nota_de_versao():
    arvore = ast.parse((RAIZ / "app" / "database.py").read_text(encoding="utf-8"))
    ruins = []
    for no in ast.walk(arvore):
        if isinstance(no, ast.Dict):
            valores = {k.value: v for k, v in zip(no.keys, no.values) if isinstance(k, ast.Constant)}
            d = valores.get("descricao")
            if isinstance(d, ast.Constant) and isinstance(d.value, str) and _TECNICO.search(d.value):
                if any(chave in valores for chave in ("chave", "parametro", "codigo_permissao", "nome_nivel")):
                    ruins.append(d.value[:80])
    assert ruins == []
