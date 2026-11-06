"""v9.3j (pedido do Presidente, 06/11: nada de nome técnico na tela): as descrições que a tela mostra, sem nome interno nem nota de versão

As descrições das permissões, de um nível de acesso, das configurações da categoria "regras" e das regras do Estatuto foram gravadas pelo seed com
anotações para quem programa ("(v5.4a)", "separada de 'associados' de propósito", "fuso FUSO_HORARIO", "ver ESTATUTO_ASAF.txt",
"POST /api/votacoes/{id}/resolver-empate"). Esta migração troca cada uma pelo texto novo (o mesmo do seed em app/database.py) SÓ se ela ainda for
EXATAMENTE o que o seed gravou: descrição editada por alguém fica como está (nunca sobrescreve decisão humana). Idempotente; o `downgrade` volta o
texto antigo do mesmo jeito. A lista abaixo é cópia congelada.

Revision ID: 9e3f1a7c5b20
Revises: 63e4f4c4065a
Create Date: 2026-11-06 18:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '9e3f1a7c5b20'
down_revision: Union[str, Sequence[str], None] = '63e4f4c4065a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (tabela, coluna que identifica, valor que identifica, texto antigo do seed, texto novo)
TROCAS = [
    ('niveis_acesso', 'nome_nivel', 'Parcerias e emendas - gestão',
     'Cadastra parcerias, emendas, parcelas, etapas e relatórios (v5.4a).',
     'Cadastra parcerias, emendas, parcelas, etapas e relatórios.'),
    ('permissoes_sistema', 'codigo_permissao', 'editar_site',
     'Abrir o editor do site (Directus) pelo atalho "Editar o site" do painel (v5.7g). É só o atalho: o que cada pessoa pode mudar lá é decidido pelo papel dela no próprio Directus.',
     'Abrir o editor do site pelo atalho "Editar o site" do painel. É só o atalho: o que cada pessoa pode mudar lá é decidido no próprio editor do site.'),
    ('permissoes_sistema', 'codigo_permissao', 'ver_cpf_completo',
     'Ver o CPF completo por clique em "Mostrar o CPF", registrado na Auditoria (v7.3a - nas listas e fichas o CPF aparece sempre escondido; decisão do Presidente: Presidente, Secretários e Tesoureiros).',
     'Ver o CPF completo clicando em "Mostrar o CPF"; cada clique fica na Auditoria. Nas listas e fichas o CPF aparece sempre escondido (decisão do Presidente: Presidente, Secretários e Tesoureiros).'),
    ('permissoes_sistema', 'codigo_permissao', 'exportar_dados_pessoais',
     "Exportar dado pessoal de associados em massa (v1.3 - separada de 'associados' de propósito).",
     'Exportar dados pessoais de associados em massa (separada do cadastro de associados de propósito).'),
    ('permissoes_sistema', 'codigo_permissao', 'forcar_cadastro_duplicado',
     "Cadastrar associado mesmo quando o sistema sinaliza um cadastro parecido já existente (v1.8 - separada de 'associados' de propósito, só quem decide sobre duplicidade tem).",
     'Cadastrar associado mesmo quando o sistema avisa que já existe um cadastro parecido (só quem decide sobre cadastro repetido tem).'),
    ('permissoes_sistema', 'codigo_permissao', 'gerenciar_checkin_evento',
     'Gerenciar portaria de evento (emitir/revogar token de check-in), configurar elegibilidade e emitir crachás/certificados (v4.8).',
     'Cuidar da portaria do evento (criar e cancelar o link de entrada), configurar a regra do certificado e emitir crachás e certificados.'),
    ('permissoes_sistema', 'codigo_permissao', 'exportar_presencas_evento',
     "Exportar lista de presenças/elegibilidade de um evento (v4.8 - separada de 'gerenciar_checkin_evento' de propósito, mesmo padrão de 'exportar_dados_pessoais').",
     'Exportar a lista de presenças de um evento e de quem tem direito ao certificado (separada da portaria de propósito).'),
    ('permissoes_sistema', 'codigo_permissao', 'exportar_inscricoes_evento',
     "Exportar lista de inscritos de um evento (v4.10 - separada de 'exportar_presencas_evento' de propósito, cada exportação em massa tem o seu próprio código).",
     'Exportar a lista de inscritos de um evento (cada exportação em massa tem a sua própria permissão).'),
    ('permissoes_sistema', 'codigo_permissao', 'exportar_beneficiarios',
     "Exportar dado de beneficiário em massa através de projetos (v4.10 - separada de 'projetos' de propósito, mesmo padrão de 'exportar_dados_pessoais').",
     'Exportar dados de beneficiários de projetos em massa (separada da gestão de projetos de propósito).'),
    ('permissoes_sistema', 'codigo_permissao', 'exportar_reservas_espaco',
     "Exportar lista de reservas de espaço em massa (v4.10 - separada de 'projetos'/demais exportações de propósito).",
     'Exportar a lista de reservas de espaço em massa (separada das outras exportações de propósito).'),
    ('permissoes_sistema', 'codigo_permissao', 'documentos',
     'Cadastrar documentos institucionais, anexar original e versão pública e enviar para revisão (v5.4a).',
     'Cadastrar documentos institucionais, anexar o original e a versão pública e enviar para revisão.'),
    ('permissoes_sistema', 'codigo_permissao', 'documentos_originais',
     "Baixar o ORIGINAL de documento Interno/Restrito, que pode ter RG/CPF (v5.4a - separada de 'documentos' de propósito, mesmo padrão de 'exportar_dados_pessoais').",
     'Baixar o original de documento Interno ou Restrito, que pode ter RG ou CPF (separada de Documentos de propósito).'),
    ('permissoes_sistema', 'codigo_permissao', 'aprovar_publicacao',
     'Aprovar, recusar e retirar publicações no site de transparência; nunca o que a própria pessoa enviou (v5.4a).',
     'Aprovar, recusar e retirar publicações no site de transparência; nunca o que a própria pessoa enviou.'),
    ('permissoes_sistema', 'codigo_permissao', 'parcerias',
     'Gerenciar parcerias, emendas parlamentares, parcelas, etapas e relatórios (v5.4a).',
     'Gerenciar parcerias, emendas parlamentares, parcelas, etapas e relatórios.'),
    ('permissoes_sistema', 'codigo_permissao', 'atendimento',
     'Atender a fila única: contato, pedidos de informação, solicitações de titular de dados (LGPD) e voluntariado que chegam pelo site (v5.5a).',
     'Atender a fila única: contato, pedidos de informação, pedidos de titular de dados (LGPD) e voluntariado que chegam pelo site.'),
    ('permissoes_sistema', 'codigo_permissao', 'comunicar',
     'Publicar avisos no mural do painel para um grupo calculado, ver quem leu e confirmou, incluir quem entrou no grupo depois e retirar o aviso (v6.1).',
     'Publicar avisos no mural do painel para um grupo, ver quem leu e confirmou, incluir quem entrou no grupo depois e retirar o aviso.'),
    ('permissoes_sistema', 'codigo_permissao', 'privacidade',
     'Programa de privacidade (LGPD): ver o encarregado, o substituto e o ato de designação (e baixar a cópia assinada) e ver e exportar o inventário de dados (v7.0a/v7.0c).',
     'Programa de privacidade (LGPD): ver o encarregado, o substituto e o ato de designação (e baixar a cópia assinada) e ver e exportar o inventário de dados.'),
    ('permissoes_sistema', 'codigo_permissao', 'privacidade_gerir',
     "Programa de privacidade (LGPD): gerar o ato de designação do encarregado, registrar a cópia assinada e ajustar o inventário de dados (v7.0a/v7.0c - separada de 'privacidade' de propósito: só o Presidente).",
     'Programa de privacidade (LGPD): gerar o ato de designação do encarregado, registrar a cópia assinada e ajustar o inventário de dados (só o Presidente).'),
    ('configuracoes_institucionais', 'chave_configuracao', 'PRAZO_CONVOCACAO_DIAS',
     'Dias mínimos de antecedência para convocação de assembleia (Art. 8º do estatuto - ver ESTATUTO_ASAF.txt).',
     'Dias mínimos de antecedência para convocação de assembleia (Art. 8º do Estatuto).'),
    ('configuracoes_institucionais', 'chave_configuracao', 'PRAZO_RECADASTRAMENTO_DIAS',
     'Dias desde a última confirmação de dados cadastrais antes do cadastro ser sinalizado para recadastramento (v1.8).',
     'Dias desde a última confirmação dos dados cadastrais até o cadastro ser marcado para recadastramento.'),
    ('configuracoes_institucionais', 'chave_configuracao', 'HORA_INICIO_EXPEDIENTE',
     'Hora (0-23, fuso FUSO_HORARIO) a partir da qual um lançamento é considerado dentro do expediente.',
     'Hora (0 a 23, no fuso horário da associação) a partir da qual um lançamento é considerado dentro do expediente.'),
    ('configuracoes_institucionais', 'chave_configuracao', 'HORA_FIM_EXPEDIENTE',
     'Hora (0-23, fuso FUSO_HORARIO) até a qual um lançamento é considerado dentro do expediente.',
     'Hora (0 a 23, no fuso horário da associação) até a qual um lançamento é considerado dentro do expediente.'),
    ('configuracoes_institucionais', 'chave_configuracao', 'DIAS_ALERTA_LANCAMENTO_TARDIO',
     'Dias entre o pagamento de uma saída e o lançamento dela no sistema a partir dos quais o lançamento é tardio: a saída fica marcada no cartão da Auditoria financeira e entra no relatório de exceção mensal do Conselho Fiscal (v5.4h).',
     'Dias entre o pagamento de uma saída e o lançamento dela no sistema a partir dos quais o lançamento é tardio: a saída fica marcada no cartão da Auditoria financeira e entra no relatório de exceção mensal do Conselho Fiscal.'),
    ('configuracoes_institucionais', 'chave_configuracao', 'URL_BASE_PAINEL',
     'Endereço do painel usado nos links dos e-mails (ex.: https://painel.asaf.org.br). Vazio = a variável de ambiente URL_BASE_PAINEL ou o painel de produção.',
     'Endereço do painel usado nos links dos e-mails (ex.: https://painel.asaf.org.br). Vazio = o endereço do painel de produção.'),
    ('regras_estatutarias', 'parametro', 'PRAZO_ATENDIMENTO_PEDIDO_CONVOCACAO_DIAS',
     'Dias que o Presidente tem para convocar assembleia após pedido formal de associado; findo o prazo, os próprios associados podem convocar (efeito automático - v2.2).',
     'Dias que o Presidente tem para convocar assembleia após pedido formal de associado; findo o prazo, os próprios associados podem convocar (efeito automático).'),
    ('regras_estatutarias', 'parametro', 'PROCURACAO_PERMITIDA',
     'Se procuração/representação de um associado por outro vale para quórum ou voto. Hoje SEMPRE vedada pelo estatuto vigente - parâmetro existe pra quando uma reforma futura mudar isso (v2.2).',
     'Se a procuração (um associado representar outro) vale para quórum ou voto. Hoje é sempre vedada pelo Estatuto; a regra existe para quando uma reforma mudar isso.'),
    ('regras_estatutarias', 'parametro', 'QTD_MENSALIDADES_INADIMPLENCIA_EXCLUSAO',
     'Mensalidades consecutivas em atraso que configuram motivo de abertura de processo disciplinar com possível exclusão (nunca automática - exige processo com ampla defesa, v2.7).',
     'Mensalidades consecutivas em atraso que configuram motivo de abertura de processo disciplinar com possível exclusão (nunca automática: exige processo com ampla defesa).'),
    ('regras_estatutarias', 'parametro', 'REGRA_DESEMPATE',
     'Como resolver empate no resultado de uma votação - sem previsão estatutária. "NOVA_VOTACAO" é o único valor que o sistema resolve sozinho hoje; qualquer outro valor fica registrado mas exige resolução manual (POST /api/votacoes/{id}/resolver-empate).',
     'Como resolver empate no resultado de uma votação (o Estatuto não prevê). "Nova votação" é o único valor que o sistema resolve sozinho; com qualquer outro, o empate fica registrado e é resolvido à mão na sessão da assembleia.'),
]


def _trocar(de_indice: int, para_indice: int) -> None:
    conexao = op.get_bind()
    for tabela, coluna, chave, *textos in TROCAS:
        conexao.execute(
            sa.text(f"UPDATE {tabela} SET descricao = :para WHERE {coluna} = :chave AND descricao = :de"),
            {"chave": chave, "de": textos[de_indice], "para": textos[para_indice]},
        )


def upgrade() -> None:
    _trocar(0, 1)


def downgrade() -> None:
    _trocar(1, 0)
