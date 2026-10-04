"""v5.4b - fotos das etapas de uma parceria, com AUTORIZAÇÃO DE IMAGEM.

Foto de oficina mostra pessoas (muitas vezes crianças). As promessas que estes testes travam:
  1. sem a autorização de imagem confirmada e sem o texto alternativo, nada é guardado;
  2. a imagem é REGRAVADA: some localização/GPS e o modelo do aparelho, a rotação é aplicada, o lado maior fica em até 2000 px;
  3. o arquivo fica privado: o público só o recebe de parceria APROVADA, por campos explícitos; retirar ou apagar tira na hora;
  4. quem retirou a autorização pode apagar a foto (some do banco e do armazenamento); apagar a etapa leva as fotos junto."""
import hashlib
import io
import uuid

import pytest
from PIL import Image

from app.models.core import AuditLog
from app.models.parcerias import FotoEtapaParceria
from app.services import armazenamento
from tests.test_documentos_verificacao import CPF_VALIDO
from tests.test_parcerias import _criar, _publicada, _usuario


@pytest.fixture(autouse=True)
def _admin_primeiro(admin_token):
    """O admin nasce antes dos usuários de teste, em qualquer ordem de execução."""


@pytest.fixture()
def gestor(db):
    return _usuario(db, "parcerias")


@pytest.fixture()
def aprovador(db):
    return _usuario(db, "aprovar_publicacao")


def _jpeg(tamanho=(200, 100), com_exif=False, orientacao=1):
    imagem = Image.new("RGB", tamanho, (30, 120, 60))
    saida = io.BytesIO()
    if com_exif:
        exif = Image.Exif()
        exif[0x010F] = "FabricanteSecreto"
        exif[0x0110] = "ModeloDoAparelho-XYZ"
        exif[0x0112] = orientacao
        gps = exif.get_ifd(0x8825)
        gps[1], gps[2], gps[3], gps[4] = "S", (6.0, 4.0, 12.0), "W", (49.0, 55.0, 30.0)
        imagem.save(saida, format="JPEG", exif=exif)
    else:
        imagem.save(saida, format="JPEG")
    return saida.getvalue()


def _png_com_transparencia():
    saida = io.BytesIO()
    Image.new("RGBA", (60, 40), (255, 0, 0, 0)).save(saida, format="PNG")
    return saida.getvalue()


def _webp():
    saida = io.BytesIO()
    Image.new("RGB", (80, 50), (0, 0, 255)).save(saida, format="WEBP")
    return saida.getvalue()


ALT = "Crianças tocando tambores na quadra da escola"


def _etapa(client, headers, id_parceria):
    r = client.post(f"/api/parcerias/{id_parceria}/etapas", json={"titulo": "Oficina de percussão"}, headers=headers)
    assert r.status_code == 201
    return r.json()["etapas"][-1]["id_etapa"]


def _enviar(client, headers, id_parceria, id_etapa, conteudo=None, nome="foto.jpg", alt=ALT, autorizacao="true", tipo="image/jpeg", **extra):
    dados = {"alt": alt, "autorizacao_imagem": autorizacao, **extra}
    return client.post(
        f"/api/parcerias/{id_parceria}/etapas/{id_etapa}/fotos", data=dados,
        files={"arquivo": (nome, conteudo if conteudo is not None else _jpeg(), tipo)}, headers=headers,
    )


@pytest.fixture()
def cenario(client, gestor):
    parceria = _criar(client, gestor)
    return parceria["id_parceria"], _etapa(client, gestor, parceria["id_parceria"])


# ----------------------------------------------------------------------------- login e permissão
def test_so_a_gestao_envia_e_apaga_e_tudo_exige_login(client, db, gestor, aprovador, cenario):
    id_parceria, id_etapa = cenario
    assert client.post(f"/api/parcerias/{id_parceria}/etapas/{id_etapa}/fotos", data={"alt": ALT, "autorizacao_imagem": "true"}, files={"arquivo": ("a.jpg", _jpeg(), "image/jpeg")}).status_code == 401
    assert _enviar(client, aprovador, id_parceria, id_etapa).status_code == 403
    id_foto = _enviar(client, gestor, id_parceria, id_etapa).json()["etapas"][0]["fotos"][0]["id_foto"]
    assert client.get(f"/api/parcerias/{id_parceria}/fotos/{id_foto}/arquivo").status_code == 401
    assert client.get(f"/api/parcerias/{id_parceria}/fotos/{id_foto}/arquivo", headers=aprovador).status_code == 200, "quem só aprova pode VER a foto"
    assert client.delete(f"/api/parcerias/{id_parceria}/fotos/{id_foto}", headers=aprovador).status_code == 403
    assert client.delete(f"/api/parcerias/{id_parceria}/fotos/{id_foto}", headers=gestor).status_code == 200


# ----------------------------------------------------------------------------- autorização e texto alternativo
@pytest.mark.parametrize("autorizacao", ["false", ""])
def test_sem_autorizacao_de_imagem_nada_e_guardado(client, db, gestor, cenario, autorizacao):
    id_parceria, id_etapa = cenario
    r = _enviar(client, gestor, id_parceria, id_etapa, autorizacao=autorizacao)
    assert r.status_code == 400 and "autorização" in r.text
    assert db.query(FotoEtapaParceria).filter(FotoEtapaParceria.id_parceria == id_parceria).count() == 0


@pytest.mark.parametrize("alt", ["", "curta", "x" * 301])
def test_descricao_da_foto_e_obrigatoria_e_tem_tamanho(client, db, gestor, cenario, alt):
    id_parceria, id_etapa = cenario
    r = _enviar(client, gestor, id_parceria, id_etapa, alt=alt)
    assert r.status_code == 400 and "Descreva a foto" in r.text
    assert db.query(FotoEtapaParceria).filter(FotoEtapaParceria.id_parceria == id_parceria).count() == 0


def test_descricao_com_dado_pessoal_e_recusada(client, gestor, cenario):
    id_parceria, id_etapa = cenario
    r = _enviar(client, gestor, id_parceria, id_etapa, alt=f"Foto da Maria, CPF {CPF_VALIDO}, na quadra")
    assert r.status_code == 422 and CPF_VALIDO not in r.text


def test_termo_de_autorizacao_ligado_precisa_existir(client, gestor, cenario):
    id_parceria, id_etapa = cenario
    assert _enviar(client, gestor, id_parceria, id_etapa, id_documento_autorizacao="999999").status_code == 404


def test_etapa_de_outra_parceria_nao_e_alcancada(client, gestor, cenario):
    id_parceria, _ = cenario
    outra = _criar(client, gestor)
    id_etapa_alheia = _etapa(client, gestor, outra["id_parceria"])
    assert _enviar(client, gestor, id_parceria, id_etapa_alheia).status_code == 404


# ----------------------------------------------------------------------------- a imagem é regravada
def test_a_foto_perde_gps_modelo_do_aparelho_e_a_rotacao_e_aplicada(client, db, gestor, cenario):
    id_parceria, id_etapa = cenario
    original = _jpeg(tamanho=(200, 100), com_exif=True, orientacao=6)  # o celular só anotou "gire 90°"
    assert b"ModeloDoAparelho-XYZ" in original
    r = _enviar(client, gestor, id_parceria, id_etapa, conteudo=original)
    assert r.status_code == 201, r.text
    foto = r.json()["etapas"][0]["fotos"][0]
    guardado = client.get(f"/api/parcerias/{id_parceria}/fotos/{foto['id_foto']}/arquivo", headers=gestor).content
    assert b"ModeloDoAparelho-XYZ" not in guardado and b"FabricanteSecreto" not in guardado
    imagem = Image.open(io.BytesIO(guardado))
    assert not imagem.getexif(), "nenhum metadado (GPS, modelo, data) sobrevive"
    assert imagem.format == "JPEG" and (imagem.width, imagem.height) == (100, 200), "a rotação foi aplicada: 200x100 virou 100x200"
    assert (foto["largura"], foto["altura"]) == (100, 200)


def test_foto_grande_e_reduzida_a_2000_px_e_png_com_transparencia_e_webp_viram_jpeg(client, gestor, cenario):
    id_parceria, id_etapa = cenario
    r = _enviar(client, gestor, id_parceria, id_etapa, conteudo=_jpeg(tamanho=(4000, 3000)))
    grande = r.json()["etapas"][0]["fotos"][0]
    assert max(grande["largura"], grande["altura"]) == 2000
    for conteudo, nome, tipo in ((_png_com_transparencia(), "a.png", "image/png"), (_webp(), "a.webp", "image/webp")):
        r = _enviar(client, gestor, id_parceria, id_etapa, conteudo=conteudo, nome=nome, tipo=tipo)
        assert r.status_code == 201, r.text
        id_foto = r.json()["etapas"][0]["fotos"][-1]["id_foto"]
        assert client.get(f"/api/parcerias/{id_parceria}/fotos/{id_foto}/arquivo", headers=gestor).content[:3] == b"\xff\xd8\xff"


@pytest.mark.parametrize("conteudo,trecho", [
    (b"GIF89a" + b"x" * 50, "Formato não suportado"),
    (b"isto nao e uma imagem de verdade", "Formato não suportado"),
    (b"\xff\xd8\xff" + b"lixo" * 20, "Não consegui abrir"),
    (b"RIFFxxxxNAOEWEBP", "Formato não suportado"),
], ids=["gif", "texto", "jpeg-falso", "riff-que-nao-e-webp"])
def test_arquivo_que_nao_e_foto_de_verdade_e_recusado(client, gestor, cenario, conteudo, trecho):
    id_parceria, id_etapa = cenario
    r = _enviar(client, gestor, id_parceria, id_etapa, conteudo=conteudo)
    assert r.status_code == 400 and trecho in r.text


def test_foto_acima_de_10_mb_e_recusada(client, gestor, cenario):
    id_parceria, id_etapa = cenario
    r = _enviar(client, gestor, id_parceria, id_etapa, conteudo=b"\xff\xd8\xff" + b"0" * (10 * 1024 * 1024))
    assert r.status_code == 400 and "muito grande" in r.text


def test_no_maximo_12_fotos_por_etapa(client, gestor, cenario):
    id_parceria, id_etapa = cenario
    pequena = _jpeg(tamanho=(20, 20))
    for _ in range(12):
        assert _enviar(client, gestor, id_parceria, id_etapa, conteudo=pequena).status_code == 201
    r = _enviar(client, gestor, id_parceria, id_etapa, conteudo=pequena)
    assert r.status_code == 409 and "12" in r.text


# ----------------------------------------------------------------------------- apagar
def test_apagar_a_foto_tira_do_banco_e_do_armazenamento_e_fica_na_auditoria(client, db, gestor, cenario):
    id_parceria, id_etapa = cenario
    foto = _enviar(client, gestor, id_parceria, id_etapa).json()["etapas"][0]["fotos"][0]
    linha = db.query(FotoEtapaParceria).filter(FotoEtapaParceria.id_foto == foto["id_foto"]).first()
    nome = linha.arquivo_nome
    assert armazenamento.obter().ler("fotos-etapas", nome) is not None
    r = client.delete(f"/api/parcerias/{id_parceria}/fotos/{foto['id_foto']}", headers=gestor)
    assert r.status_code == 200 and r.json()["etapas"][0]["fotos"] == []
    assert armazenamento.obter().ler("fotos-etapas", nome) is None, "a foto some de verdade"
    acoes = [a.acao for a in db.query(AuditLog).filter(AuditLog.tabela_afetada == "parcerias", AuditLog.id_registro_afetado == id_parceria).order_by(AuditLog.id_log)]
    assert "FOTO_ENVIADA" in acoes and "FOTO_APAGADA" in acoes
    assert client.delete(f"/api/parcerias/{id_parceria}/fotos/{foto['id_foto']}", headers=gestor).status_code == 404


def test_apagar_a_etapa_leva_as_fotos_junto(client, db, gestor, cenario):
    id_parceria, id_etapa = cenario
    _enviar(client, gestor, id_parceria, id_etapa)
    nome = db.query(FotoEtapaParceria).filter(FotoEtapaParceria.id_etapa == id_etapa).first().arquivo_nome
    assert client.delete(f"/api/parcerias/{id_parceria}/etapas/{id_etapa}", headers=gestor).status_code == 200
    assert db.query(FotoEtapaParceria).filter(FotoEtapaParceria.id_etapa == id_etapa).count() == 0
    assert armazenamento.obter().ler("fotos-etapas", nome) is None


def test_foto_de_outra_parceria_nao_e_alcancada(client, gestor, cenario):
    id_parceria, id_etapa = cenario
    outra = _criar(client, gestor)
    id_foto = _enviar(client, gestor, id_parceria, id_etapa).json()["etapas"][0]["fotos"][0]["id_foto"]
    assert client.get(f"/api/parcerias/{outra['id_parceria']}/fotos/{id_foto}/arquivo", headers=gestor).status_code == 404
    assert client.delete(f"/api/parcerias/{outra['id_parceria']}/fotos/{id_foto}", headers=gestor).status_code == 404


# ----------------------------------------------------------------------------- API pública
def test_o_publico_so_recebe_a_foto_de_parceria_aprovada_com_campos_explicitos(client, gestor, aprovador):
    parceria = _criar(client, gestor)
    id_parceria = parceria["id_parceria"]
    id_etapa = _etapa(client, gestor, id_parceria)
    foto = _enviar(client, gestor, id_parceria, id_etapa).json()["etapas"][0]["fotos"][0]
    caminho = f"/api/publico/transparencia/parcerias/{id_parceria}/fotos/{foto['id_foto']}"
    assert client.get(caminho).status_code == 404, "rascunho: a foto não é pública"
    client.post(f"/api/parcerias/{id_parceria}/enviar-revisao", headers=gestor)
    assert client.get(caminho).status_code == 404, "em revisão: também não"
    assert client.post(f"/api/parcerias/{id_parceria}/aprovar", headers=aprovador).status_code == 200

    publico = client.get(f"/api/publico/transparencia/parcerias/{id_parceria}").json()
    fotos = publico["etapas"][0]["fotos"]
    assert len(fotos) == 1
    assert set(fotos[0]) == {"id_foto", "alt", "largura", "altura", "sha256", "arquivo"}
    assert fotos[0]["alt"] == ALT and fotos[0]["arquivo"] == caminho
    corpo = client.get(caminho)
    assert corpo.status_code == 200 and corpo.headers["content-type"] == "image/jpeg"
    assert hashlib.sha256(corpo.content).hexdigest() == fotos[0]["sha256"], "o SHA-256 anunciado é o do arquivo servido"
    texto = client.get(f"/api/publico/transparencia/parcerias/{id_parceria}").text
    for proibido in ("arquivo_nome", "id_usuario", "autorizacao_imagem", "id_documento_autorizacao", "fotos-etapas"):
        assert proibido not in texto, proibido


def test_retirar_a_parceria_ou_apagar_a_foto_tira_do_publico_na_hora(client, gestor, aprovador):
    parceria = _publicada(client, gestor, aprovador)
    id_parceria = parceria["id_parceria"]
    id_etapa = _etapa(client, gestor, id_parceria)
    foto = _enviar(client, gestor, id_parceria, id_etapa).json()["etapas"][0]["fotos"][0]
    caminho = f"/api/publico/transparencia/parcerias/{id_parceria}/fotos/{foto['id_foto']}"
    assert client.get(caminho).status_code == 200, "parceria já aprovada: a foto nova vai ao site sem nova aprovação (decisão do presidente)"
    client.delete(f"/api/parcerias/{id_parceria}/fotos/{foto['id_foto']}", headers=gestor)
    assert client.get(caminho).status_code == 404
    assert client.get(f"/api/publico/transparencia/parcerias/{id_parceria}").json()["etapas"][0]["fotos"] == []

    outra = _enviar(client, gestor, id_parceria, id_etapa).json()["etapas"][0]["fotos"][0]
    retirada = f"/api/publico/transparencia/parcerias/{id_parceria}/fotos/{outra['id_foto']}"
    assert client.get(retirada).status_code == 200
    client.post(f"/api/parcerias/{id_parceria}/retirar", json={"motivo": "Retirada para correção dos dados."}, headers=aprovador)
    assert client.get(retirada).status_code == 404


def test_foto_nova_muda_a_ultima_atualizacao_e_a_impressao_do_site(client, gestor, aprovador):
    parceria = _publicada(client, gestor, aprovador)
    id_parceria = parceria["id_parceria"]
    id_etapa = _etapa(client, gestor, id_parceria)
    antes = client.get(f"/api/publico/transparencia/parcerias/{id_parceria}").json()
    _enviar(client, gestor, id_parceria, id_etapa)
    depois = client.get(f"/api/publico/transparencia/parcerias/{id_parceria}").json()
    assert depois["ultima_atualizacao"] > antes["ultima_atualizacao"]
    assert depois["etapas"][0]["fotos"] and not antes["etapas"][0]["fotos"]


def test_detalhe_do_painel_traz_as_fotos_com_a_autorizacao(client, gestor, cenario):
    id_parceria, id_etapa = cenario
    r = _enviar(client, gestor, id_parceria, id_etapa)
    foto = r.json()["etapas"][0]["fotos"][0]
    assert foto["autorizacao_imagem"] is True and foto["alt"] == ALT and foto["id_etapa"] == id_etapa
    assert "arquivo_nome" not in foto
