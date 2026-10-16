"""v5.6a (FASE 5) - rotina periódica (disparada pelo GitHub Actions agendado, ver .github/workflows/tarefa-eventos-vagas.yml): a doação feita pelo site que ninguém confirmou
no prazo passa de "Aguardando conferência" para "Prazo vencido sem confirmação" (sai da frente da tesouraria; continua podendo ser confirmada). Roda como SISTEMA, direto
contra o banco.

Uso: `python scripts/expirar_intencoes_de_doacao.py` a partir da raiz do repositório, com `DATABASE_URL` no ambiente."""
import sys

from app.database import SessaoLocal
from app.services import doacao_online


def main() -> int:
    db = SessaoLocal()
    try:
        expiradas = doacao_online.expirar_vencidas(db)
        print(f"[expirar-intencoes-de-doacao] intenções expiradas: {expiradas}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
