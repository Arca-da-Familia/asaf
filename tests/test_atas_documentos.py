"""v5.4a - atas ligadas à biblioteca de Documentos.

A ata assinada traz RG/CPF de quem assinou. Antes ia para `/uploads/atas/<nome>`, servido SEM login. As promessas:
  1. a ata nova vira um documento Restrito, com o original PRIVADO (nunca em `/uploads`), baixável só com login e
     com a permissão `documentos_originais`, e cada download fica na auditoria;
  2. nada se apaga: trocar o arquivo mantém o antigo; documento já publicado ganha uma NOVA VERSÃO;
  3. as atas que já estavam no endereço público antigo são COPIADAS para a biblioteca (sem perder nenhum arquivo),
     a migração é idempotente e o endereço antigo deixa de responder."""
import uuid
from datetime import datetime

import pytest

from app.models.ata import Ata
from app.models.core import AuditLog, NivelAcesso, PermissaoSistema, Usuario, perfil_permissao
from app.models.documentos import DocumentoInstitucional
from app.security import criar_access_token, hash_senha
from app.services import armazenamento, documentos_institucionais
from tests.test_ata import _criar_assembleia_em_andamento, _criar_ata

PDF = b"%PDF-1.4 ata assinada com RG 1234567 e CPF"


def _usuario(db, *codigos: str) -> dict:
    nivel = NivelAcesso(nome_nivel=f"nivel_ata_{uuid.uuid4().hex[:8]}", descricao="teste", exige_mfa=False)
    db.add(nivel)
    db.flush()
    for codigo in codigos:
        permissao = db.query(PermissaoSistema).filter(PermissaoSistema.codigo_permissao == codigo).first()
        assert permissao is not None, codigo
        db.execute(perfil_permissao.insert().values(id_nivel=nivel.id_nivel, id_permissao=permissao.id_permissao))
    usuario = Usuario(email=f"ata_{uuid.uuid4().hex[:8]}@teste.local", senha_hash=hash_senha("SenhaForte123456"), id_nivel=nivel.id_nivel, ativo=True)
    db.add(usuario)
    db.commit()
    db.refresh(usuario)
    return {"Authorization": f"Bearer {criar_access_token(usuario)}"}


def _anexar(client, headers, id_ata, conteudo=PDF, nome="ata.pdf", **dados):
    return client.post(f"/api/atas/{id_ata}/documento-assinado", headers=headers, files={"documento": (nome, conteudo, "application/pdf")}, data=dados)


@pytest.fixture()
def ata(client, auth_headers):
    return _criar_ata(client, auth_headers, _criar_assembleia_em_andamento(client, auth_headers))


# ------------------------------------------------------------------------------------------ ata nova
def test_a_ata_assinada_vira_documento_restrito_com_original_privado(client, auth_headers, db, ata):
    r = _anexar(client, auth_headers, ata, numero_protocolo_cartorio="555-CRT")
    assert r.status_code == 200, r.text
    corpo = r.json()
    doc = db.query(DocumentoInstitucional).filter(DocumentoInstitucional.id_documento == corpo["id_documento_assinado"]).first()
    assert (doc.tipo, doc.classificacao, doc.publicar_no_site, doc.situacao) == ("ATA", "Restrita", False, "Rascunho")
    assert (doc.vinculo_tipo, doc.vinculo_id) == ("ata", ata)
    assert doc.original_nome and doc.original_nome.endswith(".pdf")
    assert armazenamento.obter().ler("documentos-originais", doc.original_nome) == PDF
    assert corpo["numero_protocolo_cartorio"] == "555-CRT"
    # a lista de documentos (biblioteca) mostra a ata
    ids = [d["id_documento"] for d in client.get("/api/documentos?tipo=ATA", headers=auth_headers).json()]
    assert doc.id_documento in ids


def test_a_ata_nunca_fica_em_uploads_nem_em_pasta_publica(client, auth_headers, db, ata):
    corpo = _anexar(client, auth_headers, ata).json()
    assert "/uploads/" not in corpo["arquivo_documento_assinado"]
    doc = db.query(DocumentoInstitucional).filter(DocumentoInstitucional.id_documento == corpo["id_documento_assinado"]).first()
    for pasta in ("atas", "fotos", "comprovantes", "documentos"):
        assert client.get(f"/uploads/{pasta}/{doc.original_nome}").status_code == 404
    assert client.get(f"/api/publico/transparencia/documentos/{doc.id_documento}/arquivo").status_code == 404


def test_download_exige_login_e_a_permissao_de_originais_e_fica_na_auditoria(client, auth_headers, db, ata):
    caminho = _anexar(client, auth_headers, ata).json()["arquivo_documento_assinado"]
    secretaria = _usuario(db, "governanca")  # gere atas, mas não vê original sigiloso
    com_permissao = _usuario(db, "documentos_originais")
    assert client.get(caminho).status_code == 401
    assert client.get(caminho, headers=secretaria).status_code == 403
    antes = db.query(AuditLog).filter(AuditLog.acao == "ORIGINAL_BAIXADO").count()
    r = client.get(caminho, headers=com_permissao)
    assert r.status_code == 200 and r.content == PDF and r.headers["cache-control"] == "no-store"
    assert db.query(AuditLog).filter(AuditLog.acao == "ORIGINAL_BAIXADO").count() == antes + 1


def test_trocar_o_arquivo_de_um_rascunho_mantem_o_antigo_e_audita(client, auth_headers, db, ata):
    primeiro = _anexar(client, auth_headers, ata, conteudo=PDF + b" v1").json()
    doc = db.query(DocumentoInstitucional).filter(DocumentoInstitucional.id_documento == primeiro["id_documento_assinado"]).first()
    nome_v1 = doc.original_nome
    segundo = _anexar(client, auth_headers, ata, conteudo=PDF + b" v2").json()
    assert segundo["id_documento_assinado"] == primeiro["id_documento_assinado"]
    assert armazenamento.obter().ler("documentos-originais", nome_v1) == PDF + b" v1"
    assert client.get(segundo["arquivo_documento_assinado"], headers=auth_headers).content == PDF + b" v2"
    acoes = [a.acao for a in db.query(AuditLog).filter(AuditLog.tabela_afetada == "documentos_institucionais", AuditLog.id_registro_afetado == doc.id_documento).order_by(AuditLog.id_log)]
    assert acoes[:2] == ["CRIADO", "ORIGINAL_ENVIADO"]
    trilha_da_ata = [a for a in db.query(AuditLog).filter(AuditLog.tabela_afetada == "atas", AuditLog.id_registro_afetado == ata, AuditLog.acao == "DOCUMENTO_ASSINADO_ANEXADO")]
    assert len(trilha_da_ata) == 2 and "uploads" not in (trilha_da_ata[-1].dados_depois or "")


def test_documento_da_ata_ja_publicado_ganha_nova_versao_sem_tirar_o_publicado_do_ar(client, auth_headers, db, ata):
    primeiro = _anexar(client, auth_headers, ata).json()
    doc = db.query(DocumentoInstitucional).filter(DocumentoInstitucional.id_documento == primeiro["id_documento_assinado"]).first()
    doc.situacao, doc.publicar_no_site = "Aprovado", True  # como se já tivesse passado pela revisão
    db.commit()
    segundo = _anexar(client, auth_headers, ata, conteudo=PDF + b" corrigida").json()
    assert segundo["id_documento_assinado"] != primeiro["id_documento_assinado"]
    db.expire_all()
    versoes = db.query(DocumentoInstitucional).filter(DocumentoInstitucional.grupo_versao == doc.grupo_versao).order_by(DocumentoInstitucional.versao).all()
    assert [(v.versao, v.situacao) for v in versoes] == [(1, "Aprovado"), (2, "Rascunho")]
    assert versoes[0].vigente is True and versoes[1].vigente is False, "a publicada continua vigente até a nova ser aprovada"


def test_formato_invalido_e_arquivo_grande_continuam_recusados(client, auth_headers, ata):
    r = client.post(f"/api/atas/{ata}/documento-assinado", headers=auth_headers, files={"documento": ("a.gif", b"GIF89a", "image/gif")})
    assert r.status_code == 400
    r = _anexar(client, auth_headers, ata, conteudo=b"%PDF-" + b"x" * (15 * 1024 * 1024))
    assert r.status_code == 400 and "grande" in r.text
    r = _anexar(client, auth_headers, ata, conteudo=b"isto nao e um pdf de verdade")
    assert r.status_code == 400 and "não confere" in r.text


def test_o_detalhe_da_ata_diz_o_id_do_documento_para_o_painel(client, auth_headers, ata):
    assert client.get(f"/api/atas/{ata}", headers=auth_headers).json()["id_documento_assinado"] is None
    id_documento = _anexar(client, auth_headers, ata).json()["id_documento_assinado"]
    assert client.get(f"/api/atas/{ata}", headers=auth_headers).json()["id_documento_assinado"] == id_documento
    linha = next(a for a in client.get("/api/atas/", headers=auth_headers).json() if a["id_ata"] == ata)
    assert linha["id_documento_assinado"] == id_documento


# ------------------------------------------------------------------------------- atas que já existiam
def _ata_antiga(db, client, auth_headers, conteudo=PDF, nome_no_armazenamento=None, caminho=None):
    """Uma ata como existia em produção antes da v5.4a: arquivo em `atas/` e caminho público guardado."""
    id_ata = _criar_ata(client, auth_headers, _criar_assembleia_em_andamento(client, auth_headers))
    nome = nome_no_armazenamento or f"{uuid.uuid4().hex}.pdf"
    if conteudo is not None:
        armazenamento.obter().salvar("atas", nome, conteudo)
    registro = db.query(Ata).filter(Ata.id_ata == id_ata).first()
    registro.arquivo_documento_assinado = caminho or f"/uploads/atas/{nome}"
    registro.assinada_em = datetime(2026, 5, 20, 10, 0)
    db.commit()
    return id_ata, nome


def test_migracao_copia_a_ata_antiga_para_a_biblioteca_sem_perder_o_arquivo(client, auth_headers, db):
    id_ata, nome = _ata_antiga(db, client, auth_headers)
    resultado = documentos_institucionais.migrar_atas_legadas(db)
    assert resultado["migradas"] >= 1
    db.expire_all()
    ata = db.query(Ata).filter(Ata.id_ata == id_ata).first()
    doc = documentos_institucionais.documento_da_ata(db, id_ata)
    assert doc is not None and ata.arquivo_documento_assinado == f"/api/documentos/{doc.id_documento}/original"
    assert (doc.tipo, doc.classificacao, doc.publicar_no_site, doc.versao) == ("ATA", "Restrita", False, 1)
    assert doc.data_documento.isoformat() == "2026-05-20" and doc.ano == 2026
    assert armazenamento.obter().ler("documentos-originais", doc.original_nome) == PDF
    assert doc.original_sha256 and doc.original_tamanho == len(PDF)
    assert armazenamento.obter().ler("atas", nome) == PDF, "o arquivo antigo NÃO é apagado"
    assert client.get(f"/uploads/atas/{nome}").status_code == 404, "o endereço antigo deixa de responder"
    baixado = client.get(ata.arquivo_documento_assinado, headers=auth_headers)
    assert baixado.status_code == 200 and baixado.content == PDF
    assert any(a.acao == "MIGRADO_DA_ATA" and a.id_registro_afetado == doc.id_documento for a in db.query(AuditLog).filter(AuditLog.tabela_afetada == "documentos_institucionais"))


def test_migracao_e_idempotente(client, auth_headers, db):
    id_ata, _ = _ata_antiga(db, client, auth_headers)
    documentos_institucionais.migrar_atas_legadas(db)
    db.expire_all()
    primeiro = documentos_institucionais.documento_da_ata(db, id_ata)
    de_novo = documentos_institucionais.migrar_atas_legadas(db)
    assert de_novo == {"migradas": 0, "arquivo_ausente": 0, "ignoradas": 0}
    assert db.query(DocumentoInstitucional).filter(DocumentoInstitucional.vinculo_tipo == "ata", DocumentoInstitucional.vinculo_id == id_ata).count() == 1
    assert documentos_institucionais.documento_da_ata(db, id_ata).id_documento == primeiro.id_documento


def test_migracao_nao_inventa_documento_para_arquivo_que_nao_existe_mais(client, auth_headers, db):
    id_ata, nome = _ata_antiga(db, client, auth_headers, conteudo=None)
    resultado = documentos_institucionais.migrar_atas_legadas(db)
    assert resultado["arquivo_ausente"] >= 1
    db.expire_all()
    assert db.query(Ata).filter(Ata.id_ata == id_ata).first().arquivo_documento_assinado == f"/uploads/atas/{nome}", "fica como estava"
    assert documentos_institucionais.documento_da_ata(db, id_ata) is None


def test_migracao_ignora_caminho_estranho_e_ata_ja_migrada_ou_sem_documento(client, auth_headers, db):
    sem_documento = _criar_ata(client, auth_headers, _criar_assembleia_em_andamento(client, auth_headers))
    estranho, _ = _ata_antiga(db, client, auth_headers, conteudo=None, caminho="/uploads/atas/../../etc/passwd")
    nova = _criar_ata(client, auth_headers, _criar_assembleia_em_andamento(client, auth_headers))
    novo_caminho = _anexar(client, auth_headers, nova).json()["arquivo_documento_assinado"]
    resultado = documentos_institucionais.migrar_atas_legadas(db)
    assert resultado["ignoradas"] >= 1
    db.expire_all()
    assert db.query(Ata).filter(Ata.id_ata == sem_documento).first().arquivo_documento_assinado is None
    assert db.query(Ata).filter(Ata.id_ata == nova).first().arquivo_documento_assinado == novo_caminho
    assert db.query(Ata).filter(Ata.id_ata == estranho).first().arquivo_documento_assinado == "/uploads/atas/../../etc/passwd"


def test_a_migracao_na_inicializacao_nunca_derruba_a_api(monkeypatch):
    from app import main

    def estoura(_db):
        raise RuntimeError("blob fora do ar")

    monkeypatch.setattr(documentos_institucionais, "migrar_atas_legadas", estoura)
    main._migrar_atas_para_documentos()  # só registra no log: a API sobe do mesmo jeito
