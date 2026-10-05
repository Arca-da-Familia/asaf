"""Banco do AMBIENTE DE HOMOLOGAÇÃO (teste, só com dados inventados) — preparar e reiniciar.

    python scripts/homologacao_banco.py preparar      # papel `asaf_hml` + banco `asaf_hml` (idempotente)
    python scripts/homologacao_banco.py resetar       # APAGA o banco de teste inteiro e o recria vazio

Este script cuida só do banco (papel, banco, esquema): não mexe em usuário, nível de acesso nem em segundo passo (MFA). Na
homologação o MFA fica desligado, e quem o desliga é `scripts/popular_homologacao.py`, só no banco de teste.

Por que "resetar" apaga o BANCO e não as linhas: a produção tem trava no próprio banco que impede apagar lançamento e
auditoria (de propósito, ver `criar_trava_delete_imutavel`). No teste isso é o que se quer poder desfazer, e a única forma é
descartar o banco inteiro e criá-lo de novo.

Segurança (cada trava tem teste em tests/test_homologacao_banco.py):
  - o nome do banco e do papel são CONSTANTES (`asaf_hml`): não existe argumento nem variável que aponte para outro banco, então
    o banco de produção não pode ser apagado nem alterado por aqui;
  - o papel de teste só é dono do banco de teste e tem no máximo 5 conexões (o servidor é compartilhado com a produção);
  - nenhuma senha é impressa.

Variáveis de ambiente:
    ADMIN_DATABASE_URL  endereço do banco com o usuário administrador do servidor (preparar, resetar)
    HML_SENHA           senha do papel `asaf_hml` (preparar, resetar)
"""
from __future__ import annotations

import os
import sys

BANCO_HML = "asaf_hml"
PAPEL_HML = "asaf_hml"
CONEXOES_DO_PAPEL = 5


class AlvoProibido(SystemExit):
    """Qualquer tentativa de agir fora do banco de teste."""


def exigir_banco_de_teste(nome: str | None) -> None:
    if nome != BANCO_HML:
        raise AlvoProibido(f"RECUSADO: este script só mexe no banco de teste ('{BANCO_HML}'), não em '{nome}'.")


def _dsn_com_banco(dsn: str, banco: str) -> str:
    from psycopg.conninfo import conninfo_to_dict, make_conninfo

    return make_conninfo(**{**conninfo_to_dict(dsn), "dbname": banco})


def _sql():
    from psycopg import sql

    return sql


def _papel_existe(cur) -> bool:
    cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (PAPEL_HML,))
    return cur.fetchone() is not None


def _banco_existe(cur) -> bool:
    cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (BANCO_HML,))
    return cur.fetchone() is not None


def _garantir_papel(cur, senha: str) -> str:
    sql = _sql()
    verbo = "ALTER" if _papel_existe(cur) else "CREATE"
    cur.execute(
        sql.SQL("{} ROLE {} LOGIN PASSWORD {} CONNECTION LIMIT {}").format(
            sql.SQL(verbo), sql.Identifier(PAPEL_HML), sql.Literal(senha), sql.Literal(CONEXOES_DO_PAPEL)
        )
    )
    return verbo


def preparar(conexao_admin, senha: str) -> list[str]:
    """Papel e banco de teste, sem tocar em mais nada. Idempotente."""
    sql = _sql()
    feito = []
    with conexao_admin.cursor() as cur:
        feito.append("papel criado" if _garantir_papel(cur, senha) == "CREATE" else "papel já existia (senha renovada)")
        if not _banco_existe(cur):
            cur.execute(sql.SQL("CREATE DATABASE {} OWNER {}").format(sql.Identifier(BANCO_HML), sql.Identifier(PAPEL_HML)))
            feito.append("banco criado")
        else:
            cur.execute(sql.SQL("ALTER DATABASE {} OWNER TO {}").format(sql.Identifier(BANCO_HML), sql.Identifier(PAPEL_HML)))
            feito.append("banco já existia (dono conferido)")
    return feito


def resetar(conexao_admin, senha: str) -> list[str]:
    """Descarta o banco de teste e o recria vazio. A produção nunca é alcançada: o nome é a constante."""
    sql = _sql()
    with conexao_admin.cursor() as cur:
        _garantir_papel(cur, senha)
        cur.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(BANCO_HML)))
        cur.execute(sql.SQL("CREATE DATABASE {} OWNER {}").format(sql.Identifier(BANCO_HML), sql.Identifier(PAPEL_HML)))
    return ["banco de teste apagado e recriado vazio"]


def entregar_esquema_public(conexao_no_banco_de_teste) -> list[str]:
    """Banco novo no Azure nasce com o esquema `public` do `azure_pg_admin` (só "usar", sem "criar"): o dono do banco, que é o papel de
    teste, não conseguiria criar tabela nenhuma ("permission denied for schema public"). Aqui o `public` DESTE banco passa ao papel de
    teste. Roda ligado DENTRO do banco de teste e confere o nome dele antes de mexer em qualquer coisa."""
    sql = _sql()
    with conexao_no_banco_de_teste.cursor() as cur:
        cur.execute("SELECT current_database()")
        exigir_banco_de_teste(cur.fetchone()[0])
        cur.execute(sql.SQL("ALTER SCHEMA public OWNER TO {}").format(sql.Identifier(PAPEL_HML)))
    return ["esquema public do banco de teste entregue ao papel de teste"]


def _exigir(env: dict, nome: str) -> str:
    valor = env.get(nome, "")
    if not valor:
        raise SystemExit(f"Falta a variável {nome}.")
    return valor


def main(argv: list[str], env: dict | None = None, conectar=None) -> int:
    env = os.environ if env is None else env
    if conectar is None:
        import psycopg

        conectar = lambda dsn: psycopg.connect(dsn, autocommit=True)  # noqa: E731 - CREATE/DROP DATABASE não rodam em transação
    comando = argv[0] if argv else ""
    if comando in ("preparar", "resetar"):
        senha = _exigir(env, "HML_SENHA")
        dsn_admin = _exigir(env, "ADMIN_DATABASE_URL")
        with conectar(_dsn_com_banco(dsn_admin, "postgres")) as conexao:  # o administrador conecta no banco de manutenção
            resultado = (preparar if comando == "preparar" else resetar)(conexao, senha)
        with conectar(_dsn_com_banco(dsn_admin, BANCO_HML)) as conexao_do_teste:  # e depois DENTRO do banco de teste (nome constante)
            resultado += entregar_esquema_public(conexao_do_teste)
    else:
        print(__doc__)
        return 2
    for linha in resultado:
        print(f"  + {linha}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
