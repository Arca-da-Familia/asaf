"""SÓ HOMOLOGAÇÃO - o "início de uso" fictício do sistema de teste, para o robô conferir o relatório anual (v6.3c).

O relatório anual só é montado de ano ENCERRADO em que o sistema já era usado (o primeiro registro da Auditoria): um ano anterior sairia com zeros que
não correspondem à realidade. A homologação foi criada em 2026, então, sem isto, o único ano encerrado (2025) seria recusado lá e o fluxo inteiro só
poderia ser conferido em 2027. Este roteiro grava UMA entrada antiga na Auditoria do banco de TESTE (02/01/2025, ação `INICIO_FICTICIO_DE_TESTE`,
dizendo o que é), tudo inventado como o resto da homologação; a produção nunca recebe isto. Idempotente.

Segurança: recusa rodar se o `DATABASE_URL` não for o do banco `asaf_hml` e confere de novo o nome do banco antes de qualquer escrita.

Uso: `python scripts/hml_inicio_do_sistema.py` a partir da raiz do repositório, com `DATABASE_URL` (o do banco de teste) no ambiente."""
import json
import os
import sys
from datetime import datetime

from sqlalchemy import text

BANCO_HML = "asaf_hml"
INICIO_FICTICIO = datetime(2025, 1, 2, 12, 0)
ACAO = "INICIO_FICTICIO_DE_TESTE"


def marcar(db) -> bool:
    """Grava o início fictício se a Auditoria ainda não tem nada até ele; devolve se gravou. Quem chama confere o banco antes."""
    from app.models.core import AuditLog

    if db.query(AuditLog.id_log).filter(AuditLog.timestamp <= INICIO_FICTICIO).first() is not None:
        return False
    db.add(AuditLog(
        tabela_afetada="homologacao", acao=ACAO, timestamp=INICIO_FICTICIO,
        dados_depois=json.dumps({"motivo": "Só na homologação: início de uso fictício, para o robô conferir o relatório anual de um ano encerrado."},
                                ensure_ascii=False),
    ))
    db.commit()
    return True


def main() -> int:
    if f"/{BANCO_HML}" not in os.environ.get("DATABASE_URL", ""):
        raise SystemExit(f"RECUSADO: DATABASE_URL não aponta para o banco de teste ('{BANCO_HML}').")
    from app.database import SessaoLocal

    db = SessaoLocal()
    try:
        nome = db.execute(text("SELECT current_database()")).scalar()
        if nome != BANCO_HML:
            raise SystemExit(f"RECUSADO: este roteiro só roda no banco de teste ('{BANCO_HML}'), não em '{nome}'.")
        gravou = marcar(db)
        print(f"[hml-inicio-do-sistema] {'início fictício gravado' if gravou else 'já havia registro até 02/01/2025: nada a fazer'}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
