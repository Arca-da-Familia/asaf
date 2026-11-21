"""A migração a9c3e5f7b1d2 (v9.6a) só roda na homologação e na produção. Aqui ela é EXECUTADA num SQLite temporário e o resultado é comparado com o
MODELO: a forma de pagamento do associado (todos começam no "Mensal", que é o que já se cobrava), a conta de receita a reconhecer do plano e a
opção "Semestral" no catálogo. Nenhum associado, plano ou título existente muda, e o downgrade volta ao que era."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.database import Base

_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "a9c3e5f7b1d2_v9_6a_cobranca_por_periodicidade.py"
_NOVAS = {("associados", "periodicidade_contribuicao"), ("planos_contribuicao", "id_conta_contabil_receita_diferida")}


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_cobranca_periodicidade", _CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def _rodar(motor, funcao):
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            funcao()


def _banco_antes(com_catalogo=True):
    """O banco como era antes da migração: o modelo inteiro, sem as colunas novas (a volta é feita pelo próprio `downgrade`), com o catálogo de
    periodicidade como os bancos antigos tinham (Mensal e Anual)."""
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor)
    _rodar(motor, _carregar().downgrade)
    if com_catalogo:
        with motor.begin() as c:
            c.execute(sa.text("INSERT INTO catalogos (id_catalogo, chave, nome_exibido) VALUES (7, 'periodicidade_contribuicao', 'Periodicidade')"))
            c.execute(sa.text(
                "INSERT INTO opcoes_catalogo (id_catalogo, codigo, rotulo, ordem, ativo) VALUES (7, 'MENSAL', 'Mensal', 1, 1), (7, 'ANUAL', 'Anual', 2, 1)"
            ))
    return motor


def _colunas(motor, tabela):
    return {c["name"] for c in sa.inspect(motor).get_columns(tabela)}


def test_a_migracao_cria_so_o_que_o_modelo_descreve():
    motor = _banco_antes()
    assert "periodicidade_contribuicao" not in _colunas(motor, "associados")
    assert "id_conta_contabil_receita_diferida" not in _colunas(motor, "planos_contribuicao")
    _rodar(motor, _carregar().upgrade)
    assert "periodicidade_contribuicao" in _colunas(motor, "associados")
    assert "id_conta_contabil_receita_diferida" in _colunas(motor, "planos_contribuicao")
    with motor.connect() as conexao:
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
    sobre_o_novo = []
    for item in diferencas:
        for d in item if isinstance(item, list) else [item]:
            texto = repr(d)
            if any(coluna in texto for _, coluna in _NOVAS) or "receita_diferida" in texto:
                sobre_o_novo.append(texto)
    assert sobre_o_novo == [], "a migração e o modelo divergem:\n" + "\n".join(sobre_o_novo)
    chaves = sa.inspect(motor).get_foreign_keys("planos_contribuicao")
    assert any(fk["constrained_columns"] == ["id_conta_contabil_receita_diferida"] and fk["referred_table"] == "plano_de_contas" for fk in chaves)


def test_a_opcao_semestral_entra_no_catalogo_uma_vez_so():
    motor = _banco_antes()
    migracao = _carregar()
    _rodar(motor, migracao.upgrade)
    with motor.connect() as c:
        opcoes = c.execute(sa.text("SELECT codigo, rotulo, ordem, ativo FROM opcoes_catalogo WHERE id_catalogo = 7 ORDER BY ordem")).all()
    assert [tuple(o) for o in opcoes] == [("MENSAL", "Mensal", 1, 1), ("ANUAL", "Anual", 2, 1), ("SEMESTRAL", "Semestral", 3, 1)]
    # banco sem o catálogo (o seed o cria já com "Semestral"): a migração não quebra
    sem_catalogo = _banco_antes(com_catalogo=False)
    _rodar(sem_catalogo, migracao.upgrade)
    with sem_catalogo.connect() as c:
        assert c.execute(sa.text("SELECT count(*) FROM opcoes_catalogo")).scalar() == 0


def test_o_que_existe_nao_muda_e_o_downgrade_volta_ao_que_era():
    motor = _banco_antes()
    with motor.begin() as c:
        c.execute(sa.text("INSERT INTO pessoas (id_pessoa, nome_completo) VALUES (1, 'Pessoa Antiga')"))
        c.execute(sa.text("INSERT INTO associados (id_associado, id_pessoa, categoria, status_arrolamento) VALUES (1, 1, 'Efetivo', 'Ativo - Em Dia')"))
        c.execute(sa.text("INSERT INTO plano_de_contas (id_conta, codigo_contabil, descricao_conta, tipo) VALUES (1, '4.1', 'Mensalidades', 'Receita')"))
        c.execute(sa.text(
            "INSERT INTO planos_contribuicao (id_plano, categoria, descricao, periodicidade, dia_vencimento, cobranca_por_nucleo_familiar, "
            "id_conta_contabil, ativo) VALUES (1, 'Efetivo', 'Mensalidade', 'Mensal', 10, 0, 1, 1)"
        ))
    migracao = _carregar()
    _rodar(motor, migracao.upgrade)
    with motor.connect() as c:
        assert tuple(c.execute(sa.text("SELECT categoria, periodicidade_contribuicao FROM associados")).one()) == ("Efetivo", "Mensal")
        assert tuple(c.execute(sa.text(
            "SELECT descricao, periodicidade, ativo, id_conta_contabil_receita_diferida FROM planos_contribuicao"
        )).one()) == ("Mensalidade", "Mensal", 1, None)
    _rodar(motor, migracao.downgrade)
    assert "periodicidade_contribuicao" not in _colunas(motor, "associados")
    assert "id_conta_contabil_receita_diferida" not in _colunas(motor, "planos_contribuicao")
    with motor.connect() as c:
        assert c.execute(sa.text("SELECT count(*) FROM opcoes_catalogo WHERE codigo = 'SEMESTRAL'")).scalar() == 0
        assert c.execute(sa.text("SELECT count(*) FROM associados")).scalar() == 1
