"""v5.7b (FASE 5) - rotina periódica (disparada pelo GitHub Actions agendado, ver .github/workflows/tarefa-eventos-vagas.yml e, na homologação, deploy-homologacao.yml): aplica os PRAZOS DE GUARDA
de dado pessoal (LGPD, arts. 15 e 16) que já venceram, conforme a "Tabela de temporalidade" do PLANO_PROJETO.md e as regras de Configurações (app/services/retencao.py). Roda como SISTEMA, direto contra
o banco. Sai com código 1 se alguma regra falhou: uma rotina de apagar que falha em silêncio deixa o dado guardado sem ninguém saber.

Uso: `python scripts/aplicar_retencao_de_dados.py` a partir da raiz do repositório, com `DATABASE_URL` no ambiente."""
import sys

from app.database import SessaoLocal
from app.services import retencao


def main() -> int:
    db = SessaoLocal()
    try:
        resultado = retencao.aplicar_todas(db)
        for regra in retencao.REGRAS:
            if regra.codigo in resultado["aplicadas"]:
                print(f"[aplicar-retencao] {regra.codigo}: {resultado['aplicadas'][regra.codigo]}")
        falhas = resultado["falhas"]
        if falhas:
            print(f"::error::{len(falhas)} regra(s) de retenção falharam: {', '.join(falhas)} (veja o log acima).")
            return 1
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
