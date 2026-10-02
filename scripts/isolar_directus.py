"""Isolamento do Directus no Postgres (v5.1.0 - achado de 2026-10-01).

PROBLEMA: o Directus compartilhava o banco `asaf_db` e conectava como `asafadmin` (o mesmo
usuario da API). Um administrador do Directus enxergava e editava TODAS as tabelas do sistema
(associados, doacoes, audit_log...), sem passar pelo RBAC nem pelo AuditLog da API.

SOLUCAO (mesmo banco, mesmo servidor, custo zero - nao e um banco separado):
  - papel `directus_app`, sem superusuario/CREATEROLE/CREATEDB, com senha propria;
  - schema `directus` pertencente a ele; as tabelas `directus_*` saem de `public` e vao para la
    (o Directus aponta para esse schema com DB_SEARCH_PATH=directus: nem lista as tabelas do
    sistema, que ficam em `public`);
  - `directus_app` NAO recebe nenhum privilegio sobre `public`: se um dia o Directus for
    comprometido, o que ele alcanca e so o proprio conteudo.
Quando o site precisar mostrar dado do sistema (evento, transparencia), isso vem da API publica
do FastAPI ou de uma VIEW com campos publicos concedida de proposito a `directus_app` - nunca de
leitura direta das tabelas de negocio.

Uso (precisa da conexao de administrador em DATABASE_URL; a senha do papel em
DIRECTUS_DB_PASSWORD - nunca por argumento de linha de comando):
    python scripts/isolar_directus.py aplicar     # cria papel/schema e move as tabelas (1 transacao)
    python scripts/isolar_directus.py verificar   # confere o isolamento; exit 1 se algo falhar
    python scripts/isolar_directus.py reverter    # volta tudo para `public` com dono asafadmin

`aplicar` e `verificar` sao idempotentes. Sobre `reverter`: so para o caso de o Directus nao
subir com a configuracao nova; depois dele, o Directus precisa voltar a DB_USER=asafadmin e sem
DB_SEARCH_PATH.
"""
from __future__ import annotations

import os
import re
import sys

import psycopg
from psycopg import sql

PAPEL = "directus_app"
SCHEMA = "directus"
PREFIXO = "directus_"


def conectar(dsn: str | None = None):
    dsn = dsn or os.environ["DATABASE_URL"]
    dsn = re.sub(r"^postgresql\+\w+://", "postgresql://", dsn)  # URL do SQLAlchemy -> libpq
    return psycopg.connect(dsn, connect_timeout=30)


def _fetch(cur, consulta, *args):
    cur.execute(consulta, args or None)
    return cur.fetchall()


def tabelas_directus(cur, schema: str) -> list[str]:
    return [r[0] for r in _fetch(
        cur, "select tablename from pg_tables where schemaname=%s and tablename like %s order by 1",
        schema, PREFIXO + "%",
    )]


def _checar_pre_condicoes(cur, origem: str, tabs: list[str]) -> None:
    """Aborta antes de mudar qualquer coisa se mover as tabelas puder quebrar outra."""
    if not tabs:
        raise SystemExit(f"nenhuma tabela {PREFIXO}* em '{origem}': nada a isolar (ja aplicado?)")
    # FK ligando tabela do Directus a tabela do sistema (ou vice-versa) impediria separar com seguranca.
    cruzadas = _fetch(cur, """
        select c.conrelid::regclass::text, c.confrelid::regclass::text
        from pg_constraint c
        where c.contype='f'
          and ((c.conrelid::regclass::text like %s) <> (c.confrelid::regclass::text like %s))
    """, PREFIXO + "%", PREFIXO + "%")
    if cruzadas:
        raise SystemExit(f"FK entre tabelas do Directus e do sistema (abortado): {cruzadas}")


def aplicar(cur, senha: str, papel: str = PAPEL, schema: str = SCHEMA, origem: str = "public") -> None:
    admin = _fetch(cur, "select current_user")[0][0]
    tabs = tabelas_directus(cur, origem)
    ja_movidas = tabelas_directus(cur, schema)
    if not tabs and ja_movidas:
        print(f"ja aplicado: {len(ja_movidas)} tabelas em '{schema}'. Nada a mover.")
    else:
        _checar_pre_condicoes(cur, origem, tabs)

    existe = _fetch(cur, "select 1 from pg_roles where rolname=%s", papel)
    if not existe:
        cur.execute(sql.SQL(
            "CREATE ROLE {} LOGIN PASSWORD {} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION "
            "CONNECTION LIMIT 20"
        ).format(sql.Identifier(papel), sql.Literal(senha)))
        print(f"papel '{papel}' criado")
    else:
        # Papel existente: so troca a senha (rotacao). Nunca amplia privilegio.
        cur.execute(sql.SQL("ALTER ROLE {} PASSWORD {}").format(sql.Identifier(papel), sql.Literal(senha)))
        print(f"papel '{papel}' ja existia: senha redefinida")

    # Para transferir o DONO das tabelas, o administrador precisa poder assumir o papel (SET).
    cur.execute(sql.SQL("GRANT {} TO {} WITH SET TRUE").format(sql.Identifier(papel), sql.Identifier(admin)))
    cur.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {} AUTHORIZATION {}").format(
        sql.Identifier(schema), sql.Identifier(papel)))
    cur.execute(sql.SQL("ALTER ROLE {} SET search_path = {}").format(sql.Identifier(papel), sql.Identifier(schema)))

    for t in tabs:
        cur.execute(sql.SQL("ALTER TABLE {}.{} SET SCHEMA {}").format(
            sql.Identifier(origem), sql.Identifier(t), sql.Identifier(schema)))
        cur.execute(sql.SQL("ALTER TABLE {}.{} OWNER TO {}").format(
            sql.Identifier(schema), sql.Identifier(t), sql.Identifier(papel)))
    # Sequencias que seguiram as tabelas (serial/identity): o dono acompanha, mas confirma-se.
    for (seq,) in _fetch(cur, "select c.relname from pg_class c where c.relkind='S' and c.relnamespace=%s::regnamespace",
                         schema):
        cur.execute(sql.SQL("ALTER SEQUENCE {}.{} OWNER TO {}").format(
            sql.Identifier(schema), sql.Identifier(seq), sql.Identifier(papel)))

    # Defesa explicita: nada sobre o schema de origem (nao havia nada, isto so garante).
    cur.execute(sql.SQL("REVOKE ALL ON ALL TABLES IN SCHEMA {} FROM {}").format(
        sql.Identifier(origem), sql.Identifier(papel)))
    cur.execute(sql.SQL("REVOKE ALL ON ALL SEQUENCES IN SCHEMA {} FROM {}").format(
        sql.Identifier(origem), sql.Identifier(papel)))
    cur.execute(sql.SQL("REVOKE CREATE ON SCHEMA {} FROM {}").format(
        sql.Identifier(origem), sql.Identifier(papel)))
    print(f"{len(tabs)} tabelas movidas de '{origem}' para '{schema}' (dono: {papel})")


def verificar(cur, papel: str = PAPEL, schema: str = SCHEMA, origem: str = "public") -> list[str]:
    """Devolve a lista de falhas (vazia = isolamento correto)."""
    falhas: list[str] = []
    r = _fetch(cur, "select rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication "
                    "from pg_roles where rolname=%s", papel)
    if not r:
        return [f"papel '{papel}' nao existe"]
    super_, createrole, createdb, login, repl = r[0]
    if super_ or createrole or createdb or repl:
        falhas.append(f"papel com privilegio demais (super={super_}, createrole={createrole}, "
                      f"createdb={createdb}, replication={repl})")
    if not login:
        falhas.append("papel nao pode fazer login")

    # 1) NENHUMA tabela/sequencia do schema de origem pode ser tocada pelo papel.
    for (nome,) in _fetch(cur, "select c.relname from pg_class c where c.relnamespace=%s::regnamespace "
                               "and c.relkind in ('r','p','v','m','f')", origem):
        for priv in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"):
            if _fetch(cur, "select has_table_privilege(%s, %s::regclass, %s)", papel,
                      f'"{origem}"."{nome}"', priv)[0][0]:
                falhas.append(f"{papel} TEM {priv} em {origem}.{nome}")
    for (nome,) in _fetch(cur, "select c.relname from pg_class c where c.relnamespace=%s::regnamespace "
                               "and c.relkind='S'", origem):
        for priv in ("USAGE", "SELECT", "UPDATE"):
            if _fetch(cur, "select has_sequence_privilege(%s, %s::regclass, %s)", papel,
                      f'"{origem}"."{nome}"', priv)[0][0]:
                falhas.append(f"{papel} TEM {priv} na sequencia {origem}.{nome}")
    if _fetch(cur, "select has_schema_privilege(%s, %s, 'CREATE')", papel, origem)[0][0]:
        falhas.append(f"{papel} pode CRIAR objetos em {origem}")

    # 2) Nenhuma tabela do Directus sobrou no schema de origem; todas no schema novo, do papel.
    sobrou = tabelas_directus(cur, origem)
    if sobrou:
        falhas.append(f"tabelas {PREFIXO}* ainda em {origem}: {sobrou}")
    dentro = _fetch(cur, "select tablename, tableowner from pg_tables where schemaname=%s", schema)
    if not dentro:
        falhas.append(f"schema '{schema}' vazio ou inexistente")
    for nome, dono in dentro:
        if dono != papel:
            falhas.append(f"{schema}.{nome} pertence a {dono}, nao a {papel}")
    for (seq, dono) in _fetch(cur, "select c.relname, pg_get_userbyid(c.relowner) from pg_class c "
                                   "where c.relkind='S' and c.relnamespace=%s::regnamespace", schema):
        if dono != papel:
            falhas.append(f"sequencia {schema}.{seq} pertence a {dono}")

    # 3) O search_path do papel aponta SO para o schema do Directus.
    cfg = _fetch(cur, "select coalesce(array_to_string(setconfig, ','), '') from pg_db_role_setting s "
                      "join pg_roles r on r.oid = s.setrole where r.rolname=%s", papel)
    if not cfg or f"search_path={schema}" not in cfg[0][0].replace('"', "").replace(" ", ""):
        falhas.append(f"search_path do papel nao e '{schema}' (atual: {cfg})")
    return falhas


def reverter(cur, papel: str = PAPEL, schema: str = SCHEMA, destino: str = "public") -> None:
    admin = _fetch(cur, "select current_user")[0][0]
    for t in tabelas_directus(cur, schema):
        cur.execute(sql.SQL("ALTER TABLE {}.{} OWNER TO {}").format(
            sql.Identifier(schema), sql.Identifier(t), sql.Identifier(admin)))
        cur.execute(sql.SQL("ALTER TABLE {}.{} SET SCHEMA {}").format(
            sql.Identifier(schema), sql.Identifier(t), sql.Identifier(destino)))
    for (seq,) in _fetch(cur, "select c.relname from pg_class c where c.relkind='S' and c.relnamespace=%s::regnamespace",
                         destino):
        if seq.startswith(PREFIXO):
            cur.execute(sql.SQL("ALTER SEQUENCE {}.{} OWNER TO {}").format(
                sql.Identifier(destino), sql.Identifier(seq), sql.Identifier(admin)))
    print(f"tabelas devolvidas a '{destino}' (dono: {admin}). Papel e schema NAO foram apagados.")


def main(argv: list[str]) -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    if len(argv) != 2 or argv[1] not in ("aplicar", "verificar", "reverter"):
        print(__doc__)
        return 2
    conn = conectar()
    try:
        cur = conn.cursor()
        if argv[1] == "aplicar":
            senha = os.environ.get("DIRECTUS_DB_PASSWORD", "")
            if len(senha) < 32:
                raise SystemExit("DIRECTUS_DB_PASSWORD ausente ou curta (<32 caracteres)")
            aplicar(cur, senha)
            falhas = verificar(cur)
            if falhas:
                conn.rollback()
                print("VERIFICACAO FALHOU - NADA foi gravado (rollback):")
                for f in falhas:
                    print("  -", f)
                return 1
            conn.commit()
            print("OK: isolamento aplicado e verificado (commit).")
            return 0
        if argv[1] == "reverter":
            reverter(cur)
            conn.commit()
            return 0
        falhas = verificar(cur)
        conn.rollback()
        if falhas:
            print("ISOLAMENTO COM FALHA:")
            for f in falhas:
                print("  -", f)
            return 1
        print("OK: o Directus nao alcanca nenhuma tabela do sistema.")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main(sys.argv))
