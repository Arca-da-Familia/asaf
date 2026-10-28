"""Ponto de Revisão da FASE 7 (1/3, fecha v7.0–v7.1) - os achados da conferência independente, corrigidos:
  1. a versão do termo gravada é a que a pessoa ASSINOU: a data da assinatura tem de caber na vigência da versão informada (e a marca antiga não é assinável);
  2. aos 18 anos, o consentimento dado pelo responsável deixa de abrir o atendimento (o da curatela, dado a um adulto, continua);
  3. a prova do consentimento do atendimento social fica enquanto existir relato ou encaminhamento não eliminado;
  4. a leitura da lista dos consentimentos e a invalidação pela correção do nascimento ficam na Auditoria;
  5. o banco recusa alterar ou apagar um texto de privacidade gravado (a migração a3c5e7f9b1d2 também, no SQLite)."""
import importlib.util
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.models.core import AuditLog
from app.models.privacidade import Consentimento
from app.services import beneficiarios as servico, consentimentos
from tests.test_beneficiarios import _criar_beneficiario, _registrar_consentimento
from tests.test_consentimento_do_beneficiario import _atender, _consentimentos_do, _vinculo_com_equipe


def _novo(client, auth_headers, nascimento: str) -> int:
    return client.post("/api/beneficiarios/", json={"nome_completo": f"Pessoa Ponto {uuid.uuid4().hex[:6]}", "data_nascimento": f"{nascimento}T00:00:00"},
                       headers=auth_headers).json()["id_beneficiario"]


# ------------------------------------------------------------------------------------------------ 1. a versão pela data da assinatura
def test_a_data_da_assinatura_tem_de_caber_na_vigencia_da_versao(client, auth_headers):
    id_beneficiario = _criar_beneficiario(client, auth_headers, com_consentimento=False)
    antes = _registrar_consentimento(client, auth_headers, id_beneficiario, assinado_em="2026-10-20")
    assert antes.status_code == 400 and "só existe desde 27/10/2026" in antes.json()["detail"], "um termo não é assinado antes de existir"
    marca = _registrar_consentimento(client, auth_headers, id_beneficiario, versao_do_termo="1", assinado_em="2026-10-20")
    assert marca.status_code == 422, "a versão 1 é a marca antiga da equipe: não é um termo para assinar"
    assert _registrar_consentimento(client, auth_headers, id_beneficiario, assinado_em="2026-10-27").status_code == 200


def test_quando_houver_versao_nova_o_papel_antigo_e_registrado_com_a_versao_que_assinou(client, auth_headers, monkeypatch):
    """Latente hoje (o termo só tem a versão 2): com uma versão 3 em vigor, o papel assinado na vigência da 2 entra como 2, e a 2 assinada depois da 3 é recusada."""
    import dataclasses

    from app import textos_de_privacidade as tp

    v2 = tp.buscar("ATENDIMENTO_SOCIAL", "2")
    v3 = dataclasses.replace(v2, versao="3", vigente_desde=date(2026, 10, 28), texto=v2.texto + " (versão 3 de teste)")
    monkeypatch.setattr(tp, "TEXTOS", tp.TEXTOS + (v3,))
    id_beneficiario = _criar_beneficiario(client, auth_headers, com_consentimento=False)
    tarde = _registrar_consentimento(client, auth_headers, id_beneficiario, versao_do_termo="2", assinado_em="2026-10-28")
    assert tarde.status_code == 400 and "já valia a versão 3" in tarde.json()["detail"]
    ok = _registrar_consentimento(client, auth_headers, id_beneficiario, versao_do_termo="2", assinado_em="2026-10-27")
    assert ok.status_code == 200 and ok.json()["versao"] == "2"


# ------------------------------------------------------------------------------------------------ 2. os 18 anos
def test_aos_18_anos_o_consentimento_do_responsavel_deixa_de_abrir_o_atendimento(client, db, auth_headers):
    from app.models.beneficiarios import Beneficiario
    from app.models.pessoas import Pessoa

    hoje = date.today()
    fez_18_ontem = (hoje.replace(year=hoje.year - 18) - timedelta(days=1)).isoformat()
    id_beneficiario = _novo(client, auth_headers, fez_18_ontem)
    id_vinculo = _vinculo_com_equipe(client, db, auth_headers, id_beneficiario)
    pessoa = db.get(Pessoa, db.get(Beneficiario, id_beneficiario).id_pessoa)
    # a mãe consentiu quando ela ainda era menor (o termo está registrado direto: a data é anterior à vigência do termo de hoje)
    c = consentimentos.registrar(db, None, origem=consentimentos.BENEFICIARIO, id_origem=id_beneficiario, termo="ATENDIMENTO_SOCIAL", versao="2",
                                 titular=pessoa.nome_completo, id_pessoa=pessoa.id_pessoa, dado_por=consentimentos.RESPONSAVEL, nome_responsavel="Mãe de Teste",
                                 vinculo_responsavel="mae", meio=consentimentos.TERMO_EM_PAPEL, dado_em=datetime.combine(hoje - timedelta(days=30), datetime.min.time()))
    db.commit()
    assert servico.fez_18_depois_do_responsavel(c, pessoa)
    r = _atender(client, auth_headers, id_vinculo)
    assert r.status_code == 409 and "fez 18 anos" in r.json()["detail"]
    linha = next(b for b in client.get("/api/beneficiarios/", headers=auth_headers).json() if b["id_beneficiario"] == id_beneficiario)
    assert linha["consentimento_lgpd_registrado"] is False and linha["consentimento_precisa_do_termo_da_pessoa"] is True
    assert _registrar_consentimento(client, auth_headers, id_beneficiario, assinado_em=hoje.isoformat()).status_code == 200, "agora ela mesma assina"
    assert _atender(client, auth_headers, id_vinculo).status_code == 200


def test_a_curatela_de_um_adulto_continua_valendo(client, db, auth_headers):
    id_beneficiario = _novo(client, auth_headers, "1980-01-01")
    assert _registrar_consentimento(client, auth_headers, id_beneficiario, dado_por="responsavel", nome_responsavel="Curador de Teste",
                                    vinculo="responsavel_legal").status_code == 200
    id_vinculo = _vinculo_com_equipe(client, db, auth_headers, id_beneficiario)
    assert _atender(client, auth_headers, id_vinculo).status_code == 200


# ------------------------------------------------------------------------------------------------ 3. a prova fica enquanto o prontuário existir
def test_a_prova_do_atendimento_social_fica_enquanto_houver_prontuario(client, db, auth_headers):
    from app.services import retencao

    com_prontuario = _criar_beneficiario(client, auth_headers)
    id_vinculo = _vinculo_com_equipe(client, db, auth_headers, com_prontuario)
    assert _atender(client, auth_headers, id_vinculo).status_code == 200
    sem_prontuario = _criar_beneficiario(client, auth_headers)
    for id_beneficiario in (com_prontuario, sem_prontuario):
        assert client.post(f"/api/beneficiarios/{id_beneficiario}/consentimento/revogar", json={}, headers=auth_headers).status_code == 200
    antigo = datetime.utcnow() - timedelta(days=2000)
    db.query(Consentimento).filter(Consentimento.origem == consentimentos.BENEFICIARIO,
                                   Consentimento.id_origem.in_([com_prontuario, sem_prontuario])).update({Consentimento.encerrado_em: antigo},
                                                                                                         synchronize_session=False)
    db.commit()
    retencao.aplicar_todas(db, agora=datetime.utcnow())
    assert len(_consentimentos_do(db, com_prontuario)) == 1, "o relato que ele autorizou ainda existe"
    assert _consentimentos_do(db, sem_prontuario) == []


# ------------------------------------------------------------------------------------------------ 4. Auditoria
def test_a_leitura_da_lista_e_a_invalidacao_pelo_nascimento_ficam_na_auditoria(client, db, auth_headers):
    antes = db.query(sa.func.max(AuditLog.id_log)).scalar() or 0
    assert client.get("/api/privacidade/consentimentos?origem=beneficiario&busca=Joana", headers=auth_headers).status_code == 200
    [leitura] = db.query(AuditLog).filter(AuditLog.id_log > antes, AuditLog.acao == "CONSULTA_CONSENTIMENTOS").all()
    assert '"com_busca": true' in leitura.dados_depois and "Joana" not in leitura.dados_depois, "a busca é um nome: só o fato de ter havido busca"

    id_beneficiario = _criar_beneficiario(client, auth_headers)
    assert client.put(f"/api/beneficiarios/{id_beneficiario}", json={"data_nascimento": "2016-03-01T00:00:00"}, headers=auth_headers).status_code == 200
    entrada = db.query(AuditLog).filter(AuditLog.acao == "UPDATE", AuditLog.tabela_afetada == "beneficiarios",
                                        AuditLog.id_registro_afetado == id_beneficiario).order_by(AuditLog.id_log.desc()).first()
    assert '"consentimento_invalidado": true' in entrada.dados_depois


# ------------------------------------------------------------------------------------------------ 5. a migração da trava dos textos
def test_a_migracao_trava_os_textos_no_sqlite():
    import app.models  # noqa: F401
    from app.database import Base

    caminho = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "a3c5e7f9b1d2_ponto_fase7_trava_dos_textos_de_privacidade.py"
    especificacao = importlib.util.spec_from_file_location("migracao_trava_textos", caminho)
    migracao = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(migracao)
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor)
    with motor.begin() as c:
        c.execute(sa.text("INSERT INTO textos_de_privacidade (ponto, versao, tipo, texto, impressao, vigente_desde, reconstituido, registrado_em) "
                          "VALUES ('X', '1', 'aviso', 't', 'i', '2026-10-28', 0, '2026-10-28')"))
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            migracao.upgrade()
    for comando in ("UPDATE textos_de_privacidade SET texto = 'outro'", "DELETE FROM textos_de_privacidade"):
        try:
            with motor.begin() as c:
                c.execute(sa.text(comando))
            raise AssertionError(f"o banco aceitou: {comando}")
        except sa.exc.IntegrityError as erro:
            assert "não muda nem é apagado" in str(erro)
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            migracao.downgrade()
    with motor.begin() as c:
        c.execute(sa.text("UPDATE textos_de_privacidade SET texto = 'outro'"))
