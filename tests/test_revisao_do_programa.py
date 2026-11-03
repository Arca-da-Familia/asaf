"""v7.5b - a revisão anual do programa de privacidade (decisão do Presidente de 2026-11-02: todo janeiro): o retrato montado pelo sistema, as observações e a
aprovação pelo encarregado; a aprovada não muda; o aviso quando o ano passa sem revisão; e a migração."""
import importlib.util
from datetime import date, datetime
from pathlib import Path

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.database import Base
from app.models.core import AuditLog
from app.models.privacidade import REVISAO_APROVADA, RevisaoDoPrograma
from app.services import revisao_do_programa as revisao
from tests.test_documentos_institucionais import _usuario

URL = "/api/privacidade/revisao-anual"


def _limpar(db):
    for r in db.query(RevisaoDoPrograma).all():  # o banco é compartilhado entre os testes
        db.delete(r)
    db.commit()


def test_montar_anotar_e_aprovar_e_depois_nada_muda(client, db, auth_headers):
    _limpar(db)
    assert client.get(URL, headers=auth_headers).json()["situacao"]["pendente"] is True, "sem nenhuma revisão, a primeira está pendente"
    corpo = client.post(URL, headers=auth_headers).json()
    r = corpo["revisoes"][0]
    retrato = r["retrato"]
    for chave in ("inventario", "prazos_de_guarda", "acessos", "incidentes", "ensaios", "pedidos_de_titular", "treinamento", "encarregado"):
        assert chave in retrato, chave
    assert retrato["inventario"]["atividades"] >= 1 and len(retrato["prazos_de_guarda"]) >= 1
    assert all(a["permissoes"] for a in retrato["acessos"]), "só quem tem acesso a dado de outras pessoas"
    url = f"{URL}/{r['id_revisao']}"
    sem_obs = client.post(f"{url}/aprovar", headers=auth_headers)
    assert sem_obs.status_code == 422 and "observações" in sem_obs.json()["detail"]
    assert client.put(url, json={"observacoes": "Inventário em dia; falta o primeiro ensaio de incidente."}, headers=auth_headers).status_code == 200
    aprovada = client.post(f"{url}/aprovar", headers=auth_headers)
    assert aprovada.status_code == 200 and aprovada.json()["situacao"]["pendente"] is False
    assert client.put(url, json={"observacoes": "Mudar depois"}, headers=auth_headers).status_code == 409
    assert db.query(AuditLog).filter(AuditLog.acao == "REVISAO_DO_PROGRAMA_APROVADA", AuditLog.id_registro_afetado == r["id_revisao"]).count() == 1
    # remontar cria um rascunho novo; a aprovada fica
    client.post(URL, headers=auth_headers)
    db.expire_all()
    assert db.query(RevisaoDoPrograma).filter(RevisaoDoPrograma.situacao == REVISAO_APROVADA).count() == 1


def test_o_aviso_segue_o_ano(db):
    from app.models.core import Usuario

    _limpar(db)
    alguem = db.query(Usuario.id_usuario).first()[0]  # chave real: o Postgres confere a chave estrangeira
    db.add(RevisaoDoPrograma(situacao=REVISAO_APROVADA, retrato={}, observacoes="ok ok ok ok", montada_em=datetime(2027, 1, 10),
                             id_usuario_montagem=alguem, aprovada_em=datetime(2027, 1, 10)))
    db.commit()
    assert revisao.situacao(db, date(2027, 12, 31))["pendente"] is False
    janeiro = revisao.situacao(db, date(2028, 1, 15))
    assert janeiro["pendente"] is True and janeiro["atrasada"] is False, "em janeiro é a hora de fazer"
    assert revisao.situacao(db, date(2028, 2, 1))["atrasada"] is True
    _limpar(db)


def test_so_o_encarregado_monta_e_aprova_e_o_modulo_le(client, db):
    so_ve = _usuario(db, "privacidade")
    assert client.get(URL, headers=so_ve).status_code == 200
    assert client.post(URL, headers=so_ve).status_code == 403
    assert client.get(URL, headers=_usuario(db, "associados")).status_code == 403


def test_a_migracao_cria_a_tabela_do_modelo():
    caminho = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "d75b1a9e4c72_v7_5b_revisao_do_programa.py"
    especificacao = importlib.util.spec_from_file_location("migracao_revisao", caminho)
    migracao = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(migracao)
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[t for nome, t in Base.metadata.tables.items() if nome != "revisoes_do_programa"])
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            migracao.upgrade()
    with motor.connect() as conexao:
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
    sobre = [repr(d) for item in diferencas for d in (item if isinstance(item, list) else [item]) if "revisoes_do_programa" in repr(d)]
    assert sobre == [], "a migração e o modelo divergem:\n" + "\n".join(sobre)
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parent.parent / "alembic"))
    diretorio = ScriptDirectory.from_config(config)
    assert len(diretorio.get_heads()) == 1 and diretorio.get_revision("d75b1a9e4c72").down_revision == "c75a8d3f2b61"


# ------------------------------------------------------------------------------------------------ v7.5c: os achados do Ponto de Revisão 3/3
def test_quem_so_le_nao_anota_nem_aprova(client, db, auth_headers):
    _limpar(db)
    r = client.post(URL, headers=auth_headers).json()["revisoes"][0]
    so_ve = _usuario(db, "privacidade")
    assert client.put(f"{URL}/{r['id_revisao']}", json={"observacoes": "tentativa de quem só lê"}, headers=so_ve).status_code == 403
    assert client.post(f"{URL}/{r['id_revisao']}/aprovar", headers=so_ve).status_code == 403
    anotadas = db.query(AuditLog).filter(AuditLog.acao == "REVISAO_DO_PROGRAMA_ANOTADA").count()  # o banco de teste reaproveita o número
    assert client.put(f"{URL}/{r['id_revisao']}", json={"observacoes": "Anotado pelo encarregado."}, headers=auth_headers).status_code == 200
    assert db.query(AuditLog).filter(AuditLog.acao == "REVISAO_DO_PROGRAMA_ANOTADA").count() == anotadas + 1
    _limpar(db)


def test_o_retrato_de_outro_ano_nao_vale_e_29_de_fevereiro_funciona(client, db, auth_headers):
    _limpar(db)
    r = client.post(URL, headers=auth_headers).json()["revisoes"][0]
    revisao_db = db.get(RevisaoDoPrograma, r["id_revisao"])
    revisao_db.montada_em, revisao_db.observacoes = datetime(2020, 12, 30, 12), "Observações de um retrato antigo."
    db.commit()
    velho = client.post(f"{URL}/{r['id_revisao']}/aprovar", headers=auth_headers)
    assert velho.status_code == 409 and "outro ano" in velho.json()["detail"]
    retrato = revisao.montar_retrato(db, datetime(2028, 2, 29, 12))  # antes, `replace(year=...)` dava erro neste dia
    assert retrato["periodo"]["de"].startswith("2027-03-01")
    _limpar(db)
