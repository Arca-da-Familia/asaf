"""v5.4b - versão pública de documento em TEXTO (além do PDF).

O estatuto existe como PDF registrado em cartório (com assinaturas: original INTERNO) e como transcrição em texto (a que o
público lê, sem assinaturas). Estes testes travam que o texto passa pela MESMA conferência de dado pessoal do PDF, que a
aprovação é de outra pessoa e refaz a conferência, e que a API pública só mostra o texto do que foi aprovado."""
import uuid

import pytest

from app.models.core import NivelAcesso, PermissaoSistema, Usuario, perfil_permissao
from app.models.documentos import DocumentoInstitucional
from app.security import criar_access_token, hash_senha
from tests.test_documentos_verificacao import CPF_VALIDO

ESTATUTO = (
    "ESTATUTO DA ASSOCIAÇÃO ARCA DA FAMÍLIA\n\nART. 1 - A ASAF é uma associação civil sem fins lucrativos.\n"
    "ART. 2 - A ASAF tem sede em Parauapebas, no Pará.\n\n\n\nART. 3 - Os objetivos da associação são sociais."
)


def _usuario(db, *codigos: str) -> dict:
    nivel = NivelAcesso(nome_nivel=f"nivel_txt_{uuid.uuid4().hex[:8]}", descricao="teste", exige_mfa=False)
    db.add(nivel)
    db.flush()
    for codigo in codigos:
        permissao = db.query(PermissaoSistema).filter(PermissaoSistema.codigo_permissao == codigo).first()
        assert permissao is not None, codigo
        db.execute(perfil_permissao.insert().values(id_nivel=nivel.id_nivel, id_permissao=permissao.id_permissao))
    usuario = Usuario(email=f"txt_{uuid.uuid4().hex[:8]}@teste.local", senha_hash=hash_senha("SenhaForte123456"), id_nivel=nivel.id_nivel, ativo=True)
    db.add(usuario)
    db.commit()
    db.refresh(usuario)
    return {"Authorization": f"Bearer {criar_access_token(usuario)}"}


@pytest.fixture(autouse=True)
def _admin_primeiro(admin_token):
    """O admin nasce antes dos usuários de teste, em qualquer ordem de execução."""


@pytest.fixture()
def preparador(db):
    return _usuario(db, "documentos")


@pytest.fixture()
def aprovador(db):
    return _usuario(db, "aprovar_publicacao")


def _criar(client, headers, **campos):
    dados = {"tipo": "ESTATUTO", "titulo": f"Estatuto {uuid.uuid4().hex[:6]}", "classificacao": "Interna", "publicar_no_site": "true", **campos}
    original = ("estatuto-registrado.pdf", b"%PDF-1.4 estatuto com assinaturas e CPF (so no original)", "application/pdf")
    r = client.post("/api/documentos", data=dados, files={"arquivo": original}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id_documento"]


def _texto(client, headers, id_documento, texto=ESTATUTO):
    return client.post(f"/api/documentos/{id_documento}/versao-publica-texto", json={"texto": texto}, headers=headers)


def _publicado(client, preparador, aprovador, texto=ESTATUTO):
    id_documento = _criar(client, preparador)
    assert _texto(client, preparador, id_documento, texto).status_code == 200
    assert client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=preparador).status_code == 200
    r = client.post(f"/api/documentos/{id_documento}/aprovar", headers=aprovador)
    assert r.status_code == 200, r.text
    return id_documento


# ------------------------------------------------------------------------------------- enviar o texto
def test_texto_aceito_fica_como_versao_publica_com_formato_e_sha(client, db, preparador):
    id_documento = _criar(client, preparador)
    r = _texto(client, preparador, id_documento)
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["tem_versao_publica"] is True and corpo["publico_formato"] == "TEXTO"
    assert corpo["resultado_da_verificacao"]["ok"] is True
    doc = db.query(DocumentoInstitucional).filter(DocumentoInstitucional.id_documento == id_documento).first()
    assert doc.publico_nome is None, "texto não vira arquivo"
    assert "\n\n\n" not in doc.publico_texto, "no máximo uma linha em branco seguida"
    assert doc.publico_sha256 and doc.publico_tamanho == len(doc.publico_texto.encode("utf-8"))


def test_texto_com_dado_pessoal_e_recusado_e_nada_e_guardado(client, db, preparador):
    id_documento = _criar(client, preparador)
    r = _texto(client, preparador, id_documento, ESTATUTO + f"\n\nPresidente: Fulano, CPF {CPF_VALIDO}, RG 1234567.")
    assert r.status_code == 422
    achados = r.json()["detail"]["resultado"]["bloqueios"]
    assert {"CPF", "DOCUMENTO_PESSOAL"} <= {a["codigo"] for a in achados}
    assert CPF_VALIDO not in r.text, "o erro só devolve amostra mascarada"
    db.expire_all()
    doc = db.query(DocumentoInstitucional).filter(DocumentoInstitucional.id_documento == id_documento).first()
    assert doc.publico_texto is None and doc.publico_formato is None
    assert client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=preparador).status_code == 409


@pytest.mark.parametrize("quantos,trecho", [(5, "curto demais"), (200_001, "passa de")], ids=["curto", "enorme"])
def test_texto_curto_ou_enorme_e_recusado(client, preparador, quantos, trecho):
    id_documento = _criar(client, preparador)
    r = _texto(client, preparador, id_documento, "x" * quantos)
    assert r.status_code == 400 and trecho in r.text


def test_documento_que_nao_vai_ao_site_nao_aceita_versao_publica_em_texto(client, preparador):
    id_documento = _criar(client, preparador, publicar_no_site="false")
    assert _texto(client, preparador, id_documento).status_code == 409


def test_so_quem_prepara_envia_texto(client, db, preparador, aprovador):
    id_documento = _criar(client, preparador)
    assert _texto(client, aprovador, id_documento).status_code == 403
    assert client.post(f"/api/documentos/{id_documento}/versao-publica-texto", json={"texto": ESTATUTO}).status_code == 401


def test_trocar_entre_pdf_e_texto_nao_deixa_resto_do_outro(client, db, preparador):
    from tests.test_documentos_institucionais import PUBLICA_OK, _anexar_publica

    id_documento = _criar(client, preparador)
    assert _anexar_publica(client, preparador, id_documento, PUBLICA_OK).status_code == 200
    doc = db.query(DocumentoInstitucional).filter(DocumentoInstitucional.id_documento == id_documento).first()
    assert doc.publico_formato == "PDF" and doc.publico_nome
    assert _texto(client, preparador, id_documento).status_code == 200
    db.expire_all()
    assert doc.publico_formato == "TEXTO" and doc.publico_nome is None and doc.publico_paginas is None
    assert _anexar_publica(client, preparador, id_documento, PUBLICA_OK).status_code == 200
    db.expire_all()
    assert doc.publico_formato == "PDF" and doc.publico_nome and "ART. 1" not in (doc.publico_texto or "")


def test_o_texto_publico_pode_ser_visto_por_quem_revisa(client, preparador, aprovador):
    id_documento = _criar(client, preparador)
    _texto(client, preparador, id_documento)
    r = client.get(f"/api/documentos/{id_documento}/versao-publica", headers=aprovador)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/plain")
    assert "ART. 2 - A ASAF tem sede em Parauapebas" in r.text


# ------------------------------------------------------------------------------------- aprovação
def test_aprovacao_exige_outra_pessoa_e_refaz_a_conferencia_do_texto(client, db, preparador, aprovador):
    id_documento = _criar(client, preparador)
    _texto(client, preparador, id_documento)
    client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=preparador)
    assert client.post(f"/api/documentos/{id_documento}/aprovar", headers=preparador).status_code == 403
    # o texto é mexido por fora depois da conferência (SHA-256 não bate): a aprovação recusa
    doc = db.query(DocumentoInstitucional).filter(DocumentoInstitucional.id_documento == id_documento).first()
    doc.publico_texto = doc.publico_texto + "\nCPF " + CPF_VALIDO
    db.commit()
    r = client.post(f"/api/documentos/{id_documento}/aprovar", headers=aprovador)
    assert r.status_code == 409 and "SHA-256" in r.text
    # mesmo com o SHA refeito, o verificador final pega o CPF
    import hashlib

    doc.publico_sha256 = hashlib.sha256(doc.publico_texto.encode("utf-8")).hexdigest()
    db.commit()
    r = client.post(f"/api/documentos/{id_documento}/aprovar", headers=aprovador)
    assert r.status_code == 422 and CPF_VALIDO not in r.text


# ------------------------------------------------------------------------------------- API pública
def test_api_publica_traz_o_texto_so_do_aprovado_e_nunca_oferece_arquivo(client, preparador, aprovador):
    rascunho = _criar(client, preparador)
    _texto(client, preparador, rascunho)
    id_documento = _publicado(client, preparador, aprovador)

    lista = client.get("/api/publico/transparencia/documentos").json()
    item = next(d for d in lista if d["id_documento"] == id_documento)
    assert item["formato"] == "TEXTO" and item["arquivo"] is None
    assert rascunho not in [d["id_documento"] for d in lista]
    assert "texto" not in item, "a lista não carrega o texto inteiro"

    detalhe = client.get(f"/api/publico/transparencia/documentos/{id_documento}")
    assert detalhe.status_code == 200
    corpo = detalhe.json()
    assert corpo["formato"] == "TEXTO" and corpo["texto"].startswith("ESTATUTO DA ASSOCIAÇÃO ARCA DA FAMÍLIA")
    assert client.get(f"/api/publico/transparencia/documentos/{rascunho}").status_code == 404
    assert client.get(f"/api/publico/transparencia/documentos/{id_documento}/arquivo").status_code == 404
    # o original (que tem assinaturas) nunca sai
    assert "assinaturas" not in detalhe.text and "original" not in set(corpo)


def test_documento_em_pdf_continua_igual_na_api_publica(client, preparador, aprovador):
    from tests.test_documentos_institucionais import _publicado as publicar_pdf

    id_documento = publicar_pdf(client, preparador, aprovador)
    item = next(d for d in client.get("/api/publico/transparencia/documentos").json() if d["id_documento"] == id_documento)
    assert item["formato"] == "PDF" and item["arquivo"].endswith("/arquivo")
    assert client.get(f"/api/publico/transparencia/documentos/{id_documento}").json()["texto"] is None
    assert client.get(f"/api/publico/transparencia/documentos/{id_documento}/arquivo").status_code == 200


def test_retirar_do_site_tira_o_texto_na_hora(client, preparador, aprovador):
    id_documento = _publicado(client, preparador, aprovador)
    r = client.post(f"/api/documentos/{id_documento}/retirar", json={"motivo": "Texto desatualizado, vamos corrigir."}, headers=aprovador)
    assert r.status_code == 200
    assert client.get(f"/api/publico/transparencia/documentos/{id_documento}").status_code == 404


def test_documento_de_texto_ligado_a_parceria_aparece_na_pagina_dela_sem_arquivo(client, db, preparador, aprovador):
    from tests.test_parcerias import _criar as criar_parceria, _publicada, _usuario as usuario_parceria

    gestor = usuario_parceria(db, "parcerias")
    outro_aprovador = usuario_parceria(db, "aprovar_publicacao")
    parceria = _publicada(client, gestor, outro_aprovador)
    id_documento = _criar(client, preparador, tipo="PLANO_TRABALHO", vinculo_tipo="parceria", vinculo_id=str(parceria["id_parceria"]))
    _texto(client, preparador, id_documento)
    client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=preparador)
    assert client.post(f"/api/documentos/{id_documento}/aprovar", headers=aprovador).status_code == 200
    docs = client.get(f"/api/publico/transparencia/parcerias/{parceria['id_parceria']}").json()["documentos"]
    assert [(d["id_documento"], d["formato"], d["arquivo"]) for d in docs] == [(id_documento, "TEXTO", None)]


def test_busca_na_biblioteca_acha_pelo_texto_publico(client, preparador):
    id_documento = _criar(client, preparador)
    _texto(client, preparador, id_documento, ESTATUTO + "\nPALAVRA-RARA-DE-BUSCA no meio.")
    achados = client.get("/api/documentos?busca=PALAVRA-RARA-DE-BUSCA", headers=preparador).json()
    assert [d["id_documento"] for d in achados] == [id_documento]
