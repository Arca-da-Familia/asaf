"""v3.2.1/v3.3 (adaptado, 2026-09-17) - rotina mensal automática (disparada pelo GitHub Actions
agendado, ver .github/workflows/tarefa-mensal-financeiro.yml): gera a cobrança do mês corrente,
gera as contas a pagar recorrentes do mês (v3.3). Os lembretes por e-mail (Pix pronto) saíam daqui
também, só no dia 1; desde a v6.2d saem todo dia (scripts/enviar_lembretes_de_mensalidade.py).

Substitui Pix Automático (Resolução BCB 402/506) - exige convênio com um banco/PSP parceiro
pago, sem orçamento hoje (achado confirmado com o usuário). Roda como SISTEMA
(`id_usuario=None`, aparece no AuditLog como ação sem ator humano) - mesmo nível de confiança que
já existe pra rodar migração Alembic direto em produção (`DATABASE_URL` do Key Vault), nenhum
login humano é necessário.

Uso: `python scripts/tarefa_mensal_financeiro.py` a partir da raiz do repositório, com
`DATABASE_URL` já no ambiente."""
import sys
from datetime import datetime

from app.database import SessaoLocal
from app.services import contas_a_pagar, contribuicoes


def main() -> int:
    db = SessaoLocal()
    try:
        competencia = datetime.utcnow().strftime("%Y-%m")
        resultado_cobranca = contribuicoes.gerar_cobrancas(db, competencia=competencia, confirmar=True, id_usuario=None)
        print(f"[tarefa-mensal] cobrancas geradas: {resultado_cobranca['total_gerados']} (competencia {competencia})")

        resultado_contas_a_pagar = contas_a_pagar.gerar_contas_a_pagar(db, competencia=competencia, confirmar=True, id_usuario=None)
        print(f"[tarefa-mensal] contas a pagar recorrentes geradas: {resultado_contas_a_pagar['total_gerados']} (competencia {competencia})")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
