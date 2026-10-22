"""SÓ HOMOLOGAÇÃO - as contas de teste que o robô usa (as dos papéis cujas senhas estão no cofre, criadas pelo `popular_homologacao.py` com "Conceder acesso") têm a senha do
cofre, que NÃO é provisória: o robô entra sempre com ela. Desde a correção da troca obrigatória da senha provisória (achado da v6.2d), o painel só abre a tela de troca para quem
ainda tem a senha provisória; sem este roteiro, todas essas contas cairiam nela e nenhum robô entraria. O `popular_homologacao.py` já cria as contas assim; este roteiro acerta as
que existiam antes. Mexe só nesses e-mails de teste; não toca nas contas que o próprio robô cria (essas provam a troca obrigatória). Idempotente.

Segurança: recusa rodar se o `DATABASE_URL` não for o do banco `asaf_hml` e confere de novo o nome do banco antes de qualquer escrita.

Uso: `python scripts/hml_contas_do_cofre_definitivas.py` a partir da raiz do repositório, com `DATABASE_URL` (o do banco de teste) no ambiente."""
import os
import sys

from sqlalchemy import text

BANCO_HML = "asaf_hml"


def acertar(db) -> int:
    """Marca com a senha definitiva as contas do cofre que ainda estão com a provisória; devolve quantas. Quem chama confere o banco antes."""
    from app.models.core import Usuario
    from app.services.esqueci_a_senha import EMAILS_DO_COFRE  # os papéis do `popular_homologacao.py` (PERSONAS_FIXAS e PERSONAS_EXTRAS)

    acertadas = (
        db.query(Usuario)
        .filter(Usuario.email.in_(sorted(EMAILS_DO_COFRE)), Usuario.senha_provisoria.is_(True))
        .update({"senha_provisoria": False}, synchronize_session=False)
    )
    db.commit()
    return acertadas


def main() -> int:
    if f"/{BANCO_HML}" not in os.environ.get("DATABASE_URL", ""):
        raise SystemExit(f"RECUSADO: DATABASE_URL não aponta para o banco de teste ('{BANCO_HML}').")
    from app.database import SessaoLocal

    db = SessaoLocal()
    try:
        nome = db.execute(text("SELECT current_database()")).scalar()
        if nome != BANCO_HML:
            raise SystemExit(f"RECUSADO: este roteiro só roda no banco de teste ('{BANCO_HML}'), não em '{nome}'.")
        acertadas = acertar(db)
        print(f"[hml-contas-do-cofre] {acertadas} conta(s) de teste do cofre marcadas com a senha definitiva")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
