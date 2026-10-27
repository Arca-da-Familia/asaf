"""v7.1a (FASE 7) - os textos de privacidade com versão (app/textos_de_privacidade.py).

  1. o catálogo: versões seguidas, base legal e atividade que existem, e AVISO onde a base não é consentimento (pedir consentimento para tudo enfraquece o consentimento);
  2. uma versão publicada NUNCA muda de texto (a impressão de cada uma fica presa aqui: mudar um aviso exige versão nova);
  3. o site mostra exatamente o catálogo (o arquivo gerado é igual);
  4. o banco grava cada versão ao subir e nunca reescreve a gravada (vale o que foi mostrado);
  5. reabrir o aviso de uma versão antiga mostra o texto daquela época, não o de hoje (pedido do Ponto de Revisão FASE 7, 1/3);
  6. a inscrição em evento: aviso do catálogo (não mais uma configuração editável), recusa a versão velha; a migração 5b2d7e9c41f0."""
import importlib.util
import uuid
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app import textos_de_privacidade as tp
from app.models.atendimento import CONTATO, IDENTIDADE_CODIGO_NO_EMAIL, TITULAR_LGPD, VOLUNTARIO, Atendimento
from app.models.privacidade import TextoDePrivacidade
from app.services import atendimento as servico_atendimento
from app.services.inventario import ATIVIDADES, BASES_LEGAIS
from scripts import gerar_textos_de_privacidade_do_site as gerador
from tests.test_conselho_fiscal import _criar_associado, _headers

# A impressão (SHA-256) de cada versão publicada. Uma versão nova entra aqui; uma versão que já está aqui NUNCA muda (é o texto que as pessoas leram).
IMPRESSOES = {
    ("INSCRICAO_EVENTO", "1"): "fcc7f4bc083b25459f1ac08c2bdd2141a0199a3f66a138a60dcb4ffc596a7196",
    ("INSCRICAO_EVENTO", "2"): "41bdee3a55f5e0856b6c55bce79399405eb2df5b6c1f047069fcac2c04f07801",
    ("FILIACAO", "1"): "844e6c63f96874b4cbfa69f5803f2f4b1fa8c9d5c4e4392f8155e9c44c7f4461",
    ("FILIACAO", "2"): "6804af8bd24ea5ada4f4466e381241f63f89cd0e2084014de6826e589c0d3384",
    ("FILIACAO", "3"): "9b0b93d8dd765fcd52d59162b14de34b1a7418492d943398225175a23e0ea92e",
    ("ATENDIMENTO", "1"): "0f27e0363a64371bd60f76fc7bc1391ea8bc48d21b0c7373c0bf83c074fdf37f",
    ("ATENDIMENTO", "2"): "0f27e0363a64371bd60f76fc7bc1391ea8bc48d21b0c7373c0bf83c074fdf37f",
    ("ATENDIMENTO_TITULAR", "1"): "7fff91e532cad77e9f45d61cb33e27a7fb29ad55f19a5fb130f6ea04af299d9d",
    ("ATENDIMENTO_TITULAR", "2"): "7fff91e532cad77e9f45d61cb33e27a7fb29ad55f19a5fb130f6ea04af299d9d",
    ("ATENDIMENTO_VOLUNTARIADO", "1"): "0f27e0363a64371bd60f76fc7bc1391ea8bc48d21b0c7373c0bf83c074fdf37f",
    ("ATENDIMENTO_VOLUNTARIADO", "2"): "98ef42935523b274579132e8fc4e4e4d5b441b7ca53ac2306c61d16ecbaa0a69",
    ("DOACAO", "1"): "815837bb5f4f7985dea205d71aa2852ee33b552f2336ebf94bb43bcb0fe7e44d",
    ("DOACAO", "2"): "ed94c8a3b0aa63fe4110bf04c7b13f009a032d647afdba7a9dc1908a0e6c2098",
    ("VISITANTE", "1"): "16fd159c7c2674b2ceadf3eb1fe893156f31061808e6488cb83cd47f4a0ac63f",
    # v7.1b: os termos de imagem (a versão 1 é a declaração de quem enviava a foto; a 2, o termo que a pessoa assina)
    ("IMAGEM_DIRETORIA", "1"): "78d3fb8ef3f15cd042c71238bfa83bd837fc1ca62c5f47697c449cb14600208d",
    ("IMAGEM_DIRETORIA", "2"): "4611bbe4cbd7e4400bf3c1bb4d815353b3a3d9a2238945fc1ef4f4f3412c5499",
    ("IMAGEM_ATIVIDADE", "1"): "171a3b3552f07a5f7a8af41b76b27787f84aed1548e5a8267a947d8df2393df3",
    ("IMAGEM_ATIVIDADE", "2"): "8b13e68cd15ba90d63d699651fe31e95ea4574e91d97249943a99f9f1a88942a",
}


# ------------------------------------------------------------------------------------------------ 1. o catálogo
def test_o_catalogo_tem_versoes_seguidas_base_legal_e_aviso_onde_a_base_nao_e_consentimento():
    atividades = {a.codigo for a in ATIVIDADES}
    for p in tp.PONTOS:
        assert [t.versao for t in tp.versoes(p.codigo)] == [str(n) for n in range(1, len(tp.versoes(p.codigo)) + 1)], p.codigo
        assert p.atividade in atividades and p.bases_legais and all(b in BASES_LEGAIS for b in p.bases_legais), p.codigo
        consentimento = {"ART7_I", "ART11_I"} & set(p.bases_legais)
        assert (p.tipo == tp.CONSENTIMENTO) == bool(consentimento), f"{p.codigo}: aviso não tem base no consentimento, e consentimento só onde ele é a base"
        assert p.tipo != tp.AVISO or "concordo" not in p.caixa.lower() and "autorizo" not in tp.atual(p.codigo).texto.lower(), p.codigo
    assert {t.ponto for t in tp.TEXTOS} == {p.codigo for p in tp.PONTOS}
    for t in tp.TEXTOS:
        assert t.texto.strip() == t.texto and "  " not in t.texto, (t.ponto, t.versao)
        for _, href in tp._LINK.findall(t.texto):
            assert href.startswith("/") and not href.startswith("//"), "o aviso só leva a páginas do próprio site"
    # a inscrição em evento deixou de ser "autorizo" (a base é a própria inscrição) e a filiação diz o prazo que a rotina de retenção aplica
    assert "autorizo" in tp.buscar("INSCRICAO_EVENTO", "1").texto and "art. 7º, V" in tp.atual("INSCRICAO_EVENTO").texto
    assert "2 anos depois da última mudança" in tp.atual("FILIACAO").texto and "ficam guardados no sistema;" not in tp.atual("FILIACAO").texto
    # a inscrição diz o que o sistema faz com ela (conferido no código): grupo, cadastro de participantes, pesquisa de satisfação, IP na Auditoria
    for trecho in ("inscrição em grupo", "cadastro de participantes", "pesquisa de satisfação", "Auditoria", "responsável"):
        assert trecho in tp.atual("INSCRICAO_EVENTO").texto, trecho
    # cada versão guarda o que era quando foi mostrada: a 1 da inscrição era consentimento, com "Li e aceito."; a filiação 1 e 2 tinham o "concordo"
    v1 = tp.buscar("INSCRICAO_EVENTO", "1")
    assert tp.tipo_da_versao(v1) == tp.CONSENTIMENTO and tp.caixa_da_versao(v1) == "Li e aceito."
    assert tp.tipo_da_versao(tp.atual("INSCRICAO_EVENTO")) == tp.AVISO and tp.caixa_da_versao(tp.atual("INSCRICAO_EVENTO")) == "Li o aviso de privacidade."
    assert "concordo" in tp.caixa_da_versao(tp.buscar("FILIACAO", "2")) and "concordo" not in tp.caixa_da_versao(tp.atual("FILIACAO"))


def test_o_prazo_que_os_avisos_citam_e_o_que_a_rotina_de_retencao_aplica():
    from app.services.retencao import REGRAS

    padroes = {r.codigo: r.padrao_em_dias for r in REGRAS}
    assert padroes["propostas_de_filiacao"] == 730 and "(hoje, 2 anos" in tp.atual("FILIACAO").texto, "o prazo é configurável: o aviso diz o de hoje"
    assert padroes["intencoes_de_doacao"] == 730 and "hoje, 2 anos" in tp.atual("DOACAO").texto


# ------------------------------------------------------------------------------------------------ 2. versão publicada não muda
def test_nenhuma_versao_publicada_mudou_de_texto():
    atuais = {(t.ponto, t.versao): t.impressao for t in tp.TEXTOS}
    assert atuais == IMPRESSOES, (
        "Um aviso publicado mudou de texto, ou entrou versão nova sem a impressão aqui. Mudar o texto de um aviso exige VERSÃO NOVA no catálogo "
        "(a antiga fica como estava: é o que as pessoas leram)."
    )


# ------------------------------------------------------------------------------------------------ 3. o site mostra o catálogo
def test_o_arquivo_do_site_e_o_catalogo():
    assert gerador.DESTINO.read_text(encoding="utf-8") == gerador.conteudo(), (
        "site/src/data/textos-de-privacidade.json está diferente do catálogo: rode scripts/gerar_textos_de_privacidade_do_site.py"
    )


# ------------------------------------------------------------------------------------------------ 4. o banco grava e nunca reescreve
def test_o_banco_tem_cada_versao_e_nunca_reescreve_a_gravada(db):
    tp.sincronizar(db)
    gravados = {(r.ponto, r.versao): r for r in db.query(TextoDePrivacidade).all()}
    assert set(IMPRESSOES) <= set(gravados)
    assert all(gravados[c].impressao == i for c, i in IMPRESSOES.items())
    antes = db.query(TextoDePrivacidade).count()
    assert tp.sincronizar(db) == [] and db.query(TextoDePrivacidade).count() == antes, "sincronizar de novo não duplica"

    r = gravados[("VISITANTE", "1")]
    original = r.texto, r.impressao
    try:
        r.texto, r.impressao = "Texto que estava gravado.", "0" * 64
        db.commit()
        assert tp.sincronizar(db) == ["VISITANTE versão 1"]
        db.refresh(r)
        assert r.texto == "Texto que estava gravado.", "vale o gravado: é o que foi mostrado"
    finally:
        r.texto, r.impressao = original
        db.commit()


# ------------------------------------------------------------------------------------------------ 5. reabrir o aviso antigo
def test_reabrir_o_aviso_de_uma_versao_antiga_mostra_o_texto_daquela_epoca(client, db, auth_headers):
    tp.sincronizar(db)
    antigo = client.get("/api/textos-de-privacidade/FILIACAO/2", headers=auth_headers)
    assert antigo.status_code == 200, antigo.text
    corpo = antigo.json()
    assert "Pedidos recusados ou sem andamento ficam guardados no sistema" in corpo["texto_sem_links"]
    assert corpo["versao"] == "2" and corpo["versao_atual"] == "3" and corpo["reconstituido"] is True and corpo["vigente_desde"] == "2026-10-08"
    assert corpo["tipo"] == "aviso" and "concordo com o uso dos meus dados" in corpo["caixa"], "a caixa que a pessoa marcou naquela versão"
    v1 = client.get("/api/textos-de-privacidade/INSCRICAO_EVENTO/1", headers=auth_headers).json()
    assert v1["tipo"] == "consentimento" and v1["caixa"] == "Li e aceito."
    assert "[" not in corpo["texto_sem_links"] and "[Política de Privacidade](/privacidade/)" in corpo["texto"]
    assert client.get("/api/textos-de-privacidade/FILIACAO/9", headers=auth_headers).status_code == 404
    assert client.get("/api/textos-de-privacidade/NAO_EXISTE/1", headers=auth_headers).status_code == 404
    assert client.get("/api/textos-de-privacidade/FILIACAO/2").status_code == 401

    # qualquer pessoa logada lê um aviso (o texto é público); a lista com as bases e as versões é de quem tem `privacidade`
    _, associado = _criar_associado(db, f"Associado Avisos {uuid.uuid4().hex[:6]}", nome_nivel="Associado")
    assert client.get("/api/textos-de-privacidade/FILIACAO/2", headers=_headers(associado)).status_code == 200
    assert client.get("/api/privacidade/textos-de-privacidade", headers=_headers(associado)).status_code == 403
    lista = client.get("/api/privacidade/textos-de-privacidade", headers=auth_headers).json()["pontos"]
    filiacao = next(p for p in lista if p["codigo"] == "FILIACAO")
    assert [v["versao"] for v in filiacao["versoes"]] == ["3", "2", "1"] and filiacao["versao_atual"] == "3"
    assert filiacao["bases_legais"][0]["codigo"] == "ART7_V" and filiacao["atividade_nome"] == "Cadastro e vida associativa"


def test_o_atendimento_diz_qual_aviso_a_pessoa_leu():
    def ponto(tipo, identidade=None):
        return servico_atendimento.ponto_do_aviso(Atendimento(tipo=tipo, identidade_validacao=identidade))

    assert ponto(CONTATO) == "ATENDIMENTO" and ponto(TITULAR_LGPD) == "ATENDIMENTO_TITULAR" and ponto(VOLUNTARIO) == "ATENDIMENTO_VOLUNTARIADO"
    assert ponto(TITULAR_LGPD, IDENTIDADE_CODIGO_NO_EMAIL) == "VISITANTE", "o pedido de eliminação feito em Minha conta leu o aviso da conta de visitante"
    # o pedido de Minha conta de antes da v5.7f não tinha a identidade marcada: o assunto o reconhece
    antigo = Atendimento(tipo=TITULAR_LGPD, identidade_validacao=None, assunto="Eliminação de dados pela área do visitante")
    assert servico_atendimento.ponto_do_aviso(antigo) == "VISITANTE"
    import inspect

    from app.services import conta_de_visitante as cv

    assert f'assunto="{servico_atendimento.ASSUNTO_DO_PEDIDO_DO_VISITANTE}"' in inspect.getsource(cv), "o assunto que a conta de visitante grava é o que se reconhece"
    # as versões que os serviços conferem são as do catálogo
    from app.services import conta_de_visitante, doacao_online, filiacao_publica

    assert servico_atendimento.VERSAO_AVISO_DE_PRIVACIDADE_ATENDIMENTO == tp.versao_atual("ATENDIMENTO") == tp.versao_atual("ATENDIMENTO_TITULAR") \
        == tp.versao_atual("ATENDIMENTO_VOLUNTARIADO")
    assert doacao_online.VERSAO_AVISO_DE_PRIVACIDADE_DOACAO == tp.versao_atual("DOACAO")
    assert filiacao_publica.VERSAO_AVISO_DE_PRIVACIDADE_FILIACAO == tp.versao_atual("FILIACAO") == "3"
    assert conta_de_visitante.VERSAO_AVISO_DE_PRIVACIDADE_VISITANTE == tp.versao_atual("VISITANTE")


# ------------------------------------------------------------------------------------------------ 6. a inscrição em evento e a migração
def test_a_api_nova_tira_as_configuracoes_antigas_da_inscricao_ao_subir(db):
    from app.database import seed_textos_de_privacidade
    from app.models.core import ConfiguracaoInstitucional

    chaves = ("TEXTO_CONSENTIMENTO_LGPD_INSCRICAO", "VERSAO_TEXTO_CONSENTIMENTO_LGPD_INSCRICAO")
    for chave in chaves:
        if not db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao == chave).first():
            db.add(ConfiguracaoInstitucional(chave_configuracao=chave, valor_configuracao="x", tipo="texto", categoria="regras"))
    db.commit()
    seed_textos_de_privacidade()
    db.expire_all()
    assert db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao.in_(chaves)).count() == 0


def test_a_inscricao_em_evento_mostra_o_aviso_do_catalogo(client):
    r = client.get("/api/publico/eventos/consentimento-lgpd")
    assert r.status_code == 200
    corpo = r.json()
    assert corpo["versao"] == tp.versao_atual("INSCRICAO_EVENTO") == "2"
    assert corpo["texto"] == tp.sem_links(tp.atual("INSCRICAO_EVENTO").texto) and "[" not in corpo["texto"]
    assert corpo["paragrafos"] == tp.atual("INSCRICAO_EVENTO").texto.split("\n\n") and "](/privacidade/)" in corpo["paragrafos"][-1]
    assert corpo["caixa"] == "Li o aviso de privacidade."


def test_a_migracao_guarda_o_texto_editado_e_para_se_a_versao_colidir():
    caminho = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "5b2d7e9c41f0_v7_1a_textos_de_privacidade.py"
    especificacao = importlib.util.spec_from_file_location("migracao_textos", caminho)
    migracao = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(migracao)

    def banco(texto_da_config, versao="4"):
        motor = sa.create_engine("sqlite://")
        with motor.begin() as c:
            c.execute(sa.text("CREATE TABLE configuracoes_institucionais (id_config INTEGER PRIMARY KEY, chave_configuracao VARCHAR UNIQUE, valor_configuracao VARCHAR, "
                              "tipo VARCHAR(20), categoria VARCHAR(50), descricao VARCHAR, atualizado_em DATETIME, id_usuario_atualizacao INTEGER)"))
            c.execute(sa.text("INSERT INTO configuracoes_institucionais (chave_configuracao, valor_configuracao) VALUES "
                              "('TEXTO_CONSENTIMENTO_LGPD_INSCRICAO', :t), ('VERSAO_TEXTO_CONSENTIMENTO_LGPD_INSCRICAO', :v), ('OUTRA', 'x')"), {"t": texto_da_config, "v": versao})
        return motor

    def rodar(motor, passo):
        with motor.begin() as c:
            with Operations.context(MigrationContext.configure(c)):
                passo()

    import pytest

    editado_com_versao_nova = banco("Texto que a secretaria escreveu na configuração.")
    with pytest.raises(RuntimeError, match="versão '4'"):
        rodar(editado_com_versao_nova, migracao.upgrade)
    with editado_com_versao_nova.connect() as c:
        assert "textos_de_privacidade" not in sa.inspect(c).get_table_names(), "parou sem gravar nada (a transação desfez a tabela)"

    editado = banco("Texto que a secretaria escreveu na configuração.", versao="1")
    rodar(editado, migracao.upgrade)
    with editado.connect() as c:
        linhas = c.execute(sa.text("SELECT ponto, versao, tipo, texto, caixa, reconstituido FROM textos_de_privacidade")).all()
        chaves = {k for (k,) in c.execute(sa.text("SELECT chave_configuracao FROM configuracoes_institucionais"))}
    assert linhas == [("INSCRICAO_EVENTO", "1", "consentimento", "Texto que a secretaria escreveu na configuração.", "Li e aceito.", 1)], (
        "o texto editado é o que as pessoas leram")
    assert chaves == {"OUTRA", *migracao.CHAVES}, "a API antiga ainda lê as duas configurações durante a publicação: a migração não as tira"

    padrao = banco(migracao.TEXTO_PADRAO)
    rodar(padrao, migracao.upgrade)
    with padrao.connect() as c:
        assert c.execute(sa.text("SELECT COUNT(*) FROM textos_de_privacidade")).scalar() == 0, "o texto padrão é a versão 1 do catálogo, gravada ao subir"
    with padrao.begin() as c:  # a API nova tirou as duas ao subir; o downgrade as devolve
        c.execute(sa.text("DELETE FROM configuracoes_institucionais WHERE chave_configuracao <> 'OUTRA'"))
    rodar(padrao, migracao.downgrade)
    with padrao.connect() as c:
        assert "textos_de_privacidade" not in sa.inspect(c).get_table_names()
        chaves = sorted(k for (k,) in c.execute(sa.text("SELECT chave_configuracao FROM configuracoes_institucionais")))
    assert chaves == sorted(["OUTRA", *migracao.CHAVES])
    assert migracao.TEXTO_PADRAO == tp.buscar("INSCRICAO_EVENTO", "1").texto


def test_a_migracao_cria_exatamente_a_tabela_que_o_modelo_descreve():
    from alembic.autogenerate import compare_metadata

    import app.models  # noqa: F401
    from app.database import Base

    caminho = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "5b2d7e9c41f0_v7_1a_textos_de_privacidade.py"
    especificacao = importlib.util.spec_from_file_location("migracao_textos_modelo", caminho)
    migracao = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(migracao)
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[t for nome, t in Base.metadata.tables.items() if nome != "textos_de_privacidade"])
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            migracao.upgrade()
    with motor.connect() as conexao:
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
    sobre = [repr(d) for item in diferencas for d in (item if isinstance(item, list) else [item]) if "textos_de_privacidade" in repr(d)]
    assert sobre == [], "; ".join(sobre)
