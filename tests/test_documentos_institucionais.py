"""v5.4a - módulo Documentos institucionais: biblioteca com sigilo, versão pública e aprovação de publicação.

As promessas que estes testes travam (o site de transparência depende de TODAS):
  1. o ORIGINAL (pode ter RG/CPF) nunca sai pela rota pública, só por download autenticado, com permissão
     própria, sem cache, e TODO download fica na auditoria;
  2. só vai ao site a VERSÃO PÚBLICA que passou no verificador - e ele é rodado de novo na aprovação;
  3. quem criou ou enviou para revisão NÃO aprova o próprio documento (a aprovação é de outra pessoa);
  4. o público só enxerga o APROVADO, só a versão pública, só os campos da lista fixa; retirado some na hora;
  5. nada se apaga: recusar, retirar e versionar preservam o histórico."""
import hashlib
import uuid

import pytest

from app.models.core import AuditLog, NivelAcesso, PermissaoSistema, Usuario, perfil_permissao
from app.models.documentos import DocumentoInstitucional
from app.security import criar_access_token, hash_senha
from app.services import armazenamento
from tests.test_documentos_verificacao import CPF_VALIDO, TEXTO_LIMPO, pdf_com_texto, pdf_so_imagem


# ------------------------------------------------------------------------------------------ apoio
def _usuario(db, *codigos: str) -> dict:
    """Um usuário cujo nível tem EXATAMENTE as permissões pedidas (nenhuma a mais)."""
    nivel = NivelAcesso(nome_nivel=f"nivel_doc_{uuid.uuid4().hex[:8]}", descricao="teste", exige_mfa=False)
    db.add(nivel)
    db.flush()
    for codigo in codigos:
        permissao = db.query(PermissaoSistema).filter(PermissaoSistema.codigo_permissao == codigo).first()
        assert permissao is not None, f"permissão {codigo!r} não existe no seed"
        db.execute(perfil_permissao.insert().values(id_nivel=nivel.id_nivel, id_permissao=permissao.id_permissao))
    usuario = Usuario(email=f"doc_{uuid.uuid4().hex[:8]}@teste.local", senha_hash=hash_senha("SenhaForte123456"), id_nivel=nivel.id_nivel, ativo=True)
    db.add(usuario)
    db.commit()
    db.refresh(usuario)
    return {"Authorization": f"Bearer {criar_access_token(usuario)}"}


def _criar(client, headers, *, arquivo=None, **campos):
    dados = {"tipo": "ATA", "titulo": f"Ata de teste {uuid.uuid4().hex[:6]}", "classificacao": "Restrita", "publicar_no_site": "true", **campos}
    dados = {k: ("true" if v is True else "false" if v is False else v) for k, v in dados.items() if v is not None}
    arquivos = {"arquivo": arquivo} if arquivo else None
    return client.post("/api/documentos", data=dados, files=arquivos, headers=headers)


ORIGINAL = ("ata-assinada.pdf", pdf_com_texto(TEXTO_LIMPO + [f"Presidente eleito: Fulano, CPF {CPF_VALIDO}, RG 1234567."]), "application/pdf")
PUBLICA_OK = pdf_com_texto(TEXTO_LIMPO + ["Presidente eleito: Fulano de Tal (dados pessoais omitidos)."])


def _anexar_publica(client, headers, id_documento, conteudo=PUBLICA_OK):
    return client.post(f"/api/documentos/{id_documento}/versao-publica", files={"arquivo": ("publica.pdf", conteudo, "application/pdf")}, headers=headers)


def _doc_pronto_para_revisao(client, preparador, **campos):
    """Cria (Restrita, com original), anexa versão pública boa e deixa pronto para enviar à revisão."""
    r = _criar(client, preparador, arquivo=ORIGINAL, **campos)
    assert r.status_code == 200, r.text
    id_documento = r.json()["id_documento"]
    assert _anexar_publica(client, preparador, id_documento).status_code == 200
    return id_documento


def _publicado(client, preparador, aprovador, **campos):
    id_documento = _doc_pronto_para_revisao(client, preparador, **campos)
    assert client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=preparador).status_code == 200
    r = client.post(f"/api/documentos/{id_documento}/aprovar", headers=aprovador)
    assert r.status_code == 200, r.text
    return id_documento


@pytest.fixture(autouse=True)
def _admin_primeiro(admin_token):
    """O primeiro usuário do banco é o admin (bootstrap-admin só funciona uma vez): ele tem que nascer ANTES dos
    usuários de teste deste arquivo, em qualquer ordem de execução."""


@pytest.fixture()
def preparador(db):  # a secretaria que prepara: cria e envia, não aprova
    return _usuario(db, "documentos")


@pytest.fixture()
def aprovador(db):  # Presidente ou Secretário: só aprova
    return _usuario(db, "aprovar_publicacao")


# ----------------------------------------------------------------------------- login e permissão
def test_todas_as_rotas_exigem_login(client):
    for metodo, caminho in [("get", "/api/documentos"), ("get", "/api/documentos/1"), ("post", "/api/documentos"),
                            ("get", "/api/documentos/1/original"), ("post", "/api/documentos/1/aprovar"),
                            ("get", "/api/documentos/tipos")]:
        assert getattr(client, metodo)(caminho).status_code == 401, f"{metodo} {caminho}"


def test_quem_nao_tem_nenhuma_permissao_de_documento_nao_ve_nem_a_lista(client, db):
    sem = _usuario(db)  # nível sem nenhuma permissão
    assert client.get("/api/documentos", headers=sem).status_code == 403
    assert _criar(client, sem).status_code == 403


def test_cada_perfil_so_faz_o_que_e_dele(client, db, preparador, aprovador):
    originais = _usuario(db, "documentos_originais")
    r = _criar(client, preparador, arquivo=ORIGINAL)
    id_documento = r.json()["id_documento"]
    # preparo cadastra e lista, mas NÃO aprova nem baixa original Restrito
    assert client.get("/api/documentos", headers=preparador).status_code == 200
    assert client.post(f"/api/documentos/{id_documento}/aprovar", headers=preparador).status_code == 403
    assert client.get(f"/api/documentos/{id_documento}/original", headers=preparador).status_code == 403
    # aprovação lista, mas não cadastra nem baixa original
    assert client.get("/api/documentos", headers=aprovador).status_code == 200
    assert _criar(client, aprovador).status_code == 403
    assert client.get(f"/api/documentos/{id_documento}/original", headers=aprovador).status_code == 403
    # guarda de originais: vê a lista e baixa, mas não cadastra nem aprova
    assert client.get(f"/api/documentos/{id_documento}/original", headers=originais).status_code == 200
    assert _criar(client, originais).status_code == 403
    assert client.post(f"/api/documentos/{id_documento}/aprovar", headers=originais).status_code == 403


# ----------------------------------------------------------------------------------- cadastro
def test_criar_com_original_guarda_em_pasta_privada_e_nunca_devolve_o_nome_no_armazenamento(client, db, preparador):
    r = _criar(client, preparador, arquivo=ORIGINAL)
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["tem_original"] and corpo["situacao"] == "Rascunho" and corpo["vigente"] and corpo["versao"] == 1
    assert corpo["original_sha256"] == hashlib.sha256(ORIGINAL[1]).hexdigest()
    assert corpo["original_nome_arquivo"] == "ata-assinada.pdf"
    doc = db.query(DocumentoInstitucional).filter_by(id_documento=corpo["id_documento"]).one()
    assert armazenamento.obter().ler("documentos-originais", doc.original_nome) == ORIGINAL[1]
    assert doc.original_nome not in repr(corpo)  # o nome opaco do arquivo nunca vai para o cliente
    # a rota pública de uploads não enxerga a pasta privada
    assert client.get(f"/uploads/documentos-originais/{doc.original_nome}").status_code == 404


@pytest.mark.parametrize("campos,esperado", [
    ({"tipo": "INVENTADO"}, "Tipo inválido"),
    ({"titulo": "ab"}, "título"),
    ({"classificacao": "Secreta"}, "Classificação inválida"),
    ({"vinculo_tipo": "ata"}, "juntos"),
    ({"vinculo_tipo": "marte", "vinculo_id": "3"}, "Vínculo inválido"),
    ({"data_documento": "ontem"}, "Data inválida"),
])
def test_cadastro_invalido_e_recusado_com_mensagem_clara(client, preparador, campos, esperado):
    r = _criar(client, preparador, **campos)
    assert r.status_code == 400 and esperado in r.json()["detail"], r.text


@pytest.mark.parametrize("arquivo,esperado", [
    (("virus.exe", b"MZ", "application/octet-stream"), "Formato não suportado"),
    (("fake.pdf", b"nao e pdf", "application/pdf"), "não confere"),
    (("vazio.pdf", b"", "application/pdf"), "vazio|não confere"),
])
def test_original_com_formato_falso_ou_vazio_e_recusado(client, preparador, arquivo, esperado):
    r = _criar(client, preparador, arquivo=arquivo)
    assert r.status_code == 400
    import re
    assert re.search(esperado, r.json()["detail"]), r.json()


def test_ano_sai_da_data_do_documento_e_vinculo_precisa_de_tipo_e_numero(client, preparador):
    r = _criar(client, preparador, data_documento="2026-10-10", vinculo_tipo="assembleia", vinculo_id="7")
    assert r.status_code == 200
    assert r.json()["ano"] == 2026 and r.json()["vinculo_tipo"] == "assembleia" and r.json()["vinculo_id"] == 7


# -------------------------------------------------------------------------------- baixar original
def test_baixar_original_exige_permissao_propria_nao_usa_cache_e_fica_na_auditoria(client, db, preparador):
    originais = _usuario(db, "documentos_originais")
    id_documento = _criar(client, preparador, arquivo=ORIGINAL).json()["id_documento"]
    assert client.get(f"/api/documentos/{id_documento}/original", headers=preparador).status_code == 403
    r = client.get(f"/api/documentos/{id_documento}/original", headers=originais)
    assert r.status_code == 200 and r.content == ORIGINAL[1]
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["content-disposition"].startswith("attachment")
    assert r.headers["x-content-type-options"] == "nosniff" and r.headers["content-type"] == "application/pdf"
    log = db.query(AuditLog).filter_by(tabela_afetada="documentos_institucionais", acao="ORIGINAL_BAIXADO", id_registro_afetado=id_documento).all()
    assert len(log) == 1 and log[0].id_usuario is not None


def test_original_de_documento_publico_pode_ser_baixado_por_quem_gere_documentos(client, preparador):
    id_documento = _criar(client, preparador, arquivo=ORIGINAL, classificacao="Pública").json()["id_documento"]
    assert client.get(f"/api/documentos/{id_documento}/original", headers=preparador).status_code == 200


def test_documento_sem_original_responde_404_no_download(client, db):
    originais = _usuario(db, "documentos_originais", "documentos")
    id_documento = _criar(client, originais).json()["id_documento"]
    assert client.get(f"/api/documentos/{id_documento}/original", headers=originais).status_code == 404


# --------------------------------------------------------------------------------- versão pública
def test_versao_publica_com_cpf_e_recusada_nao_e_guardada_e_o_cpf_nao_volta_inteiro(client, preparador):
    id_documento = _criar(client, preparador, arquivo=ORIGINAL).json()["id_documento"]
    r = _anexar_publica(client, preparador, id_documento, ORIGINAL[1])
    assert r.status_code == 422, r.text
    achados = r.json()["detail"]["resultado"]["bloqueios"]
    assert {a["codigo"] for a in achados} >= {"CPF", "DOCUMENTO_PESSOAL"}
    assert "444" not in r.text and "777" not in r.text
    assert client.get(f"/api/documentos/{id_documento}", headers=preparador).json()["tem_versao_publica"] is False
    assert client.get(f"/api/documentos/{id_documento}/versao-publica", headers=preparador).status_code == 404


def test_versao_publica_so_imagem_e_recusada(client, preparador):
    id_documento = _criar(client, preparador, arquivo=ORIGINAL).json()["id_documento"]
    r = _anexar_publica(client, preparador, id_documento, pdf_so_imagem())
    assert r.status_code == 422 and r.json()["detail"]["resultado"]["bloqueios"][0]["codigo"] == "SO_IMAGEM"


def test_versao_publica_igual_ao_original_de_documento_restrito_e_recusada(client, preparador):
    conteudo_limpo = pdf_com_texto(TEXTO_LIMPO)
    id_documento = _criar(client, preparador, arquivo=("o.pdf", conteudo_limpo, "application/pdf")).json()["id_documento"]
    r = _anexar_publica(client, preparador, id_documento, conteudo_limpo)
    assert r.status_code == 422 and "IDÊNTICA" in r.json()["detail"]


def test_versao_publica_boa_e_guardada_com_resultado_e_texto_para_busca(client, db, preparador):
    id_documento = _criar(client, preparador, arquivo=ORIGINAL).json()["id_documento"]
    r = _anexar_publica(client, preparador, id_documento)
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["tem_versao_publica"] and corpo["verificacao"]["ok"] is True and corpo["publico_paginas"] == 1
    assert corpo["resultado_da_verificacao"]["bloqueios"] == []
    doc = db.query(DocumentoInstitucional).filter_by(id_documento=id_documento).one()
    assert armazenamento.obter().ler("documentos-publicos", doc.publico_nome) == PUBLICA_OK
    assert "Arca da Família" in doc.publico_texto
    # quem prepara e quem revisa conseguem VER a versão pública antes de ir ao site
    assert client.get(f"/api/documentos/{id_documento}/versao-publica", headers=preparador).content == PUBLICA_OK
    achados = client.get("/api/documentos", params={"busca": "Arca da Família"}, headers=preparador).json()
    assert id_documento in [d["id_documento"] for d in achados]  # busca no texto extraído


def test_documento_publico_pode_usar_o_proprio_original_como_versao_publica_mas_passa_pelo_verificador(client, preparador):
    limpo = pdf_com_texto(TEXTO_LIMPO)
    id_bom = _criar(client, preparador, arquivo=("e.pdf", limpo, "application/pdf"), classificacao="Pública", tipo="ESTATUTO").json()["id_documento"]
    assert client.post(f"/api/documentos/{id_bom}/versao-publica/usar-original", headers=preparador).status_code == 200
    # "Pública" mas com CPF dentro: a classificação está errada, o verificador recusa
    id_ruim = _criar(client, preparador, arquivo=ORIGINAL, classificacao="Pública").json()["id_documento"]
    r = client.post(f"/api/documentos/{id_ruim}/versao-publica/usar-original", headers=preparador)
    assert r.status_code == 422 and "CPF" in {a["codigo"] for a in r.json()["detail"]["resultado"]["bloqueios"]}
    # e documento Restrito NUNCA pode usar o original
    id_restrito = _criar(client, preparador, arquivo=ORIGINAL).json()["id_documento"]
    assert client.post(f"/api/documentos/{id_restrito}/versao-publica/usar-original", headers=preparador).status_code == 409


def test_documento_que_nao_e_para_o_site_nao_aceita_versao_publica(client, preparador):
    id_documento = _criar(client, preparador, arquivo=ORIGINAL, publicar_no_site=False).json()["id_documento"]
    assert _anexar_publica(client, preparador, id_documento).status_code == 409


# ---------------------------------------------------------------------------- revisão e aprovação
def test_enviar_para_revisao_exige_versao_publica_aprovada_no_verificador(client, preparador):
    id_documento = _criar(client, preparador, arquivo=ORIGINAL).json()["id_documento"]
    r = client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=preparador)
    assert r.status_code == 409 and "versão pública" in r.json()["detail"]


def test_quem_enviou_nao_aprova_nem_quem_criou_e_a_aprovacao_e_de_outra_pessoa(client, db, aprovador, auth_headers):
    # Presidente (admin de teste) cria e envia; ele tem a permissão de aprovar, mas não pode aprovar o PRÓPRIO envio
    id_documento = _doc_pronto_para_revisao(client, auth_headers)
    assert client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=auth_headers).status_code == 200
    r = client.post(f"/api/documentos/{id_documento}/aprovar", headers=auth_headers)
    assert r.status_code == 403 and "outra pessoa" in r.json()["detail"]
    assert client.get(f"/api/documentos/{id_documento}", headers=auth_headers).json()["pode_aprovar"] is False
    # o outro aprovador (Secretário, por exemplo) pode
    assert client.get(f"/api/documentos/{id_documento}", headers=aprovador).json()["pode_aprovar"] is True
    r = client.post(f"/api/documentos/{id_documento}/aprovar", headers=aprovador)
    assert r.status_code == 200 and r.json()["situacao"] == "Aprovado" and r.json()["aprovado_em"]


def test_quem_so_criou_sem_enviar_tambem_nao_aprova(client, db, preparador):
    criador_e_aprovador = _usuario(db, "documentos", "aprovar_publicacao")
    id_documento = _doc_pronto_para_revisao(client, criador_e_aprovador)
    # outro usuário envia para revisão (tem a permissão de documentos)...
    outro = _usuario(db, "documentos")
    assert client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=outro).status_code == 200
    # ...mas quem CRIOU o documento continua sem poder aprovar
    assert client.post(f"/api/documentos/{id_documento}/aprovar", headers=criador_e_aprovador).status_code == 403


def test_aprovar_exige_a_permissao_e_so_serve_para_documento_em_revisao(client, preparador, aprovador):
    id_documento = _doc_pronto_para_revisao(client, preparador)
    r = client.post(f"/api/documentos/{id_documento}/aprovar", headers=aprovador)  # ainda rascunho
    assert r.status_code == 409 and "Rascunho" in r.json()["detail"]
    client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=preparador)
    assert client.post(f"/api/documentos/{id_documento}/aprovar", headers=preparador).status_code == 403  # sem a permissão


def test_se_o_arquivo_da_versao_publica_mudar_depois_da_verificacao_a_aprovacao_recusa(client, db, preparador, aprovador):
    id_documento = _doc_pronto_para_revisao(client, preparador)
    client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=preparador)
    doc = db.query(DocumentoInstitucional).filter_by(id_documento=id_documento).one()
    armazenamento.obter().salvar("documentos-publicos", doc.publico_nome, pdf_com_texto(TEXTO_LIMPO + ["outro conteúdo"]))
    r = client.post(f"/api/documentos/{id_documento}/aprovar", headers=aprovador)
    assert r.status_code == 409 and "SHA-256" in r.json()["detail"]


def test_se_o_arquivo_guardado_passar_a_ter_dado_pessoal_a_aprovacao_final_recusa(client, db, preparador, aprovador, monkeypatch):
    id_documento = _doc_pronto_para_revisao(client, preparador)
    client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=preparador)
    from app.services import documentos_institucionais as servico
    from app.services.documentos_verificacao import Achado, Resultado

    monkeypatch.setattr(servico, "verificar_versao_publica", lambda conteudo: Resultado(ok=False, bloqueios=[Achado("CPF", "x")]))
    r = client.post(f"/api/documentos/{id_documento}/aprovar", headers=aprovador)
    assert r.status_code == 422 and "verificação final" in r.json()["detail"]["mensagem"]


def test_recusar_volta_a_rascunho_com_o_motivo_e_pode_reenviar(client, preparador, aprovador):
    id_documento = _doc_pronto_para_revisao(client, preparador)
    client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=preparador)
    assert client.post(f"/api/documentos/{id_documento}/recusar", json={"motivo": "curto"}, headers=aprovador).status_code == 400
    r = client.post(f"/api/documentos/{id_documento}/recusar", json={"motivo": "Falta cobrir o endereço na página 2."}, headers=aprovador)
    assert r.status_code == 200 and r.json()["situacao"] == "Rascunho" and "página 2" in r.json()["motivo_recusa"]
    assert client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=preparador).json()["situacao"] == "Em revisão"


def test_retirar_do_site_preserva_o_historico_e_exige_motivo(client, preparador, aprovador):
    id_documento = _publicado(client, preparador, aprovador)
    assert client.post(f"/api/documentos/{id_documento}/retirar", json={"motivo": "curto"}, headers=aprovador).status_code == 400
    assert client.post(f"/api/documentos/{id_documento}/retirar", json={"motivo": "Publicado com a página errada."}, headers=preparador).status_code == 403
    r = client.post(f"/api/documentos/{id_documento}/retirar", json={"motivo": "Publicado com a página errada."}, headers=aprovador)
    assert r.status_code == 200 and r.json()["situacao"] == "Retirado" and r.json()["motivo_retirada"]
    corpo = client.get(f"/api/documentos/{id_documento}", headers=preparador).json()
    assert corpo["tem_original"] and corpo["tem_versao_publica"] and corpo["aprovado_em"]  # nada foi apagado


def test_so_se_edita_o_cadastro_em_rascunho_e_mudar_a_classificacao_invalida_a_versao_publica(client, preparador):
    id_documento = _doc_pronto_para_revisao(client, preparador)
    assert client.patch(f"/api/documentos/{id_documento}", json={"titulo": "Novo título da ata"}, headers=preparador).json()["titulo"] == "Novo título da ata"
    r = client.patch(f"/api/documentos/{id_documento}", json={"classificacao": "Interna"}, headers=preparador)
    assert r.status_code == 200 and r.json()["tem_versao_publica"] is False and r.json()["verificacao"] is None
    assert _anexar_publica(client, preparador, id_documento).status_code == 200
    client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=preparador)
    assert client.patch(f"/api/documentos/{id_documento}", json={"titulo": "Outro título"}, headers=preparador).status_code == 409


def test_trocar_o_original_so_em_rascunho_e_o_antigo_nao_e_apagado(client, db, preparador):
    id_documento = _criar(client, preparador, arquivo=ORIGINAL).json()["id_documento"]
    antigo = db.query(DocumentoInstitucional).filter_by(id_documento=id_documento).one().original_nome
    novo = pdf_com_texto(["original corrigido"])
    r = client.post(f"/api/documentos/{id_documento}/original", files={"arquivo": ("corrigido.pdf", novo, "application/pdf")}, headers=preparador)
    assert r.status_code == 200 and r.json()["original_nome_arquivo"] == "corrigido.pdf"
    assert armazenamento.obter().ler("documentos-originais", antigo) == ORIGINAL[1]  # ata é documento de valor jurídico


# ------------------------------------------------------------------------------------ versões
def test_nova_versao_vira_a_vigente_so_quando_aprovada_e_a_anterior_fica_no_historico(client, db, preparador, aprovador):
    v1 = _publicado(client, preparador, aprovador, tipo="ESTATUTO")
    nova = client.post(f"/api/documentos/{v1}/nova-versao", headers=preparador)
    assert nova.status_code == 200
    v2 = nova.json()["id_documento"]
    assert nova.json()["versao"] == 2 and nova.json()["vigente"] is False and nova.json()["situacao"] == "Rascunho"
    assert nova.json()["grupo_versao"] == client.get(f"/api/documentos/{v1}", headers=preparador).json()["grupo_versao"]
    # só uma versão em andamento por vez
    assert client.post(f"/api/documentos/{v1}/nova-versao", headers=preparador).status_code == 409
    # v1 continua a vigente até a v2 ser aprovada
    assert client.get(f"/api/documentos/{v1}", headers=preparador).json()["vigente"] is True
    client.post(f"/api/documentos/{v2}/original", files={"arquivo": ORIGINAL}, headers=preparador)
    assert _anexar_publica(client, preparador, v2).status_code == 200
    client.post(f"/api/documentos/{v2}/enviar-revisao", headers=preparador)
    assert client.post(f"/api/documentos/{v2}/aprovar", headers=aprovador).status_code == 200
    assert client.get(f"/api/documentos/{v1}", headers=preparador).json()["vigente"] is False
    assert client.get(f"/api/documentos/{v2}", headers=preparador).json()["vigente"] is True
    publicos = {d["id_documento"]: d for d in client.get("/api/publico/transparencia/documentos").json()}
    assert publicos[v1]["vigente"] is False and publicos[v2]["vigente"] is True  # as duas ficam; o site mostra qual vale


def test_tornar_vigente_so_para_documento_que_nao_vai_ao_site(client, preparador):
    interno = _criar(client, preparador, publicar_no_site=False).json()["id_documento"]
    v2 = client.post(f"/api/documentos/{interno}/nova-versao", headers=preparador).json()["id_documento"]
    assert client.post(f"/api/documentos/{v2}/tornar-vigente", headers=preparador).json()["vigente"] is True
    assert client.get(f"/api/documentos/{interno}", headers=preparador).json()["vigente"] is False
    do_site = _criar(client, preparador).json()["id_documento"]
    assert client.post(f"/api/documentos/{do_site}/tornar-vigente", headers=preparador).status_code == 409


# ------------------------------------------------------------------------- o que o PÚBLICO vê
CAMPOS_PUBLICOS = {
    "id_documento", "tipo_codigo", "tipo", "titulo", "descricao", "data_documento", "ano", "versao", "vigente",
    "paginas", "tamanho", "sha256", "aprovado_em", "arquivo",
}


def test_o_publico_so_ve_o_aprovado_so_a_versao_publica_e_so_os_campos_da_lista_fixa(client, preparador, aprovador):
    rascunho = _doc_pronto_para_revisao(client, preparador, titulo="RASCUNHO SECRETO")
    em_revisao = _doc_pronto_para_revisao(client, preparador, titulo="EM REVISAO SECRETO")
    client.post(f"/api/documentos/{em_revisao}/enviar-revisao", headers=preparador)
    publicado = _publicado(client, preparador, aprovador, titulo="Ata de eleição 2026 - versão pública", data_documento="2026-10-10")

    lista = client.get("/api/publico/transparencia/documentos")  # sem login
    assert lista.status_code == 200
    ids = [d["id_documento"] for d in lista.json()]
    assert publicado in ids and rascunho not in ids and em_revisao not in ids
    assert "SECRETO" not in lista.text
    item = next(d for d in lista.json() if d["id_documento"] == publicado)
    assert set(item) == CAMPOS_PUBLICOS
    assert item["arquivo"] == f"/api/publico/transparencia/documentos/{publicado}/arquivo"
    assert item["tipo"] == "Ata" and item["ano"] == 2026 and item["vigente"] is True
    for proibido in ("original", "classificacao", "texto", "id_usuario", "verificacao", "vinculo", "situacao"):
        assert proibido not in lista.text, proibido

    arquivo = client.get(item["arquivo"])
    assert arquivo.status_code == 200 and arquivo.content == PUBLICA_OK  # a versão PÚBLICA, nunca o original
    assert arquivo.content != ORIGINAL[1] and b"1234567" not in arquivo.content
    assert arquivo.headers["content-type"] == "application/pdf" and arquivo.headers["x-content-type-options"] == "nosniff"
    for nao_publicado in (rascunho, em_revisao):
        assert client.get(f"/api/publico/transparencia/documentos/{nao_publicado}/arquivo").status_code == 404


def test_retirado_do_site_some_da_lista_e_o_arquivo_responde_404_na_hora(client, preparador, aprovador):
    id_documento = _publicado(client, preparador, aprovador)
    caminho = f"/api/publico/transparencia/documentos/{id_documento}/arquivo"
    assert client.get(caminho).status_code == 200
    client.post(f"/api/documentos/{id_documento}/retirar", json={"motivo": "Retirado por engano de página."}, headers=aprovador)
    assert client.get(caminho).status_code == 404
    assert id_documento not in [d["id_documento"] for d in client.get("/api/publico/transparencia/documentos").json()]


def test_documento_inexistente_responde_igual_a_nao_publicado(client):
    assert client.get("/api/publico/transparencia/documentos/99999999/arquivo").status_code == 404


# ------------------------------------------------------------------------- auditoria e listagem
def test_cada_passo_do_fluxo_fica_na_auditoria_com_quem_fez(client, db, preparador, aprovador):
    id_documento = _publicado(client, preparador, aprovador)
    client.post(f"/api/documentos/{id_documento}/retirar", json={"motivo": "Retirado para a correção da data."}, headers=aprovador)
    acoes = [a.acao for a in db.query(AuditLog).filter_by(tabela_afetada="documentos_institucionais", id_registro_afetado=id_documento).order_by(AuditLog.id_log)]
    assert acoes == ["CRIADO", "VERSAO_PUBLICA_ENVIADA", "ENVIADO_REVISAO", "APROVADO", "RETIRADO"]
    assert all(a.id_usuario for a in db.query(AuditLog).filter_by(tabela_afetada="documentos_institucionais", id_registro_afetado=id_documento))


def test_versao_publica_recusada_tambem_e_auditada_sem_guardar_o_dado(client, db, preparador):
    id_documento = _criar(client, preparador, arquivo=ORIGINAL).json()["id_documento"]
    _anexar_publica(client, preparador, id_documento, ORIGINAL[1])
    log = db.query(AuditLog).filter_by(tabela_afetada="documentos_institucionais", id_registro_afetado=id_documento, acao="VERSAO_PUBLICA_RECUSADA").one()
    assert "CPF" in log.dados_depois and "444" not in log.dados_depois


def test_listagem_filtra_por_tipo_ano_situacao_classificacao_e_vigencia(client, preparador):
    marca = uuid.uuid4().hex[:8]
    a = _criar(client, preparador, tipo="BALANCO", titulo=f"Balanço {marca}", ano="2024", classificacao="Pública").json()["id_documento"]
    b = _criar(client, preparador, tipo="CERTIDAO", titulo=f"Certidão {marca}", ano="2026", classificacao="Interna").json()["id_documento"]

    def ids(**filtro):
        return [d["id_documento"] for d in client.get("/api/documentos", params={"busca": marca, **filtro}, headers=preparador).json()]

    assert set(ids()) == {a, b}
    assert ids(tipo="BALANCO") == [a] and ids(ano=2026) == [b] and ids(classificacao="Interna") == [b]
    assert set(ids(situacao="Rascunho")) == {a, b} and ids(situacao="Aprovado") == []
    assert ids(vigente=True) and ids(vigente=False) == []


def test_tipos_para_os_formularios_do_painel(client, preparador):
    r = client.get("/api/documentos/tipos", headers=preparador).json()
    assert {"codigo": "ATA", "rotulo": "Ata"} in r["tipos"]
    assert r["classificacoes"] == ["Pública", "Interna", "Restrita"]
    assert r["situacoes"] == ["Rascunho", "Em revisão", "Aprovado", "Retirado"]


# ---------------------------------------------------------------------------- seeds e perfis
def test_permissoes_novas_existem_e_o_presidente_tem_todas(db):
    for codigo in ("documentos", "documentos_originais", "aprovar_publicacao", "parcerias"):
        assert db.query(PermissaoSistema).filter_by(codigo_permissao=codigo).first() is not None, codigo
    presidente = db.query(NivelAcesso).filter_by(nome_nivel="Presidente").one()
    do_presidente = {
        p.codigo_permissao for p in db.query(PermissaoSistema)
        .join(perfil_permissao, perfil_permissao.c.id_permissao == PermissaoSistema.id_permissao)
        .filter(perfil_permissao.c.id_nivel == presidente.id_nivel)
    }
    assert {"documentos", "documentos_originais", "aprovar_publicacao", "parcerias"} <= do_presidente


@pytest.mark.parametrize("nivel,permissao,mfa", [
    ("Documentos - preparo", "documentos", False),
    ("Documentos - originais sigilosos", "documentos_originais", True),
    ("Publicação - aprovação", "aprovar_publicacao", True),
    ("Parcerias e emendas - gestão", "parcerias", False),
])
def test_perfis_exclusivos_tem_exatamente_uma_permissao(db, nivel, permissao, mfa):
    n = db.query(NivelAcesso).filter_by(nome_nivel=nivel).one()
    codigos = [p.codigo_permissao for p in db.query(PermissaoSistema).join(perfil_permissao, perfil_permissao.c.id_permissao == PermissaoSistema.id_permissao)
               .filter(perfil_permissao.c.id_nivel == n.id_nivel)]
    assert codigos == [permissao]
    assert bool(n.exige_mfa) is mfa  # original sigiloso e aprovação exigem MFA


def test_presidente_e_secretario_recebem_aprovacao_pelo_cargo_em_mandato(db):
    from app.models.core import Catalogo, OpcaoCatalogo

    catalogo = db.query(Catalogo).filter_by(chave="titulo_cargo").one()
    cargos = {o.codigo: (o.metadados or {}).get("permissoes", []) for o in db.query(OpcaoCatalogo).filter_by(id_catalogo=catalogo.id_catalogo)}
    assert "aprovar_publicacao" in cargos["PRESIDENTE"] and "aprovar_publicacao" in cargos["SECRETARIO"]
    assert "documentos_originais" in cargos["SECRETARIO"]  # quem prepara a versão pública precisa ver o original
    for outro in ("VICE_PRESIDENTE", "TESOUREIRO", "VICE_SECRETARIO", "CONSELHO_FISCAL"):
        assert "aprovar_publicacao" not in cargos[outro], outro  # só os dois aprovam
