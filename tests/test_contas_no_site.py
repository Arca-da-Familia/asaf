"""v6.3b (FASE 6) - as contas do exercício no site, geradas dos lançamentos, só depois da aprovação em Assembleia.

Decisão do Presidente (2026-10-22): as contas do ano só vão ao site DEPOIS de a Assembleia aprovar e de o Presidente ou o Secretário confirmar a
publicação; resumo sem nome de ninguém, com o parecer do Conselho Fiscal. O texto é o gerado dos dados (ninguém o digita) e os números vão em JSON
para o site montar as tabelas. Os números são os que existiam na Assembleia (lançamento registrado depois não entra), e a Assembleia tem de ser
depois do fim do exercício (ano parcial nunca vai a público)."""
import json
import uuid
from datetime import datetime, timedelta
from decimal import Decimal

import pytest

from app.models.documentos import DocumentoInstitucional
from app.models.governanca import Assembleia
from app.services.publico_contexto import dia_de_belem
from tests.test_conselho_fiscal import _criar_associado, _headers
from tests.test_documentos_institucionais import _usuario

_ISO = "%Y-%m-%dT%H:%M:%S"
ANO = datetime.utcnow().year - 1  # o exercício encerrado (a Assembleia de teste é daqui a 20 dias, no ano de hoje)


def _conta(client, auth_headers, tipo, descricao):
    corpo = {"codigo_contabil": f"C{uuid.uuid4().hex[:8]}", "descricao_conta": descricao, "tipo": tipo}
    r = client.post("/plano-contas/", json=corpo, headers=auth_headers)
    assert r.status_code == 200, r.text
    return {**corpo, "id_conta": r.json()["id_conta"]}


def _receita_recebida(client, auth_headers, valor, competencia: datetime | None = None, receita=None):
    receita = receita or _conta(client, auth_headers, "Receita", f"Doações de teste das contas {uuid.uuid4().hex[:4]}")
    caixa = _conta(client, auth_headers, "Ativo", "Caixa de teste das contas")
    r = client.post("/titulos/", json={
        "tipo_titulo": "A Receber", "id_conta_contabil": receita["id_conta"], "descricao": "Receita de teste das contas", "valor_original": valor,
        "data_vencimento": (datetime.utcnow() + timedelta(days=5)).strftime(_ISO),
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    baixa = {"id_titulo": r.json()["id_titulo"], "valor_pago": valor, "forma_pagamento": "Pix", "id_conta_contabil_contrapartida": caixa["id_conta"]}
    if competencia:
        baixa["data_competencia"] = competencia.strftime(_ISO)
    r = client.post("/baixar-titulo/", json=baixa, headers=auth_headers)
    assert r.status_code == 200, r.text
    return receita


def _parecer(client, db, ano, texto="Contas conferidas e em ordem, sem ressalvas a apontar.", tipo="Favorável", usuario=None):
    if usuario is None:
        _conselheiro, usuario = _criar_associado(db, f"Conselheiro Contas {uuid.uuid4().hex[:6]}", nome_nivel="Conselho Fiscal")
    r = client.post("/api/conselho-fiscal/pareceres", headers=_headers(usuario), json={"ano_exercicio": ano, "tipo": tipo, "texto": texto})
    assert r.status_code == 200, r.text
    return usuario


def _ata_com_aprovacao(client, auth_headers, ano, assinar=True, encerrar=True) -> tuple[int, int, int]:
    r = client.post("/api/assembleias/", headers=auth_headers, json={
        "tipo": "Ordinária", "pauta": f"Aprovação das contas de {ano}", "data_hora_convocacao": (datetime.utcnow() + timedelta(days=20)).strftime(_ISO),
    })
    id_assembleia = r.json()["id_assembleia"]
    client.post(f"/api/assembleias/{id_assembleia}/convocar", headers=auth_headers)
    client.post(f"/api/assembleias/{id_assembleia}/abrir-sessao", headers=auth_headers)
    if encerrar:
        assert client.post(f"/api/assembleias/{id_assembleia}/encerrar-sessao", headers=auth_headers).status_code == 200
    id_ata = client.post(f"/api/assembleias/{id_assembleia}/ata", headers=auth_headers).json()["id_ata"]
    r = client.post(f"/api/atas/{id_ata}/deliberacoes", headers=auth_headers, json={
        "tipo": "Aprovação de contas", "texto": f"A Assembleia aprovou as contas do exercício {ano}.", "ano_exercicio": ano,
    })
    assert r.status_code == 200, r.text
    if assinar:
        assert client.post(f"/api/atas/{id_ata}/assinar", headers=auth_headers).status_code == 200
    return id_ata, r.json()["id_deliberacao"], id_assembleia


def _publicar(client, preparador, aprovador, id_documento):
    assert client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=preparador).status_code == 200
    r = client.post(f"/api/documentos/{id_documento}/aprovar", headers=aprovador)
    assert r.status_code == 200, r.text


@pytest.fixture
def contas_aprovadas(client, auth_headers, db, exercicio_financeiro_aberto):
    """O exercício de hoje com uma receita recebida, parecer do Conselho Fiscal e a aprovação em ata assinada."""
    receita = _receita_recebida(client, auth_headers, 500, competencia=datetime(ANO, 6, 1))
    _parecer(client, db, ANO)
    _ata_com_aprovacao(client, auth_headers, ANO)
    return receita


def test_sem_a_aprovacao_em_assembleia_as_contas_nao_vao_ao_site(client, auth_headers, db, exercicio_financeiro_aberto):
    ano = 2021
    preparador = _usuario(db, "documentos")
    r = client.post(f"/api/prestacoes-de-contas/{ano}/publicar-no-site", headers=preparador)
    assert r.status_code == 409 and "ainda não foram aprovadas pela Assembleia" in r.json()["detail"]
    assert client.get(f"/api/prestacoes-de-contas/{ano}/no-site", headers=preparador).json() == {
        "ano": ano, "aprovadas_pela_assembleia": False, "aprovadas_em": None, "lancamentos_registrados_depois": 0, "documento": None,
    }
    # a deliberação numa ata AINDA NÃO assinada não basta
    _parecer(client, db, ano)
    _ata_com_aprovacao(client, auth_headers, ano, assinar=False)
    assert client.post(f"/api/prestacoes-de-contas/{ano}/publicar-no-site", headers=preparador).status_code == 409
    # nem a ata assinada de uma assembleia que ainda não foi encerrada (não aconteceu)
    _ata_com_aprovacao(client, auth_headers, ano, encerrar=False)
    assert client.post(f"/api/prestacoes-de-contas/{ano}/publicar-no-site", headers=preparador).status_code == 409
    # nem uma deliberação revogada
    _id_ata, id_deliberacao, _id = _ata_com_aprovacao(client, auth_headers, ano)
    assert client.post(f"/api/deliberacoes/{id_deliberacao}/revogar", headers=auth_headers, json={"motivo": "Registrada no exercício errado."}).status_code == 200
    assert client.post(f"/api/prestacoes-de-contas/{ano}/publicar-no-site", headers=preparador).status_code == 409


def test_a_assembleia_tem_de_ser_depois_do_fim_do_exercicio(client, auth_headers, db, exercicio_financeiro_aberto):
    """A Assembleia de teste é daqui a 20 dias: aprovar as contas do ANO DE HOJE nela seria publicar um ano parcial."""
    ano_corrente = datetime.utcnow().year
    if (datetime.utcnow() + timedelta(days=20)).year != ano_corrente:  # nos últimos dias do ano a Assembleia de teste já cai em janeiro
        ano_corrente -= 1
        pytest.skip("a Assembleia de teste cai no ano seguinte: o caso do ano parcial não se monta hoje")
    _parecer(client, db, ano_corrente)
    _ata_com_aprovacao(client, auth_headers, ano_corrente)
    preparador = _usuario(db, "documentos")
    r = client.post(f"/api/prestacoes-de-contas/{ano_corrente}/publicar-no-site", headers=preparador)
    assert r.status_code == 409 and "ainda não foram aprovadas pela Assembleia" in r.json()["detail"]


def test_deliberacao_revogada_depois_do_preparo_trava_a_revisao_e_a_aprovacao(client, auth_headers, db, exercicio_financeiro_aberto):
    ano = 2020
    _parecer(client, db, ano)
    _id_ata, id_deliberacao, _id = _ata_com_aprovacao(client, auth_headers, ano)
    preparador, aprovador = _usuario(db, "documentos"), _usuario(db, "aprovar_publicacao")
    id_documento = client.post(f"/api/prestacoes-de-contas/{ano}/publicar-no-site", headers=preparador).json()["id_documento"]
    assert client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=preparador).status_code == 200
    assert client.post(f"/api/deliberacoes/{id_deliberacao}/revogar", headers=auth_headers, json={"motivo": "Registrada por engano."}).status_code == 200
    r = client.post(f"/api/documentos/{id_documento}/aprovar", headers=aprovador)
    assert r.status_code == 409 and "não têm mais a aprovação da Assembleia" in r.json()["detail"]
    assert all(c["ano"] != ano for c in client.get("/api/publico/transparencia/contas").json())
    # devolvido ao rascunho (recusa), também não volta à revisão
    assert client.post(f"/api/documentos/{id_documento}/recusar", headers=aprovador, json={"motivo": "A deliberação foi revogada."}).status_code == 200
    r = client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=preparador)
    assert r.status_code == 409 and "não têm mais a aprovação da Assembleia" in r.json()["detail"]


def test_quem_prepara_tem_a_permissao_de_documentos(client, auth_headers, db, contas_aprovadas):
    assert client.post(f"/api/prestacoes-de-contas/{ANO}/publicar-no-site").status_code == 401
    assert client.post(f"/api/prestacoes-de-contas/{ANO}/publicar-no-site", headers=_usuario(db, "financeiro")).status_code == 403
    assert client.post(f"/api/prestacoes-de-contas/{ANO}/publicar-no-site", headers=_usuario(db, "documentos")).status_code == 200


def test_o_documento_e_gerado_dos_lancamentos_com_o_parecer_e_ninguem_digita_o_texto(client, auth_headers, db, contas_aprovadas):
    preparador = _usuario(db, "documentos")
    r = client.post(f"/api/prestacoes-de-contas/{ANO}/publicar-no-site", headers=preparador)
    assert r.status_code == 200, r.text
    id_documento = r.json()["id_documento"]
    doc = db.get(DocumentoInstitucional, id_documento)
    assert (doc.tipo, doc.classificacao, doc.publicar_no_site, doc.situacao, doc.publico_formato, doc.ano) == ("BALANCO", "Pública", True, "Rascunho", "TEXTO", ANO)
    dados = json.loads(doc.dados_publicos_json)
    linha = next(r for r in dados["receitas"] if r["codigo"] == contas_aprovadas["codigo_contabil"])
    assert linha["valor"] == "500.00" and linha["conta"] == contas_aprovadas["descricao_conta"]
    total = sum((Decimal(r["valor"]) for r in dados["receitas"]), Decimal("0"))
    assert Decimal(dados["total_receitas"]) == total
    assert Decimal(dados["resultado"]) == Decimal(dados["total_receitas"]) - Decimal(dados["total_despesas"])
    assert dados["pareceres"] and all(p["tipo"] == "Favorável" and p["data"] for p in dados["pareceres"])
    # a data publicada é o dia da Assembleia em Belém (o instante é gravado em UTC), não a do clique em "Assinar"; a do documento também
    assembleia = db.query(Assembleia).order_by(Assembleia.id_assembleia.desc()).first()
    assert dados["aprovadas_em_assembleia_em"] == dia_de_belem(assembleia.data_hora_convocacao) == doc.data_documento.isoformat()
    assert f"Prestação de contas do exercício {ANO}" in doc.publico_texto and contas_aprovadas["descricao_conta"] in doc.publico_texto
    assert "Conselho Fiscal" in doc.publico_texto
    # o texto é o gerado: nem texto, nem PDF, nem cadastro, nem versão nova pela biblioteca mudam à mão
    detalhe = client.get(f"/api/documentos/{id_documento}", headers=_usuario(db, "documentos")).json()
    assert detalhe["gerado_pelo_sistema"] is True
    pdf = ("contas.pdf", b"%PDF-1.4 contas", "application/pdf")
    for r in (
        client.post(f"/api/documentos/{id_documento}/versao-publica-texto", headers=auth_headers, json={"texto": "Outras contas, digitadas à mão, com muitas letras."}),
        client.post(f"/api/documentos/{id_documento}/versao-publica", headers=auth_headers, files={"arquivo": pdf}),
        client.patch(f"/api/documentos/{id_documento}", headers=auth_headers, json={"titulo": "Contas editadas à mão"}),
        client.post(f"/api/documentos/{id_documento}/original", headers=auth_headers, files={"arquivo": pdf}),
    ):
        assert r.status_code == 409 and "gerado pelo sistema" in r.json()["detail"], r.text


def test_publicadas_aparecem_no_publico_e_a_versao_nova_so_pela_tela_de_origem(client, auth_headers, db, contas_aprovadas):
    preparador, aprovador = _usuario(db, "documentos"), _usuario(db, "aprovar_publicacao")
    v1 = client.post(f"/api/prestacoes-de-contas/{ANO}/publicar-no-site", headers=preparador).json()["id_documento"]
    # antes de aprovar, nada no público
    assert all(c["ano"] != ANO for c in client.get("/api/publico/transparencia/contas").json())
    _publicar(client, preparador, aprovador, v1)
    contas = client.get("/api/publico/transparencia/contas").json()
    do_ano = next(c for c in contas if c["ano"] == ANO)
    assert do_ano["id_documento"] == v1 and do_ano["dados"]["receitas"] and "aprovado_por" in do_ano
    assert any(d["id_documento"] == v1 for d in client.get("/api/publico/transparencia/documentos").json())  # também na lista de documentos
    # "Criar nova versão" da biblioteca NÃO serve para o gerado (a v2 nasceria sem a marca e aceitaria texto à mão, tirando as contas do site)
    r = client.post(f"/api/documentos/{v1}/nova-versao", headers=preparador)
    assert r.status_code == 409 and "gerado pelo sistema" in r.json()["detail"]
    # pela tela de origem: abre a versão 2 (com ano e data); a publicada continua no ar até a nova ser aprovada
    r = client.post(f"/api/prestacoes-de-contas/{ANO}/publicar-no-site", headers=preparador)
    v2 = r.json()["id_documento"]
    assert v2 != v1 and r.json()["versao"] == 2
    nova = db.get(DocumentoInstitucional, v2)
    assert nova.ano == ANO and nova.data_documento is not None and nova.dados_publicos_json
    assert next(c for c in client.get("/api/publico/transparencia/contas").json() if c["ano"] == ANO)["id_documento"] == v1
    # refazer o rascunho não abre outra versão
    assert client.post(f"/api/prestacoes-de-contas/{ANO}/publicar-no-site", headers=preparador).json()["id_documento"] == v2
    _publicar(client, preparador, aprovador, v2)
    assert next(c for c in client.get("/api/publico/transparencia/contas").json() if c["ano"] == ANO)["id_documento"] == v2
    assert client.get(f"/api/prestacoes-de-contas/{ANO}/no-site", headers=preparador).json()["documento"]["id_documento"] == v2


def test_os_numeros_sao_os_da_assembleia_lancamento_registrado_depois_nao_entra(client, auth_headers, db, exercicio_financeiro_aberto):
    ano = 2024
    receita = _receita_recebida(client, auth_headers, 300, competencia=datetime(ano, 6, 1))
    _parecer(client, db, ano)
    _id_ata, _id_deliberacao, id_assembleia = _ata_com_aprovacao(client, auth_headers, ano)
    # a Assembleia aconteceu AGORA (instante em UTC, como todo o sistema): o que foi registrado até aqui é o que ela aprovou
    assembleia = db.get(Assembleia, id_assembleia)
    assembleia.data_hora_convocacao = datetime.utcnow()
    db.commit()
    # depois dela, alguém registra uma receita de competência retroativa no ano já aprovado
    _receita_recebida(client, auth_headers, 45, competencia=datetime(ano, 7, 1), receita=receita)
    preparador = _usuario(db, "documentos")
    situacao = client.get(f"/api/prestacoes-de-contas/{ano}/no-site", headers=preparador).json()
    assert situacao["lancamentos_registrados_depois"] == 1
    id_documento = client.post(f"/api/prestacoes-de-contas/{ano}/publicar-no-site", headers=preparador).json()["id_documento"]
    dados = json.loads(db.get(DocumentoInstitucional, id_documento).dados_publicos_json)
    assert dados["total_receitas"] == "300.00"  # não 345: a receita registrada depois da Assembleia não entra
    # numa nova aprovação (outra Assembleia, mais tarde), os números passam a incluir a receita
    _ata_com_aprovacao(client, auth_headers, ano)
    assert client.get(f"/api/prestacoes-de-contas/{ano}/no-site", headers=preparador).json()["lancamentos_registrados_depois"] == 0
    client.post(f"/api/prestacoes-de-contas/{ano}/publicar-no-site", headers=preparador)
    db.expire_all()
    assert json.loads(db.get(DocumentoInstitucional, id_documento).dados_publicos_json)["total_receitas"] == "345.00"


def test_o_ultimo_parecer_de_cada_conselheiro_ate_a_deliberacao(client, auth_headers, db, exercicio_financeiro_aberto):
    ano = 2023
    primeiro = _parecer(client, db, ano, tipo="Contrário", texto="Primeira leitura, antes da correção: substituída pelo próprio conselheiro.")
    _parecer(client, db, ano, texto="Contas em ordem, conferidas pelo primeiro conselheiro.", usuario=primeiro)
    _parecer(client, db, ano, tipo="Com ressalva", texto="Faltou o comprovante de uma despesa pequena; o resto confere.")
    _ata_com_aprovacao(client, auth_headers, ano)
    _parecer(client, db, ano, tipo="Contrário", texto="Parecer emitido depois da Assembleia, não pode aparecer.")
    preparador = _usuario(db, "documentos")
    id_documento = client.post(f"/api/prestacoes-de-contas/{ano}/publicar-no-site", headers=preparador).json()["id_documento"]
    doc = db.get(DocumentoInstitucional, id_documento)
    assert [p["tipo"] for p in json.loads(doc.dados_publicos_json)["pareceres"]] == ["Favorável", "Com ressalva"]
    assert "Pareceres do Conselho Fiscal (2, um por conselheiro)" in doc.publico_texto and "não pode aparecer" not in doc.publico_texto
    assert "Primeira leitura" not in doc.publico_texto
    assert "Conselheiro Contas" not in doc.publico_texto  # sem o nome de quem emitiu


def test_dado_pessoal_no_parecer_trava_a_geracao_sem_criar_nada(client, auth_headers, db, exercicio_financeiro_aberto):
    _parecer(client, db, 2022, texto="Contas em ordem. Contato do conselheiro: CPF 529.982.247-25.")
    _ata_com_aprovacao(client, auth_headers, 2022)
    preparador = _usuario(db, "documentos")
    for _tentativa in range(2):  # a segunda tentativa também recusa, sem acumular rascunho órfão
        r = client.post("/api/prestacoes-de-contas/2022/publicar-no-site", headers=preparador)
        assert r.status_code == 422 and "corrija na origem" in r.json()["detail"]["mensagem"]
        assert "529.982.247-25" not in r.text and r.json()["detail"]["resultado"]["bloqueios"]
    assert db.query(DocumentoInstitucional).filter(DocumentoInstitucional.tipo == "BALANCO", DocumentoInstitucional.ano == 2022).count() == 0


def test_a_data_publicada_e_o_dia_da_assembleia_em_belem(client, auth_headers, db, exercicio_financeiro_aberto):
    """Uma Assembleia às 22h30 de 14/01 em Belém é gravada como 15/01 01:30 UTC: o público tem de ler 14/01 (no texto, no JSON e na data do documento)."""
    ano = 2018
    _parecer(client, db, ano)
    _id_ata, _id_deliberacao, id_assembleia = _ata_com_aprovacao(client, auth_headers, ano)
    assembleia = db.get(Assembleia, id_assembleia)
    assembleia.data_hora_convocacao = datetime(ano + 1, 1, 15, 1, 30)
    db.commit()
    preparador = _usuario(db, "documentos")
    assert client.get(f"/api/prestacoes-de-contas/{ano}/no-site", headers=preparador).json()["aprovadas_em"] == f"{ano + 1}-01-14"
    id_documento = client.post(f"/api/prestacoes-de-contas/{ano}/publicar-no-site", headers=preparador).json()["id_documento"]
    doc = db.get(DocumentoInstitucional, id_documento)
    assert json.loads(doc.dados_publicos_json)["aprovadas_em_assembleia_em"] == f"{ano + 1}-01-14"
    assert doc.data_documento.isoformat() == f"{ano + 1}-01-14" and f"em 14/01/{ano + 1}." in doc.publico_texto


def test_a_ata_imprime_a_hora_de_belem_e_nao_a_utc(client, auth_headers, db, exercicio_financeiro_aberto):
    """A ata agora também vai ao site em texto: a hora da convocação tem de ser a de Belém (o instante é gravado em UTC; antes saíam 3 horas a mais)."""
    _parecer(client, db, 2019)
    id_ata, _id_deliberacao, id_assembleia = _ata_com_aprovacao(client, auth_headers, 2019, assinar=False)
    assembleia = db.get(Assembleia, id_assembleia)
    corpo = client.get(f"/api/atas/{id_ata}", headers=auth_headers).json()["corpo_texto"]
    belem = assembleia.data_hora_convocacao - timedelta(hours=3)
    assert f"Convocação: {belem:%d/%m/%Y às %H:%M} (horário de Belém)" in corpo
