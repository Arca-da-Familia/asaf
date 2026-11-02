"""v7.5a - o treinamento de privacidade (decisões do Presidente de 2026-11-02): quem só vê os próprios dados não precisa; Diretoria Executiva e Conselho Fiscal
ao entrar no cargo e a cada 2 anos; os demais todo ano; 30 dias para fazer; sem bloqueio; e a migração."""
import importlib.util
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.database import Base
from app.models.core import AuditLog, Usuario
from app.services import treinamento_de_privacidade as treino
from tests.test_conselho_fiscal import _criar_associado, _headers
from tests.test_documentos_institucionais import _usuario
from tests.test_encarregado import _mandato

URL = "/api/meu-treinamento-de-privacidade"


def _nome(prefixo):
    return f"{prefixo} {uuid.uuid4().hex[:6]}"


def test_quem_so_ve_os_proprios_dados_nao_precisa(client, db):
    _, usuario = _criar_associado(db, _nome("Associado Comum"), nome_nivel="Associado")
    r = client.get(URL, headers=_headers(usuario)).json()
    assert r["situacao"]["precisa"] is False and r["material"]["versao"] == treino.VERSAO and len(r["material"]["itens"]) == 10
    assert client.post(URL, headers=_headers(usuario)).status_code == 400


def test_quem_tem_acesso_sem_cargo_faz_todo_ano_e_tem_30_dias(client, db):
    headers = _usuario(db, "associados")
    id_usuario = client.get("/auth/me", headers=headers).json()["id_usuario"]
    usuario = db.get(Usuario, id_usuario)
    agora = datetime.utcnow()
    s = treino.situacao(db, usuario, agora)
    assert s["precisa"] and s["pendente"] and s["intervalo_dias"] == 365 and not s["com_mandato"]
    assert s["fazer_ate"] == max(treino.INICIO_DO_TREINAMENTO, usuario.data_criacao) + timedelta(days=30)
    assert treino.situacao(db, usuario, s["fazer_ate"] + timedelta(days=1))["atrasado"] is True
    feito = client.post(URL, headers=headers).json()["situacao"]
    assert feito["pendente"] is False and feito["atrasado"] is False
    ultimo = db.query(sa.func.max(treino.TreinamentoDePrivacidade.concluido_em)).filter(treino.TreinamentoDePrivacidade.id_usuario == id_usuario).scalar()
    assert treino.situacao(db, usuario, ultimo + timedelta(days=364))["pendente"] is False
    assert treino.situacao(db, usuario, ultimo + timedelta(days=366))["pendente"] is True
    assert db.query(AuditLog).filter(AuditLog.acao == "TREINAMENTO_CONCLUIDO", AuditLog.id_usuario == id_usuario).count() == 1


def test_diretoria_faz_ao_entrar_no_cargo_e_a_cada_2_anos(client, db):
    associado, usuario = _criar_associado(db, _nome("Secretaria Treino"), nome_nivel="Associado")
    agora = datetime.utcnow()
    _mandato(db, associado, "SECRETARIO", agora - timedelta(days=10), dias=4 * 365)
    s = treino.situacao(db, usuario, agora)
    assert s["precisa"] and s["pendente"] and s["com_mandato"] and s["intervalo_dias"] == 730
    db.add(treino.TreinamentoDePrivacidade(id_usuario=usuario.id_usuario, versao_material="1", concluido_em=agora - timedelta(days=5)))
    db.commit()
    assert treino.situacao(db, usuario, agora)["pendente"] is False
    assert treino.situacao(db, usuario, agora - timedelta(days=5) + timedelta(days=729))["pendente"] is False
    assert treino.situacao(db, usuario, agora - timedelta(days=5) + timedelta(days=731))["pendente"] is True


def test_quem_entra_no_cargo_depois_do_ultimo_treinamento_faz_de_novo(client, db):
    associado, usuario = _criar_associado(db, _nome("Tesoureira Treino"), nome_nivel="Associado")
    agora = datetime.utcnow()
    db.add(treino.TreinamentoDePrivacidade(id_usuario=usuario.id_usuario, versao_material="1", concluido_em=agora - timedelta(days=40)))
    db.commit()
    _mandato(db, associado, "TESOUREIRO", agora - timedelta(days=3), dias=4 * 365)
    s = treino.situacao(db, usuario, agora)
    assert s["pendente"] is True and s["com_mandato"] is True


def test_o_quadro_e_do_modulo_privacidade(client, db, auth_headers):
    assert client.get("/api/privacidade/treinamentos", headers=_usuario(db, "associados")).status_code == 403
    r = client.get("/api/privacidade/treinamentos", headers=_usuario(db, "privacidade"))
    assert r.status_code == 200 and r.json()["dias_com_mandato"] == 730 and r.json()["dias_sem_mandato"] == 365
    assert all(i["precisa"] for i in r.json()["itens"])


# ------------------------------------------------------------------------------------------------ a migração
def test_a_migracao_cria_a_tabela_do_modelo():
    caminho = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "c75a8d3f2b61_v7_5a_treinamento_de_privacidade.py"
    especificacao = importlib.util.spec_from_file_location("migracao_treinamento", caminho)
    migracao = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(migracao)
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[t for nome, t in Base.metadata.tables.items() if nome != "treinamentos_de_privacidade"])
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            migracao.upgrade()
    with motor.connect() as conexao:
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
    sobre = [repr(d) for item in diferencas for d in (item if isinstance(item, list) else [item]) if "treinamentos_de_privacidade" in repr(d)]
    assert sobre == [], "a migração e o modelo divergem:\n" + "\n".join(sobre)
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parent.parent / "alembic"))
    diretorio = ScriptDirectory.from_config(config)
    assert len(diretorio.get_heads()) == 1 and diretorio.get_revision("c75a8d3f2b61").down_revision == "b74b2e6c1d40"
