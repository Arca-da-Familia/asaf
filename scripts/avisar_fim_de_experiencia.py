"""v6.2d (FASE 6) - rotina periódica (GitHub Actions agendado, ver .github/workflows/tarefa-eventos-vagas.yml): quem estava "Em Experiência" e cujo período já acabou tem a
situação recalculada, e quem cuida de Associados é avisado no sino (ver app/services/automaticos_de_associado.py). Roda como SISTEMA, direto contra o banco.

Uso: `python scripts/avisar_fim_de_experiencia.py` a partir da raiz do repositório, com `DATABASE_URL` no ambiente."""
import sys

from app.database import SessaoLocal
from app.services import automaticos_de_associado


def main() -> int:
    db = SessaoLocal()
    try:
        resultado = automaticos_de_associado.avisar_fim_de_experiencia(db)
        print(f"[fim-de-experiencia] {resultado}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
