"""v9.2b (FASE 9) - os ÍNDICES DE DESEMPENHO: os filtros e as ligações que as telas usam nas tabelas que crescem com o tempo e com o número de associados.

O Postgres não cria índice sozinho nas ligações entre tabelas (chave estrangeira): sem ele, cada saldo de conta, cada ficha de associado e cada lista do
Financeiro lê a tabela inteira, e isso só piora com os anos. Achado ao medir a API na homologação (robô v9.2b-01): a lista de títulos com p95 de 2,9 s e as
contas financeiras com 0,8 s. Das 229 ligações sem índice do sistema, entram aqui só as que alguma tela ou rotina FILTRA (as de "quem registrou", que
ninguém pesquisa, ficam de fora: índice também custa a cada gravação).

A migração `63e4f4c4065a` cria exatamente estes índices (a lista está copiada lá, como toda migração deve ser: congelada); `tests/test_indices_de_desempenho.py`
confere que as duas listas são iguais e que cada tabela e coluna existe.
"""
from sqlalchemy import Index

from app.database import Base

# (nome do índice, tabela, colunas)
INDICES = [
    # Financeiro: o saldo de cada conta soma as partidas dela; o lançamento junta as suas partidas
    ("ix_partidas_contabeis_id_conta", "partidas_contabeis", ["id_conta"]),
    ("ix_partidas_contabeis_id_lancamento", "partidas_contabeis", ["id_lancamento"]),
    ("ix_lancamentos_contabeis_id_titulo", "lancamentos_contabeis", ["id_titulo"]),
    # títulos: toda tela do Financeiro filtra por situação e vencimento (o que vence, o que venceu)
    ("ix_titulos_financeiros_status_vencimento", "titulos_financeiros", ["status", "data_vencimento"]),
    ("ix_titulos_financeiros_data_vencimento", "titulos_financeiros", ["data_vencimento"]),
    ("ix_titulos_financeiros_id_fornecedor", "titulos_financeiros", ["id_fornecedor"]),
    ("ix_doacoes_id_associado", "doacoes", ["id_associado"]),
    ("ix_doacoes_id_titulo", "doacoes", ["id_titulo"]),
    ("ix_inscricoes_id_titulo_cobranca", "inscricoes", ["id_titulo_cobranca"]),
    ("ix_reservas_espaco_id_titulo_cobranca", "reservas_espaco", ["id_titulo_cobranca"]),
    # a ficha do associado (Ficha 360 e as abas) e os direitos do titular buscam tudo de uma pessoa
    ("ix_enderecos_id_associado", "enderecos", ["id_associado"]),
    ("ix_documentos_anexos_id_associado", "documentos_anexos", ["id_associado"]),
    ("ix_historico_cargos_id_associado", "historico_cargos", ["id_associado"]),
    ("ix_isencoes_contribuicao_id_associado", "isencoes_contribuicao", ["id_associado"]),
    ("ix_negociacoes_divida_id_associado", "negociacoes_divida", ["id_associado"]),
    ("ix_creditos_associado_id_associado", "creditos_associado", ["id_associado"]),
    ("ix_reembolsos_despesa_id_associado", "reembolsos_despesa", ["id_associado"]),
    ("ix_documentos_emitidos_id_pessoa", "documentos_emitidos", ["id_pessoa"]),
    # voluntariado: a escala e as horas de cada projeto e de cada pessoa
    ("ix_alocacoes_voluntarios_id_projeto", "alocacoes_voluntarios", ["id_projeto"]),
    ("ix_alocacoes_voluntarios_id_associado", "alocacoes_voluntarios", ["id_associado"]),
    ("ix_registros_horas_voluntariado_id_projeto", "registros_horas_voluntariado", ["id_projeto"]),
    ("ix_registros_horas_voluntariado_id_alocacao", "registros_horas_voluntariado", ["id_alocacao"]),
    ("ix_respostas_pesquisa_satisfacao_id_inscricao", "respostas_pesquisa_satisfacao", ["id_inscricao"]),
    # a Auditoria filtrada por quem fez; as sessões de quem entra (sair de todos os aparelhos, trocar a senha)
    ("ix_audit_log_id_usuario", "audit_log", ["id_usuario"]),
    ("ix_tokens_acesso_id_usuario", "tokens_acesso", ["id_usuario"]),
]


def registrar() -> None:
    """Pendura os índices nas tabelas (chamado depois de todos os modelos carregados): o banco dos testes, criado pelos modelos, fica igual ao da migração."""
    tabelas = Base.metadata.tables
    for nome, tabela, colunas in INDICES:
        t = tabelas[tabela]
        if any(ix.name == nome for ix in t.indexes):
            continue
        Index(nome, *[t.c[c] for c in colunas])
