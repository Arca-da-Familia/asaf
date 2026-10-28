"""v7.1c (FASE 7) - o consentimento do atendimento social (app/services/beneficiarios.py::registrar_consentimento e _exigir_consentimento).

  1. sem o consentimento vigente, o prontuário e o encaminhamento não gravam (409, com o motivo); a leitura do que já existe continua;
  2. quem tem menos de 18 anos só com um dos pais ou o responsável (com o nome e o vínculo); o adulto consente por si;
  3. registrar de novo substitui o vigente (o anterior fica encerrado, como prova); revogar fecha o que é novo;
  4. termo velho, data futura, sem a permissão de projetos: recusados; o PDF do termo;
  5. a migração 9d1b6c3e5f27 traz a marca antiga como "declaração antiga"."""
import importlib.util
import io
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

import pypdf
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app import textos_de_privacidade as tp
from app.models.privacidade import INVALIDADO, REVOGADO, SUBSTITUIDO, Consentimento
from app.services import consentimentos
from tests.test_beneficiarios import _associado_do_token, _criar_beneficiario, _criar_projeto, _registrar_consentimento, _vincular
from tests.test_conselho_fiscal import _criar_associado, _headers


def _vinculo_com_equipe(client, db, auth_headers, id_beneficiario) -> int:
    id_projeto = _criar_projeto(client, auth_headers)
    id_vinculo = _vincular(client, auth_headers, id_beneficiario, id_projeto)
    client.post(f"/api/projetos/{id_projeto}/equipe", json={"id_associado": _associado_do_token(db, auth_headers).id_associado, "papel": "COORDENADOR"},
                headers=auth_headers)
    return id_vinculo


def _atender(client, auth_headers, id_vinculo, relato="Atendimento de teste."):
    return client.post(f"/api/beneficiarios-projeto/{id_vinculo}/atendimentos", json={"relato": relato}, headers=auth_headers)


def _consentimentos_do(db, id_beneficiario):
    db.expire_all()
    return db.query(Consentimento).filter(Consentimento.origem == consentimentos.BENEFICIARIO, Consentimento.id_origem == id_beneficiario).order_by(
        Consentimento.id_consentimento).all()


# ------------------------------------------------------------------------------------------------ 1. a trava
def test_sem_consentimento_o_prontuario_e_o_encaminhamento_nao_gravam(client, db, auth_headers):
    id_beneficiario = _criar_beneficiario(client, auth_headers, com_consentimento=False)
    id_vinculo = _vinculo_com_equipe(client, db, auth_headers, id_beneficiario)
    r = _atender(client, auth_headers, id_vinculo)
    assert r.status_code == 409 and "consentimento" in r.json()["detail"]
    r = client.post(f"/api/beneficiarios-projeto/{id_vinculo}/encaminhamentos", json={"tipo_rede": "CRAS", "descricao": "Encaminhamento de teste."},
                    headers=auth_headers)
    assert r.status_code == 409
    vinculo = next(v for v in client.get(f"/api/projetos/{_vinculo_projeto(db, id_vinculo)}/beneficiarios", headers=auth_headers).json()
                   if v["id_vinculo"] == id_vinculo)
    assert vinculo["consentimento_vigente"] is False, "a tela do prontuário sabe antes de tentar"
    assert _registrar_consentimento(client, auth_headers, id_beneficiario).status_code == 200
    assert _atender(client, auth_headers, id_vinculo).status_code == 200
    assert client.get(f"/api/beneficiarios-projeto/{id_vinculo}/atendimentos", headers=auth_headers).status_code == 200


def _vinculo_projeto(db, id_vinculo):
    from app.models.beneficiarios import BeneficiarioProjeto

    return db.get(BeneficiarioProjeto, id_vinculo).id_projeto


# ------------------------------------------------------------------------------------------------ 2. criança e adolescente
def test_menor_de_18_so_com_um_dos_pais_ou_o_responsavel(client, db, auth_headers):
    nascimento = (date.today() - timedelta(days=10 * 365)).isoformat()
    r = client.post("/api/beneficiarios/", json={"nome_completo": f"Criança de Teste {uuid.uuid4().hex[:6]}", "data_nascimento": f"{nascimento}T00:00:00"},
                    headers=auth_headers)
    id_beneficiario = r.json()["id_beneficiario"]
    proprio = _registrar_consentimento(client, auth_headers, id_beneficiario)
    assert proprio.status_code == 400 and "menos de 18 anos" in proprio.json()["detail"]
    assert _registrar_consentimento(client, auth_headers, id_beneficiario, dado_por="responsavel", nome_responsavel="", vinculo="mae").status_code == 400
    assert _registrar_consentimento(client, auth_headers, id_beneficiario, dado_por="responsavel", nome_responsavel="Joana da Silva",
                                    vinculo="tia").status_code == 400, "o vínculo é mãe, pai ou responsável legal"
    ok = _registrar_consentimento(client, auth_headers, id_beneficiario, dado_por="responsavel", nome_responsavel="  Joana   da Silva ", vinculo="mae")
    assert ok.status_code == 200, ok.text
    corpo = ok.json()
    assert (corpo["dado_por"], corpo["nome_responsavel"], corpo["vinculo_rotulo"]) == ("responsavel", "Joana da Silva", "Mãe")
    [c] = _consentimentos_do(db, id_beneficiario)
    assert c.ponto == "ATENDIMENTO_SOCIAL" and c.versao == tp.versao_atual("ATENDIMENTO_SOCIAL") and c.dado_em.date() == date(2026, 10, 27)
    assert c.titular.startswith("Criança de Teste") and c.id_pessoa is not None


def _novo(client, auth_headers, nascimento=None) -> int:
    corpo = {"nome_completo": f"Pessoa de Teste {uuid.uuid4().hex[:6]}"}
    if nascimento:
        corpo["data_nascimento"] = f"{nascimento}T00:00:00"
    return client.post("/api/beneficiarios/", json=corpo, headers=auth_headers).json()["id_beneficiario"]


def test_sem_nascimento_nao_se_registra_e_a_idade_e_a_da_assinatura(client, db, auth_headers):
    """Revisão independente: sem o nascimento a criança "consentia sozinha"; a idade vale na DATA DA ASSINATURA (fez 18 depois de assinar sozinha: não vale)."""
    sem = _registrar_consentimento(client, auth_headers, _novo(client, auth_headers))
    assert sem.status_code == 400 and "data de nascimento" in sem.json()["detail"]
    fez_18_depois = _novo(client, auth_headers, "2008-10-28")  # fez 18 em 28/10/2026, um dia depois de o termo versão 2 existir
    r = _registrar_consentimento(client, auth_headers, fez_18_depois, assinado_em="2026-10-27")
    assert r.status_code == 400 and "menos de 18 anos" in r.json()["detail"]
    assert _registrar_consentimento(client, auth_headers, fez_18_depois, assinado_em="2026-10-28").status_code == 200, "no dia dos 18 anos já consente"


def test_adulto_pelo_responsavel_so_com_o_responsavel_legal(client, db, auth_headers):
    adulto = _novo(client, auth_headers, "1980-01-01")
    mae = _registrar_consentimento(client, auth_headers, adulto, dado_por="responsavel", nome_responsavel="Maria de Teste", vinculo="mae")
    assert mae.status_code == 400 and "já tinha 18 anos" in mae.json()["detail"]
    curatela = _registrar_consentimento(client, auth_headers, adulto, dado_por="responsavel", nome_responsavel="Curador de Teste", vinculo="responsavel_legal")
    assert curatela.status_code == 200 and curatela.json()["vinculo_rotulo"] == "Responsável legal (guarda, tutela ou curatela)"


def test_nascimento_corrigido_para_menor_invalida_o_consentimento_dado_sozinho(client, db, auth_headers):
    id_beneficiario = _criar_beneficiario(client, auth_headers)
    id_vinculo = _vinculo_com_equipe(client, db, auth_headers, id_beneficiario)
    assert _atender(client, auth_headers, id_vinculo).status_code == 200
    r = client.put(f"/api/beneficiarios/{id_beneficiario}", json={"data_nascimento": "2016-03-01T00:00:00"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    [c] = _consentimentos_do(db, id_beneficiario)
    assert c.encerramento == INVALIDADO and "menos de 18 anos" in c.motivo_encerramento
    assert _atender(client, auth_headers, id_vinculo).status_code == 409
    ok = _registrar_consentimento(client, auth_headers, id_beneficiario, dado_por="responsavel", nome_responsavel="Pai de Teste", vinculo="pai")
    assert ok.status_code == 200 and _atender(client, auth_headers, id_vinculo).status_code == 200


def test_a_marca_antiga_nao_abre_o_prontuario(client, db, auth_headers):
    """Revisão independente: a marca antiga (declaração antiga, sem termo nem responsável) virava consentimento vigente; agora é só a prova do que havia."""
    id_beneficiario = _criar_beneficiario(client, auth_headers, com_consentimento=False)
    id_vinculo = _vinculo_com_equipe(client, db, auth_headers, id_beneficiario)
    from app.models.beneficiarios import Beneficiario

    b = db.get(Beneficiario, id_beneficiario)
    consentimentos.registrar(db, None, origem=consentimentos.BENEFICIARIO, id_origem=id_beneficiario, termo="ATENDIMENTO_SOCIAL", versao="1",
                             titular="Marca antiga", id_pessoa=b.id_pessoa, meio=consentimentos.DECLARACAO_ANTIGA, dado_em=datetime(2026, 10, 1))
    b.observacao_consentimento = "Colhido em papel."
    db.commit()
    r = _atender(client, auth_headers, id_vinculo)
    assert r.status_code == 409 and "marca antiga" in r.json()["detail"]
    linha = next(x for x in client.get("/api/beneficiarios/", headers=auth_headers).json() if x["id_beneficiario"] == id_beneficiario)
    assert linha["consentimento_lgpd_registrado"] is False and linha["consentimento"]["meio"] == "declaracao_antiga"
    assert linha["observacao_consentimento"] == "Colhido em papel." and "cadastro do beneficiário" in linha["consentimento"]["meio_rotulo"]
    projeto = next(v for v in client.get(f"/api/projetos/{_vinculo_projeto(db, id_vinculo)}/beneficiarios", headers=auth_headers).json()
                   if v["id_vinculo"] == id_vinculo)
    assert projeto["consentimento_vigente"] is False
    assert _registrar_consentimento(client, auth_headers, id_beneficiario).status_code == 200
    assert _atender(client, auth_headers, id_vinculo).status_code == 200


def test_a_busca_acha_o_nome_do_responsavel(client, db, auth_headers):
    crianca = _novo(client, auth_headers, "2017-02-02")
    responsavel = f"Responsavel Buscado {uuid.uuid4().hex[:6]}"
    assert _registrar_consentimento(client, auth_headers, crianca, dado_por="responsavel", nome_responsavel=responsavel,
                                    vinculo="responsavel_legal").status_code == 200
    achados = consentimentos.listar(db, busca=responsavel.lower(), origem=consentimentos.BENEFICIARIO)["consentimentos"]
    assert [c["id_origem"] for c in achados] == [crianca]


def test_o_aviso_diz_quem_marcava_a_caixa(client, db, auth_headers):
    """Revisão independente: a versão 1 dizia "a pessoa marcou a caixa", mas quem marcava era a equipe."""
    antigo = client.get("/api/textos-de-privacidade/ATENDIMENTO_SOCIAL/1", headers=auth_headers)
    assert antigo.status_code == 200, antigo.text
    assert antigo.json()["marcada_pela_equipe"] is True
    assert client.get("/api/textos-de-privacidade/FILIACAO/3", headers=auth_headers).json()["marcada_pela_equipe"] is False


# ------------------------------------------------------------------------------------------------ 3. substituir e revogar
def test_registrar_de_novo_substitui_e_revogar_fecha_o_que_e_novo(client, db, auth_headers):
    id_beneficiario = _criar_beneficiario(client, auth_headers)
    id_vinculo = _vinculo_com_equipe(client, db, auth_headers, id_beneficiario)
    assert _atender(client, auth_headers, id_vinculo).status_code == 200
    assert _registrar_consentimento(client, auth_headers, id_beneficiario, assinado_em="2026-10-28").status_code == 200
    anterior, novo = _consentimentos_do(db, id_beneficiario)
    assert anterior.encerramento == SUBSTITUIDO and "Substituído" in anterior.motivo_encerramento and novo.encerrado_em is None
    assert consentimentos.para_o_painel(anterior)["encerramento_rotulo"] == "Encerrado: substituído por um termo registrado depois"

    r = client.post(f"/api/beneficiarios/{id_beneficiario}/consentimento/revogar", json={"motivo": "A mãe pediu na reunião."}, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["encerramento_rotulo"] == "Revogado (a pessoa ou o responsável retirou o consentimento)"
    assert _consentimentos_do(db, id_beneficiario)[-1].encerramento == REVOGADO
    assert _atender(client, auth_headers, id_vinculo).status_code == 409, "revogado, nada novo grava"
    assert len(client.get(f"/api/beneficiarios-projeto/{id_vinculo}/atendimentos", headers=auth_headers).json()) == 1, "o que já existe fica"
    assert client.post(f"/api/beneficiarios/{id_beneficiario}/consentimento/revogar", json={}, headers=auth_headers).status_code == 404


# ------------------------------------------------------------------------------------------------ 4. recusas, permissão e o termo
def test_termo_velho_data_futura_e_sem_permissao_sao_recusados(client, db, auth_headers):
    id_beneficiario = _criar_beneficiario(client, auth_headers, com_consentimento=False)
    velho = _registrar_consentimento(client, auth_headers, id_beneficiario, versao_do_termo="1")
    assert velho.status_code == 422 and "recarregue" in velho.json()["detail"]
    futura = _registrar_consentimento(client, auth_headers, id_beneficiario, assinado_em=(date.today() + timedelta(days=2)).isoformat())
    assert futura.status_code == 400
    assert _registrar_consentimento(client, auth_headers, id_beneficiario, dado_por="vizinho").status_code == 400
    _, associado = _criar_associado(db, f"Associado Consentimento {uuid.uuid4().hex[:6]}", nome_nivel="Associado")
    assert _registrar_consentimento(client, _headers(associado), id_beneficiario).status_code == 403
    assert _consentimentos_do(db, id_beneficiario) == []

    termo = client.get("/api/consentimentos/termo-da-tela/beneficiario", headers=auth_headers).json()
    assert termo["termo"] == "ATENDIMENTO_SOCIAL" and "art. 14, § 1º" in termo["texto"]
    pdf = client.get("/api/consentimentos/termos/ATENDIMENTO_SOCIAL/pdf", headers=auth_headers)
    texto = " ".join(p.extract_text() for p in pypdf.PdfReader(io.BytesIO(pdf.content)).pages)
    assert pdf.status_code == 200 and "TERMO DE CONSENTIMENTO" in texto and "Assinatura" in texto


def test_o_termo_diz_o_que_o_sistema_faz():
    """O termo é assinado: cada afirmação tem de ser verdade no código (só a equipe vê, cada leitura fica registrada, revogar fecha o que é novo)."""
    texto = tp.atual("ATENDIMENTO_SOCIAL").texto
    assert tp.tipo_da_versao(tp.atual("ATENDIMENTO_SOCIAL")) == tp.CONSENTIMENTO and "art. 11, I" in texto
    from app.classificacao_de_dados import CONSULTA_PRONTUARIO
    from app.services import beneficiarios

    assert "só a equipe do projeto os vê" in texto and hasattr(beneficiarios, "exigir_membro_da_equipe_do_vinculo")
    assert "cada leitura fica registrada" in texto and CONSULTA_PRONTUARIO
    assert "nenhum atendimento novo é registrado" in texto and hasattr(beneficiarios, "_exigir_consentimento")
    crianca = next(p for p in texto.split("\n\n") if p.startswith("CRIANÇA OU ADOLESCENTE"))
    assert "quem consente é um dos pais ou o responsável legal (LGPD, art. 14, § 1º)" in crianca and "assina junto" in crianca
    assert tp.buscar("ATENDIMENTO_SOCIAL", "1").reconstituido


# ------------------------------------------------------------------------------------------------ 5. a migração
def test_a_migracao_traz_a_marca_antiga_como_declaracao_antiga():
    import app.models  # noqa: F401
    from app.database import Base

    caminho = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "9d1b6c3e5f27_v7_1c_consentimento_do_beneficiario.py"
    especificacao = importlib.util.spec_from_file_location("migracao_beneficiario", caminho)
    migracao = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(migracao)
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor)
    with motor.begin() as c:
        c.execute(sa.text("INSERT INTO pessoas (id_pessoa, nome_completo) VALUES (1, 'Com a marca'), (2, 'Sem a marca')"))
        c.execute(sa.text("INSERT INTO beneficiarios (id_beneficiario, id_pessoa, consentimento_lgpd_registrado, data_consentimento) VALUES "
                          "(10, 1, 1, '2026-10-01 09:00:00'), (11, 2, 0, NULL)"))
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            migracao.upgrade()
    with motor.connect() as c:
        linhas = c.execute(sa.text("SELECT ponto, versao, titular, id_pessoa, meio, origem, id_origem FROM consentimentos")).all()
    assert linhas == [("ATENDIMENTO_SOCIAL", "1", "Com a marca", 1, "declaracao_antiga", "beneficiario", 10)]
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            migracao.downgrade()
    with motor.connect() as c:
        assert c.execute(sa.text("SELECT COUNT(*) FROM consentimentos")).scalar() == 0
    assert datetime  # (importado para os testes de data acima)
