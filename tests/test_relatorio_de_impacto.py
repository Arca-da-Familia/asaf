"""v7.0d (FASE 7) - o relatório de impacto à proteção de dados (RIPD) obrigatório antes do alto risco (ver app/services/relatorio_de_impacto.py).

  1. o PORTÃO: sem relatório aprovado, gravar no prontuário e registrar encaminhamento são recusados (409, com o motivo); a leitura continua; aprovado, grava;
  2. o rascunho nasce montado do inventário (dados sensíveis, base, medidas) com o parecer do encarregado em branco; aprovar exige todas as seções;
  3. aprovar torna a versão vigente e a anterior (aprovada ou suspensa) "Substituído"; um rascunho novo não fecha o tratamento; suspender fecha os novos
     registros até aprovar de novo; quem salva sobre um rascunho que outra pessoa mudou recebe 409 (o marcador do rascunho);
  4. ver: `privacidade`; salvar, aprovar e suspender: `privacidade_gerir`; saber se está liberado: qualquer pessoa logada (sem dado);
  5. a biometria e a pontuação de engajamento estão na lista, ainda não ligadas; o PDF; a Auditoria; a migração 13948ce981ad."""
import importlib.util
import json
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.database import Base
from app.models.core import AuditLog
from app.models.mandatos import Mandato
from app.models.privacidade import RIPD_APROVADO, RIPD_SUBSTITUIDO, RelatorioDeImpacto
from app.services import inventario
from app.services import relatorio_de_impacto as ripd
from tests.apoio_ripd import aprovar_relatorio_do_atendimento_social
from tests.test_beneficiarios import _associado_do_token, _criar_beneficiario, _criar_projeto, _vincular
from tests.test_conselho_fiscal import _criar_associado, _headers

CODIGO = "ATENDIMENTO_SOCIAL"
SECOES_COMPLETAS = {chave: f"Texto suficiente da seção {chave} ({uuid.uuid4().hex[:4]})." for chave, _ in ripd.SECOES}


def _marcador(client, auth_headers):
    """O marcador do rascunho que a tela receberia ao abrir (None se não há rascunho)."""
    tratamentos = client.get("/api/privacidade/relatorios-de-impacto", headers=auth_headers).json()["tratamentos"]
    return next(t for t in tratamentos if t["codigo"] == CODIGO)["marcador_do_rascunho"]


def _salvar(client, auth_headers, secoes, marcador=...):
    marcador = _marcador(client, auth_headers) if marcador is ... else marcador
    return client.put(f"/api/privacidade/relatorios-de-impacto/{CODIGO}", json={"secoes": secoes, "marcador_base": marcador}, headers=auth_headers)


def _vinculo_com_equipe(client, db, auth_headers) -> int:
    id_projeto = _criar_projeto(client, auth_headers)
    id_vinculo = _vincular(client, auth_headers, _criar_beneficiario(client, auth_headers), id_projeto)
    client.post(f"/api/projetos/{id_projeto}/equipe", json={"id_associado": _associado_do_token(db, auth_headers).id_associado, "papel": "COORDENADOR"},
                headers=auth_headers)
    return id_vinculo


# ------------------------------------------------------------------------------------------------ 1. o portão
def test_sem_relatorio_aprovado_o_prontuario_e_o_encaminhamento_nao_gravam(client, db, auth_headers):
    id_vinculo = _vinculo_com_equipe(client, db, auth_headers)
    assert client.post(f"/api/beneficiarios-projeto/{id_vinculo}/atendimentos", json={"relato": "Antes da suspensão."}, headers=auth_headers).status_code == 200
    try:
        suspenso = client.post(f"/api/privacidade/relatorios-de-impacto/{CODIGO}/suspender", json={"motivo": "Revisar os riscos depois do incidente."},
                               headers=auth_headers)
        assert suspenso.status_code == 200, suspenso.text
        assert client.get(f"/api/relatorios-de-impacto/{CODIGO}/liberado", headers=auth_headers).json()["liberado"] is False
        r = client.post(f"/api/beneficiarios-projeto/{id_vinculo}/atendimentos", json={"relato": "Durante a suspensão."}, headers=auth_headers)
        assert r.status_code == 409 and "relatório de impacto" in r.json()["detail"]
        r = client.post(f"/api/beneficiarios-projeto/{id_vinculo}/encaminhamentos", json={"tipo_rede": "CRAS", "descricao": "Durante a suspensão."},
                        headers=auth_headers)
        assert r.status_code == 409
        leitura = client.get(f"/api/beneficiarios-projeto/{id_vinculo}/atendimentos", headers=auth_headers)
        assert leitura.status_code == 200 and len(leitura.json()) == 1, "o que já existe continua legível (auditado)"
        assert client.post(f"/api/privacidade/relatorios-de-impacto/{CODIGO}/suspender", json={"motivo": "Suspender de novo não pode."},
                           headers=auth_headers).status_code == 409
        agora = next(t for t in suspenso.json()["tratamentos"] if t["codigo"] == CODIGO)
        assert agora["aprovado"] is None and agora["suspenso"]["motivo_suspensao"] == "Revisar os riscos depois do incidente."
        assert agora["proposta"] is None, "com versão na história, revisa-se do suspenso, não da proposta do sistema"
        id_suspenso = agora["suspenso"]["id_relatorio"]
        import io

        import pypdf

        pdf = client.get(f"/api/privacidade/relatorios-de-impacto/{CODIGO}/pdf", headers=auth_headers)
        texto = " ".join(" ".join(p.extract_text().split()) for p in pypdf.PdfReader(io.BytesIO(pdf.content)).pages)
        assert "suspensa em" in texto and "Revisar os riscos depois do incidente." in texto, "o PDF mostra o que está suspenso, com a data e o motivo"
    finally:
        aprovar_relatorio_do_atendimento_social()
    db.expire_all()
    assert db.get(RelatorioDeImpacto, id_suspenso).situacao == RIPD_SUBSTITUIDO, "aprovar de novo substitui a versão suspensa"
    assert client.post(f"/api/beneficiarios-projeto/{id_vinculo}/atendimentos", json={"relato": "Depois de aprovar de novo."}, headers=auth_headers).status_code == 200


# ------------------------------------------------------------------------------------------------ 2 e 3. rascunho, aprovação, versões
def test_rascunho_montado_aprovar_exige_tudo_e_versoes(client, db, auth_headers):
    dados = {t["codigo"]: t for t in client.get("/api/privacidade/relatorios-de-impacto", headers=auth_headers).json()["tratamentos"]}
    atendimento = dados[CODIGO]
    assert atendimento["ligado"] and atendimento["liberado"]
    assert atendimento["proposta"] is None, "já há versão aprovada: revisa-se dela, não da proposta do sistema"
    proposta = ripd._proposta(db, ripd.buscar(CODIGO))
    assert "registros_atendimento.relato" in proposta["dados"] and proposta["parecer_do_encarregado"] == ""
    assert "melhor interesse" in proposta["dados"]
    vigente_antes = atendimento["aprovado"]["versao"]
    sem_parecer = {**SECOES_COMPLETAS, "parecer_do_encarregado": ""}
    assert _salvar(client, auth_headers, sem_parecer).status_code == 200
    depois_do_rascunho = client.get(f"/api/relatorios-de-impacto/{CODIGO}/liberado", headers=auth_headers).json()
    assert depois_do_rascunho["liberado"] is True, "um rascunho novo não fecha o tratamento: o aprovado continua valendo"
    recusa = client.post(f"/api/privacidade/relatorios-de-impacto/{CODIGO}/aprovar", headers=auth_headers)
    assert recusa.status_code == 422 and "Parecer do encarregado" in recusa.json()["detail"]
    assert _salvar(client, auth_headers, SECOES_COMPLETAS).status_code == 200
    aprovado = client.post(f"/api/privacidade/relatorios-de-impacto/{CODIGO}/aprovar", headers=auth_headers)
    assert aprovado.status_code == 200, aprovado.text
    agora = next(t for t in aprovado.json()["tratamentos"] if t["codigo"] == CODIGO)
    assert agora["aprovado"]["versao"] == vigente_antes + 1 and agora["aprovado"]["secoes"]["parecer_do_encarregado"] == SECOES_COMPLETAS["parecer_do_encarregado"]
    db.expire_all()
    antigo = db.query(RelatorioDeImpacto).filter(RelatorioDeImpacto.codigo_tratamento == CODIGO, RelatorioDeImpacto.versao == vigente_antes).one()
    assert antigo.situacao == RIPD_SUBSTITUIDO
    assert [h["situacao"] for h in agora["historico"]][:2] == [RIPD_APROVADO, RIPD_SUBSTITUIDO]
    assert client.post(f"/api/privacidade/relatorios-de-impacto/{CODIGO}/aprovar", headers=auth_headers).status_code == 409, "sem rascunho, nada a aprovar"
    acoes = {a for (a,) in db.query(AuditLog.acao).filter(AuditLog.tabela_afetada == "relatorios_de_impacto").all()}
    assert {"RIPD_RASCUNHO_SALVO", "RIPD_APROVADO"} <= acoes


def test_a_proposta_do_sistema_diz_o_que_o_codigo_faz(db):
    """Cada afirmação do rascunho montado foi conferida com o código: quem entra na equipe (e fica na Auditoria), o consentimento ainda não exigido."""
    proposta = ripd._proposta(db, ripd.buscar(CODIGO))
    tudo = " ".join(proposta.values())
    assert "curto" not in tudo, "o relato não tem limite de tamanho curto"
    assert "pode pôr alguém (ou a si) na equipe" in proposta["metodologia"] and "Auditoria" in proposta["metodologia"]
    assert "ainda não o exige" in proposta["metodologia"] and "o sistema ainda não exige" in proposta["riscos"]
    from app.models.beneficiarios import Beneficiario

    assert hasattr(Beneficiario, "consentimento_lgpd_registrado"), "o campo citado no rascunho existe"


def test_salvar_sobre_rascunho_que_outra_pessoa_mudou_recebe_409(client, db, auth_headers):
    marcador = _marcador(client, auth_headers)
    primeiro = _salvar(client, auth_headers, {**SECOES_COMPLETAS, "descricao": "Primeira pessoa."}, marcador)
    assert primeiro.status_code == 200, primeiro.text
    novo = next(t for t in primeiro.json()["tratamentos"] if t["codigo"] == CODIGO)["marcador_do_rascunho"]
    assert novo and novo != marcador
    segundo = _salvar(client, auth_headers, {**SECOES_COMPLETAS, "descricao": "Segunda pessoa."}, novo)
    assert segundo.status_code == 200, segundo.text
    recusa = _salvar(client, auth_headers, {**SECOES_COMPLETAS, "descricao": "A primeira de novo, com o marcador velho."}, novo)
    assert recusa.status_code == 409 and "Outra pessoa salvou" in recusa.json()["detail"]
    db.expire_all()
    rascunho = db.query(RelatorioDeImpacto).filter(RelatorioDeImpacto.codigo_tratamento == CODIGO, RelatorioDeImpacto.situacao == "Rascunho").one()
    assert rascunho.secoes["descricao"] == "Segunda pessoa.", "o texto de quem salvou por último com o marcador certo fica"
    assert _salvar(client, auth_headers, SECOES_COMPLETAS, None).status_code == 409, "a tela que abriu sem rascunho não grava sobre um que surgiu"
    assert _salvar(client, auth_headers, SECOES_COMPLETAS).status_code == 200
    assert client.post(f"/api/privacidade/relatorios-de-impacto/{CODIGO}/aprovar", headers=auth_headers).status_code == 200


def test_biometria_e_pontuacao_estao_na_lista_e_fechadas(client, auth_headers):
    dados = {t["codigo"]: t for t in client.get("/api/privacidade/relatorios-de-impacto", headers=auth_headers).json()["tratamentos"]}
    for codigo, versao in (("BIOMETRIA", "v20.3"), ("PONTUACAO_DE_ENGAJAMENTO", "v11.1")):
        assert dados[codigo]["ligado"] is False and dados[codigo]["versao_do_plano"] == versao and dados[codigo]["liberado"] is False
    assert all(t.atividade is None or t.atividade in {a.codigo for a in inventario.ATIVIDADES} for t in ripd.TRATAMENTOS)
    assert client.get("/api/relatorios-de-impacto/NAO_EXISTE/liberado", headers=auth_headers).status_code == 404


def test_o_pdf_do_relatorio(client, db, auth_headers):
    r = client.get(f"/api/privacidade/relatorios-de-impacto/{CODIGO}/pdf", headers=auth_headers)
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    import io

    import pypdf

    texto = "\n".join(p.extract_text() for p in pypdf.PdfReader(io.BytesIO(r.content)).pages)
    assert "RELATÓRIO DE IMPACTO" in texto and "Parecer do encarregado" in texto and "Controlador:" in texto
    assert db.query(AuditLog).filter(AuditLog.acao == "RIPD_EXPORTADO").count() >= 1


# ------------------------------------------------------------------------------------------------ 4. permissões
def test_quem_ve_quem_aprova_e_quem_so_pergunta_se_esta_liberado(client, db):
    vice, usuario = _criar_associado(db, f"Vice RIPD {uuid.uuid4().hex[:6]}", nome_nivel="Associado")
    mandato = Mandato(id_associado=vice.id_associado, orgao_codigo="DIRETORIA_EXECUTIVA", cargo_codigo="VICE_PRESIDENTE",
                      data_inicio=datetime.utcnow() - timedelta(days=2), data_fim_previsto=datetime.utcnow() + timedelta(days=30))
    db.add(mandato)
    db.commit()
    try:
        h = _headers(usuario)
        assert client.get("/api/privacidade/relatorios-de-impacto", headers=h).status_code == 200
        assert client.put(f"/api/privacidade/relatorios-de-impacto/{CODIGO}", json={"secoes": SECOES_COMPLETAS}, headers=h).status_code == 403
        assert client.post(f"/api/privacidade/relatorios-de-impacto/{CODIGO}/aprovar", headers=h).status_code == 403
        assert client.post(f"/api/privacidade/relatorios-de-impacto/{CODIGO}/suspender", json={"motivo": "tentativa do vice"}, headers=h).status_code == 403
    finally:
        mandato.data_fim_efetivo = datetime.utcnow()
        db.commit()
    _, associado = _criar_associado(db, f"Associado RIPD {uuid.uuid4().hex[:6]}", nome_nivel="Associado")
    h = _headers(associado)
    assert client.get("/api/privacidade/relatorios-de-impacto", headers=h).status_code == 403
    assert client.get(f"/api/relatorios-de-impacto/{CODIGO}/liberado", headers=h).json() == {
        "codigo": CODIGO, "nome": "Prontuário e encaminhamentos de beneficiários", "liberado": True,
    }
    assert client.get(f"/api/relatorios-de-impacto/{CODIGO}/liberado").status_code == 401


# ------------------------------------------------------------------------------------------------ 5. a migração
def test_a_migracao_cria_exatamente_a_tabela_que_o_modelo_descreve():
    caminho = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "13948ce981ad_v7_0d_relatorio_de_impacto.py"
    especificacao = importlib.util.spec_from_file_location("migracao_ripd", caminho)
    migracao = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(migracao)
    tabela = "relatorios_de_impacto"
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[t for nome, t in Base.metadata.tables.items() if nome != tabela])
    antes = set(sa.inspect(motor).get_table_names())
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            migracao.upgrade()
    with motor.connect() as conexao:
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
    sobre = [repr(d) for item in diferencas for d in (item if isinstance(item, list) else [item]) if tabela in repr(d)]
    assert sobre == [], "\n".join(sobre)
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            migracao.downgrade()
    assert set(sa.inspect(motor).get_table_names()) == antes
    assert json  # (importado para o leitor de Auditoria em outros testes)
