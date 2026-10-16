"""v5.7d (FASE 5) - rotina periódica (disparada pelo GitHub Actions agendado, ver .github/workflows/tarefa-eventos-vagas.yml e, na homologação, deploy-homologacao.yml): apaga a foto da Diretoria de
quem não tem mais mandato vigente nem marcado (o vencimento natural do mandato não é um clique de ninguém, então alguém precisa olhar). Decisão do Presidente (2026-10-15): "a foto da diretoria tem que
apagar automaticamente; não pode ficar guardada". Roda como SISTEMA, direto contra o banco, e apaga o arquivo no armazenamento privado (`ARMAZENAMENTO_BLOB_URL` no ambiente; sem ele, o disco local). Sai com código 1 se alguma foto não pôde ser apagada.

Uso: `python scripts/apagar_fotos_da_diretoria_vencidas.py` a partir da raiz do repositório, com `DATABASE_URL` (e `ARMAZENAMENTO_BLOB_URL`) no ambiente."""
import sys

from app.database import SessaoLocal
from app.services import fotos_da_diretoria


def main() -> int:
    db = SessaoLocal()
    try:
        apagadas, falhas = fotos_da_diretoria.apagar_fotos_sem_mandato(db)
        print(f"[apagar-fotos-da-diretoria] fotos apagadas: {apagadas}; que não foi possível apagar: {falhas}")
        if falhas:
            # a foto continua guardada: o fluxo tem de ficar VERMELHO (sem papel de dados no armazenamento, por exemplo, o apagamento falha e antes tudo parecia certo)
            print(f"::error::{falhas} foto(s) da Diretoria não puderam ser apagadas do armazenamento (confira o papel de dados da identidade do fluxo e o log acima).")
            return 1
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
