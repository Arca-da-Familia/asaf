"""A migração f7c4d0e3a915 (v5.7e) só roda em produção. Aqui ela é EXECUTADA num SQLite temporário, com os dados que um banco que já existe tem, e o resultado é conferido: o Conselho Fiscal (nível e cargo)
troca `financeiro` por `financeiro_auditar`, e NADA mais muda (outros níveis, outros cargos, outras permissões)."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.database import Base
from app.models.core import Catalogo, NivelAcesso, OpcaoCatalogo, PermissaoSistema, perfil_permissao

_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "f7c4d0e3a915_v5_7e_conselho_fiscal_audita_sem_operar.py"
_TABELAS = ("permissoes_sistema", "niveis_acesso", "perfil_permissao", "catalogos", "opcoes_catalogo")


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_conselho_audita", _CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def _rodar(motor, funcao):
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            funcao()


def _banco_com_dados(com_dados: bool = True):
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[Base.metadata.tables[t] for t in _TABELAS])
    if not com_dados:
        return motor
    with motor.begin() as c:
        for codigo in ("financeiro", "auditoria", "parcerias"):
            c.execute(sa.insert(PermissaoSistema), {"modulo": "x", "codigo_permissao": codigo, "descricao": codigo})
        ids = {codigo: c.execute(sa.select(PermissaoSistema.id_permissao).where(PermissaoSistema.codigo_permissao == codigo)).scalar() for codigo in ("financeiro", "auditoria", "parcerias")}
        for nome in ("Conselho Fiscal", "Diretoria"):
            c.execute(sa.insert(NivelAcesso), {"nome_nivel": nome, "descricao": nome, "is_conselho_fiscal": nome == "Conselho Fiscal", "exige_mfa": False})
        niveis = {nome: c.execute(sa.select(NivelAcesso.id_nivel).where(NivelAcesso.nome_nivel == nome)).scalar() for nome in ("Conselho Fiscal", "Diretoria")}
        for codigo in ("financeiro", "auditoria"):
            c.execute(sa.insert(perfil_permissao).values(id_nivel=niveis["Conselho Fiscal"], id_permissao=ids[codigo]))
        c.execute(sa.insert(perfil_permissao).values(id_nivel=niveis["Diretoria"], id_permissao=ids["financeiro"]))
        c.execute(sa.insert(Catalogo), {"chave": "titulo_cargo", "nome_exibido": "Título de cargo"})
        id_catalogo = c.execute(sa.select(Catalogo.id_catalogo)).scalar()
        c.execute(sa.insert(OpcaoCatalogo), {"id_catalogo": id_catalogo, "codigo": "CONSELHO_FISCAL", "rotulo": "Conselheiro Fiscal", "metadados": {"permissoes": ["financeiro", "auditoria"]}})
        c.execute(sa.insert(OpcaoCatalogo), {"id_catalogo": id_catalogo, "codigo": "TESOUREIRO", "rotulo": "1º Tesoureiro", "metadados": {"permissoes": ["financeiro", "parcerias"]}})
    return motor


def _do_nivel(motor, nome: str) -> set[str]:
    with motor.connect() as c:
        linhas = c.execute(
            sa.select(PermissaoSistema.codigo_permissao)
            .join(perfil_permissao, perfil_permissao.c.id_permissao == PermissaoSistema.id_permissao)
            .join(NivelAcesso, NivelAcesso.id_nivel == perfil_permissao.c.id_nivel)
            .where(NivelAcesso.nome_nivel == nome)
        ).all()
    return {codigo for (codigo,) in linhas}


def _do_cargo(motor, codigo: str) -> set[str]:
    with motor.connect() as c:
        metadados = c.execute(sa.select(OpcaoCatalogo.metadados).where(OpcaoCatalogo.codigo == codigo)).scalar()
    return set(metadados["permissoes"])


def test_o_conselho_fiscal_troca_a_permissao_que_opera_pela_que_audita_e_nada_mais_muda():
    motor = _banco_com_dados()
    _rodar(motor, _carregar().upgrade)
    assert _do_nivel(motor, "Conselho Fiscal") == {"financeiro_auditar", "auditoria"}
    assert _do_nivel(motor, "Diretoria") == {"financeiro"}, "outro nível não é tocado"
    assert _do_cargo(motor, "CONSELHO_FISCAL") == {"financeiro_auditar", "auditoria"}
    assert _do_cargo(motor, "TESOUREIRO") == {"financeiro", "parcerias"}, "outro cargo não é tocado"
    with motor.connect() as c:
        assert c.execute(sa.select(sa.func.count()).select_from(PermissaoSistema).where(PermissaoSistema.codigo_permissao == "financeiro_auditar")).scalar() == 1
        assert c.execute(sa.select(sa.func.count()).select_from(PermissaoSistema)).scalar() == 4, "só a permissão nova foi criada"


def test_rodar_de_novo_nao_muda_nada():
    motor = _banco_com_dados()
    migracao = _carregar()
    _rodar(motor, migracao.upgrade)
    _rodar(motor, migracao.upgrade)
    assert _do_nivel(motor, "Conselho Fiscal") == {"financeiro_auditar", "auditoria"}
    assert _do_cargo(motor, "CONSELHO_FISCAL") == {"financeiro_auditar", "auditoria"}
    with motor.connect() as c:
        assert c.execute(sa.select(sa.func.count()).select_from(perfil_permissao)).scalar() == 3


def test_se_o_semeador_ja_criou_a_permissao_nova_ela_nao_duplica():
    motor = _banco_com_dados()
    with motor.begin() as c:
        c.execute(sa.insert(PermissaoSistema), {"modulo": "financeiro", "codigo_permissao": "financeiro_auditar", "descricao": "já semeada"})
    _rodar(motor, _carregar().upgrade)
    with motor.connect() as c:
        assert c.execute(sa.select(sa.func.count()).select_from(PermissaoSistema).where(PermissaoSistema.codigo_permissao == "financeiro_auditar")).scalar() == 1
    assert _do_nivel(motor, "Conselho Fiscal") == {"financeiro_auditar", "auditoria"}


def test_num_banco_novo_sem_nivel_nem_cargo_a_migracao_nao_falha():
    motor = _banco_com_dados(com_dados=False)
    _rodar(motor, _carregar().upgrade)
    with motor.connect() as c:
        assert c.execute(sa.select(PermissaoSistema.codigo_permissao)).scalars().all() == ["financeiro_auditar"]


def test_o_downgrade_devolve_o_financeiro_ao_conselho_fiscal():
    motor = _banco_com_dados()
    migracao = _carregar()
    _rodar(motor, migracao.upgrade)
    _rodar(motor, migracao.downgrade)
    assert _do_nivel(motor, "Conselho Fiscal") == {"financeiro", "auditoria"}
    assert _do_cargo(motor, "CONSELHO_FISCAL") == {"financeiro", "auditoria"}
    assert _do_nivel(motor, "Diretoria") == {"financeiro"}
    with motor.connect() as c:
        assert c.execute(sa.select(sa.func.count()).select_from(PermissaoSistema).where(PermissaoSistema.codigo_permissao == "financeiro_auditar")).scalar() == 0


def test_a_migracao_continua_a_cadeia_do_alembic_sem_segunda_cabeca():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parent.parent / "alembic"))
    diretorio = ScriptDirectory.from_config(config)
    assert len(diretorio.get_heads()) == 1, diretorio.get_heads()
    assert "f7c4d0e3a915" in {revisao.revision for revisao in diretorio.walk_revisions()}
    assert diretorio.get_revision("f7c4d0e3a915").down_revision == "e6b3c9d2f8a4"
