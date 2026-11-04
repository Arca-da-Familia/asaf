"""v9.2b (FASE 9): os índices de desempenho - os filtros e as ligações que as telas usam nas tabelas que crescem (ver app/models/indices_de_desempenho.py)

Achado ao medir a API na homologação (robô v9.2b-01): a lista de títulos com p95 de 2,9 s e as contas financeiras com 0,8 s; o Postgres não cria índice
nas ligações entre tabelas, e o saldo de cada conta lia todas as partidas do sistema. Só CRIA índices (nenhum dado muda); o `downgrade` os apaga. A lista
abaixo é cópia congelada da do modelo; tests/test_indices_de_desempenho.py confere que as duas são iguais.

Revision ID: 63e4f4c4065a
Revises: ccf5cbf31408
Create Date: 2026-11-04 15:00:00

"""
from typing import Sequence, Union

from alembic import op

revision: str = '63e4f4c4065a'
down_revision: Union[str, Sequence[str], None] = 'ccf5cbf31408'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDICES = [
    ("ix_partidas_contabeis_id_conta", "partidas_contabeis", ["id_conta"]),
    ("ix_partidas_contabeis_id_lancamento", "partidas_contabeis", ["id_lancamento"]),
    ("ix_lancamentos_contabeis_id_titulo", "lancamentos_contabeis", ["id_titulo"]),
    ("ix_titulos_financeiros_status_vencimento", "titulos_financeiros", ["status", "data_vencimento"]),
    ("ix_titulos_financeiros_data_vencimento", "titulos_financeiros", ["data_vencimento"]),
    ("ix_titulos_financeiros_id_fornecedor", "titulos_financeiros", ["id_fornecedor"]),
    ("ix_doacoes_id_associado", "doacoes", ["id_associado"]),
    ("ix_doacoes_id_titulo", "doacoes", ["id_titulo"]),
    ("ix_inscricoes_id_titulo_cobranca", "inscricoes", ["id_titulo_cobranca"]),
    ("ix_reservas_espaco_id_titulo_cobranca", "reservas_espaco", ["id_titulo_cobranca"]),
    ("ix_enderecos_id_associado", "enderecos", ["id_associado"]),
    ("ix_documentos_anexos_id_associado", "documentos_anexos", ["id_associado"]),
    ("ix_historico_cargos_id_associado", "historico_cargos", ["id_associado"]),
    ("ix_isencoes_contribuicao_id_associado", "isencoes_contribuicao", ["id_associado"]),
    ("ix_negociacoes_divida_id_associado", "negociacoes_divida", ["id_associado"]),
    ("ix_creditos_associado_id_associado", "creditos_associado", ["id_associado"]),
    ("ix_reembolsos_despesa_id_associado", "reembolsos_despesa", ["id_associado"]),
    ("ix_documentos_emitidos_id_pessoa", "documentos_emitidos", ["id_pessoa"]),
    ("ix_alocacoes_voluntarios_id_projeto", "alocacoes_voluntarios", ["id_projeto"]),
    ("ix_alocacoes_voluntarios_id_associado", "alocacoes_voluntarios", ["id_associado"]),
    ("ix_registros_horas_voluntariado_id_projeto", "registros_horas_voluntariado", ["id_projeto"]),
    ("ix_registros_horas_voluntariado_id_alocacao", "registros_horas_voluntariado", ["id_alocacao"]),
    ("ix_respostas_pesquisa_satisfacao_id_inscricao", "respostas_pesquisa_satisfacao", ["id_inscricao"]),
    ("ix_audit_log_id_usuario", "audit_log", ["id_usuario"]),
    ("ix_tokens_acesso_id_usuario", "tokens_acesso", ["id_usuario"]),
]


def upgrade() -> None:
    for nome, tabela, colunas in INDICES:
        op.create_index(nome, tabela, colunas, if_not_exists=True)


def downgrade() -> None:
    for nome, tabela, _ in reversed(INDICES):
        op.drop_index(nome, table_name=tabela, if_exists=True)
