"""v6.2c (FASE 6) - rotina periódica (GitHub Actions agendado, ver .github/workflows/tarefa-eventos-vagas.yml): publica os avisos do mural agendados cuja hora já passou
(ver app/services/avisos_agendados.py: o grupo é recalculado na hora; agendamento que não pode mais sair é cancelado com o motivo). Roda como SISTEMA, direto contra o banco.

Sai com 1 se algum agendamento deu erro inesperado (quem roda precisa saber); cancelamento com motivo não é erro.

Uso: `python scripts/publicar_avisos_agendados.py` a partir da raiz do repositório, com `DATABASE_URL` no ambiente."""
import sys

from app.database import SessaoLocal
from app.services import avisos_agendados


def main() -> int:
    db = SessaoLocal()
    try:
        resultado = avisos_agendados.publicar_os_que_chegaram_a_hora(db)
        print(f"[publicar-avisos-agendados] {resultado}")
        return 1 if resultado["falhas"] else 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
