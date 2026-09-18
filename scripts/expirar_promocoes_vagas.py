"""v4.7 (FASE 4) - rotina periódica (disparada pelo GitHub Actions agendado, ver
.github/workflows/tarefa-eventos-vagas.yml): quem foi promovido da lista de espera de um evento
e não confirmou até o prazo perde a vaga pro próximo da fila. Roda como SISTEMA (mesmo raciocínio
de scripts/tarefa_mensal_financeiro.py), direto contra o banco de produção.

Uso: `python scripts/expirar_promocoes_vagas.py` a partir da raiz do repositório, com
`DATABASE_URL` e as variáveis `SMTP_*` já no ambiente."""
import sys

from app.database import SessaoLocal
from app.services import vagas


def main() -> int:
    db = SessaoLocal()
    try:
        resultado = vagas.expirar_promocoes_vencidas(db)
        print(f"[expirar-promocoes-vagas] promoções vencidas processadas: {len(resultado)}")
        for item in resultado:
            print(f"  - inscrição #{item['id_inscricao']} cancelada; promovido: #{item['id_promovido']}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
