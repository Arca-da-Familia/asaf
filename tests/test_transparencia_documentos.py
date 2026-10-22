"""v6.3a (FASE 6) - documentos da Transparência com responsável e histórico; a ata no site em TEXTO.

Decisões do Presidente (2026-10-22): o documento publicado mostra quem aprovou (NOME e CARGO); a versão substituída continua no site, ligada à que a
substituiu (o grupo de versões); a ata vai ao site em TEXTO, nunca o PDF: parte-se do texto da ata, o verificador de dado pessoal bloqueia o que não pode
sair e a publicação é aprovada pelo Presidente ou pelo Secretário (outra pessoa)."""
from datetime import datetime, timedelta

from app.models.associados import Associado
from app.models.core import AuditLog, Usuario
from app.models.documentos import DocumentoInstitucional
from app.models.mandatos import Mandato
from app.security import criar_access_token
from app.services import documentos_institucionais
from tests.apoio_auth import cabecalho_admin
from tests.test_ata import _criar_assembleia_em_andamento, _criar_ata
from tests.test_documentos_institucionais import _usuario
from tests.test_situacao import _criar_associado

TEXTO_LIMPO = (
    "Ata da Assembleia Geral Ordinária. Aos dez dias do mês de março, reuniram-se os associados da ASAF na sede. "
    "A Assembleia aprovou por maioria as contas do exercício e o plano de atividades. Nada mais havendo, encerrou-se a sessão."
)


def _ata_assinada(client, auth_headers, db, corpo=None) -> int:
    id_ata = _criar_ata(client, auth_headers, _criar_assembleia_em_andamento(client, auth_headers))
    if corpo is not None:
        from app.models.ata import Ata

        db.get(Ata, id_ata).corpo_texto = corpo
        db.commit()
    assert client.post(f"/api/atas/{id_ata}/assinar", headers=auth_headers).status_code == 200
    return id_ata


def _secretario_com_mandato(client, db) -> tuple[dict, str]:
    """Uma pessoa com login (nível Associado, sem permissão) que é 1º Secretário por mandato vigente: aprova pela permissão do cargo."""
    associado = _criar_associado(client)
    r = client.post(
        f"/api/associados/{associado['id_associado']}/conceder-acesso",
        json={"email": f"secretario{associado['id_associado']}@transparencia.example.com", "senha_provisoria": "Provisoria1"}, headers=cabecalho_admin(client),
    )
    assert r.status_code == 200, r.text
    db.add(Mandato(
        id_associado=associado["id_associado"], orgao_codigo="DIRETORIA_EXECUTIVA", cargo_codigo="SECRETARIO",
        data_inicio=datetime.utcnow() - timedelta(days=30), data_fim_previsto=datetime.utcnow() + timedelta(days=700),
    ))
    db.commit()
    usuario = db.get(Usuario, r.json()["id_usuario"])
    nome = db.get(Associado, associado["id_associado"]).nome_completo
    return {"Authorization": f"Bearer {criar_access_token(usuario)}"}, nome


def _publicar_texto(client, preparador, aprovador, id_documento, texto=TEXTO_LIMPO):
    r = client.post(f"/api/documentos/{id_documento}/versao-publica-texto", headers=preparador, json={"texto": texto})
    assert r.status_code == 200 and r.json()["resultado_da_verificacao"]["ok"] is True, r.text
    assert client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=preparador).status_code == 200
    r = client.post(f"/api/documentos/{id_documento}/aprovar", headers=aprovador)
    assert r.status_code == 200, r.text


def test_a_ata_so_vai_ao_site_assinada_e_quem_prepara_precisa_da_permissao_de_documentos(client, auth_headers, db):
    rascunho = _criar_ata(client, auth_headers, _criar_assembleia_em_andamento(client, auth_headers))
    preparador = _usuario(db, "documentos")
    r = client.post(f"/api/atas/{rascunho}/publicar-no-site", headers=preparador)
    assert r.status_code == 409 and "assinada" in r.json()["detail"]
    assinada = _ata_assinada(client, auth_headers, db)
    assert client.post(f"/api/atas/{assinada}/publicar-no-site", headers=_usuario(db, "governanca")).status_code == 403
    assert client.post(f"/api/atas/{assinada}/publicar-no-site").status_code == 401


def test_preparar_abre_um_documento_publico_em_texto_com_o_texto_da_ata_e_nao_mexe_na_ata_assinada(client, auth_headers, db):
    corpo = "Ata da assembleia. Presente Fulano de Tal, CPF 529.982.247-25, residente na Rua das Flores. " + TEXTO_LIMPO
    id_ata = _ata_assinada(client, auth_headers, db, corpo=corpo)
    preparador = _usuario(db, "documentos")
    r = client.post(f"/api/atas/{id_ata}/publicar-no-site", headers=preparador)
    assert r.status_code == 200, r.text
    id_documento = r.json()["id_documento"]
    doc = db.get(DocumentoInstitucional, id_documento)
    assert (doc.tipo, doc.classificacao, doc.publicar_no_site, doc.situacao, doc.vinculo_tipo, doc.vinculo_id) == ("ATA", "Pública", True, "Rascunho", "ata", id_ata)
    assert doc.original_nome is None  # nenhum PDF: o site recebe só o texto
    # chamar de novo devolve o MESMO documento em preparo (não abre outro)
    assert client.post(f"/api/atas/{id_ata}/publicar-no-site", headers=preparador).json()["id_documento"] == id_documento
    # o painel recebe o texto da ata como ponto de partida
    detalhe = client.get(f"/api/documentos/{id_documento}", headers=preparador).json()
    assert detalhe["texto_sugerido"] == corpo
    # o documento ASSINADO da ata (original privado) continua sendo o Restrito: anexar o PDF assinado não cai no do site
    r = client.post(f"/api/atas/{id_ata}/documento-assinado", headers=auth_headers, files={"documento": ("ata.pdf", b"%PDF-1.4 ata assinada", "application/pdf")})
    assert r.status_code == 200, r.text
    assinado = db.get(DocumentoInstitucional, r.json()["id_documento_assinado"])
    assert assinado.id_documento != id_documento and assinado.classificacao == "Restrita"
    assert documentos_institucionais.documento_da_ata_no_site(db, id_ata).id_documento == id_documento
    assert db.query(AuditLog).filter(
        AuditLog.tabela_afetada == "documentos_institucionais", AuditLog.acao == "CRIADO", AuditLog.id_registro_afetado == id_documento,
    ).count() == 1


def test_o_verificador_bloqueia_o_dado_pessoal_do_texto_da_ata_e_o_limpo_passa(client, auth_headers, db):
    id_ata = _ata_assinada(client, auth_headers, db)
    preparador = _usuario(db, "documentos")
    id_documento = client.post(f"/api/atas/{id_ata}/publicar-no-site", headers=preparador).json()["id_documento"]
    com_cpf = TEXTO_LIMPO + " Presente o associado de CPF 529.982.247-25 e celular (94) 99123-4567."
    r = client.post(f"/api/documentos/{id_documento}/versao-publica-texto", headers=preparador, json={"texto": com_cpf})
    assert r.status_code == 422, r.text
    tipos = {b["codigo"] for b in r.json()["detail"]["resultado"]["bloqueios"]}
    assert {"CPF", "TELEFONE"} <= tipos
    assert "529.982.247-25" not in r.text  # os achados voltam mascarados
    assert client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=preparador).status_code == 409
    ok = client.post(f"/api/documentos/{id_documento}/versao-publica-texto", headers=preparador, json={"texto": TEXTO_LIMPO})
    assert ok.json()["resultado_da_verificacao"]["ok"] is True
    # quem preparou não aprova (a aprovação é de outra pessoa)
    assert client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=preparador).status_code == 200
    assert client.post(f"/api/documentos/{id_documento}/aprovar", headers=preparador).status_code == 403


def test_o_publico_ve_quem_aprovou_nome_e_cargo_pelo_mandato_do_dia(client, auth_headers, db):
    id_ata = _ata_assinada(client, auth_headers, db)
    preparador = _usuario(db, "documentos")
    secretario, nome = _secretario_com_mandato(client, db)
    id_documento = client.post(f"/api/atas/{id_ata}/publicar-no-site", headers=preparador).json()["id_documento"]
    _publicar_texto(client, preparador, secretario, id_documento)

    lista = client.get("/api/publico/transparencia/documentos").json()
    item = next(d for d in lista if d["id_documento"] == id_documento)
    assert item["aprovado_por"] == {"nome": nome, "cargo": "1º Secretário"}
    assert item["formato"] == "TEXTO" and item["arquivo"] is None and item["tipo"] == "Ata"
    detalhe = client.get(f"/api/publico/transparencia/documentos/{id_documento}").json()
    assert detalhe["aprovado_por"] == item["aprovado_por"] and detalhe["texto"] == TEXTO_LIMPO
    # o cargo é o do DIA da aprovação: o mandato acabar depois não muda o histórico
    mandato = db.query(Mandato).filter(Mandato.cargo_codigo == "SECRETARIO").order_by(Mandato.id_mandato.desc()).first()
    mandato.data_fim_efetivo = db.get(DocumentoInstitucional, id_documento).aprovado_em + timedelta(microseconds=1)  # encerrado logo depois da aprovação
    db.commit()
    assert not mandato.vigente()
    assert next(d for d in client.get("/api/publico/transparencia/documentos").json() if d["id_documento"] == id_documento)["aprovado_por"]["cargo"] == "1º Secretário"


def test_quem_aprovou_sem_mandato_ou_sem_cadastro_nao_tem_o_nome_publicado(client, auth_headers, db):
    """Só aparece o nome de quem tinha mandato na Diretoria ou no Conselho no dia (esses nomes já são públicos); os outros, só a data."""
    id_ata = _ata_assinada(client, auth_headers, db)
    preparador = _usuario(db, "documentos")
    id_documento = client.post(f"/api/atas/{id_ata}/publicar-no-site", headers=preparador).json()["id_documento"]
    _publicar_texto(client, preparador, auth_headers, id_documento)  # o administrador de teste: tem cadastro de associado, sem mandato
    item = next(d for d in client.get("/api/publico/transparencia/documentos").json() if d["id_documento"] == id_documento)
    assert item["aprovado_por"] is None and item["aprovado_em"]

    outro_ata = _ata_assinada(client, auth_headers, db)
    outro = client.post(f"/api/atas/{outro_ata}/publicar-no-site", headers=preparador).json()["id_documento"]
    _publicar_texto(client, preparador, _usuario(db, "aprovar_publicacao"), outro)  # usuário sem cadastro de associado
    item = next(d for d in client.get("/api/publico/transparencia/documentos").json() if d["id_documento"] == outro)
    assert item["aprovado_por"] is None


def test_nome_apagado_pelo_prazo_de_guarda_nao_vira_nome_publicado(client, auth_headers, db):
    from app.services.retencao import NOME_APAGADO

    id_ata = _ata_assinada(client, auth_headers, db)
    preparador = _usuario(db, "documentos")
    secretario, nome = _secretario_com_mandato(client, db)
    id_documento = client.post(f"/api/atas/{id_ata}/publicar-no-site", headers=preparador).json()["id_documento"]
    _publicar_texto(client, preparador, secretario, id_documento)
    associado = db.query(Associado).filter(Associado.nome_completo == nome).one()
    associado.nome_completo = NOME_APAGADO
    db.commit()
    item = next(d for d in client.get("/api/publico/transparencia/documentos").json() if d["id_documento"] == id_documento)
    assert item["aprovado_por"] is None


def test_a_versao_nova_parte_do_texto_publicado_e_a_anterior_continua_no_site_no_mesmo_grupo(client, auth_headers, db):
    id_ata = _ata_assinada(client, auth_headers, db)
    preparador = _usuario(db, "documentos")
    aprovador = _usuario(db, "aprovar_publicacao")
    v1 = client.post(f"/api/atas/{id_ata}/publicar-no-site", headers=preparador).json()["id_documento"]
    _publicar_texto(client, preparador, aprovador, v1)
    r = client.post(f"/api/atas/{id_ata}/publicar-no-site", headers=preparador)
    v2 = r.json()["id_documento"]
    assert v2 != v1 and r.json()["versao"] == 2
    assert client.get(f"/api/documentos/{v2}", headers=preparador).json()["texto_sugerido"] == TEXTO_LIMPO  # já sem o dado pessoal
    corrigido = TEXTO_LIMPO + " Retificação: o encerramento ocorreu às dezoito horas."
    _publicar_texto(client, preparador, aprovador, v2, texto=corrigido)
    lista = {d["id_documento"]: d for d in client.get("/api/publico/transparencia/documentos").json()}
    assert lista[v1]["grupo_versao"] == lista[v2]["grupo_versao"]
    assert (lista[v1]["vigente"], lista[v2]["vigente"]) == (False, True)
    assert (lista[v1]["versao"], lista[v2]["versao"]) == (1, 2)


def test_a_ata_vai_ao_site_so_em_texto_o_pdf_e_recusado(client, auth_headers, db):
    id_ata = _ata_assinada(client, auth_headers, db)
    preparador = _usuario(db, "documentos")
    id_documento = client.post(f"/api/atas/{id_ata}/publicar-no-site", headers=preparador).json()["id_documento"]
    pdf = b"%PDF-1.4 ata em pdf"
    r = client.post(f"/api/documentos/{id_documento}/versao-publica", headers=preparador, files={"arquivo": ("ata.pdf", pdf, "application/pdf")})
    assert r.status_code == 409 and "só em texto" in r.json()["detail"]
    assert client.get(f"/api/documentos/{id_documento}", headers=preparador).json()["so_texto"] is True



def test_nenhuma_ata_vai_ao_site_em_pdf_por_nenhum_caminho(client, auth_headers, db):
    """O PDF da ata não vai ao site: nem a ata assinada marcada para o site, nem um documento novo do tipo Ata, nem 'usar o original'; o texto da
    ata não troca de tipo, classificação ou vínculo e não recebe arquivo original."""
    pdf = ("ata.pdf", b"%PDF-1.4 ata assinada", "application/pdf")
    id_ata = _ata_assinada(client, auth_headers, db)
    assinado = client.post(f"/api/atas/{id_ata}/documento-assinado", headers=auth_headers, files={"documento": pdf}).json()["id_documento_assinado"]
    assert client.patch(f"/api/documentos/{assinado}", headers=auth_headers, json={"publicar_no_site": True}).status_code == 200
    r = client.post(f"/api/documentos/{assinado}/versao-publica", headers=auth_headers, files={"arquivo": pdf})
    assert r.status_code == 409 and "só em texto" in r.json()["detail"]
    # e ele não deixa de ser Ata para escapar da regra, nem vira Público (o PDF assinado tem RG/CPF: só quem tem documentos_originais baixa)
    assert client.patch(f"/api/documentos/{assinado}", headers=auth_headers, json={"tipo": "OUTRO"}).status_code == 409
    assert client.patch(f"/api/documentos/{assinado}", headers=auth_headers, json={"classificacao": "Pública"}).status_code == 409
    # documento ligado a uma ata não se cria pela rota genérica (nasce na tela da ata)
    r = client.post(
        "/api/documentos", headers=auth_headers,
        data={"tipo": "ATA", "titulo": "Ata ligada", "classificacao": "Pública", "publicar_no_site": "true", "vinculo_tipo": "ata", "vinculo_id": str(id_ata)},
        files={"arquivo": pdf},
    )
    assert r.status_code == 409

    novo = client.post(
        "/api/documentos", headers=auth_headers, data={"tipo": "ATA", "titulo": "Ata avulsa", "classificacao": "Pública", "publicar_no_site": "true"},
        files={"arquivo": pdf},
    ).json()["id_documento"]
    assert client.post(f"/api/documentos/{novo}/versao-publica/usar-original", headers=auth_headers).status_code == 409
    assert client.post(f"/api/documentos/{novo}/versao-publica", headers=auth_headers, files={"arquivo": pdf}).status_code == 409
    assert client.patch(f"/api/documentos/{novo}", headers=auth_headers, json={"tipo": "OUTRO"}).status_code == 409  # a ata avulsa também continua ata

    preparador = _usuario(db, "documentos")
    texto = client.post(f"/api/atas/{id_ata}/publicar-no-site", headers=preparador).json()["id_documento"]
    assert client.patch(f"/api/documentos/{texto}", headers=preparador, json={"classificacao": "Restrita"}).status_code == 409
    assert client.post(f"/api/documentos/{texto}/original", headers=preparador, files={"arquivo": pdf}).status_code == 409


def test_publicar_depois_de_uma_retirada_nao_abre_documentos_em_serie(client, auth_headers, db):
    id_ata = _ata_assinada(client, auth_headers, db)
    preparador, aprovador = _usuario(db, "documentos"), _usuario(db, "aprovar_publicacao")
    v1 = client.post(f"/api/atas/{id_ata}/publicar-no-site", headers=preparador).json()["id_documento"]
    _publicar_texto(client, preparador, aprovador, v1)
    v2 = client.post(f"/api/atas/{id_ata}/publicar-no-site", headers=preparador).json()["id_documento"]
    _publicar_texto(client, preparador, aprovador, v2, texto=TEXTO_LIMPO + " Segunda versão.")
    assert client.post(f"/api/documentos/{v2}/retirar", headers=aprovador, json={"motivo": "Publicado com um erro de digitação."}).status_code == 200
    # a v1 volta a ser a vigente: o site não fica só com versões "anteriores"
    db.expire_all()
    assert db.get(DocumentoInstitucional, v1).vigente is True
    # publicar de novo abre UMA versão nova do que está no ar (a v1), e clicar de novo devolve a mesma
    v3 = client.post(f"/api/atas/{id_ata}/publicar-no-site", headers=preparador).json()["id_documento"]
    assert client.post(f"/api/atas/{id_ata}/publicar-no-site", headers=preparador).json()["id_documento"] == v3
    db.expire_all()
    doc3 = db.get(DocumentoInstitucional, v3)
    assert doc3.grupo_versao == db.get(DocumentoInstitucional, v1).grupo_versao and doc3.versao == 3
    # e o ponto de partida é o texto da versão no ar, nunca o da retirada
    assert client.get(f"/api/documentos/{v3}", headers=preparador).json()["texto_sugerido"] == TEXTO_LIMPO


def test_o_texto_sugerido_traz_o_relato_da_secretaria_e_depois_de_uma_recusa_o_texto_ja_enviado(client, auth_headers, db):
    from app.models.ata import Ata

    id_ata = _criar_ata(client, auth_headers, _criar_assembleia_em_andamento(client, auth_headers))
    db.get(Ata, id_ata).relato_secretaria = "A Assembleia agradeceu aos voluntários do mutirão."
    db.commit()
    assert client.post(f"/api/atas/{id_ata}/assinar", headers=auth_headers).status_code == 200
    preparador, aprovador = _usuario(db, "documentos"), _usuario(db, "aprovar_publicacao")
    id_documento = client.post(f"/api/atas/{id_ata}/publicar-no-site", headers=preparador).json()["id_documento"]
    sugestao = client.get(f"/api/documentos/{id_documento}", headers=preparador).json()["texto_sugerido"]
    assert sugestao.endswith("Relato da secretaria:\nA Assembleia agradeceu aos voluntários do mutirão.")
    # a lista de documentos não leva o texto inteiro da ata
    lista = client.get("/api/documentos?tipo=ATA", headers=preparador).json()
    assert all(d["texto_sugerido"] is None for d in lista)
    # enviado e recusado: volta para editar com o texto JÁ ENVIADO, não o da ata de novo
    client.post(f"/api/documentos/{id_documento}/versao-publica-texto", headers=preparador, json={"texto": TEXTO_LIMPO})
    client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=preparador)
    assert client.post(f"/api/documentos/{id_documento}/recusar", headers=aprovador, json={"motivo": "Faltou o relato da secretaria."}).status_code == 200
    assert client.get(f"/api/documentos/{id_documento}", headers=preparador).json()["texto_sugerido"] == TEXTO_LIMPO


def test_a_ata_retificada_nao_vai_ao_site_a_retificacao_sim(client, auth_headers, db):
    id_ata = _ata_assinada(client, auth_headers, db)
    r = client.post(f"/api/atas/{id_ata}/retificar", headers=auth_headers, json={"motivo": "Correção do horário de encerramento."})
    assert r.status_code == 200, r.text
    preparador = _usuario(db, "documentos")
    r = client.post(f"/api/atas/{id_ata}/publicar-no-site", headers=preparador)
    assert r.status_code == 409 and "retificada" in r.json()["detail"]


# ------------------------------------------------------------------------------------------------ Ponto de Revisão FASE 6 (2/2)
def test_ponto_fase6_a_ata_nao_vai_em_pdf_nem_virando_ata_depois(client, auth_headers, db):
    """Um documento de outro tipo, Público, com PDF na versão pública, não vira Ata (levaria a ata ao site em PDF); e a conferência do envio e da
    aprovação recusa qualquer Ata que não esteja em TEXTO."""
    pdf = ("documento.pdf", b"%PDF-1.4 documento", "application/pdf")
    outro = client.post(
        "/api/documentos", headers=auth_headers, data={"tipo": "OUTRO", "titulo": "Documento que viraria ata", "classificacao": "Pública",
                                                       "publicar_no_site": "true"},
        files={"arquivo": pdf},
    ).json()["id_documento"]
    doc = db.get(DocumentoInstitucional, outro)
    doc.publico_nome, doc.publico_formato, doc.verificacao_ok = "versao-publica.pdf", "PDF", True  # (como se o PDF já tivesse passado na conferência)
    db.commit()
    r = client.patch(f"/api/documentos/{outro}", headers=auth_headers, json={"tipo": "ATA"})
    assert r.status_code == 409 and "só em texto" in r.json()["detail"]
    # mesmo que uma Ata chegue com PDF por outro caminho, não passa do envio
    doc.tipo = "ATA"
    db.commit()
    r = client.post(f"/api/documentos/{outro}/enviar-revisao", headers=auth_headers)
    assert r.status_code == 409 and "só em texto, nunca em PDF" in r.json()["detail"]


def test_ponto_fase6_balanco_e_relatorio_anual_so_vao_ao_site_gerados(client, auth_headers, db):
    """Balanço e Relatório anual montados à mão na biblioteca não vão ao site (passariam por fora da aprovação em Assembleia e dos números do sistema)."""
    preparador = _usuario(db, "documentos")
    for tipo in ("BALANCO", "RELATORIO_ANUAL"):
        r = client.post("/api/documentos", headers=preparador, data={"tipo": tipo, "titulo": f"{tipo} digitado à mão", "classificacao": "Pública",
                                                                      "publicar_no_site": "true"})
        assert r.status_code == 200, r.text
        id_documento = r.json()["id_documento"]
        r = client.post(f"/api/documentos/{id_documento}/versao-publica-texto", headers=preparador, json={"texto": TEXTO_LIMPO})
        assert r.status_code == 200, r.text
        r = client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=preparador)
        assert r.status_code == 409 and "gerado pelo sistema" in r.json()["detail"], r.text


def test_ponto_fase6_o_texto_sugerido_da_ata_sai_sem_os_nomes_da_presenca_e_quem_aprova_compara(client, auth_headers, db):
    corpo = (
        "ATA DE ASSEMBLEIA GERAL ORDINÁRIA\nConvocação: 10/03/2026 às 19:00 (horário de Belém)\n\nPRESENÇA\nAssociados habilitados: 12\nCredenciados: 2\n"
        "  - Maria Nome Completo Da Silva (Presencial) - entrada 19:05\n  - João Outro Nome (Remota) - entrada 19:10, saída 21:00\n\n"
        "ORDEM DO DIA\nAprovação das contas.\n\nITENS DA SESSÃO\n  1. Contas - Encerrado\n     Votação 'Contas' (Aberta/Nominal): {'Sim': 2} - aprovado: Sim"
    )
    id_ata = _ata_assinada(client, auth_headers, db, corpo=corpo)
    preparador = _usuario(db, "documentos")
    id_documento = client.post(f"/api/atas/{id_ata}/publicar-no-site", headers=preparador).json()["id_documento"]
    sugerido = client.get(f"/api/documentos/{id_documento}", headers=preparador).json()["texto_sugerido"]
    assert "Maria Nome Completo" not in sugerido and "João Outro Nome" not in sugerido
    assert "Credenciados: 2" in sugerido and "ORDEM DO DIA" in sugerido and "{'Sim': 2}" in sugerido
    # quem aprova vê o texto da ata assinada para comparar (quem prepara, não)
    aprovador = _usuario(db, "aprovar_publicacao")
    assert client.get(f"/api/documentos/{id_documento}", headers=aprovador).json()["texto_da_ata_assinada"] is None  # ainda em rascunho
    assert client.post(f"/api/documentos/{id_documento}/versao-publica-texto", headers=preparador, json={"texto": sugerido}).status_code == 200
    assert client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=preparador).status_code == 200
    assert client.get(f"/api/documentos/{id_documento}", headers=aprovador).json()["texto_da_ata_assinada"] == corpo
    assert client.get(f"/api/documentos/{id_documento}", headers=preparador).json()["texto_da_ata_assinada"] is None
