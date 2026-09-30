"""v4.9 (FASE 4) - rotina periódica (disparada pelo GitHub Actions agendado, ver
.github/workflows/tarefa-fechamento-eventos.yml): todo evento encerrado sem `FechamentoEvento`
ainda ganha um automaticamente (inscritos, presentes, arrecadado, custos, resultado por centro de
custo). Roda como SISTEMA (mesmo raciocínio de scripts/expirar_promocoes_vagas.py), direto contra
o banco de produção.

Uso: `python scripts/fechar_eventos_encerrados.py` a partir da raiz do repositório, com
`DATABASE_URL` já no ambiente."""
import sys

from app.database import SessaoLocal
from app.services import fechamento_evento


def main() -> int:
    db = SessaoLocal()
    try:
        resultado = fechamento_evento.fechar_eventos_encerrados_sem_fechamento(db)
        print(f"[fechar-eventos-encerrados] eventos fechados automaticamente: {len(resultado)}")
        for item in resultado:
            print(f"  - evento #{item['id_evento']}: fechamento #{item['id_fechamento']}, resultado R$ {item['resultado']}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
