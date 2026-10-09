"""v5.5a (FASE 5) - rotina periódica (disparada pelo GitHub Actions agendado, ver .github/workflows/tarefa-eventos-vagas.yml): avisa no sino de quem atende os
pedidos da fila de atendimento que estão vencidos ou vencem em até 3 dias (uma vez por dia por pedido e por pessoa). Roda como SISTEMA, direto contra o banco.

Uso: `python scripts/avisar_prazos_de_atendimento.py` a partir da raiz do repositório, com `DATABASE_URL` no ambiente."""
import sys

from app.database import SessaoLocal
from app.services import atendimento


def main() -> int:
    db = SessaoLocal()
    try:
        criados = atendimento.avisar_prazos(db)
        print(f"[avisar-prazos-de-atendimento] avisos criados: {criados}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
