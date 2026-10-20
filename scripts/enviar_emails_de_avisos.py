"""v6.2a (FASE 6) - rotina periódica (GitHub Actions agendado, ver .github/workflows/tarefa-eventos-vagas.yml): envia por e-mail, em lotes, os avisos do mural que quem publicou
marcou "também por e-mail" (ver app/services/envio_de_avisos.py: teto diário e por rodada, uma conexão por rodada, falha passageira volta para a fila). Roda como SISTEMA, direto
contra o banco, com os segredos SMTP_* no ambiente.

Sai com 1 quando não consegue conectar ao servidor de e-mail ou quando ele recusa o REMETENTE (configuração: quem roda precisa saber); recusa de um endereço é registrada no
aviso e não derruba a rodada.

Uso: `python scripts/enviar_emails_de_avisos.py` a partir da raiz do repositório, com `DATABASE_URL` e `SMTP_*` no ambiente."""
import sys

from app.database import SessaoLocal
from app.services import envio_de_avisos


def main() -> int:
    db = SessaoLocal()
    try:
        resultado = envio_de_avisos.enviar_pendentes(db)
        print(f"[enviar-emails-de-avisos] {resultado}")
        return 1 if resultado.get("erro_de_conexao") else 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
