"""A suíte roda em SQLite, que não impõe chave estrangeira nem ordem de DDL; a produção é Postgres, que
impõe. Aqui o `create_all` é simulado no dialeto do Postgres SEM banco (motor falso) e, na ordem real em
que o DDL seria executado, cada chave estrangeira precisa apontar para colunas que JÁ são PK/UNIQUE.

Achado de 2026-10-02: `plano_de_contas.codigo_contabil_pai -> codigo_contabil` (FK da própria tabela,
unicidade por índice criado depois do CREATE TABLE) fazia o `create_all` quebrar em qualquer Postgres
NOVO ("there is no unique constraint matching given keys") - invisível em produção, cujo schema nasceu
em etapas, e fatal para um ambiente novo de teste ou de recuperação de desastre."""
import re

from sqlalchemy import create_mock_engine

from app.database import Base


def _ddl_postgres() -> list[str]:
    instrucoes: list[str] = []
    motor = create_mock_engine("postgresql+psycopg://", lambda sql, *a, **k: instrucoes.append(str(sql.compile(dialect=motor.dialect)).strip()))
    Base.metadata.create_all(motor, checkfirst=False)
    return instrucoes


def _colunas(texto: str) -> frozenset[str]:
    return frozenset(c.strip().strip('"') for c in texto.split(","))


def test_create_all_no_postgres_nunca_cria_fk_para_coluna_ainda_sem_unicidade():
    unicos: dict[str, list[frozenset[str]]] = {}
    problemas: list[str] = []

    def referencia_ok(tabela: str, colunas: str) -> bool:
        return _colunas(colunas) in unicos.get(tabela.strip('"'), [])

    for stmt in _ddl_postgres():
        criar = re.match(r"CREATE TABLE (\S+) \(", stmt)
        if criar:
            tabela = criar.group(1).strip('"')
            for cols in re.findall(r"(?:PRIMARY KEY|UNIQUE) \(([^)]*)\)", stmt):
                unicos.setdefault(tabela, []).append(_colunas(cols))
            for alvo, cols in re.findall(r"FOREIGN KEY\([^)]*\) REFERENCES (\S+) \(([^)]*)\)", stmt):
                if not referencia_ok(alvo, cols):
                    problemas.append(f"{tabela} -> {alvo}({cols}): FK dentro do CREATE TABLE, sem PK/UNIQUE ainda")
            continue
        indice = re.match(r"CREATE UNIQUE INDEX \S+ ON (\S+) \(([^)]*)\)", stmt)
        if indice:
            unicos.setdefault(indice.group(1).strip('"'), []).append(_colunas(indice.group(2)))
            continue
        alterar = re.match(r"ALTER TABLE (\S+) ADD CONSTRAINT \S+ FOREIGN KEY\([^)]*\) REFERENCES (\S+) \(([^)]*)\)", stmt)
        if alterar and not referencia_ok(alterar.group(2), alterar.group(3)):
            problemas.append(f"{alterar.group(1)} -> {alterar.group(2)}({alterar.group(3)}): ALTER antes da unicidade")

    assert not problemas, "Postgres recusaria esta ordem de criação:\n  " + "\n  ".join(problemas)


def test_a_simulacao_enxerga_o_schema_inteiro():
    """Sanidade do próprio teste: se o motor falso parar de emitir DDL, o teste acima passaria à toa."""
    instrucoes = _ddl_postgres()
    assert sum(1 for s in instrucoes if s.startswith("CREATE TABLE")) == len(Base.metadata.tables) > 100
    assert any(s.startswith("CREATE UNIQUE INDEX") for s in instrucoes)
