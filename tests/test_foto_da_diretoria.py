"""v5.7c - nome e FOTO de quem está na Diretoria e no Conselho aparecem no site ("a pessoa se sente representada quando vê o rosto de quem responde pela instituição"). O que o servidor garante:
  1. a foto só é guardada com a autorização de uso de imagem, e só se for imagem de verdade; é regravada em JPEG sem nenhum metadado;
  2. a API pública só traz a foto de quem autorizou E tem mandato vigente; o arquivo público responde 404 igual para tudo o que não pode aparecer;
  3. trocar a foto substitui a anterior (o arquivo velho sai) e apagar (retirou a autorização) some do sistema e do site na hora;
  4. a foto do cadastro de associado (privada) nunca sai por aqui; só a `governanca` mexe; tudo fica na Auditoria."""
import io
import uuid
from datetime import datetime, timedelta

from PIL import Image

from app.models.mandatos import FotoDaDiretoria, Mandato
from app.services import armazenamento
from app.services.fotos_da_diretoria import PASTA_DAS_FOTOS
from tests.test_publico import _dar_posse, _dirigente


def _jpeg(cor=(200, 60, 60), tamanho=(300, 400), com_metadado=False) -> bytes:
    imagem = Image.new("RGB", tamanho, cor)
    saida = io.BytesIO()
    if com_metadado:
        exif = Image.Exif()
        exif[0x010F] = "Fabricante Secreto"  # Make
        exif[0x0112] = 6  # Orientation
        imagem.save(saida, format="JPEG", exif=exif, comment=b"texto livre que nao pode ir junto")
    else:
        imagem.save(saida, format="JPEG")
    return saida.getvalue()


def _novo_dirigente(db, cargo="PRESIDENTE", orgao="DIRETORIA_EXECUTIVA", client=None, auth_headers=None):
    sufixo = uuid.uuid4().hex[:6]
    dirigente = _dirigente(db, f"Dirigente Foto {sufixo}", f"6{uuid.uuid4().int % 10**10:010d}", f"foto.{sufixo}@particular.com", "(94) 98888-0000")
    id_mandato = _dar_posse(client, auth_headers, dirigente, orgao, cargo)
    return dirigente, id_mandato


def _enviar(client, auth_headers, id_associado, conteudo, autorizacao=True, nome="foto.jpg", tipo="image/jpeg"):
    return client.post(
        f"/api/mandatos/associados/{id_associado}/foto-publica", headers=auth_headers,
        files={"arquivo": (nome, conteudo, tipo)}, data={"autorizacao_imagem": "true" if autorizacao else "false"},
    )


def _linha_publica(client, nome):
    return next(x for x in client.get("/api/publico/diretoria").json() if x["nome"] == nome)


def test_sem_a_autorizacao_de_imagem_a_foto_nao_e_guardada(client, auth_headers, db):
    dirigente, _ = _novo_dirigente(db, client=client, auth_headers=auth_headers)
    r = _enviar(client, auth_headers, dirigente.id_associado, _jpeg(), autorizacao=False)
    assert r.status_code == 400 and "autorização de uso de imagem" in r.json()["detail"]
    assert client.get(f"/api/mandatos/associados/{dirigente.id_associado}/foto-publica", headers=auth_headers).json()["foto"] is None
    assert _linha_publica(client, dirigente.nome_completo)["foto"] is None


def test_arquivo_que_nao_e_imagem_e_associado_que_nao_existe_sao_recusados(client, auth_headers, db):
    dirigente, _ = _novo_dirigente(db, client=client, auth_headers=auth_headers)
    r = _enviar(client, auth_headers, dirigente.id_associado, b"isto nao e uma imagem", nome="x.jpg")
    assert r.status_code == 400 and "Formato não suportado" in r.json()["detail"]
    assert _enviar(client, auth_headers, 99999999, _jpeg()).status_code == 404
    assert client.get("/api/mandatos/associados/99999999/foto-publica", headers=auth_headers).status_code == 404


def test_a_foto_vai_ao_site_so_de_quem_autorizou_e_o_arquivo_bate_com_a_impressao_digital(client, auth_headers, db):
    com_foto, _ = _novo_dirigente(db, cargo="PRESIDENTE", client=client, auth_headers=auth_headers)
    sem_foto, _ = _novo_dirigente(db, cargo="SECRETARIO", client=client, auth_headers=auth_headers)
    r = _enviar(client, auth_headers, com_foto.id_associado, _jpeg())
    assert r.status_code == 201, r.text
    assert r.json()["aparece_no_site"] is True and r.json()["foto"]["autorizacao_imagem"] is True

    linha = _linha_publica(client, com_foto.nome_completo)
    assert set(linha["foto"]) == {"id_foto", "alt", "sha256", "largura", "altura", "arquivo"}
    assert linha["foto"]["alt"] == f"Foto de {com_foto.nome_completo}, Presidente"
    assert _linha_publica(client, sem_foto.nome_completo)["foto"] is None

    arquivo = client.get(linha["foto"]["arquivo"])  # SEM login
    assert arquivo.status_code == 200 and arquivo.headers["content-type"] == "image/jpeg"
    assert arquivo.content[:3] == b"\xff\xd8\xff"
    import hashlib

    assert hashlib.sha256(arquivo.content).hexdigest() == linha["foto"]["sha256"]
    # a foto de cadastro do associado (privada) não vazou
    assert "segredo.jpg" not in client.get("/api/publico/diretoria").text


def test_a_foto_e_regravada_sem_nenhum_metadado_e_cabe_no_limite(client, auth_headers, db):
    dirigente, _ = _novo_dirigente(db, client=client, auth_headers=auth_headers)
    assert _enviar(client, auth_headers, dirigente.id_associado, _jpeg(tamanho=(3000, 2400), com_metadado=True)).status_code == 201
    foto = _linha_publica(client, dirigente.nome_completo)["foto"]
    saida = client.get(foto["arquivo"]).content
    imagem = Image.open(io.BytesIO(saida))
    assert imagem.format == "JPEG" and max(imagem.size) <= 2000
    assert len(imagem.getexif()) == 0, "nenhum Exif (fabricante, orientação, GPS) vai junto"
    assert b"Fabricante Secreto" not in saida and b"texto livre" not in saida and b"Exif" not in saida


def test_sem_mandato_vigente_a_foto_deixa_de_ser_publica(client, auth_headers, db):
    dirigente, id_mandato = _novo_dirigente(db, client=client, auth_headers=auth_headers)
    assert _enviar(client, auth_headers, dirigente.id_associado, _jpeg()).status_code == 201
    foto = _linha_publica(client, dirigente.nome_completo)["foto"]
    assert client.get(foto["arquivo"]).status_code == 200
    # o mandato termina: a pessoa some da lista e a foto passa a dar 404 (a foto continua guardada, mas não é pública)
    mandato = db.query(Mandato).filter(Mandato.id_mandato == id_mandato).first()
    mandato.data_fim_efetivo = datetime.utcnow() - timedelta(days=1)
    db.commit()
    assert dirigente.nome_completo not in {x["nome"] for x in client.get("/api/publico/diretoria").json()}
    assert client.get(foto["arquivo"]).status_code == 404
    assert client.get(f"/api/mandatos/associados/{dirigente.id_associado}/foto-publica", headers=auth_headers).json()["aparece_no_site"] is False
    # foto inexistente responde igual
    assert client.get("/api/publico/diretoria/fotos/99999999").status_code == 404


def test_trocar_substitui_e_apagar_remove_do_sistema_e_do_site(client, auth_headers, db):
    dirigente, _ = _novo_dirigente(db, client=client, auth_headers=auth_headers)
    assert _enviar(client, auth_headers, dirigente.id_associado, _jpeg(cor=(10, 10, 200))).status_code == 201
    primeira = db.query(FotoDaDiretoria).filter(FotoDaDiretoria.id_pessoa == dirigente.id_pessoa).one()
    nome_antigo, sha_antigo = primeira.arquivo_nome, primeira.sha256
    assert armazenamento.obter().ler(PASTA_DAS_FOTOS, nome_antigo) is not None

    assert _enviar(client, auth_headers, dirigente.id_associado, _jpeg(cor=(10, 200, 10))).status_code == 201
    db.expire_all()
    fotos = db.query(FotoDaDiretoria).filter(FotoDaDiretoria.id_pessoa == dirigente.id_pessoa).all()
    assert len(fotos) == 1, "uma foto por pessoa"
    assert fotos[0].sha256 != sha_antigo and fotos[0].arquivo_nome != nome_antigo
    assert armazenamento.obter().ler(PASTA_DAS_FOTOS, nome_antigo) is None, "o arquivo velho saiu do armazenamento"
    nome_novo = fotos[0].arquivo_nome
    assert armazenamento.obter().ler(PASTA_DAS_FOTOS, nome_novo) is not None

    r = client.delete(f"/api/mandatos/associados/{dirigente.id_associado}/foto-publica", headers=auth_headers)
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.query(FotoDaDiretoria).filter(FotoDaDiretoria.id_pessoa == dirigente.id_pessoa).count() == 0
    assert armazenamento.obter().ler(PASTA_DAS_FOTOS, nome_novo) is None
    assert _linha_publica(client, dirigente.nome_completo)["foto"] is None
    assert client.delete(f"/api/mandatos/associados/{dirigente.id_associado}/foto-publica", headers=auth_headers).status_code == 404


def test_so_quem_tem_governanca_mexe_e_a_auditoria_guarda(client, auth_headers, db):
    dirigente, _ = _novo_dirigente(db, client=client, auth_headers=auth_headers)
    rota = f"/api/mandatos/associados/{dirigente.id_associado}/foto-publica"
    assert client.get(rota).status_code == 401
    assert client.post(rota, files={"arquivo": ("f.jpg", _jpeg(), "image/jpeg")}, data={"autorizacao_imagem": "true"}).status_code == 401
    assert client.delete(rota).status_code == 401
    assert client.get(rota + "/arquivo").status_code == 401
    assert _enviar(client, auth_headers, dirigente.id_associado, _jpeg()).status_code == 201
    assert client.get(rota + "/arquivo", headers=auth_headers).content[:3] == b"\xff\xd8\xff"
    assert client.delete(rota, headers=auth_headers).status_code == 200
    entradas = client.get("/api/auditoria/?tabela_afetada=fotos_da_diretoria&por_pagina=50", headers=auth_headers).json()["entradas"]
    assert {"FOTO_ENVIADA", "FOTO_APAGADA"} <= {e["acao"] for e in entradas}
