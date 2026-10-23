"""v7.0c (FASE 7) - o inventário de dados vivo no sistema (ver app/services/inventario.py).

  1. toda tabela com dado de pessoa (classificação da v7.0b) está numa atividade; as tabelas citadas existem; os códigos de base legal, operador e regra de guarda existem;
  2. cada atividade traz as seções do modelo da ANPD, com os dados, os sensíveis e a criança lidos do modelo e o prazo lido da regra de retenção EM VIGOR;
  3. ajustar grava uma versão nova (o histórico), recusa base legal fora da lista e "nada mudou", e vai para a Auditoria; só quem tem `privacidade_gerir`;
  4. exportar em planilha e em PDF (para apresentar à ANPD), com a Auditoria;
  5. a migração 30a03a70ba56 cria exatamente a tabela que o modelo descreve;
  6. achados da conferência independente: rotinas do GitHub e envios de e-mail conferidos com o código; o art. 14 é requisito, não base; versão guarda só o
     diferente (a proposta nova do código aparece); código antigo não derruba; ordem não é mudança; base nova não nasce conferida; versão de partida (409);
     planilha sem fórmula e com o controlador e o encarregado; PDF com quebra de linha."""
import csv
import importlib.util
import io
import json
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import pypdf
import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import HTTPException
import pytest

import app.models  # noqa: F401
from app import classificacao_de_dados as cl
from app.database import Base
from app.models.core import AuditLog, ConfiguracaoInstitucional
from app.services import inventario, retencao
from tests.test_conselho_fiscal import _criar_associado, _headers


def _nome(prefixo: str) -> str:
    return f"{prefixo} {uuid.uuid4().hex[:6]}"


# ------------------------------------------------------------------------------------------------ 1. nada fora do inventário
def test_toda_tabela_com_dado_de_pessoa_esta_numa_atividade():
    assert inventario.tabelas_sem_atividade() == []


def test_o_que_as_atividades_citam_existe():
    tabelas = Base.metadata.tables
    regras = {r.codigo for r in retencao.REGRAS}
    for a in inventario.ATIVIDADES:
        assert all(t in tabelas for t in a.tabelas), a.codigo
        assert set(a.bases_legais) <= set(inventario.BASES_LEGAIS) and a.bases_legais, a.codigo
        assert set(a.operadores) <= set(inventario.OPERADORES) and a.operadores, a.codigo
        assert set(a.regras_de_retencao) <= regras, a.codigo
    assert {r.codigo for r in retencao.REGRAS} <= {r for a in inventario.ATIVIDADES for r in a.regras_de_retencao}, "toda regra de guarda aparece no inventário"
    citadas = [t for a in inventario.ATIVIDADES for t in a.tabelas]
    assert len(citadas) == len(set(citadas)), "cada tabela numa atividade só"


def test_uma_tabela_nova_com_dado_de_pessoa_aparece_como_pendencia():
    falsa = [{"tabela": "tabela_nova_qualquer", "titulares": [cl.PESSOA], "colunas_pessoais": ["nome"], "colunas_sensiveis": [], "pode_ter_crianca": False,
              "texto_livre_que_pode_ter_sensivel": [], "leitura_auditada": []}]
    assert inventario.tabelas_sem_atividade(cl.inventario_do_modelo() + falsa) == ["tabela_nova_qualquer"]


# ------------------------------------------------------------------------------------------------ 2. as seções, lidas do modelo e da regra em vigor
def test_cada_atividade_traz_as_secoes_do_modelo_da_anpd(db):
    dados = {a["codigo"]: a for a in inventario.listar(db)["atividades"]}
    beneficiarios = dados["BENEFICIARIOS"]
    assert beneficiarios["pode_ter_crianca"] and "registros_atendimento.relato" in beneficiarios["dados_sensiveis"]
    assert cl.BENEFICIARIO in beneficiarios["titulares"] and beneficiarios["sem_rotina_de_guarda"]
    assert "Art. 14" not in " ".join(beneficiarios["bases_legais_texto"]), "o art. 14 é requisito (Enunciado CD/ANPD nº 1/2023), não base legal"
    assert "melhor interesse" in beneficiarios["requisito_crianca"] and beneficiarios["base_legal_conferida"] is False
    assert dados["ATENDIMENTO"]["requisito_crianca"] is not None or not dados["ATENDIMENTO"]["pode_ter_crianca"]
    visitante = dados["VISITANTE"]
    assert not visitante["sem_rotina_de_guarda"] and "apagados em até 1 dia" in visitante["prazos_fixos"][0]
    assert dados["SITE_EDITORIAL"]["tabelas_externas"] and any("site" in a for a in dados["TRANSPARENCIA"]["armazenamento"])
    cadastro = dados["CADASTRO"]
    assert "pessoas.cpf" in cadastro["dados_pessoais"] and "mudancas_situacao.motivo" in cadastro["dados_sensiveis"]
    assert any("armazenamento privado" in a for a in cadastro["armazenamento"]) and cadastro["transferencia_internacional"]
    assert "South Central US (Estados Unidos)" in cadastro["armazenamento"][0]
    operacao = dados["OPERACAO"]
    assert "exercicios_contabeis" in operacao["tabelas"] and operacao["titulares"] == [cl.USUARIO]


def test_o_prazo_e_o_da_regra_em_vigor(db):
    atual = next(p for p in next(a for a in inventario.listar(db)["atividades"] if a["codigo"] == "ATENDIMENTO")["prazos_de_guarda"])
    assert atual["regra"] == "atendimentos" and atual["dias"] == retencao.dias_da_regra(db, next(r for r in retencao.REGRAS if r.codigo == "atendimentos"))
    config = db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao == "PRAZO_RETENCAO_ATENDIMENTOS_DIAS").first()
    original = config.valor_configuracao
    try:
        config.valor_configuracao = "999"
        db.commit()
        from app import config_cache
        config_cache._cache.clear()
        novo = next(a for a in inventario.listar(db)["atividades"] if a["codigo"] == "ATENDIMENTO")["prazos_de_guarda"][0]
        assert novo["dias"] == 999, "o inventário lê a regra de hoje, não um número escrito à parte"
    finally:
        config.valor_configuracao = original
        db.commit()
        from app import config_cache
        config_cache._cache.clear()


# ------------------------------------------------------------------------------------------------ 3. ajustar (versão nova, Auditoria, permissão)
def test_ajustar_grava_versao_nova_com_historico_e_auditoria(client, db, auth_headers):
    codigo = "FORNECEDORES"
    antes = client.get("/api/privacidade/inventario", headers=auth_headers).json()
    atual = next(a for a in antes["atividades"] if a["codigo"] == codigo)
    texto = f"Cadastrar fornecedores e pagar o que foi contratado ({uuid.uuid4().hex[:6]})."
    r = client.put(f"/api/privacidade/inventario/{codigo}", headers=auth_headers, json={"finalidade": texto, "base_legal_conferida": True})
    assert r.status_code == 200, r.text
    depois = next(a for a in r.json()["atividades"] if a["codigo"] == codigo)
    assert depois["finalidade"] == texto and depois["base_legal_conferida"] and depois["versao"] == atual["versao"] + 1
    assert codigo not in r.json()["base_legal_a_conferir"]
    assert client.put(f"/api/privacidade/inventario/{codigo}", headers=auth_headers, json={"finalidade": texto + " velha", "versao_base": atual["versao"]}).status_code == 409, \
        "quem salva sobre a versão velha recebe 409"
    historico = client.get(f"/api/privacidade/inventario/{codigo}/historico", headers=auth_headers).json()
    assert historico[0]["versao"] == depois["versao"] and historico[0]["campos"]["finalidade"] == texto and historico[-1]["por"] == "proposta do sistema (a de hoje)"
    entrada = db.query(AuditLog).filter(AuditLog.acao == "ATIVIDADE_AJUSTADA").order_by(AuditLog.id_log.desc()).first()
    assert json.loads(entrada.dados_depois)["atividade"] == codigo and json.loads(entrada.dados_antes)["finalidade"] == atual["finalidade"]
    assert client.put(f"/api/privacidade/inventario/{codigo}", headers=auth_headers, json={"finalidade": texto}).status_code == 409, "nada mudou"
    assert client.put(f"/api/privacidade/inventario/{codigo}", headers=auth_headers, json={"bases_legais": ["ART99"]}).status_code == 422
    assert client.put(f"/api/privacidade/inventario/{codigo}", headers=auth_headers, json={"bases_legais": []}).status_code == 422
    assert client.put(f"/api/privacidade/inventario/{codigo}", headers=auth_headers, json={"finalidade": "curta"}).status_code == 422
    assert client.put("/api/privacidade/inventario/NAO_EXISTE", headers=auth_headers, json={"finalidade": texto}).status_code == 404


def test_o_vice_presidente_ve_o_inventario_mas_nao_ajusta(client, db):
    vice, usuario = _criar_associado(db, _nome("Vice Inventario"), nome_nivel="Associado")
    from app.models.mandatos import Mandato

    mandato = Mandato(id_associado=vice.id_associado, orgao_codigo="DIRETORIA_EXECUTIVA", cargo_codigo="VICE_PRESIDENTE",
                      data_inicio=datetime.utcnow() - timedelta(days=2), data_fim_previsto=datetime.utcnow() + timedelta(days=30))
    db.add(mandato)
    db.commit()
    try:
        h = _headers(usuario)
        visto = client.get("/api/privacidade/inventario", headers=h)
        assert visto.status_code == 200 and visto.json()["pode_gerir"] is False
        assert client.put("/api/privacidade/inventario/CADASTRO", headers=h, json={"observacoes": "tentativa de quem só vê"}).status_code == 403
        assert client.get("/api/privacidade/inventario-planilha", headers=h).status_code == 200
    finally:
        mandato.data_fim_efetivo = datetime.utcnow()
        db.commit()
    _, diretor = _criar_associado(db, _nome("Diretor Sem Privacidade"), nome_nivel="Diretoria")
    for rota in ("/api/privacidade/inventario", "/api/privacidade/inventario-planilha", "/api/privacidade/inventario-pdf", "/api/privacidade/inventario/CADASTRO/historico"):
        assert client.get(rota, headers=_headers(diretor)).status_code == 403, rota
    assert client.get("/api/privacidade/inventario").status_code == 401


# ------------------------------------------------------------------------------------------------ 4. exportar
def test_exportar_em_planilha_e_em_pdf_com_auditoria(client, db, auth_headers):
    r = client.get("/api/privacidade/inventario-planilha", headers=auth_headers)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    linhas = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig")), delimiter=";"))
    cabecalho = linhas.index(list(inventario.COLUNAS_DA_PLANILHA))
    assert cabecalho == 3 and len(linhas) == cabecalho + 1 + len(inventario.ATIVIDADES), "controlador, encarregado, linha em branco, colunas, atividades"
    beneficiarios = next(linha for linha in linhas if linha and linha[0] == "Atendimento social a beneficiários")
    assert "registros_atendimento.relato" in beneficiarios[4] and beneficiarios[5].startswith("sim — Art. 14") and "Sem rotina automática" in beneficiarios[11]
    pdf = client.get("/api/privacidade/inventario-pdf", headers=auth_headers)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    texto = "\n".join(p.extract_text() for p in pypdf.PdfReader(io.BytesIO(pdf.content)).pages)
    assert "INVENTÁRIO DE DADOS PESSOAIS" in texto and "Contribuições, cobranças e reembolsos" in texto
    exportados = db.query(AuditLog).filter(AuditLog.acao == "INVENTARIO_EXPORTADO").count()
    assert exportados >= 2


# ------------------------------------------------------------------------------------------------ 5. a migração
def test_a_migracao_cria_exatamente_a_tabela_que_o_modelo_descreve():
    caminho = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "30a03a70ba56_v7_0c_inventario_de_dados.py"
    especificacao = importlib.util.spec_from_file_location("migracao_inventario", caminho)
    migracao = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(migracao)
    tabela = "versoes_de_atividade_de_tratamento"
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[t for nome, t in Base.metadata.tables.items() if nome != tabela])
    antes = set(sa.inspect(motor).get_table_names())
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            migracao.upgrade()
    with motor.connect() as conexao:
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
    sobre = [repr(d) for item in diferencas for d in (item if isinstance(item, list) else [item]) if tabela in repr(d)]
    assert sobre == [], "\n".join(sobre)
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            migracao.downgrade()
    assert set(sa.inspect(motor).get_table_names()) == antes


# ------------------------------------------------------------------------------------------------ 6. achados da conferência independente
_RAIZ = Path(__file__).resolve().parent.parent


def test_as_rotinas_do_github_sao_as_dos_fluxos_e_as_atividades_citam_o_github():
    import re

    fluxos = [p for p in (_RAIZ / ".github" / "workflows").glob("*.yml") if p.name.startswith(("tarefa-", "escalar-"))]
    rodados = {m for p in fluxos for m in re.findall(r"python (scripts/[a-z_]+\.py)", p.read_text(encoding="utf-8"))}
    declarados = {r for r in inventario.ROTINAS_DO_GITHUB if r.startswith("scripts/")}
    assert rodados == declarados, f"rotinas do GitHub fora do inventário: {rodados - declarados}; a mais: {declarados - rodados}"
    for rotina, atividades in inventario.ROTINAS_DO_GITHUB.items():
        for codigo in atividades:
            assert "GITHUB" in inventario.buscar(codigo).operadores, f"{codigo} é tocada por {rotina}"


def test_quem_manda_email_esta_no_inventario_e_cita_o_google():
    def manda_email(texto: str) -> bool:
        return "enviar_email(" in texto or "ConexaoDeEmail" in texto  # um a um ou em lote (a conexão aberta uma vez)

    modulos = {p.stem for p in (_RAIZ / "app" / "services").glob("*.py") if manda_email(p.read_text(encoding="utf-8")) and p.stem != "notificacoes"}
    assert modulos == set(inventario.ENVIOS_DE_EMAIL), f"e-mail fora do inventário: {modulos - set(inventario.ENVIOS_DE_EMAIL)}"
    for modulo, codigo in inventario.ENVIOS_DE_EMAIL.items():
        assert "GOOGLE" in inventario.buscar(codigo).operadores, f"{codigo} manda e-mail por {modulo}"


def test_a_versao_guarda_so_o_diferente_e_a_proposta_nova_aparece(client, db, auth_headers, monkeypatch):
    from app.models.privacidade import VersaoDeAtividadeDeTratamento

    codigo = "VOLUNTARIADO"
    observacao = f"Observação do encarregado {uuid.uuid4().hex[:6]}."
    r = client.put(f"/api/privacidade/inventario/{codigo}", headers=auth_headers, json={"observacoes": observacao})
    assert r.status_code == 200, r.text
    guardada = db.query(VersaoDeAtividadeDeTratamento).filter(VersaoDeAtividadeDeTratamento.codigo_atividade == codigo).order_by(
        VersaoDeAtividadeDeTratamento.versao.desc()).first()
    assert set(guardada.campos["ajustes"]) == {"observacoes"} and guardada.campos["como_ficou"]["observacoes"] == observacao, guardada.campos
    original = inventario.buscar(codigo)
    mudada = inventario.Atividade(**{**original.__dict__, "finalidade": "Finalidade nova escrita no código depois."})
    monkeypatch.setattr(inventario, "_POR_CODIGO", {**inventario._POR_CODIGO, codigo: mudada})
    monkeypatch.setattr(inventario, "ATIVIDADES", tuple(mudada if a.codigo == codigo else a for a in inventario.ATIVIDADES))
    atual = next(a for a in inventario.listar(db)["atividades"] if a["codigo"] == codigo)
    assert atual["finalidade"] == "Finalidade nova escrita no código depois." and atual["observacoes"] == observacao


def test_codigo_antigo_guardado_nao_derruba_o_inventario(db):
    from app.models.privacidade import VersaoDeAtividadeDeTratamento
    from app.models.core import Usuario

    usuario = db.query(Usuario).first()
    numero = (db.query(sa.func.max(VersaoDeAtividadeDeTratamento.versao)).filter(VersaoDeAtividadeDeTratamento.codigo_atividade == "OPERACAO").scalar() or 0) + 1
    linha = VersaoDeAtividadeDeTratamento(codigo_atividade="OPERACAO", versao=numero, campos={"ajustes": {"bases_legais": ["ART14_P1"]}}, id_usuario=usuario.id_usuario)
    db.add(linha)
    db.commit()
    try:
        operacao = next(a for a in inventario.listar(db)["atividades"] if a["codigo"] == "OPERACAO")
        assert operacao["bases_legais_texto"] == ["(código antigo: ART14_P1)"]
        assert inventario.planilha(db) and inventario.pdf(db).startswith(b"%PDF")
    finally:
        db.delete(linha)  # não deixa o código antigo para os outros testes (o banco é compartilhado)
        db.commit()


def test_ordem_nao_e_mudanca_e_base_nova_nao_nasce_conferida(client, auth_headers):
    codigo = "COMUNICACAO"
    atual = next(a for a in client.get("/api/privacidade/inventario", headers=auth_headers).json()["atividades"] if a["codigo"] == codigo)
    bases = atual["bases_legais"]
    if not atual["base_legal_conferida"]:
        assert client.put(f"/api/privacidade/inventario/{codigo}", headers=auth_headers, json={"base_legal_conferida": True}).status_code == 200
    invertida = client.put(f"/api/privacidade/inventario/{codigo}", headers=auth_headers, json={"bases_legais": list(reversed(bases)) + bases[:1]})
    assert invertida.status_code == 409, "reordenar ou repetir não é mudança"
    nova = sorted(set(bases) ^ {"ART7_I"}) or ["ART7_IX"]
    r = client.put(f"/api/privacidade/inventario/{codigo}", headers=auth_headers, json={"bases_legais": nova})
    assert r.status_code == 200, r.text
    depois = next(a for a in r.json()["atividades"] if a["codigo"] == codigo)
    assert depois["base_legal_conferida"] is False, "base legal nova não nasce conferida"


def test_planilha_sem_formula_com_controlador_e_pdf_com_quebra_de_linha(client, db, auth_headers):
    codigo = "FINANCEIRO"
    atual = next(a for a in client.get("/api/privacidade/inventario", headers=auth_headers).json()["atividades"] if a["codigo"] == codigo)
    texto = f"=1+1 não é fórmula {uuid.uuid4().hex[:6]}\nsegunda linha das observações"
    assert client.put(f"/api/privacidade/inventario/{codigo}", headers=auth_headers, json={"observacoes": texto, "versao_base": atual["versao"]}).status_code == 200
    planilha = inventario.planilha(db).decode("utf-8-sig")
    linhas = list(csv.reader(io.StringIO(planilha), delimiter=";"))
    assert linhas[0][0].startswith("Controlador: ") and linhas[1][0].startswith("Encarregado pelo tratamento de dados pessoais: ")
    financeiro = next(linha for linha in linhas if linha and linha[0] == "Contribuições, cobranças e reembolsos")
    assert financeiro[-1].startswith("'=1+1"), "começa com apóstrofo: o Excel não executa"
    texto_pdf = "\n".join(p.extract_text() for p in pypdf.PdfReader(io.BytesIO(inventario.pdf(db))).pages)
    assert "Controlador:" in texto_pdf and "segunda linha das observações" in texto_pdf
    linha_com_quebra = next(linha for linha in texto_pdf.splitlines() if "segunda linha das observações" in linha)
    assert "não é fórmula" not in linha_com_quebra, "a quebra de linha do campo vira linha nova no PDF"


def test_duas_gravacoes_ao_mesmo_tempo_dao_409(db, monkeypatch):
    from app.models.core import Usuario
    from app.models.privacidade import VersaoDeAtividadeDeTratamento

    usuario = db.query(Usuario).first()
    codigo = "ACESSO"
    numero = (db.query(sa.func.max(VersaoDeAtividadeDeTratamento.versao)).filter(VersaoDeAtividadeDeTratamento.codigo_atividade == codigo).scalar() or 0) + 1
    db.add(VersaoDeAtividadeDeTratamento(codigo_atividade=codigo, versao=numero, campos={"observacoes": "x" * 12}, id_usuario=usuario.id_usuario))
    db.commit()
    # como se a outra gravação tivesse calculado o mesmo número: o "máximo" que ela leu é o de antes
    original = inventario._vigente
    monkeypatch.setattr(inventario, "_vigente", lambda db_, c: None if c == codigo else original(db_, c))
    real_query = db.query

    class _Consulta:
        def __init__(self, q):
            self._q = q

        def __getattr__(self, nome):
            return getattr(self._q, nome)

        def filter(self, *a, **k):
            return _Consulta(self._q.filter(*a, **k))

        def scalar(self):
            return numero - 1

    monkeypatch.setattr(db, "query", lambda *a, **k: _Consulta(real_query(*a, **k)) if "max" in str(a) else real_query(*a, **k))
    with pytest.raises(HTTPException) as recusa:
        inventario.atualizar(db, usuario, codigo, {"observacoes": "y" * 12})
    assert recusa.value.status_code == 409



def test_conferida_nao_passa_para_a_base_que_o_codigo_propuser_depois(client, db, auth_headers, monkeypatch):
    codigo = "VISITANTE"
    atual = next(a for a in client.get("/api/privacidade/inventario", headers=auth_headers).json()["atividades"] if a["codigo"] == codigo)
    if not atual["base_legal_conferida"]:
        r = client.put(f"/api/privacidade/inventario/{codigo}", headers=auth_headers, json={"base_legal_conferida": True, "versao_base": atual["versao"]})
        assert r.status_code == 200, r.text
    assert next(a for a in inventario.listar(db)["atividades"] if a["codigo"] == codigo)["base_legal_conferida"] is True
    original = inventario.buscar(codigo)
    if atual["bases_legais"] == sorted(original.bases_legais):  # o encarregado conferiu a proposta: o código passa a propor outra base
        mudada = inventario.Atividade(**{**original.__dict__, "bases_legais": tuple(sorted(set(original.bases_legais) | {"ART7_I"}))})
        monkeypatch.setattr(inventario, "_POR_CODIGO", {**inventario._POR_CODIGO, codigo: mudada})
        monkeypatch.setattr(inventario, "ATIVIDADES", tuple(mudada if a.codigo == codigo else a for a in inventario.ATIVIDADES))
        depois = next(a for a in inventario.listar(db)["atividades"] if a["codigo"] == codigo)
        assert depois["base_legal_conferida"] is False, "a base que o código propôs depois não foi conferida"


def test_o_historico_mostra_o_que_valia_ao_salvar_e_nao_a_proposta_de_hoje(client, db, auth_headers, monkeypatch):
    codigo = "TRANSPARENCIA"
    original = inventario.buscar(codigo)
    observacao = f"Observação que valia {uuid.uuid4().hex[:6]}."
    atual = next(a for a in client.get("/api/privacidade/inventario", headers=auth_headers).json()["atividades"] if a["codigo"] == codigo)
    assert client.put(f"/api/privacidade/inventario/{codigo}", headers=auth_headers, json={"observacoes": observacao, "versao_base": atual["versao"]}).status_code == 200
    mudada = inventario.Atividade(**{**original.__dict__, "finalidade": "Finalidade que o código passou a propor depois."})
    monkeypatch.setattr(inventario, "_POR_CODIGO", {**inventario._POR_CODIGO, codigo: mudada})
    monkeypatch.setattr(inventario, "ATIVIDADES", tuple(mudada if a.codigo == codigo else a for a in inventario.ATIVIDADES))
    historico = inventario.historico(db, codigo)
    assert historico[0]["campos"]["finalidade"] == original.finalidade and historico[0]["campos"]["observacoes"] == observacao
    assert historico[-1]["campos"]["finalidade"] == "Finalidade que o código passou a propor depois."


def test_o_cabecalho_usa_os_nomes_do_ato_e_avisa_quando_os_mandatos_mudaram(db, monkeypatch):
    from app.services import encarregado as servico_encarregado

    monkeypatch.setattr(servico_encarregado, "situacao", lambda db_: {
        "ato_vigente": {"numero": 7, "nome_encarregado": "Quem o Ato Nomeia", "nome_substituto": "Vice do Ato"},
        "encarregado": {"nome": "Presidente de Hoje"}, "substituto": None,
        "avisos": [{"codigo": "ATO_DE_OUTRA_PESSOA", "texto": "x"}],
    })
    cabecalho = inventario._cabecalho(db)
    assert "Quem o Ato Nomeia" in cabecalho[1] and "Presidente de Hoje" not in cabecalho[1]
    assert "Ato nº 7; os mandatos mudaram e um ato novo está pendente" in cabecalho[1]


def test_o_site_editorial_tem_titulares_crianca_e_armazenamento_proprios(db):
    editorial = next(a for a in inventario.listar(db)["atividades"] if a["codigo"] == "SITE_EDITORIAL")
    assert "quem edita as notícias do site" in editorial["titulares"] and editorial["pode_ter_crianca"] and editorial["requisito_crianca"]
    assert any("conta própria do Directus" in a for a in editorial["armazenamento"])
    assert not any("armazenamento privado" in a for a in editorial["armazenamento"]), "a mídia do Directus não fica no armazenamento privado do sistema"
    assert (_RAIZ / ".github" / "workflows" / "deploy-site.yml").exists(), "a montagem do site citada em ROTINAS_DO_GITHUB"
