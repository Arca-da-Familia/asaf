"""v1.5 (FASE 1): eventos_linha_do_tempo (Ficha 360), com backfill do histórico já existente

Revision ID: f0a1b2c3d4e5
Revises: e9f0a1b2c3d4
Create Date: 2026-09-14 21:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'f0a1b2c3d4e5'
down_revision: Union[str, Sequence[str], None] = 'e9f0a1b2c3d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TITULOS_MUDANCA_SITUACAO = {
    "licenca": "Licença registrada",
    "desligamento": "Desligamento registrado",
    "readmissao": "Readmitido como associado",
}
# Mesmo código de tipo usado pelas publicações em tempo real (app/routers/situacao.py) - o
# backfill precisa gerar o mesmo `tipo` que um evento novo geraria, senão a linha do tempo teria
# dois nomes diferentes para o mesmo tipo de evento dependendo de quando ele aconteceu.
_TIPOS_MUDANCA_SITUACAO = {
    "licenca": "LICENCA_REGISTRADA",
    "desligamento": "DESLIGAMENTO",
    "readmissao": "READMISSAO",
}


def upgrade() -> None:
    op.create_table(
        "eventos_linha_do_tempo",
        sa.Column("id_evento", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_associado", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False, index=True),
        sa.Column("modulo_origem", sa.String(length=30), nullable=False),
        sa.Column("tipo", sa.String(length=50), nullable=False),
        sa.Column("titulo", sa.String(), nullable=False),
        sa.Column("descricao", sa.String(), nullable=True),
        sa.Column("data_evento", sa.DateTime(), nullable=False, index=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )

    bind = op.get_bind()
    eventos = sa.table(
        "eventos_linha_do_tempo",
        sa.column("id_associado", sa.Integer), sa.column("modulo_origem", sa.String),
        sa.column("tipo", sa.String), sa.column("titulo", sa.String), sa.column("descricao", sa.String),
        sa.column("data_evento", sa.DateTime), sa.column("criado_em", sa.DateTime),
    )

    # Backfill 1: mudanças de situação já registradas (v1.4) - licença/desligamento/readmissão.
    if bind.dialect.has_table(bind, "mudancas_situacao"):
        mudancas = sa.table(
            "mudancas_situacao",
            sa.column("id_associado", sa.Integer), sa.column("tipo", sa.String),
            sa.column("motivo", sa.String), sa.column("data_efetiva", sa.DateTime),
        )
        for id_associado, tipo, motivo, data_efetiva in bind.execute(
            sa.select(mudancas.c.id_associado, mudancas.c.tipo, mudancas.c.motivo, mudancas.c.data_efetiva)
        ):
            bind.execute(eventos.insert().values(
                id_associado=id_associado, modulo_origem="situacao",
                tipo=_TIPOS_MUDANCA_SITUACAO.get(tipo, tipo.upper()),
                titulo=_TITULOS_MUDANCA_SITUACAO.get(tipo, tipo), descricao=f"Motivo: {motivo}." if motivo else None,
                data_evento=data_efetiva,
            ))

    # Backfill 2: filiações já aprovadas (v1.2) - usa a matrícula/data de admissão do associado
    # já efetivado como aproximação da data de aprovação (a proposta não guarda isso separado).
    if bind.dialect.has_table(bind, "propostas_filiacao") and bind.dialect.has_table(bind, "associados"):
        propostas = sa.table(
            "propostas_filiacao", sa.column("status", sa.String), sa.column("id_associado_efetivado", sa.Integer),
        )
        associados_tbl = sa.table(
            "associados", sa.column("id_associado", sa.Integer),
            sa.column("numero_matricula", sa.Integer), sa.column("data_admissao", sa.DateTime),
        )
        consulta = (
            sa.select(associados_tbl.c.id_associado, associados_tbl.c.numero_matricula, associados_tbl.c.data_admissao)
            .select_from(propostas.join(associados_tbl, propostas.c.id_associado_efetivado == associados_tbl.c.id_associado))
            .where(propostas.c.status == "Aprovada")
        )
        for id_associado, numero_matricula, data_admissao in bind.execute(consulta):
            bind.execute(eventos.insert().values(
                id_associado=id_associado, modulo_origem="filiacao", tipo="FILIACAO_APROVADA",
                titulo="Filiação aprovada", descricao=f"Matrícula {numero_matricula} atribuída.",
                data_evento=data_admissao,
            ))

    # Backfill 3: histórico de cargos já existente (protótipo anterior ao plano de fases).
    if bind.dialect.has_table(bind, "historico_cargos"):
        cargos = sa.table(
            "historico_cargos",
            sa.column("id_associado", sa.Integer), sa.column("titulo_cargo", sa.String),
            sa.column("data_posse", sa.DateTime), sa.column("data_saida", sa.DateTime),
        )
        for id_associado, titulo_cargo, data_posse, data_saida in bind.execute(
            sa.select(cargos.c.id_associado, cargos.c.titulo_cargo, cargos.c.data_posse, cargos.c.data_saida)
        ):
            if data_posse:
                bind.execute(eventos.insert().values(
                    id_associado=id_associado, modulo_origem="cargos", tipo="CARGO_INICIADO",
                    titulo=f"Assumiu o cargo de {titulo_cargo}", data_evento=data_posse,
                ))
            if data_saida:
                bind.execute(eventos.insert().values(
                    id_associado=id_associado, modulo_origem="cargos", tipo="CARGO_ENCERRADO",
                    titulo=f"Deixou o cargo de {titulo_cargo}", data_evento=data_saida,
                ))


def downgrade() -> None:
    op.drop_table("eventos_linha_do_tempo")
