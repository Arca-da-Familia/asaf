"""SÓ HOMOLOGAÇÃO (v6.2d) - faz "passar os 90 dias" do período de experiência do candidato que o robô `v6.2d-01` aprovou, para a rotina do fim da experiência (que roda logo depois,
na mesma publicação da homologação) ter o que avisar. Mexe só em quem o robô criou para isso: situação "Em Experiência", nome começando por "Experiencia Encerrada Robo " e e-mail de
teste (`@homologacao.example.com`). Põe o fim da experiência um minuto atrás; o resto (situação recalculada, aviso no sino, Auditoria) é a rotina de verdade que faz.

Segurança: recusa rodar se o `DATABASE_URL` não for o do banco `asaf_hml` e confere de novo o nome do banco antes de qualquer escrita; a produção não tem como chegar aqui.

Uso: `python scripts/hml_encerrar_experiencia_do_robo.py` a partir da raiz do repositório, com `DATABASE_URL` (o do banco de teste) no ambiente."""
import os
import sys
from datetime import datetime, timedelta

from sqlalchemy import text

BANCO_HML = "asaf_hml"
PREFIXO_DO_ROBO = "Experiencia Encerrada Robo "
SUFIXO_EMAIL = "@homologacao.example.com"


def main() -> int:
    if f"/{BANCO_HML}" not in os.environ.get("DATABASE_URL", ""):
        raise SystemExit(f"RECUSADO: DATABASE_URL não aponta para o banco de teste ('{BANCO_HML}').")
    from app.database import SessaoLocal
    from app.models.associados import Associado
    from app.services.categoria_associado import EM_EXPERIENCIA

    db = SessaoLocal()
    try:
        nome = db.execute(text("SELECT current_database()")).scalar()
        if nome != BANCO_HML:
            raise SystemExit(f"RECUSADO: este roteiro só roda no banco de teste ('{BANCO_HML}'), não em '{nome}'.")
        do_robo = (
            db.query(Associado)
            .filter(
                Associado.status_arrolamento == EM_EXPERIENCIA,
                Associado.nome_completo.startswith(PREFIXO_DO_ROBO),
                Associado.email_contato.endswith(SUFIXO_EMAIL),
            )
            .all()
        )
        for associado in do_robo:
            associado.data_fim_experiencia = datetime.utcnow() - timedelta(minutes=1)
        db.commit()
        print(f"[hml-encerrar-experiencia] {len(do_robo)} candidato(s) do robô com a experiência encerrada")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
