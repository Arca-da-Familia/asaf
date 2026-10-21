"""v6.2d (FASE 6) - tarefa diária (GitHub Actions agendado, ver .github/workflows/tarefa-diaria-lembretes.yml): os lembretes de mensalidade por e-mail, com o Pix pronto
(antes do vencimento, no dia e depois, ver app/services/lembretes.py). Até a v6.2c só rodavam no dia 1 do mês, junto com a cobrança. Roda como SISTEMA, direto contra o banco.

Sai com 1 se a rodada parou por falha da conta ou da conexão de e-mail (quem roda precisa saber); a pausa pedida pelo servidor para a rodada sem alarme (a de amanhã
recupera); recusa de um endereço só conta como falha e o lote segue.

Uso: `python scripts/enviar_lembretes_de_mensalidade.py` a partir da raiz do repositório, com `DATABASE_URL` e as variáveis `SMTP_*` no ambiente."""
import sys

from app.database import SessaoLocal
from app.services import lembretes


def main() -> int:
    db = SessaoLocal()
    try:
        resultado = lembretes.rodada_de_lembretes(db)
        print(f"[lembretes] enviados: {len(resultado['enviados'])}, falhas: {resultado['falhas']}, parou: {resultado['parou'] or 'não'}")
        return 1 if resultado["parou"] in lembretes.PARA_COM_ALARME else 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
