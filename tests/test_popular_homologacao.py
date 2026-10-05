"""O roteiro que preenche a HOMOLOGAÇÃO com dados inventados roda de verdade, de ponta a ponta, num banco SQLite DESCARTÁVEL e num
processo à parte (para não poluir o banco compartilhado da suíte). Prova que todas as áreas são criadas pelas rotas reais, que
nada de dado real entra, que as senhas nunca aparecem na saída e que as travas recusam qualquer banco que não seja o de teste."""
import importlib.util
import json
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
CAMINHO = RAIZ / "scripts" / "popular_homologacao.py"
_especificacao = importlib.util.spec_from_file_location("popular_homologacao", CAMINHO)
ph = importlib.util.module_from_spec(_especificacao)
_especificacao.loader.exec_module(ph)

MOTORISTA = textwrap.dedent(
    """
    import importlib.util, json, os, sys
    sys.path.insert(0, {raiz!r})
    os.environ.update(DATABASE_URL={url!r}, JWT_SECRET="segredo-de-teste-do-roteiro", RUN_DB_MIGRATION="true")
    from fastapi.testclient import TestClient
    from sqlalchemy import text
    from app.database import SessaoLocal
    from app.main import app
    esp = importlib.util.spec_from_file_location("popular_homologacao", {caminho!r})
    ph = importlib.util.module_from_spec(esp); esp.loader.exec_module(ph)
    saidas = []
    with SessaoLocal() as db, TestClient(app) as client:
        resultado = ph.popular(client, db, admin_senha="Senha-De-Teste-Do-Roteiro-1", escrever=saidas.append,
                               senhas={{"secretario": "Secretaria-Senha-Do-Cofre-77", "tesoureiro": "Tesouraria-Senha-Do-Cofre-88"}})
        contagem = lambda sql: db.execute(text(sql)).scalar()
        resumo = {{
            "associados": contagem("select count(*) from associados"),
            "mandatos": contagem("select count(*) from mandatos"),
            "projetos_publicos": contagem("select count(*) from projetos_eventos where visibilidade='Pública'"),
            "projeto_em_destaque": contagem("select count(*) from projetos_eventos where destaque_no_site = 1"),
            "eventos": contagem("select count(*) from eventos"),
            "eventos_publicos": contagem("select count(*) from eventos where visibilidade='Pública'"),
            "fotos_de_evento": contagem("select count(*) from fotos_evento where autorizacao_imagem = 1"),
            "fotos_de_etapa": contagem("select count(*) from fotos_etapa_parceria where autorizacao_imagem = 1"),
            "documentos_aprovados": contagem("select count(*) from documentos_institucionais where situacao='Aprovado'"),
            "parcerias_aprovadas": contagem("select count(*) from parcerias where situacao_publicacao='Aprovado'"),
            "assembleias": contagem("select count(*) from assembleias"),
            "lancamentos": contagem("select count(*) from lancamentos_contabeis"),
        }}
        publico = {{c: client.get(c).json() for c in ("/api/publico/diretoria", "/api/publico/projetos", "/api/publico/eventos",
                                                      "/api/publico/transparencia/parcerias", "/api/publico/transparencia/documentos")}}
        publico = {{c: len(v) for c, v in publico.items()}}
    print("@@" + json.dumps({{"resultado": resultado, "resumo": resumo, "publico": publico, "saidas": saidas}}, default=str))
    """
)


@pytest.fixture(scope="module")
def execucao(tmp_path_factory):
    pasta = tmp_path_factory.mktemp("roteiro-hml")
    banco = pasta / "banco.db"
    codigo = MOTORISTA.format(raiz=str(RAIZ), url=f"sqlite:///{banco.as_posix()}", caminho=str(CAMINHO))
    r = subprocess.run([sys.executable, "-c", codigo], cwd=pasta, capture_output=True, text=True, encoding="utf-8", timeout=600)
    linhas = [l for l in r.stdout.splitlines() if l.startswith("@@")]
    assert linhas, f"o roteiro não terminou:\n{r.stdout[-1500:]}\n{r.stderr[-2500:]}"
    return json.loads(linhas[-1][2:]), r


def test_todas_as_areas_sao_criadas_sem_nenhuma_falha(execucao):
    dados, _ = execucao
    assert dados["resultado"]["falhas"] == [], dados["resultado"]["falhas"]
    assert len(dados["resultado"]["feito"]) == 9


def test_o_que_foi_criado_bate_com_o_prometido(execucao):
    resumo = execucao[0]["resumo"]
    assert resumo["associados"] == 16, "15 associados + o administrador de teste"
    assert resumo["mandatos"] == 10
    assert resumo["projetos_publicos"] == 1 and resumo["projeto_em_destaque"] == 1
    assert resumo["eventos"] == 3 and resumo["eventos_publicos"] == 2
    assert resumo["fotos_de_evento"] == 3 and resumo["fotos_de_etapa"] == 1
    assert resumo["documentos_aprovados"] == 2 and resumo["parcerias_aprovadas"] == 1
    assert resumo["assembleias"] == 1 and resumo["lancamentos"] == 2


def test_o_site_publico_enxerga_o_que_ja_foi_liberado(execucao):
    publico = execucao[0]["publico"]
    assert publico["/api/publico/diretoria"] == 10
    assert publico["/api/publico/projetos"] == 1, "só o projeto Público; o interno não aparece"
    assert publico["/api/publico/eventos"] == 2, "só os eventos Públicos"
    assert publico["/api/publico/transparencia/parcerias"] == 1 and publico["/api/publico/transparencia/documentos"] == 2


def test_cria_o_secretario_e_o_tesoureiro_de_teste_e_nao_vaza_senha(execucao):
    dados, processo = execucao
    usuarios = dados["resultado"]["usuarios"]
    assert set(usuarios) == {"presidente", "secretario", "tesoureiro"}
    saida_visivel = "\n".join(dados["saidas"]) + processo.stderr
    assert usuarios["secretario"]["senha"] == "Secretaria-Senha-Do-Cofre-77", "usa a senha recebida do cofre"
    assert usuarios["tesoureiro"]["senha"] == "Tesouraria-Senha-Do-Cofre-88"
    for papel in ("secretario", "tesoureiro"):
        assert usuarios[papel]["senha"] and usuarios[papel]["cpf"] and usuarios[papel]["email"].endswith("@homologacao.example.com")
        assert usuarios[papel]["senha"] not in saida_visivel
    assert "Senha-De-Teste-Do-Roteiro-1" not in saida_visivel, "a senha do administrador nunca aparece na saída"


def test_tudo_leva_a_marca_de_teste_e_nenhum_dado_real(execucao):
    saidas = "\n".join(execucao[0]["saidas"])
    assert "FALHOU" not in saidas
    assert ph.SUFIXO_EMAIL.endswith("example.com"), "e-mail de domínio reservado: nunca chega a ninguém"
    texto = CAMINHO.read_text(encoding="utf-8").lower()
    for real in ("arcadafamilia", "@gmail", "@hotmail", "ieadespa", "@asaf"):
        assert real not in texto, real


def test_cpfs_inventados_sao_validos_e_distintos():
    from app.validadores import validar_cpf

    gerados = [ph.cpf_valido(222000000 + i * 7919) for i in range(15)] + [ph.cpf_valido(111000111)]
    assert len(set(gerados)) == 16
    for cpf in gerados:
        assert len(cpf) == 11 and validar_cpf(cpf), cpf


def test_senha_gerada_atende_a_politica_e_e_aleatoria():
    senhas = {ph.senha_aleatoria() for _ in range(20)}
    assert len(senhas) == 20
    for s in senhas:
        assert len(s) >= 12 and any(c.isupper() for c in s) and any(c.islower() for c in s) and any(c.isdigit() for c in s)


def test_a_trava_recusa_qualquer_banco_que_nao_seja_o_de_teste(monkeypatch):
    class Resultado:
        def __init__(self, valor):
            self.valor = valor

        def scalar(self):
            return self.valor

    class BancoFalso:
        def __init__(self, nome):
            self.nome = nome

        def execute(self, *_):
            return Resultado(self.nome)

        def query(self, *_):
            raise AssertionError("não deve nem chegar a consultar usuários")

    for outro in ("asaf_db", "postgres"):
        with pytest.raises(SystemExit, match="RECUSADO"):
            ph._exigir_banco_de_teste(BancoFalso(outro))
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h:5432/asaf_db")
    with pytest.raises(SystemExit, match="RECUSADO"):
        ph.main()
