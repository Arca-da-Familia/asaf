"""v5.4b - cargos da diretoria alinhados ao Art. 19 (e ao Art. 24) do Estatuto.

A migração d3f7a9c2e154 só roda em produção (a suíte cria o schema por `create_all` e semeia o catálogo novo). Aqui ela é
EXECUTADA de verdade, num SQLite temporário com o catálogo de cargos como existia em produção, para provar o que importa:
só rótulo e ordem mudam (o código do cargo, que o banco e as alçadas referenciam, NUNCA muda), as permissões não mudam, o
2º Vice-Presidente nasce com as permissões que o Vice-Presidente tem, e cargo fora do Estatuto só fica inativo (mandato
antigo continua existindo e valendo)."""
import importlib.util
import json
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.models.core import Catalogo, OpcaoCatalogo

_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "d3f7a9c2e154_v5_4b_cargos_do_art_19.py"

_COMO_ERA = [  # (codigo, rotulo, ordem, ativo, permissoes) - o catálogo de produção antes desta migração
    ("PRESIDENTE", "Presidente", 0, True, ["gerenciar_acesso", "associados"]),
    ("VICE_PRESIDENTE", "Vice-Presidente", 1, True, ["associados", "governanca", "ajuste_da_diretoria"]),
    ("TESOUREIRO", "Tesoureiro", 2, True, ["financeiro", "parcerias"]),
    ("VICE_TESOUREIRO", "Vice-Tesoureiro", 3, True, ["financeiro", "parcerias"]),
    ("SECRETARIO", "Secretário", 4, True, ["associados", "governanca"]),
    ("VICE_SECRETARIO", "Vice-Secretário", 5, True, ["associados", "documentos"]),
    ("CONSELHO_FISCAL", "Conselho Fiscal", 6, True, ["financeiro", "auditoria"]),
    ("DIRETOR_DE_PATRIMONIO", "Diretor de Patrimônio", 7, True, None),
    ("DIRETOR_SOCIAL", "Diretor Social", 8, True, ["projetos"]),
]


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_cargos", _CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def _banco(com_mandato_no_diretor_social=False):
    motor = sa.create_engine("sqlite://")
    with motor.begin() as c:
        c.execute(sa.text("CREATE TABLE catalogos (id_catalogo INTEGER PRIMARY KEY, chave TEXT)"))
        c.execute(sa.text(
            "CREATE TABLE opcoes_catalogo (id_opcao INTEGER PRIMARY KEY, id_catalogo INTEGER, codigo TEXT, rotulo TEXT, "
            "ordem INTEGER, ativo BOOLEAN, metadados JSON)"
        ))
        c.execute(sa.text("CREATE TABLE mandatos (id_mandato INTEGER PRIMARY KEY, cargo_codigo TEXT)"))
        c.execute(sa.text("INSERT INTO catalogos VALUES (1, 'titulo_cargo'), (2, 'outro_catalogo')"))
        for codigo, rotulo, ordem, ativo, permissoes in _COMO_ERA:
            c.execute(
                sa.text("INSERT INTO opcoes_catalogo (id_catalogo, codigo, rotulo, ordem, ativo, metadados) VALUES (1, :c, :r, :o, :a, :m)"),
                {"c": codigo, "r": rotulo, "o": ordem, "a": ativo, "m": json.dumps({"permissoes": permissoes}) if permissoes is not None else None},
            )
        # um catálogo que NÃO é de cargo, com um código igual: não pode ser tocado
        c.execute(sa.text("INSERT INTO opcoes_catalogo (id_catalogo, codigo, rotulo, ordem, ativo) VALUES (2, 'PRESIDENTE', 'Outro', 9, 1)"))
        if com_mandato_no_diretor_social:
            c.execute(sa.text("INSERT INTO mandatos (cargo_codigo) VALUES ('DIRETOR_SOCIAL')"))
    return motor


def _rodar(motor, funcao):
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            funcao()


def _cargos(motor, id_catalogo=1):
    with motor.connect() as c:
        linhas = c.execute(
            sa.text("SELECT codigo, rotulo, ordem, ativo, metadados FROM opcoes_catalogo WHERE id_catalogo = :i ORDER BY ordem"), {"i": id_catalogo}
        ).fetchall()
    return {codigo: (rotulo, ordem, bool(ativo), json.loads(m)["permissoes"] if m else None) for codigo, rotulo, ordem, ativo, m in linhas}


def test_so_rotulo_e_ordem_mudam_o_codigo_e_as_permissoes_ficam():
    motor = _banco()
    antes = _cargos(motor)
    _rodar(motor, _carregar().upgrade)
    depois = _cargos(motor)
    for codigo, rotulo in {
        "PRESIDENTE": "Presidente", "VICE_PRESIDENTE": "1º Vice-Presidente", "SECRETARIO": "1º Secretário",
        "VICE_SECRETARIO": "2º Secretário", "TESOUREIRO": "1º Tesoureiro", "VICE_TESOUREIRO": "2º Tesoureiro",
        "CONSELHO_FISCAL": "Conselheiro Fiscal",
    }.items():
        assert depois[codigo][0] == rotulo, codigo
        assert depois[codigo][3] == antes[codigo][3], f"{codigo}: a permissão do cargo NÃO pode mudar"
    # a ordem é a do Art. 19: Presidente, vices, secretários, tesoureiros, depois o Conselho
    ativos = [c for c, (_r, _o, ativo, _p) in depois.items() if ativo]
    assert ativos == ["PRESIDENTE", "VICE_PRESIDENTE", "VICE_PRESIDENTE_2", "SECRETARIO", "VICE_SECRETARIO", "TESOUREIRO", "VICE_TESOUREIRO", "CONSELHO_FISCAL"]


def test_o_segundo_vice_presidente_nasce_com_as_permissoes_do_primeiro_inclusive_o_ajuste_da_diretoria():
    motor = _banco()
    _rodar(motor, _carregar().upgrade)
    cargos = _cargos(motor)
    assert cargos["VICE_PRESIDENTE_2"][0] == "2º Vice-Presidente" and cargos["VICE_PRESIDENTE_2"][2] is True
    assert cargos["VICE_PRESIDENTE_2"][3] == ["associados", "governanca", "ajuste_da_diretoria"]


def test_cargo_fora_do_estatuto_so_fica_inativo_e_mandato_antigo_nao_e_tocado():
    motor = _banco(com_mandato_no_diretor_social=True)
    _rodar(motor, _carregar().upgrade)
    cargos = _cargos(motor)
    assert cargos["DIRETOR_SOCIAL"][2] is False and cargos["DIRETOR_DE_PATRIMONIO"][2] is False
    assert cargos["DIRETOR_SOCIAL"][3] == ["projetos"], "a permissão do cargo inativo continua (o mandato antigo segue valendo)"
    with motor.connect() as c:
        assert c.execute(sa.text("SELECT cargo_codigo FROM mandatos")).scalar() == "DIRETOR_SOCIAL"


def test_outro_catalogo_com_o_mesmo_codigo_nao_e_tocado():
    motor = _banco()
    _rodar(motor, _carregar().upgrade)
    assert _cargos(motor, id_catalogo=2) == {"PRESIDENTE": ("Outro", 9, True, None)}


def test_rodar_duas_vezes_da_o_mesmo_resultado():
    motor = _banco()
    migracao = _carregar()
    _rodar(motor, migracao.upgrade)
    uma_vez = _cargos(motor)
    _rodar(motor, migracao.upgrade)
    assert _cargos(motor) == uma_vez
    with motor.connect() as c:
        assert c.execute(sa.text("SELECT COUNT(*) FROM opcoes_catalogo WHERE codigo = 'VICE_PRESIDENTE_2'")).scalar() == 1


def test_downgrade_devolve_rotulos_e_ordem_e_so_apaga_o_vice_que_ninguem_usa():
    motor = _banco()
    migracao = _carregar()
    antes = _cargos(motor)
    _rodar(motor, migracao.upgrade)
    _rodar(motor, migracao.downgrade)
    assert _cargos(motor) == antes

    motor = _banco()
    _rodar(motor, migracao.upgrade)
    with motor.begin() as c:
        c.execute(sa.text("INSERT INTO mandatos (cargo_codigo) VALUES ('VICE_PRESIDENTE_2')"))
    _rodar(motor, migracao.downgrade)
    assert "VICE_PRESIDENTE_2" in _cargos(motor), "mandato gravado com esse código não pode ficar sem cargo"


def test_banco_novo_ja_nasce_com_os_cargos_do_art_19(db):
    """O seed (banco novo) e a migração (banco existente) têm que chegar ao MESMO catálogo."""
    catalogo = db.query(Catalogo).filter(Catalogo.chave == "titulo_cargo").first()
    opcoes = (
        db.query(OpcaoCatalogo).filter(OpcaoCatalogo.id_catalogo == catalogo.id_catalogo, OpcaoCatalogo.ativo.is_(True))
        .order_by(OpcaoCatalogo.ordem).all()
    )
    assert [(o.codigo, o.rotulo) for o in opcoes] == [
        ("PRESIDENTE", "Presidente"), ("VICE_PRESIDENTE", "1º Vice-Presidente"), ("VICE_PRESIDENTE_2", "2º Vice-Presidente"),
        ("SECRETARIO", "1º Secretário"), ("VICE_SECRETARIO", "2º Secretário"), ("TESOUREIRO", "1º Tesoureiro"),
        ("VICE_TESOUREIRO", "2º Tesoureiro"), ("CONSELHO_FISCAL", "Conselheiro Fiscal"),
    ]
    por_codigo = {o.codigo: o.metadados["permissoes"] for o in opcoes}
    # o Presidente e o 1º Secretário aprovam publicação; o 2º Secretário e os vices, não
    assert "aprovar_publicacao" in por_codigo["PRESIDENTE"] and "aprovar_publicacao" in por_codigo["SECRETARIO"]
    for outro in ("VICE_PRESIDENTE", "VICE_PRESIDENTE_2", "VICE_SECRETARIO", "TESOUREIRO", "VICE_TESOUREIRO", "CONSELHO_FISCAL"):
        assert "aprovar_publicacao" not in por_codigo[outro], outro
    assert por_codigo["VICE_PRESIDENTE_2"] == por_codigo["VICE_PRESIDENTE"]


def test_a_cadeia_continua_com_um_unico_head():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    assert _carregar().down_revision == "b5e2d8f1a436"
    raiz = Path(__file__).resolve().parent.parent
    config = Config(str(raiz / "alembic.ini"))
    config.set_main_option("script_location", str(raiz / "alembic"))
    diretorio = ScriptDirectory.from_config(config)
    assert len(diretorio.get_heads()) == 1, "histórico ramificado: duas migrações com o mesmo pai"
    assert "d3f7a9c2e154" in {r.revision for r in diretorio.walk_revisions()}
