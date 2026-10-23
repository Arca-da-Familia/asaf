"""v7.0c (FASE 7) - o inventário de dados vivo no sistema (ver app/services/inventario.py).

  1. toda tabela com dado de pessoa (classificação da v7.0b) está numa atividade; as tabelas citadas existem; os códigos de base legal, operador e regra de guarda existem;
  2. cada atividade traz as seções do modelo da ANPD, com os dados, os sensíveis e a criança lidos do modelo e o prazo lido da regra de retenção EM VIGOR;
  3. ajustar grava uma versão nova (o histórico), recusa base legal fora da lista e "nada mudou", e vai para a Auditoria; só quem tem `privacidade_gerir`;
  4. exportar em planilha e em PDF (para apresentar à ANPD), com a Auditoria;
  5. a migração 30a03a70ba56 cria exatamente a tabela que o modelo descreve."""
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
    assert "Art. 14, § 1º" in " ".join(beneficiarios["bases_legais_texto"]) and beneficiarios["base_legal_conferida"] is False
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
    historico = client.get(f"/api/privacidade/inventario/{codigo}/historico", headers=auth_headers).json()
    assert historico[0]["versao"] == depois["versao"] and historico[0]["campos"]["finalidade"] == texto and historico[-1]["por"] == "proposta do sistema"
    entrada = db.query(AuditLog).filter(AuditLog.acao == "ATIVIDADE_AJUSTADA").order_by(AuditLog.id_log.desc()).first()
    assert json.loads(entrada.dados_depois)["atividade"] == codigo and json.loads(entrada.dados_antes)["finalidade"] == atual["finalidade"]
    assert client.put(f"/api/privacidade/inventario/{codigo}", headers=auth_headers, json={"finalidade": texto}).status_code == 409, "nada mudou"
    assert client.put(f"/api/privacidade/inventario/{codigo}", headers=auth_headers, json={"bases_legais": ["ART99"]}).status_code == 422
    assert client.put(f"/api/privacidade/inventario/{codigo}", headers=auth_headers, json={"bases_legais": []}).status_code == 422
    assert client.put(f"/api/privacidade/inventario/{codigo}", headers=auth_headers, json={"operadores": ["DROPBOX"]}).status_code == 422
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
    assert tuple(linhas[0]) == inventario.COLUNAS_DA_PLANILHA and len(linhas) == len(inventario.ATIVIDADES) + 1
    beneficiarios = next(linha for linha in linhas if linha[0] == "Atendimento social a beneficiários")
    assert "registros_atendimento.relato" in beneficiarios[4] and beneficiarios[5] == "sim" and "Sem rotina automática" in beneficiarios[11]
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
