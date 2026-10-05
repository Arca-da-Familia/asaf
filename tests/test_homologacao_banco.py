"""O auxiliar do banco de HOMOLOGAÇÃO só pode mexer no banco de teste. Estes testes usam conexões FALSAS (nenhum banco de verdade)
e conferem o SQL que seria enviado: o nome do banco é constante, não há como apontar para o banco de produção, o script não mexe em
MFA nem em nível de acesso e a senha nunca é impressa."""
import importlib.util
from pathlib import Path

import pytest

_CAMINHO = Path(__file__).resolve().parent.parent / "scripts" / "homologacao_banco.py"
_especificacao = importlib.util.spec_from_file_location("homologacao_banco", _CAMINHO)
hb = importlib.util.module_from_spec(_especificacao)
_especificacao.loader.exec_module(hb)


class CursorFalso:
    def __init__(self, existentes=(), banco_atual="asaf_hml"):
        self.comandos: list[str] = []
        self._existentes = set(existentes)
        self._banco_atual = banco_atual
        self._ultimo = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, comando, parametros=None):
        texto = comando if isinstance(comando, str) else comando.as_string()
        self.comandos.append(texto)
        self._ultimo = (texto, parametros)

    def fetchone(self):
        texto, parametros = self._ultimo
        if "current_database" in texto:
            return (self._banco_atual,)
        if "pg_roles" in texto:
            return (1,) if ("papel" in self._existentes) else None
        if "pg_database" in texto:
            return (1,) if ("banco" in self._existentes) else None
        return None


class ConexaoFalsa:
    def __init__(self, existentes=(), banco_atual="asaf_hml"):
        self.cursor_falso = CursorFalso(existentes, banco_atual)

    def cursor(self):
        return self.cursor_falso

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


def test_o_nome_do_banco_e_do_papel_sao_constantes_do_banco_de_teste():
    assert hb.BANCO_HML == "asaf_hml" and hb.PAPEL_HML == "asaf_hml"
    assert hb.CONEXOES_DO_PAPEL <= 5, "o servidor é compartilhado com a produção (50 conexões, produção usa até 25)"


def test_so_o_banco_de_teste_passa_na_trava():
    hb.exigir_banco_de_teste("asaf_hml")
    for outro in ("asaf_db", "postgres", "azure_sys", "", None):
        with pytest.raises(hb.AlvoProibido, match="RECUSADO"):
            hb.exigir_banco_de_teste(outro)


def test_preparar_cria_papel_e_banco_quando_nao_existem():
    conexao = ConexaoFalsa()
    feito = hb.preparar(conexao, "senha-de-teste")
    sql = "\n".join(conexao.cursor_falso.comandos)
    assert 'CREATE ROLE "asaf_hml" LOGIN PASSWORD' in sql and "CONNECTION LIMIT 5" in sql
    assert 'CREATE DATABASE "asaf_hml" OWNER "asaf_hml"' in sql
    assert feito == ["papel criado", "banco criado"]


def test_preparar_e_idempotente_renova_a_senha_e_confere_o_dono():
    conexao = ConexaoFalsa(existentes=("papel", "banco"))
    feito = hb.preparar(conexao, "outra-senha")
    sql = "\n".join(conexao.cursor_falso.comandos)
    assert 'ALTER ROLE "asaf_hml" LOGIN PASSWORD' in sql and "CREATE ROLE" not in sql
    assert 'ALTER DATABASE "asaf_hml" OWNER TO "asaf_hml"' in sql and "CREATE DATABASE" not in sql
    assert feito == ["papel já existia (senha renovada)", "banco já existia (dono conferido)"]


def test_resetar_descarta_so_o_banco_de_teste_e_recria_vazio():
    conexao = ConexaoFalsa(existentes=("papel",))
    hb.resetar(conexao, "senha-de-teste")
    sql = [c for c in conexao.cursor_falso.comandos if "DATABASE" in c]
    assert sql == ['DROP DATABASE IF EXISTS "asaf_hml" WITH (FORCE)', 'CREATE DATABASE "asaf_hml" OWNER "asaf_hml"']
    assert not any("asaf_db" in c for c in conexao.cursor_falso.comandos), "o banco de produção nunca aparece"


def test_nenhuma_funcao_aceita_o_nome_de_outro_banco():
    import inspect

    for funcao in (hb.preparar, hb.resetar):
        assert list(inspect.signature(funcao).parameters) == ["conexao_admin", "senha"], funcao.__name__
    assert list(inspect.signature(hb.entregar_esquema_public).parameters) == ["conexao_no_banco_de_teste"]


def test_o_esquema_public_do_banco_novo_passa_ao_papel_de_teste():
    """Achado do 1º reinício real (2026-10-05): no Azure o `public` de um banco novo é do `azure_pg_admin` e o papel de teste, dono do
    banco, não conseguia criar tabela. A correção roda DENTRO do banco de teste e só nele."""
    conexao = ConexaoFalsa()
    feito = hb.entregar_esquema_public(conexao)
    assert [c for c in conexao.cursor_falso.comandos if "SCHEMA" in c] == ['ALTER SCHEMA public OWNER TO "asaf_hml"']
    assert feito == ["esquema public do banco de teste entregue ao papel de teste"]
    for outro in ("asaf_db", "postgres"):
        errada = ConexaoFalsa(banco_atual=outro)
        with pytest.raises(hb.AlvoProibido, match="RECUSADO"):
            hb.entregar_esquema_public(errada)
        assert not any("SCHEMA" in c for c in errada.cursor_falso.comandos), "em outro banco nem chega a mexer no esquema"


def test_o_script_nao_tem_como_enfraquecer_o_mfa():
    texto = _CAMINHO.read_text(encoding="utf-8").lower()
    assert "exige_mfa" not in texto and "liberar" not in texto and "niveis_acesso" not in texto


def test_main_pede_as_variaveis_e_nunca_imprime_a_senha(capsys):
    with pytest.raises(SystemExit, match="HML_SENHA"):
        hb.main(["preparar"], env={"ADMIN_DATABASE_URL": "postgresql://adm:x@h:5432/asaf_db"}, conectar=lambda dsn: ConexaoFalsa())
    with pytest.raises(SystemExit, match="ADMIN_DATABASE_URL"):
        hb.main(["resetar"], env={"HML_SENHA": "s"}, conectar=lambda dsn: ConexaoFalsa())

    usados = []
    conexoes = []

    def conectar(dsn):
        usados.append(dsn)
        conexoes.append(ConexaoFalsa())
        return conexoes[-1]

    env = {"ADMIN_DATABASE_URL": "postgresql://adm:segredo-do-admin@h.exemplo:5432/asaf_db?sslmode=require", "HML_SENHA": "SENHA-SECRETA-HML"}
    assert hb.main(["preparar"], env=env, conectar=conectar) == 0
    saida = capsys.readouterr().out
    assert "SENHA-SECRETA-HML" not in saida and "segredo-do-admin" not in saida
    assert "dbname=postgres" in usados[0] and "asaf_db" not in usados[0], "o administrador conecta no banco de manutenção, não no de produção"
    assert len(usados) == 2 and "dbname=asaf_hml" in usados[1] and "asaf_db" not in usados[1], "e depois dentro do banco de teste"
    assert any("ALTER SCHEMA public OWNER" in c for c in conexoes[1].cursor_falso.comandos)
    assert not any("SCHEMA" in c for c in conexoes[0].cursor_falso.comandos), "no banco de manutenção não se mexe em esquema"


def test_comando_desconhecido_mostra_a_ajuda_e_nao_faz_nada(capsys):
    chamadas = []
    assert hb.main(["apagar-tudo"], env={}, conectar=lambda dsn: chamadas.append(dsn)) == 2
    assert chamadas == [] and "preparar" in capsys.readouterr().out
