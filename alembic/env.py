import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

# Garante que "app" seja importável mesmo quando o Alembic roda de outro diretório.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# DATABASE_URL vem do ambiente, igual ao resto da aplicação (nunca hardcoded aqui) -
# sobrescreve o que estiver em alembic.ini.
db_url = os.environ.get("DATABASE_URL")
if db_url:
    config.set_main_option("sqlalchemy.url", db_url)

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Importa TODOS os models (via app/models/__init__.py) para que o autogenerate enxergue
# todas as tabelas - sem isso, tabelas de módulos não importados aqui ficariam invisíveis
# pro Alembic e ele tentaria "apagá-las" por engano.
from app.database import Base
import app.models  # noqa: F401 - o import em si já registra tudo em Base.metadata

target_metadata = Base.metadata


def include_object(object, name, type_, reflected, compare_to):
    """Ignora as tabelas do Directus (directus_*) - o Directus é dono delas, não a gente.
    Elas vivem no MESMO banco Postgres (decisão de arquitetura, ver PLANO_PROJETO.md
    seção 3), mas o Alembic desta API nunca deve criar, alterar ou apagar nenhuma."""
    if type_ == "table" and name.startswith("directus_"):
        return False
    return True

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_object=include_object,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
