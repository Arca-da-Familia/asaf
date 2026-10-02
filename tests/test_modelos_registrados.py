"""O Alembic só enxerga os modelos que `import app.models` registra (alembic/env.py). Achado de
2026-10-02: modelos de importacao/filiacao/situacao/voluntariado/qualidade_cadastro ficavam de fora, e
`alembic check` quebrava (NoReferencedTableError) - o autogenerate também "apagaria" essas tabelas.
Aqui o pacote é importado SOZINHO, num processo novo, do jeito que o Alembic faz."""
import json
import subprocess
import sys
from pathlib import Path

from app.database import Base

_RAIZ = Path(__file__).resolve().parent.parent


def test_import_app_models_sozinho_registra_todas_as_tabelas_do_sistema():
    codigo = (
        "import json, os; os.environ['DATABASE_URL']='sqlite:///:memory:'; "
        "from app.database import Base; import app.models; "
        "print(json.dumps(sorted(Base.metadata.tables)))"
    )
    saida = subprocess.run([sys.executable, "-c", codigo], capture_output=True, text=True, cwd=_RAIZ, check=True)
    so_models = set(json.loads(saida.stdout.strip().splitlines()[-1]))
    # Esta suíte importa app.main (todos os routers): é o conjunto completo de tabelas em uso.
    completo = set(Base.metadata.tables)
    assert so_models == completo, f"invisíveis para o Alembic: {sorted(completo - so_models)}"


def test_toda_chave_estrangeira_aponta_para_tabela_registrada():
    """O defeito exato: FK para tabela que o metadata não conhece (`associados.id_lote_importacao`)."""
    tabelas = set(Base.metadata.tables)
    for tabela in Base.metadata.tables.values():
        for fk in tabela.foreign_keys:
            alvo = fk.target_fullname.rsplit(".", 1)[0]
            assert alvo in tabelas, f"{tabela.name}.{fk.parent.name} -> {alvo} (tabela desconhecida)"
