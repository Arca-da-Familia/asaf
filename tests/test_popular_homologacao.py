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
                               senhas={{"secretario": "Secretaria-Senha-Do-Cofre-77", "tesoureiro": "Tesouraria-Senha-Do-Cofre-88",
                                       "cargo_presidente": "CargoPresidente-Senha-Do-Cofre-11", "vice_presidente": "VicePresidente-Senha-Do-Cofre-22",
                                       "vice_presidente_2": "VicePresidente2-Senha-Do-Cofre-33", "conselheiro": "Conselheiro-Senha-Do-Cofre-44",
                                       "conselheiro_2": "Conselheiro2-Senha-Do-Cofre-55", "conselheiro_3": "Conselheiro3-Senha-Do-Cofre-66"}})
        def entrar():
            # entra pelo caminho de verdade (CPF e senha) e pergunta ao sistema se ainda exige o segundo passo
            login = client.post("/auth/login", json={{"cpf": ph.cpf_valido(111000111), "senha": "Senha-De-Teste-Do-Roteiro-1"}})
            corpo = login.json()
            eu = client.get("/auth/me", headers={{"Authorization": "Bearer " + corpo.get("access_token", "")}}).json()
            return {{"status": login.status_code, "requer_mfa": corpo.get("requer_mfa"), "mfa_obrigatorio": eu.get("mfa_obrigatorio"),
                    "mfa_pendente": eu.get("mfa_pendente")}}

        niveis_com_mfa = lambda: db.execute(text("select count(*) from niveis_acesso where exige_mfa = 1")).scalar()
        antes, entrada_antes = niveis_com_mfa(), entrar()
        ph._nome_do_banco = lambda _db: "asaf_hml"  # o SQLite descartável faz de conta que é o banco de teste
        afetados = ph.desligar_segundo_passo_do_ambiente_de_teste(db)
        mfa = {{"antes": antes, "afetados": afetados, "depois": niveis_com_mfa(), "entrada_antes": entrada_antes, "entrada_depois": entrar()}}
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
    print("@@" + json.dumps({{"resultado": resultado, "resumo": resumo, "publico": publico, "saidas": saidas, "mfa": mfa}}, default=str))
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


def test_segundo_passo_fica_desligado_no_banco_de_teste_e_o_login_entra_so_com_cpf_e_senha(execucao):
    """Decisão do presidente (2026-10-05): a homologação não tem segundo passo. Antes de desligar, o Presidente de teste ERA obrigado a
    configurá-lo (prova de que o roteiro mexeu em algo real); depois, entra direto e o sistema não pede mais nada."""
    mfa = execucao[0]["mfa"]
    assert mfa["antes"] > 0 and mfa["entrada_antes"]["mfa_pendente"] is True, mfa
    assert mfa["afetados"] == mfa["antes"] and mfa["depois"] == 0, mfa
    assert mfa["entrada_depois"] == {"status": 200, "requer_mfa": False, "mfa_obrigatorio": False, "mfa_pendente": False}, mfa


def test_o_segundo_passo_so_pode_ser_desligado_no_banco_de_teste():
    """A produção (`asaf_db`) e qualquer outro banco são RECUSADOS antes de qualquer escrita."""

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
            raise AssertionError("não pode nem chegar a tocar nos níveis de acesso")

        def commit(self):
            raise AssertionError("não pode gravar nada")

    for outro in ("asaf_db", "postgres", "asaf_hml_copia"):
        with pytest.raises(SystemExit, match="RECUSADO"):
            ph.desligar_segundo_passo_do_ambiente_de_teste(BancoFalso(outro))


def test_nada_fora_do_roteiro_de_homologacao_desliga_o_segundo_passo():
    """O segundo passo só some por este roteiro, que só roda no `asaf_hml`: o código do sistema (`app/`) segue exigindo-o, e o
    catálogo de produção nasce com a exigência ligada."""
    from app.database import SessaoLocal  # noqa: F401 - só garante que o pacote carrega
    texto = (RAIZ / "app" / "database.py").read_text(encoding="utf-8")
    assert '"nome_nivel": "Presidente"' in texto and '"exige_mfa": True' in texto
    for arquivo in (RAIZ / "app").rglob("*.py"):
        assert "desligar_segundo_passo" not in arquivo.read_text(encoding="utf-8"), arquivo


def test_cria_o_secretario_e_o_tesoureiro_de_teste_e_nao_vaza_senha(execucao):
    dados, processo = execucao
    usuarios = dados["resultado"]["usuarios"]
    # os extras (diretoria com cargo e conselheiro fiscal) só existem porque o cofre trouxe a senha deles
    assert set(usuarios) == {
        "presidente", "secretario", "tesoureiro", "cargo_presidente", "vice_presidente", "vice_presidente_2", "conselheiro", "conselheiro_2",
        "conselheiro_3",
    }
    saida_visivel = "\n".join(dados["saidas"]) + processo.stderr
    assert usuarios["secretario"]["senha"] == "Secretaria-Senha-Do-Cofre-77", "usa a senha recebida do cofre"
    assert usuarios["tesoureiro"]["senha"] == "Tesouraria-Senha-Do-Cofre-88"
    assert usuarios["conselheiro"]["cpf"] == "22205543334", "o CPF inventado que o robô e o HOMOLOGACAO.md conhecem"
    assert usuarios["vice_presidente"]["cpf"] == "22200791984" and usuarios["vice_presidente_2"]["cpf"] == "22201583811"
    assert usuarios["cargo_presidente"]["cpf"] == "22200000014"
    assert usuarios["conselheiro_2"]["cpf"] == "22206335271" and usuarios["conselheiro_3"]["cpf"] == "22207127109"
    for papel in ("secretario", "tesoureiro", "cargo_presidente", "vice_presidente", "vice_presidente_2", "conselheiro", "conselheiro_2", "conselheiro_3"):
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


def test_o_script_roda_como_arquivo_de_qualquer_pasta_e_acha_o_pacote_app(tmp_path):
    """A 2ª execução do fluxo falhou com `No module named 'app'`: `python scripts/popular_homologacao.py` só enxerga a pasta `scripts/`.
    Aqui o script roda COMO ARQUIVO, de outra pasta, num banco SQLite (que não é o de teste de verdade): tem que passar do `import app`
    e só parar na trava do banco, nunca por falta de módulo."""
    import os

    env = {**os.environ, "DATABASE_URL": f"sqlite:///{(tmp_path / 'asaf_hml.db').as_posix()}", "JWT_SECRET": "x", "RUN_DB_MIGRATION": "true"}
    env.pop("PYTHONPATH", None)
    r = subprocess.run([sys.executable, str(CAMINHO)], cwd=tmp_path, env=env, capture_output=True, text=True, encoding="utf-8", timeout=300)
    saida = r.stdout + r.stderr
    assert "No module named" not in saida, saida[-800:]
    assert r.returncode != 0, "num banco que não é o de teste de verdade a trava tem que parar o roteiro"
