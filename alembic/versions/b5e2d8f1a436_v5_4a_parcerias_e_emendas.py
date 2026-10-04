"""v5.4a (FASE 5): parcerias e emendas (parcelas, etapas, relatórios e vínculo com o livro-caixa)

Cria `parcerias`, `parcelas_parceria`, `etapas_parceria`, `relatorios_parceria` e `lancamentos_parceria`. As
permissões (`parcerias`, `aprovar_publicacao`) já foram acrescentadas aos cargos pela migração anterior
(a7c1e9d3f0b2). Nada de dado existente é tocado.

Revision ID: b5e2d8f1a436
Revises: a7c1e9d3f0b2
Create Date: 2026-10-04 12:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b5e2d8f1a436'
down_revision: Union[str, Sequence[str], None] = 'a7c1e9d3f0b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDICES = {
    "parcerias": ("id_parceria", "tipo", "ano", "situacao", "situacao_publicacao"),
    "parcelas_parceria": ("id_parcela", "id_parceria"),
    "etapas_parceria": ("id_etapa", "id_parceria"),
    "relatorios_parceria": ("id_relatorio", "id_parceria"),
    "lancamentos_parceria": ("id_vinculo", "id_parceria"),
}


def upgrade() -> None:
    op.create_table(
        "parcerias",
        sa.Column("id_parceria", sa.Integer(), primary_key=True),
        sa.Column("tipo", sa.String(length=20), nullable=False),
        sa.Column("ano", sa.Integer(), nullable=False),
        sa.Column("titulo", sa.String(length=200), nullable=False),
        sa.Column("objeto", sa.Text(), nullable=False),
        sa.Column("esfera", sa.String(length=10), nullable=True),
        sa.Column("orgao_concedente", sa.String(length=200), nullable=True),
        sa.Column("numero_emenda", sa.String(length=40), nullable=True),
        sa.Column("identificador_unico", sa.String(length=60), nullable=True),
        sa.Column("proponente", sa.String(length=200), nullable=True),
        sa.Column("numero_termo", sa.String(length=60), nullable=True),
        sa.Column("valor_total", sa.Numeric(14, 2), nullable=False),
        sa.Column("data_assinatura", sa.Date(), nullable=True),
        sa.Column("vigencia_inicio", sa.Date(), nullable=True),
        sa.Column("vigencia_fim", sa.Date(), nullable=True),
        sa.Column("situacao", sa.String(length=30), nullable=False),
        sa.Column("id_centro_custo", sa.Integer(), sa.ForeignKey("centros_de_custo.id_centro_custo"), nullable=True),
        sa.Column("situacao_publicacao", sa.String(length=12), nullable=False),
        sa.Column("id_usuario_envio_revisao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("enviado_revisao_em", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_aprovacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("aprovado_em", sa.DateTime(), nullable=True),
        sa.Column("motivo_recusa", sa.Text(), nullable=True),
        sa.Column("id_usuario_recusa", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("recusado_em", sa.DateTime(), nullable=True),
        sa.Column("motivo_retirada", sa.Text(), nullable=True),
        sa.Column("id_usuario_retirada", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("retirado_em", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.Column("atualizado_em", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("identificador_unico"),
        sa.UniqueConstraint("id_centro_custo"),
    )
    op.create_table(
        "parcelas_parceria",
        sa.Column("id_parcela", sa.Integer(), primary_key=True),
        sa.Column("id_parceria", sa.Integer(), sa.ForeignKey("parcerias.id_parceria"), nullable=False),
        sa.Column("numero", sa.Integer(), nullable=False),
        sa.Column("valor_previsto", sa.Numeric(14, 2), nullable=False),
        sa.Column("data_prevista", sa.Date(), nullable=True),
        sa.Column("observacao", sa.String(length=200), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id_parceria", "numero", name="uq_parcela_numero_por_parceria"),
    )
    op.create_table(
        "etapas_parceria",
        sa.Column("id_etapa", sa.Integer(), primary_key=True),
        sa.Column("id_parceria", sa.Integer(), sa.ForeignKey("parcerias.id_parceria"), nullable=False),
        sa.Column("titulo", sa.String(length=200), nullable=False),
        sa.Column("descricao", sa.Text(), nullable=True),
        sa.Column("data_prevista", sa.Date(), nullable=True),
        sa.Column("data_realizacao", sa.Date(), nullable=True),
        sa.Column("local", sa.String(length=200), nullable=True),
        sa.Column("publico_atendido", sa.Integer(), nullable=True),
        sa.Column("situacao", sa.String(length=12), nullable=False),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "relatorios_parceria",
        sa.Column("id_relatorio", sa.Integer(), primary_key=True),
        sa.Column("id_parceria", sa.Integer(), sa.ForeignKey("parcerias.id_parceria"), nullable=False),
        sa.Column("tipo", sa.String(length=15), nullable=False),
        sa.Column("periodo_inicio", sa.Date(), nullable=True),
        sa.Column("periodo_fim", sa.Date(), nullable=True),
        sa.Column("data_prevista", sa.Date(), nullable=True),
        sa.Column("data_apresentacao", sa.Date(), nullable=True),
        sa.Column("prazo_analise_dias", sa.Integer(), nullable=False),
        sa.Column("resultado", sa.String(length=25), nullable=False),
        sa.Column("data_resultado", sa.Date(), nullable=True),
        sa.Column("observacao", sa.Text(), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "lancamentos_parceria",
        sa.Column("id_vinculo", sa.Integer(), primary_key=True),
        sa.Column("id_parceria", sa.Integer(), sa.ForeignKey("parcerias.id_parceria"), nullable=False),
        sa.Column("id_lancamento", sa.Integer(), sa.ForeignKey("lancamentos_contabeis.id_lancamento"), nullable=False),
        sa.Column("natureza", sa.String(length=12), nullable=False),
        sa.Column("id_parcela", sa.Integer(), sa.ForeignKey("parcelas_parceria.id_parcela"), nullable=True),
        sa.Column("categoria", sa.String(length=12), nullable=True),
        sa.Column("descricao_publica", sa.String(length=200), nullable=False),
        sa.Column("funcao", sa.String(length=80), nullable=True),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.Column("atualizado_em", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id_lancamento"),
    )
    for tabela, colunas in _INDICES.items():
        for coluna in colunas:
            op.create_index(f"ix_{tabela}_{coluna}", tabela, [coluna])


def downgrade() -> None:
    for tabela, colunas in reversed(list(_INDICES.items())):
        for coluna in reversed(colunas):
            op.drop_index(f"ix_{tabela}_{coluna}", table_name=tabela)
    for tabela in ("lancamentos_parceria", "relatorios_parceria", "etapas_parceria", "parcelas_parceria", "parcerias"):
        op.drop_table(tabela)
