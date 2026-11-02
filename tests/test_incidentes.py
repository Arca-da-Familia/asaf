"""v7.4b - o registro de incidentes de segurança (decisões do Presidente de 2026-10-30): prazo de 3 dias úteis contado de quando a associação soube (hora de
Belém), comunicação obrigatória só com risco relevante, encerrar só com o registro completo, nada se apaga, ensaio uma vez por ano; e a migração."""
import importlib.util
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.database import Base
from app.models.core import AuditLog
from app.models.privacidade import ENCERRADO, IncidenteDeSeguranca
from app.services import incidentes
from tests.test_documentos_institucionais import _usuario

URL = "/api/privacidade/incidentes"


# ------------------------------------------------------------------------------------------------ o prazo
@pytest.mark.parametrize("conhecido_em_utc, prazo", [
    (datetime(2026, 10, 30, 12, 0), date(2026, 11, 4)),   # sexta 09:00 em Belém -> quarta
    (datetime(2026, 10, 31, 2, 30), date(2026, 11, 4)),   # sábado 02:30 UTC ainda é sexta 23:30 em Belém -> quarta
    (datetime(2026, 11, 2, 15, 0), date(2026, 11, 5)),    # segunda -> quinta
    (datetime(2026, 11, 1, 15, 0), date(2026, 11, 4)),    # domingo -> quarta (conta segunda, terça, quarta)
])
def test_o_prazo_e_de_3_dias_uteis_pela_hora_de_belem(conhecido_em_utc, prazo):
    assert incidentes.prazo_para_comunicar(conhecido_em_utc) == prazo


def _incidente(**k) -> IncidenteDeSeguranca:
    base = dict(numero=1, ensaio=False, titulo="t", descricao="d", conhecido_em=datetime(2026, 10, 30, 12, 0), risco="A_AVALIAR", situacao="ABERTO")
    return IncidenteDeSeguranca(**{**base, **k})


def test_a_situacao_do_prazo():
    d = date
    assert incidentes.situacao_do_prazo(_incidente(), d(2026, 11, 3)) == "no_prazo"
    assert incidentes.situacao_do_prazo(_incidente(), d(2026, 11, 4)) == "vence_hoje"
    assert incidentes.situacao_do_prazo(_incidente(risco="RELEVANTE"), d(2026, 11, 5)) == "vencido"
    assert incidentes.situacao_do_prazo(_incidente(risco="SEM_RISCO_RELEVANTE"), d(2026, 12, 1)) == "sem_obrigacao"
    feito = _incidente(risco="RELEVANTE", comunicado_anpd_em=datetime(2026, 11, 2), comunicado_pessoas_em=datetime(2026, 11, 2))
    assert incidentes.situacao_do_prazo(feito, d(2026, 12, 1)) == "comunicado"
    assert incidentes.situacao_do_prazo(_incidente(ensaio=True), d(2026, 12, 1)) == "ensaio"


# ------------------------------------------------------------------------------------------------ as rotas
def _registrar(client, headers, **k):
    corpo = {"titulo": f"Incidente de teste {uuid.uuid4().hex[:6]}", "descricao": "Um arquivo foi enviado ao endereço errado.",
             "conhecido_em": (datetime.utcnow() - timedelta(hours=1)).isoformat(), **k}
    r = client.post(URL, json=corpo, headers=headers)
    assert r.status_code == 200, r.text
    return next(i for i in r.json()["itens"] if i["titulo"] == corpo["titulo"])


def test_so_o_encarregado_registra_e_quem_ve_o_modulo_le(client, db, auth_headers):
    so_ve = _usuario(db, "privacidade")
    assert client.get(URL, headers=so_ve).status_code == 200
    assert client.post(URL, json={"titulo": "Tentativa", "descricao": "Não pode registrar.", "conhecido_em": datetime.utcnow().isoformat()},
                       headers=so_ve).status_code == 403
    assert client.get(URL, headers=_usuario(db, "associados")).status_code == 403
    i = _registrar(client, auth_headers)
    assert i["situacao"] == "ABERTO" and i["risco"] == "A_AVALIAR" and i["situacao_do_prazo"] in ("no_prazo", "vence_hoje")
    assert client.put(f"{URL}/{i['id_incidente']}", json={"risco": "RELEVANTE"}, headers=so_ve).status_code == 403


def test_encerrar_exige_o_registro_completo_e_depois_nada_muda(client, db, auth_headers):
    i = _registrar(client, auth_headers)
    url = f"{URL}/{i['id_incidente']}"
    falta = client.post(f"{url}/encerrar", headers=auth_headers)
    assert falta.status_code == 422 and "avaliar o risco" in falta.json()["detail"] and "lição aprendida" in falta.json()["detail"]
    r = client.put(url, json={"risco": "RELEVANTE", "motivo_do_risco": "Dados de contato de associados chegaram a quem não devia.",
                              "contencao": "Pedimos a exclusão e trocamos a rotina de envio.", "licao_aprendida": "Conferir o destinatário antes de enviar."},
                   headers=auth_headers)
    assert r.status_code == 200, r.text
    falta = client.post(f"{url}/encerrar", headers=auth_headers)
    assert falta.status_code == 422 and "ANPD" in falta.json()["detail"] and "pessoas atingidas" in falta.json()["detail"]
    agora = datetime.utcnow().isoformat()
    assert client.put(url, json={"comunicado_anpd_em": agora, "protocolo_anpd": "00000.000000/2026-00", "comunicado_pessoas_em": agora,
                                 "como_pessoas": "E-mail a cada pessoa e aviso no painel."}, headers=auth_headers).status_code == 200
    fechado = client.post(f"{url}/encerrar", headers=auth_headers)
    assert fechado.status_code == 200
    item = next(x for x in fechado.json()["itens"] if x["id_incidente"] == i["id_incidente"])
    assert item["situacao"] == ENCERRADO and item["situacao_do_prazo"] == "comunicado"
    assert client.put(url, json={"licao_aprendida": "Mudar depois"}, headers=auth_headers).status_code == 409
    assert client.delete(url, headers=auth_headers).status_code == 405, "não há rota de apagar"


def test_datas_impossiveis_sao_recusadas(client, auth_headers):
    futuro = (datetime.utcnow() + timedelta(days=2)).isoformat()
    r = client.post(URL, json={"titulo": "No futuro", "descricao": "Data errada de propósito.", "conhecido_em": futuro}, headers=auth_headers)
    assert r.status_code == 422 and "futuro" in r.json()["detail"]
    i = _registrar(client, auth_headers)
    antes = (datetime.utcnow() - timedelta(days=30)).isoformat()
    r = client.put(f"{URL}/{i['id_incidente']}", json={"comunicado_anpd_em": antes}, headers=auth_headers)
    assert r.status_code == 422 and "entre o dia" in r.json()["detail"]


def test_a_auditoria_guarda_os_campos_que_mudaram_e_nao_os_textos(client, db, auth_headers):
    i = _registrar(client, auth_headers)
    segredo = f"texto-que-nao-vai-para-a-auditoria-{uuid.uuid4().hex[:6]}"
    client.put(f"{URL}/{i['id_incidente']}", json={"pessoas_afetadas": segredo, "risco": "SEM_RISCO_RELEVANTE"}, headers=auth_headers)
    registro = db.query(AuditLog).filter(AuditLog.acao == "INCIDENTE_ATUALIZADO", AuditLog.id_registro_afetado == i["id_incidente"]).one()
    assert segredo not in registro.dados_depois and "pessoas_afetadas" in registro.dados_depois and "SEM_RISCO_RELEVANTE" in registro.dados_depois
    assert db.query(AuditLog).filter(AuditLog.acao == "INCIDENTE_REGISTRADO", AuditLog.id_registro_afetado == i["id_incidente"]).count() == 1


def test_o_ensaio_nao_se_comunica_a_anpd_e_conta_para_o_proximo_ensaio(client, db, auth_headers):
    for velho in db.query(IncidenteDeSeguranca).filter(IncidenteDeSeguranca.ensaio.is_(True)).all():  # o banco é compartilhado entre os testes
        db.delete(velho)
    db.commit()
    assert client.get(URL, headers=auth_headers).json()["ensaios"]["pendente"] is True, "sem nenhum ensaio, o primeiro está pendente"
    e = _registrar(client, auth_headers, ensaio=True)
    url = f"{URL}/{e['id_incidente']}"
    r = client.put(url, json={"comunicado_anpd_em": datetime.utcnow().isoformat()}, headers=auth_headers)
    assert r.status_code == 422 and "Ensaio" in r.json()["detail"]
    client.put(url, json={"risco": "RELEVANTE", "motivo_do_risco": "Simulamos vazamento de lista de inscritos.", "contencao": "Simulado.",
                          "licao_aprendida": "O passo a passo funcionou; o modelo de e-mail precisa de ajuste."}, headers=auth_headers)
    fechado = client.post(f"{url}/encerrar", headers=auth_headers)
    assert fechado.status_code == 200, fechado.text
    ensaios = fechado.json()["ensaios"]
    assert ensaios["pendente"] is False and ensaios["proximo_ate"] == (date.today() + timedelta(days=365)).isoformat() or ensaios["pendente"] is False
    # um ano e um dia depois, o próximo ensaio está pendente
    assert incidentes.ensaios(db, date.today() + timedelta(days=367))["pendente"] is True


# ------------------------------------------------------------------------------------------------ a migração
_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "b74b2e6c1d40_v7_4b_incidentes_de_seguranca.py"


def _migracao():
    especificacao = importlib.util.spec_from_file_location("migracao_incidentes", _CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def _rodar(motor, funcao):
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            funcao()


def test_a_migracao_cria_a_tabela_do_modelo_e_registra_o_precedente_sem_o_email():
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[t for nome, t in Base.metadata.tables.items() if nome != "incidentes_de_seguranca"])
    migracao = _migracao()
    _rodar(motor, migracao.upgrade)
    with motor.connect() as conexao:
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
        linhas = conexao.execute(sa.text("SELECT numero, risco, situacao, descricao, contencao FROM incidentes_de_seguranca")).all()
    sobre_a_tabela = [repr(d) for item in diferencas for d in (item if isinstance(item, list) else [item]) if "incidentes_de_seguranca" in repr(d)]
    assert sobre_a_tabela == [], "a migração e o modelo divergem:\n" + "\n".join(sobre_a_tabela)
    assert len(linhas) == 1 and linhas[0][0] == 1 and linhas[0][1] == "SEM_RISCO_RELEVANTE" and linhas[0][2] == ENCERRADO
    assert "@" not in linhas[0][3] and "@" not in linhas[0][4], "o precedente não traz o e-mail"
    _rodar(motor, migracao.downgrade)
    assert "incidentes_de_seguranca" not in set(sa.inspect(motor).get_table_names())


def test_a_migracao_continua_a_cadeia_sem_segunda_cabeca():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parent.parent / "alembic"))
    diretorio = ScriptDirectory.from_config(config)
    assert len(diretorio.get_heads()) == 1 and diretorio.get_revision("b74b2e6c1d40").down_revision == "a73c9f1e5b20"
