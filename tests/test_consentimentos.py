"""v7.1b (FASE 7) - o registro dos consentimentos (app/services/consentimentos.py): a prova do termo de imagem que a pessoa assinou.

  1. enviar uma foto registra o consentimento (termo e versão em vigor, quem autorizou, como, o documento, quem registrou); sem quem, sem o meio, com o termo
     digitalizado sem o documento ou com a versão velha do termo, a foto é recusada e NADA fica gravado;
  2. apagar a foto encerra o consentimento (revogado, com o motivo, ou apagado) e o encerrado fica como prova; trocar a foto da Diretoria encerra o anterior; o fim do
     mandato encerra como "fim do prazo"; apagar a etapa da parceria encerra os das fotos dela;
  3. a lista (Privacidade > Consentimentos) é de quem tem `privacidade`; o termo em vigor e o PDF para assinar, de quem está logado;
  4. a migração 7c4e1a9d2b63 registra as fotos que já existiam como "declaração antiga" e cria exatamente a tabela do modelo."""
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
from app.models.eventos import FotoEvento
from app.models.mandatos import Mandato
from app.models.parcerias import FotoEtapaParceria
from app.models.privacidade import APAGADO, FIM_DO_PRAZO, REVOGADO, Consentimento
from app.services import consentimentos as servico
from app.services import fotos_da_diretoria
from tests.test_conselho_fiscal import _criar_associado, _headers
from tests.test_contexto_publico import _enviar_foto, _evento_publico, _foto, _projeto_publico
from tests.test_foto_da_diretoria import _jpeg, _novo_dirigente
from tests.test_parcerias_fotos import _criar, _enviar as _enviar_foto_da_etapa, _etapa
from tests.test_parcerias_fotos import gestor  # noqa: F401  (fixture)


def _consentimentos(db, origem, id_origem, desde: int = 0):
    """Os consentimentos de um registro (a partir de `desde`: o SQLite dos testes reaproveita o número de uma foto apagada; o Postgres não)."""
    db.expire_all()
    return db.query(Consentimento).filter(Consentimento.origem == origem, Consentimento.id_origem == id_origem,
                                          Consentimento.id_consentimento > desde).order_by(Consentimento.id_consentimento).all()


def _ultimo_id(db) -> int:
    from sqlalchemy import func

    return db.query(func.max(Consentimento.id_consentimento)).scalar() or 0


# ------------------------------------------------------------------------------------------------ 1. enviar registra; o que falta é recusado sem gravar nada
def test_enviar_a_foto_do_evento_registra_o_consentimento(client, db, auth_headers):
    desde = _ultimo_id(db)
    id_evento = _evento_publico(client, auth_headers, id_projeto=_projeto_publico(client, auth_headers))
    id_foto = _foto(client, auth_headers, id_evento, quem_autorizou="  Joana   da Silva  (mãe da Ana)  ")
    [c] = _consentimentos(db, servico.FOTO_DE_EVENTO, id_foto, desde)
    assert (c.ponto, c.versao, c.meio, c.encerrado_em) == ("IMAGEM_ATIVIDADE", tp.versao_atual("IMAGEM_ATIVIDADE"), servico.TERMO_EM_PAPEL, None)
    assert c.titular == "Joana da Silva (mãe da Ana)" and c.id_usuario_registro is not None
    assert c.dado_em.date() == (datetime.utcnow() - timedelta(days=1)).date(), "vale a data em que o termo foi assinado, não a do envio da foto"
    no_painel = client.get(f"/api/eventos/{id_evento}/fotos", headers=auth_headers).json()[-1]["consentimento"]
    assert no_painel["termo"] == "IMAGEM_ATIVIDADE" and no_painel["meio_rotulo"].startswith("Termo assinado em papel") and no_painel["titular"] == c.titular


def test_sem_quem_sem_meio_sem_documento_ou_com_termo_velho_a_foto_nao_entra(client, db, auth_headers):
    id_evento = _evento_publico(client, auth_headers, id_projeto=_projeto_publico(client, auth_headers))
    antes_fotos, antes_consentimentos = db.query(FotoEvento).count(), db.query(Consentimento).count()
    assert _enviar_foto(client, auth_headers, id_evento, quem_autorizou="").status_code == 400
    assert _enviar_foto(client, auth_headers, id_evento, meio="verbal").status_code == 400
    assert _enviar_foto(client, auth_headers, id_evento, assinado_em="").status_code == 400, "sem a data da assinatura"
    futura = _enviar_foto(client, auth_headers, id_evento, assinado_em=(date.today() + timedelta(days=3)).isoformat())
    assert futura.status_code == 400 and "depois de hoje" in futura.json()["detail"]
    r = _enviar_foto(client, auth_headers, id_evento, meio=servico.TERMO_DIGITALIZADO)
    assert r.status_code == 400 and "número do documento" in r.json()["detail"]
    velho = _enviar_foto(client, auth_headers, id_evento, versao_do_termo="1")
    assert velho.status_code == 422 and "recarregue" in velho.json()["detail"]
    assert _enviar_foto(client, auth_headers, id_evento, meio=servico.TERMO_DIGITALIZADO, id_documento_autorizacao="999999").status_code == 404
    db.expire_all()
    assert (db.query(FotoEvento).count(), db.query(Consentimento).count()) == (antes_fotos, antes_consentimentos), "nada fica gravado"


# ------------------------------------------------------------------------------------------------ 2. apagar encerra; o encerrado fica
def test_apagar_a_foto_encerra_o_consentimento_e_ele_fica_como_prova(client, db, auth_headers):
    desde = _ultimo_id(db)
    id_evento = _evento_publico(client, auth_headers, id_projeto=_projeto_publico(client, auth_headers))
    revogada, errada = _foto(client, auth_headers, id_evento), _foto(client, auth_headers, id_evento)
    # o motivo vai no CORPO (o endereço fica no registro de acesso do servidor)
    r = client.request("DELETE", f"/api/eventos/{id_evento}/fotos/{revogada}", json={"revogado": True, "motivo": "A mãe pediu por telefone em 27/10."},
                       headers=auth_headers)
    assert r.status_code == 200, r.text
    assert client.delete(f"/api/eventos/{id_evento}/fotos/{errada}", headers=auth_headers).status_code == 200
    [c1] = _consentimentos(db, servico.FOTO_DE_EVENTO, revogada, desde)
    [c2] = _consentimentos(db, servico.FOTO_DE_EVENTO, errada, desde)
    assert (c1.encerramento, c1.motivo_encerramento) == (REVOGADO, "A mãe pediu por telefone em 27/10.") and c1.encerrado_em is not None
    assert c2.encerramento == APAGADO and c2.id_usuario_encerramento is not None
    assert db.get(FotoEvento, revogada) is None, "revogar é apagar a foto"


def test_a_foto_da_diretoria_troca_revoga_e_acaba_com_o_mandato(client, db, auth_headers):
    desde = _ultimo_id(db)
    dirigente, id_mandato = _novo_dirigente(db, client=client, auth_headers=auth_headers)
    rota = f"/api/mandatos/associados/{dirigente.id_associado}/foto-publica"
    dados = {"autorizacao_imagem": "true", "meio": servico.TERMO_EM_PAPEL, "versao_do_termo": tp.versao_atual("IMAGEM_DIRETORIA"), "assinado_em": "2026-10-20"}
    primeira = client.post(rota, headers=auth_headers, files={"arquivo": ("a.jpg", _jpeg(), "image/jpeg")}, data=dados)
    assert primeira.status_code == 201, primeira.text
    id_foto = primeira.json()["foto"]["id_foto"]
    [c] = _consentimentos(db, servico.FOTO_DA_DIRETORIA, id_foto, desde)
    assert c.ponto == "IMAGEM_DIRETORIA" and c.titular == dirigente.nome_completo and c.dado_por == "titular" and c.id_pessoa == dirigente.id_pessoa
    assert primeira.json()["foto"]["consentimento"]["titular"] == dirigente.nome_completo

    assert client.post(rota, headers=auth_headers, files={"arquivo": ("b.jpg", _jpeg(cor=(10, 10, 200)), "image/jpeg")}, data=dados).status_code == 201
    anterior, novo = _consentimentos(db, servico.FOTO_DA_DIRETORIA, id_foto, desde)
    assert (anterior.encerramento, anterior.motivo_encerramento) == (APAGADO, "A foto foi trocada por outra.") and novo.encerrado_em is None

    assert client.request("DELETE", rota, json={"motivo": "Pediu na reunião de 27/10."}, headers=auth_headers).status_code == 200
    assert _consentimentos(db, servico.FOTO_DA_DIRETORIA, id_foto, desde)[-1].encerramento == REVOGADO, "na Diretoria, apagar é porque a pessoa retirou"

    # o fim do mandato encerra como "fim do prazo"
    assert client.post(rota, headers=auth_headers, files={"arquivo": ("c.jpg", _jpeg(), "image/jpeg")}, data=dados).status_code == 201
    foto = fotos_da_diretoria.foto_da_pessoa(db, dirigente.id_pessoa)
    mandato = db.get(Mandato, id_mandato)
    mandato.data_fim_efetivo = datetime.utcnow() - timedelta(days=1)
    db.commit()
    assert fotos_da_diretoria.apagar_foto_se_sem_mandato(db, dirigente.id_associado) is True
    ultimo = _consentimentos(db, servico.FOTO_DA_DIRETORIA, foto.id_foto, desde)[-1]
    assert ultimo.encerramento == FIM_DO_PRAZO and "mandato" in ultimo.motivo_encerramento


def test_apagar_a_etapa_encerra_os_consentimentos_das_fotos_dela(client, db, gestor):  # noqa: F811
    desde = _ultimo_id(db)
    id_parceria = _criar(client, gestor)["id_parceria"]
    id_etapa = _etapa(client, gestor, id_parceria)
    r = _enviar_foto_da_etapa(client, gestor, id_parceria, id_etapa)
    assert r.status_code == 201, r.text
    id_foto = r.json()["etapas"][-1]["fotos"][0]["id_foto"]
    assert r.json()["etapas"][-1]["fotos"][0]["consentimento"]["termo"] == "IMAGEM_ATIVIDADE"
    assert client.delete(f"/api/parcerias/{id_parceria}/etapas/{id_etapa}", headers=gestor).status_code == 200
    [c] = _consentimentos(db, servico.FOTO_DE_ETAPA, id_foto, desde)
    assert c.encerramento == APAGADO and "etapa" in c.motivo_encerramento
    assert db.get(FotoEtapaParceria, id_foto) is None


# ------------------------------------------------------------------------------------------------ 3. quem vê
def test_a_lista_e_de_quem_cuida_da_privacidade_e_o_termo_de_quem_esta_logado(client, db, auth_headers):
    id_evento = _evento_publico(client, auth_headers, id_projeto=_projeto_publico(client, auth_headers))
    id_foto = _foto(client, auth_headers, id_evento)
    client.request("DELETE", f"/api/eventos/{id_evento}/fotos/{id_foto}", json={"revogado": True}, headers=auth_headers)
    lista = client.get("/api/privacidade/consentimentos", params={"situacao": "encerrados", "origem": servico.FOTO_DE_EVENTO}, headers=auth_headers)
    assert lista.status_code == 200
    assert any(c["id_origem"] == id_foto and c["encerramento"] == REVOGADO for c in lista.json()["consentimentos"])
    assert all(c["encerrado_em"] for c in lista.json()["consentimentos"])
    # a busca pelo nome de quem assinou (quem revoga a autorização de atividade tem TODAS as fotos em que aparece apagadas) e as páginas
    unico = f"Signatária de Teste {uuid.uuid4().hex[:6]}"  # (o SQLite dos testes não põe em minúscula letra acentuada maiúscula; o Postgres põe)
    for _ in range(2):
        _foto(client, auth_headers, id_evento, quem_autorizou=unico)
    achados = client.get("/api/privacidade/consentimentos", params={"busca": unico.lower()}, headers=auth_headers).json()
    assert achados["total"] == 2 and {c["titular"] for c in achados["consentimentos"]} == {unico}
    assert achados["por_pagina"] == servico.POR_PAGINA and achados["pagina"] == 1
    assert client.get("/api/privacidade/consentimentos", params={"busca": unico, "pagina": 2}, headers=auth_headers).json()["consentimentos"] == []

    _, associado = _criar_associado(db, f"Associado Termo {uuid.uuid4().hex[:6]}", nome_nivel="Associado")
    h = _headers(associado)
    assert client.get("/api/privacidade/consentimentos", headers=h).status_code == 403
    termo = client.get("/api/consentimentos/termo-da-tela/foto_de_evento", headers=h)
    assert termo.status_code == 200 and termo.json()["versao"] == tp.versao_atual("IMAGEM_ATIVIDADE") and "art. 14, § 1º" in termo.json()["texto"]
    assert [m["codigo"] for m in termo.json()["meios"]] == [servico.TERMO_EM_PAPEL, servico.TERMO_DIGITALIZADO]
    pdf = client.get("/api/consentimentos/termos/IMAGEM_DIRETORIA/pdf", headers=h)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    texto = " ".join(p.extract_text() for p in pypdf.PdfReader(io.BytesIO(pdf.content)).pages)
    assert "TERMO DE AUTORIZAÇÃO DE USO DE IMAGEM" in texto and "Assinatura" in texto and f"versão {tp.versao_atual('IMAGEM_DIRETORIA')}" in texto
    assert client.get("/api/consentimentos/termos/FILIACAO/pdf", headers=h).status_code == 404
    assert client.get("/api/consentimentos/termo-da-tela/beneficiario", headers=h).status_code == 404
    assert client.get("/api/consentimentos/termo-da-tela/foto_de_evento").status_code == 401


def test_os_termos_dizem_o_que_o_sistema_faz():
    """O termo é assinado pela pessoa: cada afirmação tem de ser verdade no código."""
    diretoria = tp.atual("IMAGEM_DIRETORIA").texto
    assert "o sistema apaga a foto sozinho" in diretoria and hasattr(fotos_da_diretoria, "apagar_fotos_sem_mandato")
    for termo in ("IMAGEM_DIRETORIA", "IMAGEM_ATIVIDADE"):
        t = tp.atual(termo)
        assert tp.tipo_da_versao(t) == tp.CONSENTIMENTO and "sem localização nem dados do aparelho" in t.texto and "a qualquer momento, sem custo" in t.texto
        assert tp.buscar(termo, "1").reconstituido and "declaração" in tp.buscar(termo, "1").observacao.lower()
        assert "cópia de segurança por cerca de 30 dias" in t.texto and "por 5 anos depois que ela termina" in t.texto
    atividade = tp.atual("IMAGEM_ATIVIDADE").texto
    # criança: um dos pais ou o responsável (art. 14, § 1º); adolescente: assina junto; num parágrafo próprio, em destaque
    crianca = next(p for p in atividade.split("\n\n") if p.startswith("CRIANÇA OU ADOLESCENTE"))
    assert "criança, quem autoriza é um dos pais ou o responsável legal (LGPD, art. 14, § 1º)" in crianca and "assina junto" in crianca
    assert "as fotos em que eu (ou a criança ou o adolescente) apareço saem do sistema" in atividade, "revogar vale para todas as fotos da pessoa"
    assert "mandato vigente ou já marcado" in tp.atual("IMAGEM_DIRETORIA").texto
    from app.services.retencao import REGRAS

    assert {r.codigo: r.padrao_em_dias for r in REGRAS}["consentimentos_encerrados"] == 5 * 365, "os 5 anos que o termo promete"


# ------------------------------------------------------------------------------------------------ 4. a migração
def _migracao():
    caminho = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "7c4e1a9d2b63_v7_1b_consentimentos.py"
    especificacao = importlib.util.spec_from_file_location("migracao_consentimentos", caminho)
    migracao = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(migracao)
    return migracao


def test_a_migracao_registra_as_fotos_que_ja_existiam_e_cria_a_tabela_do_modelo():
    from alembic.autogenerate import compare_metadata

    import app.models  # noqa: F401
    from app.database import Base

    migracao = _migracao()
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[t for nome, t in Base.metadata.tables.items() if nome != "consentimentos"])
    with motor.begin() as c:
        c.execute(sa.text("INSERT INTO pessoas (id_pessoa, nome_completo) VALUES (7, 'Dirigente Antiga')"))
        c.execute(sa.text("INSERT INTO fotos_da_diretoria (id_foto, id_pessoa, arquivo_nome, sha256, tamanho, largura, altura, alt, autorizacao_imagem, criado_em) "
                          "VALUES (3, 7, 'a.jpg', :h, 1, 1, 1, 'Foto', 1, '2026-10-16 10:00:00')"), {"h": "0" * 64})
        c.execute(sa.text("INSERT INTO fotos_evento (id_foto, id_evento, arquivo_nome, sha256, tamanho, largura, altura, alt, autorizacao_imagem, criado_em) "
                          "VALUES (5, 1, 'b.jpg', :h, 1, 1, 1, 'Foto do evento', 1, '2026-10-05 10:00:00')"), {"h": "0" * 64})
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            migracao.upgrade()
    with motor.connect() as conexao:
        linhas = conexao.execute(sa.text("SELECT ponto, versao, titular, id_pessoa, meio, origem, id_origem, encerrado_em FROM consentimentos ORDER BY origem")).all()
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
    assert linhas == [
        ("IMAGEM_DIRETORIA", "1", "Dirigente Antiga", 7, "declaracao_antiga", "foto_da_diretoria", 3, None),
        ("IMAGEM_ATIVIDADE", "1", migracao.TITULAR_DAS_FOTOS_DE_ATIVIDADE, None, "declaracao_antiga", "foto_de_evento", 5, None),
    ]
    sobre = [repr(d) for item in diferencas for d in (item if isinstance(item, list) else [item]) if "consentimentos" in repr(d)]
    assert sobre == [], "; ".join(sobre)
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            migracao.downgrade()
    assert "consentimentos" not in sa.inspect(motor).get_table_names()
    assert servico.MEIOS[servico.DECLARACAO_ANTIGA].startswith("Declaração de quem enviou")


# ------------------------------------------------------------------------------------------------ menor privilégio e o prazo da prova
def test_quem_so_le_a_parceria_nao_ve_o_nome_de_quem_assinou(client, db, gestor):  # noqa: F811
    from tests.test_parcerias_fotos import aprovador  # noqa: F401

    id_parceria = _criar(client, gestor)["id_parceria"]
    id_etapa = _etapa(client, gestor, id_parceria)
    assert _enviar_foto_da_etapa(client, gestor, id_parceria, id_etapa, quem_autorizou="Mãe de Teste da Oficina").status_code == 201
    do_gestor = client.get(f"/api/parcerias/{id_parceria}", headers=gestor).json()["etapas"][-1]["fotos"][0]["consentimento"]
    assert do_gestor["titular"] == "Mãe de Teste da Oficina"
    from tests.test_parcerias_fotos import _usuario

    leitor = _usuario(db, "aprovar_publicacao")
    do_leitor = client.get(f"/api/parcerias/{id_parceria}", headers=leitor).json()["etapas"][-1]["fotos"][0]["consentimento"]
    assert do_leitor["titular"] is None and do_leitor["versao"] == do_gestor["versao"], "vê que há consentimento, sem o nome de quem assinou"


def test_a_prova_do_consentimento_encerrado_e_apagada_depois_do_prazo_e_a_vigente_fica(db):
    from app.services import retencao

    agora = datetime.utcnow()
    vigente = Consentimento(ponto="IMAGEM_ATIVIDADE", versao="2", titular="Vigente de teste", meio=servico.TERMO_EM_PAPEL, dado_em=agora - timedelta(days=4000),
                            registrado_em=agora, origem="foto_de_evento", id_origem=900001)
    velho = Consentimento(ponto="IMAGEM_ATIVIDADE", versao="2", titular="Encerrado velho", meio=servico.TERMO_EM_PAPEL, dado_em=agora - timedelta(days=4000),
                          registrado_em=agora, origem="foto_de_evento", id_origem=900002, encerrado_em=agora - timedelta(days=1830), encerramento=REVOGADO)
    recente = Consentimento(ponto="IMAGEM_ATIVIDADE", versao="2", titular="Encerrado recente", meio=servico.TERMO_EM_PAPEL, dado_em=agora - timedelta(days=400),
                            registrado_em=agora, origem="foto_de_evento", id_origem=900003, encerrado_em=agora - timedelta(days=10), encerramento=APAGADO)
    db.add_all([vigente, velho, recente])
    db.commit()
    ids = (vigente.id_consentimento, velho.id_consentimento, recente.id_consentimento)
    regra = next(r for r in retencao.REGRAS if r.codigo == "consentimentos_encerrados")
    assert regra.aplicar(db, agora, retencao.dias_da_regra(db, regra)) >= 1
    db.expire_all()
    assert [db.get(Consentimento, i) is not None for i in ids] == [True, False, True]
    for i in (ids[0], ids[2]):
        db.delete(db.get(Consentimento, i))
    db.commit()
