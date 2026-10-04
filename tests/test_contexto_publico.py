"""v5.5 - Despertai e o contexto do evento.

O projeto principal da associação (o Despertai) é um PROJETO do sistema marcado como destaque; cada edição é um EVENTO ligado a
ele; os relatórios são DOCUMENTOS ligados ao evento (aprovados por outra pessoa, como todo documento); as fotos entram só com a
autorização de imagem; as notícias, que moram no Directus, são ligadas no build do site pelo número. As promessas que estes
testes travam:
  1. projeto e evento se editam (antes só se criavam) e o texto que vai ao site passa pelo verificador de dado pessoal;
  2. só projeto Público fica em destaque; projeto interno nunca é revelado, nem por um evento ligado a ele;
  3. a página pública mostra só o que foi liberado: evento Público, documento Aprovado, foto com autorização de imagem;
  4. foto de evento: sem autorização ou sem descrição nada é guardado; a imagem é regravada sem GPS; apagar tira do site."""
import io
import uuid
from datetime import datetime, timedelta

import pytest
from PIL import Image

from app.models.core import AuditLog
from app.models.eventos import FotoEvento
from app.services import armazenamento
from tests.test_documentos_em_texto import _criar as _criar_documento
from tests.test_documentos_em_texto import _texto, aprovador, preparador  # noqa: F401 - fixtures
from tests.test_documentos_verificacao import CPF_VALIDO
from tests.test_eventos import _ISO, _criar_evento
from tests.test_parcerias import _usuario
from tests.test_parcerias_fotos import ALT, _jpeg, _png_com_transparencia, _webp
from tests.test_projetos import _criar_projeto

RELATORIO = (
    "RELATÓRIO DA 1ª EDIÇÃO DO DESPERTAI\n\nA edição reuniu comunidades de Parauapebas em oficinas, apresentações e rodas de "
    "conversa. As atividades foram gratuitas e abertas ao público."
)


@pytest.fixture(autouse=True)
def _admin_primeiro(admin_token):
    """O admin nasce antes dos usuários de teste, em qualquer ordem de execução."""


@pytest.fixture()
def sem_permissao(db):
    return _usuario(db, "documentos")


def _projeto_publico(client, headers, **extra):
    return _criar_projeto(client, headers, visibilidade="Pública", descricao="Programa de encontros com as comunidades.", **extra)


def _evento_publico(client, headers, id_projeto=None, dias=10, **extra):
    inicio = (datetime.utcnow() + timedelta(days=dias)).strftime(_ISO)
    return _criar_evento(client, headers, visibilidade="Pública", id_projeto=id_projeto, data_hora_inicio=inicio, **extra)


def _enviar_foto(client, headers, id_evento, conteudo=None, alt=ALT, autorizacao="true", nome="foto.jpg", tipo="image/jpeg", **extra):
    return client.post(
        f"/api/eventos/{id_evento}/fotos", data={"alt": alt, "autorizacao_imagem": autorizacao, **extra},
        files={"arquivo": (nome, conteudo if conteudo is not None else _jpeg(), tipo)}, headers=headers,
    )


def _foto(client, headers, id_evento, **extra) -> int:
    r = _enviar_foto(client, headers, id_evento, **extra)
    assert r.status_code == 201, r.text
    return r.json()[-1]["id_foto"]


def _relatorio_aprovado(client, preparador, aprovador, vinculo_tipo, vinculo_id, titulo=None):
    id_documento = _criar_documento(
        client, preparador, tipo="RELATORIO_EVENTO", titulo=titulo or f"Relatório {uuid.uuid4().hex[:6]}", classificacao="Interna",
        vinculo_tipo=vinculo_tipo, vinculo_id=str(vinculo_id),
    )
    assert _texto(client, preparador, id_documento, RELATORIO).status_code == 200
    assert client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=preparador).status_code == 200
    assert client.post(f"/api/documentos/{id_documento}/aprovar", headers=aprovador).status_code == 200
    return id_documento


# ================================================================================ projeto: editar e destaque
def test_editar_projeto_muda_so_o_que_foi_enviado_e_deixa_rastro(client, db, auth_headers):
    id_projeto = _projeto_publico(client, auth_headers, nome_projeto=f"Despertai {uuid.uuid4().hex[:6]}")
    antes = client.get(f"/api/projetos/{id_projeto}", headers=auth_headers).json()
    r = client.put(f"/api/projetos/{id_projeto}", json={"descricao": "Novo texto sobre o programa."}, headers=auth_headers)
    assert r.status_code == 200, r.text
    depois = r.json()
    assert depois["descricao"] == "Novo texto sobre o programa."
    assert {k: v for k, v in depois.items() if k != "descricao"} == {k: v for k, v in antes.items() if k != "descricao"}
    log = db.query(AuditLog).filter(AuditLog.tabela_afetada == "projetos_eventos", AuditLog.id_registro_afetado == id_projeto, AuditLog.acao == "UPDATE").first()
    assert log is not None and "Novo texto" in log.dados_depois


def test_editar_projeto_exige_login_e_permissao(client, auth_headers, sem_permissao):
    id_projeto = _projeto_publico(client, auth_headers)
    assert client.put(f"/api/projetos/{id_projeto}", json={"descricao": "x" * 10}).status_code == 401
    assert client.put(f"/api/projetos/{id_projeto}", json={"descricao": "x" * 10}, headers=sem_permissao).status_code == 403
    assert client.put("/api/projetos/987654", json={"descricao": "x" * 10}, headers=auth_headers).status_code == 404


def test_so_projeto_publico_fica_em_destaque(client, auth_headers):
    interno = _criar_projeto(client, auth_headers, visibilidade="Interna")
    r = client.put(f"/api/projetos/{interno}", json={"destaque_no_site": True}, headers=auth_headers)
    assert r.status_code == 422 and "Público" in r.text
    assert client.post("/projetos/", headers=auth_headers, json={
        "nome_projeto": "Destaque interno", "tipo_foco": "Social", "necessita_alvara_bombeiros": False,
        "data_inicio": datetime.utcnow().strftime(_ISO), "data_fim_prevista": (datetime.utcnow() + timedelta(days=9)).strftime(_ISO),
        "visibilidade": "Interna", "destaque_no_site": True,
    }).status_code == 422
    # visibilidade e destaque podem mudar juntos
    r = client.put(f"/api/projetos/{interno}", json={"visibilidade": "Pública", "destaque_no_site": True}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["destaque_no_site"] is True
    publico = {p["id_projeto"]: p for p in client.get("/api/publico/projetos").json()}
    assert publico[interno]["destaque"] is True
    # voltar a Interna com o destaque ligado também é recusado: não existe projeto interno em destaque
    assert client.put(f"/api/projetos/{interno}", json={"visibilidade": "Interna"}, headers=auth_headers).status_code == 422
    assert client.put(f"/api/projetos/{interno}", json={"visibilidade": "Interna", "destaque_no_site": False}, headers=auth_headers).status_code == 200


def test_projeto_publico_nasce_sem_destaque(client, auth_headers):
    id_projeto = _projeto_publico(client, auth_headers)
    assert client.get(f"/api/publico/projetos/{id_projeto}").json()["destaque"] is False


def test_texto_de_projeto_publico_com_dado_pessoal_e_recusado(client, auth_headers):
    r = client.post("/projetos/", headers=auth_headers, json={
        "nome_projeto": "Projeto com dado", "tipo_foco": "Social", "necessita_alvara_bombeiros": False,
        "data_inicio": datetime.utcnow().strftime(_ISO), "data_fim_prevista": (datetime.utcnow() + timedelta(days=9)).strftime(_ISO),
        "visibilidade": "Pública", "descricao": f"Coordenação: Maria, CPF {CPF_VALIDO}.",
    })
    assert r.status_code == 422 and CPF_VALIDO not in r.text
    id_projeto = _projeto_publico(client, auth_headers)
    r = client.put(f"/api/projetos/{id_projeto}", json={"publico_alvo": f"Falar com 91 98888-7777 ou {CPF_VALIDO}"}, headers=auth_headers)
    assert r.status_code == 422
    # texto de projeto INTERNO não vai ao site: não é barrado
    interno = _criar_projeto(client, auth_headers, visibilidade="Interna", descricao=f"Anotação interna, CPF {CPF_VALIDO}.")
    assert interno


def test_data_de_termino_antes_do_inicio_e_recusada(client, auth_headers):
    id_projeto = _projeto_publico(client, auth_headers)
    r = client.put(
        f"/api/projetos/{id_projeto}", headers=auth_headers,
        json={"data_inicio": "2027-05-10T00:00:00", "data_fim_prevista": "2027-05-01T00:00:00"},
    )
    assert r.status_code == 422


# ================================================================================ evento: projeto e edição
def test_evento_pertence_a_um_projeto_e_a_nova_edicao_segue_no_mesmo(client, auth_headers):
    id_projeto = _projeto_publico(client, auth_headers)
    id_evento = _evento_publico(client, auth_headers, id_projeto=id_projeto)
    assert client.get(f"/api/eventos/{id_evento}", headers=auth_headers).json()["id_projeto"] == id_projeto
    nova = client.post(
        f"/api/eventos/{id_evento}/nova-edicao", headers=auth_headers,
        json={"data_hora_inicio": (datetime.utcnow() + timedelta(days=400)).strftime(_ISO)},
    )
    assert nova.status_code == 200, nova.text
    assert client.get(f"/api/eventos/{nova.json()['id_evento']}", headers=auth_headers).json()["id_projeto"] == id_projeto


def test_evento_de_projeto_que_nao_existe_e_recusado(client, auth_headers):
    r = client.post("/api/eventos/", headers=auth_headers, json={
        "titulo": "Evento órfão", "categoria": "PALESTRA", "data_hora_inicio": (datetime.utcnow() + timedelta(days=3)).strftime(_ISO),
        "id_projeto": 987654,
    })
    assert r.status_code == 404 and "Projeto" in r.text


def test_editar_evento_so_muda_o_que_foi_enviado_e_deixa_rastro(client, db, auth_headers):
    id_projeto = _projeto_publico(client, auth_headers)
    id_evento = _evento_publico(client, auth_headers)
    r = client.put(f"/api/eventos/{id_evento}", json={"titulo": "Despertai 2026", "id_projeto": id_projeto}, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["titulo"] == "Despertai 2026" and r.json()["id_projeto"] == id_projeto
    assert r.json()["visibilidade"] == "Pública", "o que não foi enviado não muda"
    # null desliga o evento do projeto
    r = client.put(f"/api/eventos/{id_evento}", json={"id_projeto": None}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["id_projeto"] is None and r.json()["titulo"] == "Despertai 2026"
    log = db.query(AuditLog).filter(AuditLog.tabela_afetada == "eventos", AuditLog.id_registro_afetado == id_evento, AuditLog.acao == "UPDATE").first()
    assert log is not None


def test_editar_evento_exige_login_e_permissao(client, auth_headers, sem_permissao):
    id_evento = _evento_publico(client, auth_headers)
    assert client.put(f"/api/eventos/{id_evento}", json={"titulo": "Outro título"}).status_code == 401
    assert client.put(f"/api/eventos/{id_evento}", json={"titulo": "Outro título"}, headers=sem_permissao).status_code == 403
    assert client.put("/api/eventos/987654", json={"titulo": "Outro título"}, headers=auth_headers).status_code == 404


@pytest.mark.parametrize(
    "corpo,trecho",
    [
        ({"titulo": ""}, "pelo menos 3"),
        ({"titulo": None}, "vazio"),
        ({"categoria": "CATEGORIA_QUE_NAO_EXISTE"}, ""),
        ({"visibilidade": "Secreta"}, ""),
        ({"id_projeto": 987654}, "Projeto"),
        ({"id_espaco": 987654}, "Espaço"),
        ({"data_hora_fim": "2000-01-01T00:00:00"}, "depois do início"),
        ({"descricao": f"Contato: Maria, CPF {CPF_VALIDO}"}, "dado pessoal"),
    ],
    ids=["titulo-curto", "titulo-nulo", "categoria", "visibilidade", "projeto", "espaco", "fim-antes-do-inicio", "dado-pessoal"],
)
def test_edicao_invalida_de_evento_e_recusada(client, auth_headers, corpo, trecho):
    id_evento = _evento_publico(client, auth_headers)
    r = client.put(f"/api/eventos/{id_evento}", json=corpo, headers=auth_headers)
    assert r.status_code in (404, 422), r.text
    assert trecho in r.text
    assert CPF_VALIDO not in r.text.replace("CPF " + CPF_VALIDO, "")


def test_limite_de_vagas_nao_pode_ficar_abaixo_das_vagas_ocupadas(client, db, auth_headers):
    from app.models.eventos import Evento

    id_evento = _evento_publico(client, auth_headers, vagas=20)
    evento = db.query(Evento).filter(Evento.id_evento == id_evento).first()
    evento.vagas_ocupadas = 8
    db.commit()
    r = client.put(f"/api/eventos/{id_evento}", json={"vagas": 5}, headers=auth_headers)
    assert r.status_code == 422 and "8 vagas ocupadas" in r.text
    assert client.put(f"/api/eventos/{id_evento}", json={"vagas": 8}, headers=auth_headers).status_code == 200


def test_evento_publico_com_dado_pessoal_na_criacao_e_recusado_mas_interno_nao(client, auth_headers):
    inicio = (datetime.utcnow() + timedelta(days=5)).strftime(_ISO)
    base = {"titulo": "Encontro", "categoria": "PALESTRA", "data_hora_inicio": inicio, "descricao": f"Falar com Maria, CPF {CPF_VALIDO}"}
    assert client.post("/api/eventos/", headers=auth_headers, json={**base, "visibilidade": "Pública"}).status_code == 422
    assert client.post("/api/eventos/", headers=auth_headers, json={**base, "visibilidade": "Interna"}).status_code == 200


# ================================================================================ fotos do evento
def test_foto_exige_login_e_permissao(client, auth_headers, sem_permissao):
    id_evento = _evento_publico(client, auth_headers)
    assert client.post(f"/api/eventos/{id_evento}/fotos", data={"alt": ALT, "autorizacao_imagem": "true"}, files={"arquivo": ("a.jpg", _jpeg(), "image/jpeg")}).status_code == 401
    assert _enviar_foto(client, sem_permissao, id_evento).status_code == 403
    id_foto = _foto(client, auth_headers, id_evento)
    assert client.get(f"/api/eventos/{id_evento}/fotos").status_code == 401
    assert client.get(f"/api/eventos/{id_evento}/fotos/{id_foto}/arquivo").status_code == 401
    assert client.get(f"/api/eventos/{id_evento}/fotos/{id_foto}/arquivo", headers=sem_permissao).status_code == 403
    assert client.delete(f"/api/eventos/{id_evento}/fotos/{id_foto}", headers=sem_permissao).status_code == 403
    assert client.get(f"/api/eventos/{id_evento}/fotos/{id_foto}/arquivo", headers=auth_headers).status_code == 200


@pytest.mark.parametrize("autorizacao", ["false", ""])
def test_sem_autorizacao_de_imagem_nada_e_guardado(client, db, auth_headers, autorizacao):
    id_evento = _evento_publico(client, auth_headers)
    r = _enviar_foto(client, auth_headers, id_evento, autorizacao=autorizacao)
    assert r.status_code == 400 and "autorização" in r.text
    assert db.query(FotoEvento).filter(FotoEvento.id_evento == id_evento).count() == 0


@pytest.mark.parametrize("alt", ["", "curta", "x" * 301])
def test_descricao_da_foto_e_obrigatoria_e_tem_tamanho(client, db, auth_headers, alt):
    id_evento = _evento_publico(client, auth_headers)
    r = _enviar_foto(client, auth_headers, id_evento, alt=alt)
    assert r.status_code == 400 and "Descreva a foto" in r.text
    assert db.query(FotoEvento).filter(FotoEvento.id_evento == id_evento).count() == 0


def test_descricao_com_dado_pessoal_e_recusada(client, auth_headers):
    id_evento = _evento_publico(client, auth_headers)
    r = _enviar_foto(client, auth_headers, id_evento, alt=f"Foto da Maria, CPF {CPF_VALIDO}, na quadra")
    assert r.status_code == 422 and CPF_VALIDO not in r.text


def test_termo_de_autorizacao_ligado_precisa_existir(client, auth_headers):
    id_evento = _evento_publico(client, auth_headers)
    assert _enviar_foto(client, auth_headers, id_evento, id_documento_autorizacao="999999").status_code == 404


def test_a_imagem_e_regravada_sem_gps_nem_aparelho_e_com_a_rotacao_aplicada(client, db, auth_headers):
    id_evento = _evento_publico(client, auth_headers)
    original = _jpeg(tamanho=(200, 100), com_exif=True, orientacao=6)  # o celular só anotou "gire 90 graus"
    assert b"FabricanteSecreto" in original and b"ModeloDoAparelho" in original
    id_foto = _foto(client, auth_headers, id_evento, conteudo=original)
    guardada = client.get(f"/api/eventos/{id_evento}/fotos/{id_foto}/arquivo", headers=auth_headers).content
    assert b"FabricanteSecreto" not in guardada and b"ModeloDoAparelho" not in guardada and b"Exif" not in guardada
    imagem = Image.open(io.BytesIO(guardada))
    assert imagem.format == "JPEG" and imagem.size == (100, 200), "a rotação foi aplicada"
    assert not imagem.getexif(), "nenhum metadado ficou"
    foto = db.query(FotoEvento).filter(FotoEvento.id_foto == id_foto).first()
    assert (foto.largura, foto.altura) == (100, 200) and foto.tamanho == len(guardada)


def test_foto_grande_e_reduzida_e_png_e_webp_viram_jpeg(client, auth_headers):
    id_evento = _evento_publico(client, auth_headers)
    grande = io.BytesIO()
    Image.new("RGB", (3000, 1000), (10, 90, 200)).save(grande, format="JPEG")
    for nome, conteudo, tipo in (
        ("grande.jpg", grande.getvalue(), "image/jpeg"), ("a.png", _png_com_transparencia(), "image/png"), ("a.webp", _webp(), "image/webp"),
    ):
        id_foto = _foto(client, auth_headers, id_evento, conteudo=conteudo, nome=nome, tipo=tipo)
        imagem = Image.open(io.BytesIO(client.get(f"/api/eventos/{id_evento}/fotos/{id_foto}/arquivo", headers=auth_headers).content))
        assert imagem.format == "JPEG" and max(imagem.size) <= 2000
        if nome == "grande.jpg":
            assert imagem.size == (2000, 667)


@pytest.mark.parametrize(
    "conteudo,nome,tipo",
    [(b"MZ\x90\x00 isto nao e imagem", "foto.jpg", "image/jpeg"), (b"<svg onload=alert(1)></svg>", "foto.svg", "image/svg+xml"),
     (b"\xff\xd8\xff\xe0 jpeg quebrado", "foto.jpg", "image/jpeg"), (b"", "vazia.jpg", "image/jpeg")],
    ids=["executavel", "svg", "jpeg-quebrado", "vazia"],
)
def test_arquivo_que_nao_e_imagem_de_verdade_e_recusado(client, db, auth_headers, conteudo, nome, tipo):
    id_evento = _evento_publico(client, auth_headers)
    assert _enviar_foto(client, auth_headers, id_evento, conteudo=conteudo, nome=nome, tipo=tipo).status_code == 400
    assert db.query(FotoEvento).filter(FotoEvento.id_evento == id_evento).count() == 0


def test_foto_acima_de_10_mb_e_recusada(client, auth_headers):
    id_evento = _evento_publico(client, auth_headers)
    assert _enviar_foto(client, auth_headers, id_evento, conteudo=b"\xff\xd8\xff" + b"0" * (10 * 1024 * 1024 + 1)).status_code == 400


def test_limite_de_fotos_por_evento(client, auth_headers, monkeypatch):
    monkeypatch.setattr("app.services.eventos_fotos.FOTOS_POR_EVENTO", 2)
    id_evento = _evento_publico(client, auth_headers)
    _foto(client, auth_headers, id_evento)
    _foto(client, auth_headers, id_evento)
    r = _enviar_foto(client, auth_headers, id_evento)
    assert r.status_code == 409 and "máximo" in r.text


def test_apagar_a_foto_tira_do_banco_do_armazenamento_e_do_site(client, db, auth_headers):
    id_evento = _evento_publico(client, auth_headers)
    id_foto = _foto(client, auth_headers, id_evento)
    nome = db.query(FotoEvento).filter(FotoEvento.id_foto == id_foto).first().arquivo_nome
    assert armazenamento.obter().ler("fotos-eventos", nome) is not None
    assert client.get(f"/api/publico/eventos/{id_evento}/fotos/{id_foto}").status_code == 200
    r = client.delete(f"/api/eventos/{id_evento}/fotos/{id_foto}", headers=auth_headers)
    assert r.status_code == 200 and r.json() == []
    db.expire_all()
    assert db.query(FotoEvento).filter(FotoEvento.id_foto == id_foto).count() == 0
    assert armazenamento.obter().ler("fotos-eventos", nome) is None
    assert client.get(f"/api/publico/eventos/{id_evento}/fotos/{id_foto}").status_code == 404
    assert client.get(f"/api/publico/eventos/{id_evento}").json()["fotos"] == []
    log = db.query(AuditLog).filter(AuditLog.tabela_afetada == "eventos", AuditLog.id_registro_afetado == id_evento, AuditLog.acao == "FOTO_APAGADA").first()
    assert log is not None


def test_foto_de_outro_evento_nao_e_alcancada_pelo_numero(client, auth_headers):
    a, b = _evento_publico(client, auth_headers), _evento_publico(client, auth_headers)
    id_foto = _foto(client, auth_headers, a)
    assert client.get(f"/api/eventos/{b}/fotos/{id_foto}/arquivo", headers=auth_headers).status_code == 404
    assert client.delete(f"/api/eventos/{b}/fotos/{id_foto}", headers=auth_headers).status_code == 404
    assert client.get(f"/api/publico/eventos/{b}/fotos/{id_foto}").status_code == 404


def test_o_publico_so_recebe_foto_de_evento_publico_e_com_autorizacao(client, db, auth_headers):
    interno = _criar_evento(client, auth_headers, visibilidade="Interna")
    id_foto_interna = _foto(client, auth_headers, interno)
    inexistente = client.get("/api/publico/eventos/987654/fotos/1")
    assert client.get(f"/api/publico/eventos/{interno}/fotos/{id_foto_interna}").status_code == inexistente.status_code == 404
    assert client.get(f"/api/publico/eventos/{interno}/fotos/{id_foto_interna}").json() == inexistente.json()

    publico = _evento_publico(client, auth_headers)
    id_foto = _foto(client, auth_headers, publico)
    r = client.get(f"/api/publico/eventos/{publico}/fotos/{id_foto}")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg" and r.headers["x-content-type-options"] == "nosniff"
    assert r.content[:3] == b"\xff\xd8\xff"
    # uma linha sem a autorização (não nasce pela API, mas o banco poderia ter) nunca é servida nem listada
    foto = db.query(FotoEvento).filter(FotoEvento.id_foto == id_foto).first()
    foto.autorizacao_imagem = False
    db.commit()
    assert client.get(f"/api/publico/eventos/{publico}/fotos/{id_foto}").status_code == 404
    assert client.get(f"/api/publico/eventos/{publico}").json()["fotos"] == []
    # e virar Interna tira a foto do ar na hora
    foto.autorizacao_imagem = True
    db.commit()
    assert client.put(f"/api/eventos/{publico}", json={"visibilidade": "Interna"}, headers=auth_headers).status_code == 200
    assert client.get(f"/api/publico/eventos/{publico}/fotos/{id_foto}").status_code == 404


# ================================================================================ página pública do evento
CAMPOS_FOTO_PUBLICA = {"id_foto", "alt", "largura", "altura", "tamanho", "sha256", "arquivo"}


def test_detalhe_publico_do_evento_traz_o_contexto_com_campos_explicitos(client, auth_headers, preparador, aprovador):
    id_projeto = _projeto_publico(client, auth_headers, nome_projeto="Despertai")
    primeira = _evento_publico(client, auth_headers, id_projeto=id_projeto, dias=-400, titulo="Despertai 2025")
    segunda = client.post(
        f"/api/eventos/{primeira}/nova-edicao", headers=auth_headers,
        json={"data_hora_inicio": (datetime.utcnow() + timedelta(days=20)).strftime(_ISO), "titulo": "Despertai 2026"},
    ).json()["id_evento"]
    interna = client.post(
        f"/api/eventos/{segunda}/nova-edicao", headers=auth_headers,
        json={"data_hora_inicio": (datetime.utcnow() + timedelta(days=500)).strftime(_ISO), "titulo": "Despertai 2027 (ainda interna)"},
    ).json()["id_evento"]
    assert client.put(f"/api/eventos/{interna}", json={"visibilidade": "Interna"}, headers=auth_headers).status_code == 200
    id_foto = _foto(client, auth_headers, segunda)
    id_relatorio = _relatorio_aprovado(client, preparador, aprovador, "evento", segunda, titulo="Relatório do Despertai 2026")
    rascunho = _criar_documento(client, preparador, tipo="RELATORIO_EVENTO", titulo="Rascunho de relatório", vinculo_tipo="evento", vinculo_id=str(segunda))
    assert rascunho

    r = client.get(f"/api/publico/eventos/{segunda}")
    assert r.status_code == 200
    corpo = r.json()
    assert corpo["id_projeto"] == id_projeto and corpo["projeto"] == {"id_projeto": id_projeto, "nome": "Despertai"}
    assert [(e["id_evento"], e["atual"]) for e in corpo["edicoes"]] == [(primeira, False), (segunda, True)], "só edições Públicas, da mais antiga à mais nova"
    assert [d["id_documento"] for d in corpo["documentos"]] == [id_relatorio], "só o documento APROVADO, ligado a este evento"
    assert corpo["documentos"][0]["vinculo_tipo"] == "evento" and corpo["documentos"][0]["vinculo_id"] == segunda
    assert len(corpo["fotos"]) == 1 and set(corpo["fotos"][0]) == CAMPOS_FOTO_PUBLICA and corpo["fotos"][0]["id_foto"] == id_foto
    assert corpo["fotos"][0]["arquivo"] == f"/api/publico/eventos/{segunda}/fotos/{id_foto}"
    for proibido in ("arquivo_nome", "fotos-eventos", "id_usuario", "id_documento_autorizacao", "autorizacao_imagem", "situacao"):
        assert proibido not in r.text


def test_evento_de_projeto_interno_nao_revela_o_projeto(client, auth_headers):
    interno = _criar_projeto(client, auth_headers, visibilidade="Interna", nome_projeto="Projeto reservado")
    id_evento = _evento_publico(client, auth_headers, id_projeto=interno)
    detalhe = client.get(f"/api/publico/eventos/{id_evento}").json()
    assert detalhe["id_projeto"] is None and detalhe["projeto"] is None
    assert "Projeto reservado" not in client.get(f"/api/publico/eventos/{id_evento}").text
    na_lista = next(e for e in client.get("/api/publico/eventos").json() if e["id_evento"] == id_evento)
    assert na_lista["id_projeto"] is None
    assert client.get(f"/api/publico/projetos/{interno}").status_code == 404


def test_evento_interno_continua_sem_pagina_publica(client, auth_headers):
    interno = _criar_evento(client, auth_headers, visibilidade="Interna")
    assert client.get(f"/api/publico/eventos/{interno}").status_code == 404


# ================================================================================ página pública do projeto
def test_detalhe_publico_do_projeto_traz_edicoes_relatorios_e_fotos(client, auth_headers, preparador, aprovador):
    id_projeto = _projeto_publico(client, auth_headers, nome_projeto="Despertai")
    antiga = _evento_publico(client, auth_headers, id_projeto=id_projeto, dias=-400, titulo="Despertai 2025")
    nova = _evento_publico(client, auth_headers, id_projeto=id_projeto, dias=30, titulo="Despertai 2026")
    interna = _criar_evento(client, auth_headers, visibilidade="Interna", id_projeto=id_projeto, titulo="Reunião interna do Despertai")
    avulso = _evento_publico(client, auth_headers, titulo="Evento de outro projeto")
    foto = _foto(client, auth_headers, antiga)
    relatorio_do_evento = _relatorio_aprovado(client, preparador, aprovador, "evento", antiga)
    relatorio_do_projeto = _relatorio_aprovado(client, preparador, aprovador, "projeto", id_projeto)
    relatorio_de_outro = _relatorio_aprovado(client, preparador, aprovador, "evento", avulso)

    r = client.get(f"/api/publico/projetos/{id_projeto}")
    assert r.status_code == 200
    corpo = r.json()
    assert [e["id_evento"] for e in corpo["eventos"]] == [nova, antiga], "o mais recente primeiro; o interno e o de outro projeto não entram"
    assert interna not in [e["id_evento"] for e in corpo["eventos"]] and avulso not in [e["id_evento"] for e in corpo["eventos"]]
    assert {d["id_documento"] for d in corpo["documentos"]} == {relatorio_do_evento, relatorio_do_projeto}
    assert relatorio_de_outro not in {d["id_documento"] for d in corpo["documentos"]}
    assert [f["id_foto"] for f in corpo["fotos"]] == [foto] and corpo["fotos"][0]["id_evento"] == antiga
    assert set(corpo["fotos"][0]) == CAMPOS_FOTO_PUBLICA | {"id_evento"}
    for proibido in ("Reunião interna", "arquivo_nome", "id_centro_custo", "responsavel"):
        assert proibido not in r.text


def test_galeria_do_projeto_mostra_so_as_12_fotos_mais_recentes(client, db, auth_headers):
    id_projeto = _projeto_publico(client, auth_headers)
    id_evento = _evento_publico(client, auth_headers, id_projeto=id_projeto)
    for i in range(14):
        db.add(FotoEvento(id_evento=id_evento, arquivo_nome=f"x{i}.jpg", sha256="0" * 64, tamanho=1, largura=1, altura=1, alt=ALT, autorizacao_imagem=True))
    db.commit()
    fotos = client.get(f"/api/publico/projetos/{id_projeto}").json()["fotos"]
    assert len(fotos) == 12
    assert [f["id_foto"] for f in fotos] == sorted((f["id_foto"] for f in fotos), reverse=True)


def test_projeto_sem_nada_ligado_responde_listas_vazias(client, auth_headers):
    id_projeto = _projeto_publico(client, auth_headers)
    corpo = client.get(f"/api/publico/projetos/{id_projeto}").json()
    assert corpo["eventos"] == [] and corpo["documentos"] == [] and corpo["fotos"] == []


# ================================================================================ relatórios = documentos ligados
def test_relatorio_de_evento_e_um_tipo_de_documento_e_o_vinculo_tem_que_existir(client, preparador):
    tipos = {t["codigo"]: t["rotulo"] for t in client.get("/api/documentos/tipos", headers=preparador).json()["tipos"]}
    assert tipos["RELATORIO_EVENTO"] == "Relatório de evento ou de projeto"
    dados = {"tipo": "RELATORIO_EVENTO", "titulo": "Relatório sem evento", "classificacao": "Interna", "publicar_no_site": "true", "vinculo_tipo": "evento", "vinculo_id": "987654"}
    r = client.post("/api/documentos", data=dados, headers=preparador)
    assert r.status_code == 404 and "Evento nº 987654" in r.text
    r = client.post("/api/documentos", data={**dados, "vinculo_tipo": "projeto"}, headers=preparador)
    assert r.status_code == 404 and "Projeto nº 987654" in r.text


def test_editar_o_vinculo_do_documento_tambem_confere_se_existe(client, auth_headers, preparador):
    id_evento = _evento_publico(client, auth_headers)
    id_documento = _criar_documento(client, preparador, tipo="RELATORIO_EVENTO", vinculo_tipo="evento", vinculo_id=str(id_evento))
    r = client.patch(f"/api/documentos/{id_documento}", json={"vinculo_tipo": "evento", "vinculo_id": 987654}, headers=preparador)
    assert r.status_code == 404, r.text


def test_so_o_vinculo_com_evento_ou_projeto_aparece_no_documento_publico(client, preparador, aprovador):
    from tests.test_documentos_em_texto import _publicado

    id_documento = _publicado(client, preparador, aprovador)  # ligado a nada
    publico = next(d for d in client.get("/api/publico/transparencia/documentos").json() if d["id_documento"] == id_documento)
    assert publico["vinculo_tipo"] is None and publico["vinculo_id"] is None


def test_relatorio_aprovado_que_e_retirado_sai_da_pagina_do_evento(client, auth_headers, preparador, aprovador):
    id_evento = _evento_publico(client, auth_headers)
    id_documento = _relatorio_aprovado(client, preparador, aprovador, "evento", id_evento)
    assert [d["id_documento"] for d in client.get(f"/api/publico/eventos/{id_evento}").json()["documentos"]] == [id_documento]
    r = client.post(f"/api/documentos/{id_documento}/retirar", json={"motivo": "Relatório com erro, será refeito."}, headers=aprovador)
    assert r.status_code == 200, r.text
    assert client.get(f"/api/publico/eventos/{id_evento}").json()["documentos"] == []
