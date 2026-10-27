"""v7.0b (FASE 7) - a CLASSIFICAÇÃO dos dados por sensibilidade, num mapa único aplicado ao próprio modelo (`Column.info["lgpd"]` e `Table.info`).

Três níveis (LGPD): **pessoal** (art. 5º, I: identifica ou descreve uma pessoa), **pessoal sensível** (art. 5º, II, e art. 11: saúde, origem racial, religião,
biometria...) e **de criança e adolescente** (art. 14) — este último é da TABELA (as linhas podem ser de menor), não da coluna. Uma coluna pessoal de texto livre,
onde a equipe ou a própria pessoa pode escrever qualquer coisa, é marcada "pode conter dado sensível" (fica no inventário para a v7.1 decidir base legal e prazo).

O que a classificação liga (controles por classificação, não caso a caso):
  1. `app.auditoria.registrar_auditoria` não grava no "antes e depois" o valor de coluna sensível, nem o de coluna pessoal de tabela que pode ter dado de criança;
  2. a anonimização do associado desligado cobre toda coluna pessoal da pessoa (o teste compara com `CAMPOS_ANONIMIZAVEIS` e com o que fica de propósito);
  3. toda coluna sensível declara a ação de Auditoria que a LEITURA grava (`leitura_auditada`), e o teste confere a rota de cada uma.

Os TITULARES de cada tabela saem das chaves estrangeiras (quem a linha descreve) mais o que o mapa acrescenta para a tabela que guarda pessoa sem chave (o
formulário do site, a doação, o código do visitante). `inventario_do_modelo()` lê tudo do modelo: é a base do inventário de dados (v7.0c).

A marca "pode ter criança" vale também, derivada, para a tabela cuja chave estrangeira aponta para uma tabela marcada aqui (a presença, a foto, a linha do tempo
e a inscrição da pessoa que pode ser criança), num nível só (senão tudo o que aponta para o associado ficaria marcado).

Tabela ou coluna nova: o teste (tests/test_classificacao_de_dados.py) reprova (1) coluna cujo nome indica dado de pessoa (ou sensível: saúde, raça, religião,
deficiência...) e que não está aqui, nem como pessoal, nem como "não é de pessoa"; (2) QUALQUER coluna não classificada das tabelas centrais de pessoa (as de
`TITULAR_POR_CHAVE`), onde o nome não basta; (3) nome que está aqui mas não existe mais no modelo."""
import re
from dataclasses import dataclass, field
from typing import Optional

PESSOAL = "pessoal"
SENSIVEL = "sensivel"
NAO_PESSOAL = "nao_pessoal"

# titulares (de quem é o dado)
PESSOA = "pessoa cadastrada (associado, dependente, voluntário ou beneficiário)"
ASSOCIADO = "associado"
BENEFICIARIO = "beneficiário de projeto"
VOLUNTARIO = "voluntário"
INSCRITO = "inscrito em evento"
DOADOR = "doador"
CANDIDATO = "candidato a associado"
SOLICITANTE = "quem escreve à ASAF pelo site (contato, informação, titular de dados, voluntariado)"
VISITANTE = "visitante do site"
USUARIO = "usuário do painel"
DIRIGENTE = "membro da Diretoria ou do Conselho Fiscal"
FORNECEDOR = "fornecedor pessoa física"
FOTOGRAFADO = "pessoa que aparece em foto"

# a chave estrangeira diz de quem é a linha
TITULAR_POR_CHAVE = {
    "pessoas": PESSOA, "papeis": PESSOA, "associados": ASSOCIADO, "beneficiarios": BENEFICIARIO, "beneficiarios_projeto": BENEFICIARIO,
    "inscricoes": INSCRITO, "usuarios": USUARIO, "propostas_filiacao": CANDIDATO, "doacoes": DOADOR, "atendimentos": SOLICITANTE,
    "processos_disciplinares": ASSOCIADO,  # a manifestação da Diretoria é sobre o associado do processo
}


@dataclass(frozen=True)
class Coluna:
    categoria: str
    pode_conter_sensivel: bool = False  # texto livre: a equipe ou a pessoa pode escrever dado sensível
    visivel_na_auditoria: bool = False  # dado sobre a pessoa que descreve o ANDAMENTO (situação, datas, consentimento): fica visível no "antes e depois"
    leitura_auditada: Optional[str] = None  # só para SENSIVEL: a ação que a rota de leitura grava na Auditoria


P = Coluna(PESSOAL)
# pessoal, mas do andamento (a situação da inscrição, o consentimento do responsável registrado, as datas): a Auditoria guarda o valor, que é a prova do que mudou
M = Coluna(PESSOAL, visivel_na_auditoria=True)
LIVRE = Coluna(PESSOAL, pode_conter_sensivel=True)
NP = Coluna(NAO_PESSOAL)


def S(acao: str) -> Coluna:
    return Coluna(SENSIVEL, leitura_auditada=acao)


@dataclass(frozen=True)
class Tabela:
    colunas: dict = field(default_factory=dict)
    titulares: tuple = ()  # além dos que as chaves estrangeiras dão
    criancas: bool = False  # as linhas podem ser de criança ou adolescente (LGPD art. 14)
    # não herda a marca de criança pela chave estrangeira (a Auditoria guarda o que mudou ali sem esconder): o cadastro de associado (a prestação de contas da gestão),
    # a Diretoria, o funcionário. Se ainda assim pode ter adolescente, `adolescentes` o diz no inventário (sem esconder na Auditoria: risco aceito, PLANO v7.0b).
    nao_herda_crianca: bool = False
    adolescentes: bool = False  # pode ter adolescente (12 a 17 anos, LGPD art. 14): vai ao inventário, não liga a máscara da Auditoria


CONSULTA_PRONTUARIO = "CONSULTA_PRONTUARIO"
CONSULTA_ENCAMINHAMENTOS = "CONSULTA_ENCAMINHAMENTOS"
CONSULTA_HISTORICO_SITUACAO = "CONSULTA_HISTORICO_SITUACAO"

CLASSIFICACAO: dict[str, Tabela] = {
    # ---------------------------------------------------------------- a pessoa e o associado
    "pessoas": Tabela(criancas=True, colunas={
        "nome_completo": P, "cpf": P, "data_nascimento": P, "email_contato": P, "telefone_whatsapp": P, "estado_civil": P, "profissao": P,
        "naturalidade": P, "foto": P, "habilidades": P, "data_ultima_confirmacao": M, "contato_suspeito": M, "criado_em": NP,
    }),
    # o associado pode ter 16 ou 17 anos (Estatuto, art. 12): é adolescente (LGPD art. 14; relativamente incapaz, Código Civil art. 4º, I). O inventário diz isso;
    # a máscara da Auditoria não se liga no cadastro de associado (o que mudou na ficha de um associado é prestação de contas da gestão): risco aceito, PLANO v7.0b
    "associados": Tabela(nao_herda_crianca=True, adolescentes=True, colunas={
        "observacoes_gerenciais": LIVRE, "numero_matricula": P, "categoria": M, "status_arrolamento": M, "data_admissao": M, "data_fim_experiencia": M,
        "data_fim_licenca": M, "data_desligamento": M,
    }),
    "papeis": Tabela(colunas={"tipo_papel": M, "ativo": M, "criado_em": NP}),
    "funcionarios": Tabela(nao_herda_crianca=True),
    "enderecos": Tabela(titulares=(ASSOCIADO,), colunas={"cep": P, "logradouro": P, "numero": P, "bairro": P, "cidade": P, "estado": P}),
    "dependentes_familiares": Tabela(criancas=True, colunas={"grau_parentesco": P}),
    "documentos_anexos": Tabela(colunas={"tipo_documento": NP, "caminho_arquivo": P}),
    "eventos_linha_do_tempo": Tabela(colunas={"titulo": P, "descricao": P}),
    "mudancas_situacao": Tabela(colunas={
        "motivo": S(CONSULTA_HISTORICO_SITUACAO), "documento_referencia": P, "tipo": M, "data_efetiva": M, "data_fim_prevista": M, "criado_em": NP,
    }),
    "habilitados_assembleia": Tabela(colunas={"motivo_inabilitacao": P}),
    "justificativas_falta_assembleia": Tabela(colunas={"motivo": LIVRE, "motivo_decisao": NP}),
    "isencoes_contribuicao": Tabela(colunas={"motivo": LIVRE}),
    "isencoes_taxa_contexto": Tabela(colunas={"motivo": LIVRE}),
    "processos_disciplinares": Tabela(nao_herda_crianca=True, adolescentes=True, colunas={
        "motivo_codigo": P, "descricao": LIVRE, "defesa_texto": LIVRE, "decisao_texto": LIVRE, "pena_aplicada": P, "status": M, "data_abertura": M,
        "prazo_defesa_ate": NP, "defesa_apresentada_em": M, "escalada_automatica": NP, "suspensao_dias": M, "data_fim_suspensao": M, "decidido_em": NP,
        "homologado_em": NP, "criado_em": NP,
    }),
    "manifestacoes_diretoria_disciplinar": Tabela(colunas={"justificativa": LIVRE}),
    "impugnacoes_votacao": Tabela(colunas={"motivo": LIVRE}),
    "propostas_de_socios": Tabela(colunas={"observacao": LIVRE}),  # o comentário do sócio é sobre o candidato, que pode ter 16 ou 17 anos
    "titulos_financeiros": Tabela(colunas={"descricao": P}),
    "reembolsos_despesa": Tabela(colunas={"comprovante": P}),  # o comprovante traz o nome de quem pediu o reembolso
    "valores_campo": Tabela(titulares=(PESSOA,), criancas=True, colunas={"valor": LIVRE}),  # campos personalizados de associado, beneficiário e evento
    # ---------------------------------------------------------------- beneficiários (atendimento social: famílias e crianças)
    "beneficiarios": Tabela(criancas=True, colunas={
        "observacao_consentimento": P, "data_consentimento": M, "consentimento_lgpd_registrado": M, "criado_em": NP,
    }),
    "beneficiarios_projeto": Tabela(criancas=True, colunas={"papel": M, "atendimento_por_familia": M, "data_inicio": M, "data_fim": M}),
    "registros_atendimento": Tabela(criancas=True, colunas={"relato": S(CONSULTA_PRONTUARIO), "data_atendimento": M, "criado_em": NP}),
    "encaminhamentos_rede_externa": Tabela(criancas=True, colunas={
        "tipo_rede": S(CONSULTA_ENCAMINHAMENTOS), "descricao": S(CONSULTA_ENCAMINHAMENTOS), "data_encaminhamento": M,
    }),
    # ---------------------------------------------------------------- voluntariado
    "termos_adesao_voluntario": Tabela(titulares=(VOLUNTARIO,), criancas=True, colunas={
        "documento_referencia": P, "autorizacao_responsavel_referencia": M, "atividade": P, "carga_horaria_semanal": M, "local": P, "data_inicio": M,
        "data_fim_vigencia": M, "versao": NP, "ativo": M, "criado_em": NP,
    }),
    "registros_horas_voluntariado": Tabela(titulares=(VOLUNTARIO,), colunas={"descricao_atividade": P}),
    "trocas_turno_voluntario": Tabela(titulares=(VOLUNTARIO,), colunas={"motivo": LIVRE}),
    "alocacoes_voluntarios": Tabela(titulares=(VOLUNTARIO,), colunas={"habilidades_exigidas": NP}),
    "vagas_escala_voluntario": Tabela(colunas={"habilidades_exigidas": NP}),
    # ---------------------------------------------------------------- formulários do site, filiação, doação, visitante
    "atendimentos": Tabela(colunas={
        "assunto": LIVRE, "mensagem": LIVRE, "nome_completo": P, "email_contato": P, "telefone_whatsapp": P, "cpf": P, "data_nascimento": P, "chave_remetente": P,
        "identidade_nota": P, "resposta": LIVRE, "resposta_enviada_por_email": NP, "motivo_encerramento": LIVRE, "motivo_visivel_ao_titular": NP,
        "protocolo": M, "tipo": NP, "subtipo": NP, "impressao_do_pedido": NP, "origem": NP, "consentimento_lgpd_em": M, "consentimento_lgpd_versao": NP,
        "status": NP, "prazo_dias": NP, "prazo_em": NP, "assumido_em": NP, "identidade_validacao": M, "identidade_validada_em": M, "respondido_em": NP,
        "encerrado_em": NP, "criado_em": NP, "atualizado_em": NP,
    }),
    "propostas_filiacao": Tabela(titulares=(CANDIDATO,), criancas=True, colunas={  # 16 e 17 anos, com a autorização do responsável declarada
        "nome_completo": P, "cpf": P, "email_contato": P, "telefone_whatsapp": P, "data_nascimento": P, "motivo_recusa": P,
        "autorizacao_responsavel_declarada": M, "status": M, "consentimento_lgpd_em": M, "consentimento_lgpd_versao": NP, "criado_em": NP, "atualizado_em": NP,
    }),
    "inscricoes": Tabela(criancas=True, colunas={
        "respostas_formulario": LIVRE, "email_da_inscricao": P, "status": M, "data_inscricao": M, "categoria_cota": M, "contexto_tipo": NP, "codigo_checkin": NP,
        "token_cancelamento": NP, "consentimento_lgpd_versao": NP, "prazo_confirmacao": NP, "identificador_grupo": NP,
    }),  # inscrição de família (grupo) pode ter criança
    "respostas_pesquisa_satisfacao": Tabela(colunas={"comentario": LIVRE}),
    "doacoes": Tabela(titulares=(DOADOR,), colunas={
        "nome_doador": P, "documento_doador": P, "valor": P, "descricao_bem": NP, "anonima": NP, "tipo_doacao": NP, "recorrente": NP, "numero_recibo": NP,
        "data_doacao": NP,
    }),
    "intencoes_de_doacao": Tabela(titulares=(DOADOR,), colunas={
        "nome_doador": P, "email_doador": P, "documento_doador": P, "observacao": NP, "recibo_enviado_por_email": NP,
    }),
    "codigos_de_visitante": Tabela(titulares=(VISITANTE,), colunas={"email": P}),
    "sessoes_de_visitante": Tabela(titulares=(VISITANTE,), colunas={"email": P}),
    "tentativas_acesso_publico": Tabela(titulares=(VISITANTE,), colunas={"ip": P}),
    # ---------------------------------------------------------------- acesso ao painel e Auditoria
    "usuarios": Tabela(colunas={
        "email": P, "senha_hash": P, "mfa_secret": P, "ativo": P, "data_criacao": NP, "tentativas_falhas": NP, "bloqueado_ate": NP, "mfa_ativado": NP,
        "senha_provisoria": NP,
    }),
    "tokens_acesso": Tabela(colunas={"ip_origem": P, "user_agent": P}),
    "audit_log": Tabela(colunas={"ip_origem": P, "dados_antes": LIVRE, "dados_depois": LIVRE}),
    # ---------------------------------------------------------------- Diretoria, governança, documentos
    "mandatos": Tabela(titulares=(DIRIGENTE,), colunas={"motivo_encerramento": P}),
    "fotos_da_diretoria": Tabela(titulares=(DIRIGENTE,), nao_herda_crianca=True, colunas={"arquivo_nome": P, "alt": P, "autorizacao_imagem": M}),
    "declaracoes_conflito_interesse": Tabela(titulares=(DIRIGENTE,), colunas={"descricao": LIVRE}),
    "atos_do_encarregado": Tabela(titulares=(DIRIGENTE,), colunas={
        "nome_encarregado": P, "nome_substituto": P, "assinado_nome_arquivo": P, "assinado_arquivo": P, "texto": P,
    }),
    "atas": Tabela(colunas={"relato_secretaria": P, "corpo_texto": P, "motivo_retificacao": NP, "arquivo_documento_assinado": P}),
    "ocorrencias_sessao": Tabela(colunas={"descricao": LIVRE}),
    "documentos_institucionais": Tabela(colunas={  # o ORIGINAL pode ter RG/CPF de quem assinou (ata, termo)
        "original_nome": P, "original_nome_arquivo": NP, "descricao": NP, "data_documento": NP, "publico_nome": NP, "motivo_recusa": NP, "motivo_retirada": NP,
        "publico_texto": NP,  # a versão pública já passou pelo verificador de dado pessoal
    }),
    "fotos_evento": Tabela(titulares=(FOTOGRAFADO,), criancas=True, colunas={"arquivo_nome": P, "alt": P, "autorizacao_imagem": M, "sha256": NP, "tamanho": NP, "largura": NP, "altura": NP, "criado_em": NP}),  # crianças nas atividades
    # v7.1b: a prova de cada consentimento (quem consentiu, o responsável, o vínculo, o IP); pode ser de criança (a foto de uma atividade, pelo responsável)
    "consentimentos": Tabela(titulares=(FOTOGRAFADO, DIRIGENTE), criancas=True, colunas={
        "titular": P, "nome_responsavel": P, "vinculo_responsavel": P, "ip": P, "motivo_encerramento": LIVRE, "ponto": NP, "versao": NP, "dado_por": NP,
        "meio": NP, "dado_em": NP, "registrado_em": NP, "origem": NP, "encerrado_em": NP, "encerramento": NP,
    }),
    "fotos_etapa_parceria": Tabela(titulares=(FOTOGRAFADO,), criancas=True, colunas={"arquivo_nome": P, "alt": P, "autorizacao_imagem": M, "sha256": NP, "tamanho": NP, "largura": NP, "altura": NP, "criado_em": NP}),
    "documentos_emitidos": Tabela(colunas={"variaveis_usadas": LIVRE, "caminho_arquivo": P}),  # o certificado traz o nome e os dados de quem o recebe
    "fila_revisao_cadastro": Tabela(colunas={"detalhe": P}),
    "notificacoes_painel": Tabela(colunas={"texto": P}),  # o aviso do sino cita a pessoa
    "negociacoes_divida": Tabela(colunas={"termo": P}),
    "entregas_de_aviso": Tabela(colunas={"ultimo_erro": P}),  # o erro do servidor de e-mail traz o endereço
    "credenciais_webauthn": Tabela(colunas={"apelido": P}),
    "votos_abertos": Tabela(colunas={"opcao": P}),
    # ---------------------------------------------------------------- fornecedor (pode ser pessoa física)
    "fornecedores": Tabela(titulares=(FORNECEDOR,), colunas={"razao_social": P, "cnpj": P, "telefone": P}),
    "dados_bancarios_fornecedor": Tabela(titulares=(FORNECEDOR,), colunas={
        "titular": P, "banco": P, "agencia": P, "conta": P, "tipo_conta": NP, "motivo_rejeicao": NP,
    }),
}

# Colunas que o detector de nomes pega, mas que NÃO são de pessoa (o nome de um espaço, o motivo de bloquear uma sala, a agência da conta da própria ASAF...)
NAO_PESSOAIS: dict[str, tuple[str, ...]] = {
    "auditorias_de_titulo": ("observacao",),
    "avisos": ("por_email", "publico_descricao", "motivo_retirada", "texto"),
    "avisos_agendados": ("por_email", "publico_descricao", "motivo", "texto"),
    "certidoes_deliberacao": ("texto_gerado",),
    "deliberacoes": ("texto", "observacao_conclusao"),
    "lancamentos_contabeis": ("motivo_estorno", "comprovante"),
    "opcoes_catalogo": ("cor",),
    "pareceres_prestacao_contas": ("texto",),
    "prestacoes_de_contas": ("conteudo",),
    "registros_voto_secreto": ("opcao",),  # o voto secreto não é ligado a ninguém (v2.x)
    "relatorios_de_impacto": ("motivo_suspensao",),  # v7.0d: o relatório descreve o tratamento, não uma pessoa
    "textos_de_privacidade": ("texto", "observacao"),  # v7.1a: o aviso que o site mostra a todos, não o dado de uma pessoa
    "relatorios_finais_projeto": ("conteudo",),
    "respostas_questionamento": ("texto",),
    "bloqueios_espaco": ("motivo", "descricao"),
    "campanhas_arrecadacao": ("descricao",),
    "campanhas_desconto_antecipado": ("motivo",),
    "catalogos": ("nome_exibido", "descricao"),
    "centros_de_custo": ("nome",),
    "checklists_devolucao_espaco": ("descricao_avaria",),
    "configuracoes_institucionais": ("descricao",),
    "contas_a_pagar_recorrentes": ("descricao",),
    "cotacoes_compra": ("anexo",),
    "documentos_estatuto": ("caminho_arquivo",),
    "contas_financeiras": ("tipo_conta_financeira", "agencia", "numero_conta"),  # as contas da própria ASAF
    "delegacoes_aprovacao": ("motivo",),
    "espacos": ("nome",),
    "etapas_parceria": ("descricao",),
    "eventos": ("descricao", "endereco_avulso", "motivo_status"),
    "eventos_calendario": ("descricao",),
    "indicadores": ("nome",),
    "itens_pauta": ("descricao",),
    "lancamentos_parceria": ("descricao_publica",),
    "modelos_de_aviso": ("nome", "por_email", "texto"),
    "modelos_documentos": ("tipo_documento", "nome_modelo"),
    "niveis_acesso": ("nome_nivel", "descricao"),
    "parcelas_parceria": ("observacao",),
    "parcerias": ("motivo_recusa", "motivo_retirada", "numero_termo"),
    "permissoes_sistema": ("descricao",),
    "plano_de_contas": ("descricao_conta",),
    "planos_contribuicao": ("descricao",),
    "processos_dissolucao": (  # a entidade que recebe o patrimônio é pessoa jurídica
        "motivo", "liquidacao_observacao", "entidade_destinataria_nome", "entidade_destinataria_cnpj", "entidade_destinataria_justificativa",
        "baixa_cadastral_observacao", "motivo_cancelamento",
    ),
    "projetos_eventos": ("nome_projeto", "descricao"),
    "questionamentos_lancamento": ("pergunta",),
    "reembolsos_despesa": ("descricao", "motivo_reprovacao"),
    "assembleias": ("edital_texto",),
    "regras_estatutarias": ("descricao",),
    "relatorios_parceria": ("observacao",),
    "remanejamentos_destinacao": ("motivo",),
    "reservas_espaco": ("motivo_status",),
    "sessoes_evento": ("descricao",),
    "solicitacoes_compra": ("descricao", "justificativa", "motivo_reprovacao"),
    "templates_documento": ("nome", "corpo_texto"),
    "tokens_portaria": ("descricao",),
    "valores_plano_contribuicao": ("motivo_reajuste",),
}

# O nome da coluna sugere dado de pessoa: tem de estar classificado (pessoal, sensível ou "não é de pessoa"). Chave estrangeira e `id_*` ficam de fora (a chave
# vira TITULAR da tabela, não coluna pessoal).
DETECTOR = re.compile(
    r"(^|_)(nome|nomes|cpf|cnpj|rg|nis|email|emails|telefone|telefones|whatsapp|celular|endereco|enderecos|logradouro|cep|bairro|nascimento|idade|foto|fotos|"
    r"ip|user|agent|relato|observacao|observacoes|mensagem|resposta|respostas|comentario|justificativa|motivo|parentesco|naturalidade|profissao|civil|"
    r"habilidades|agencia|conta|documento|comprovante|pergunta|descricao|titular|responsavel|escola|renda|apelido|alt|assunto|texto|conteudo|detalhe|termo|"
    r"opcao|erro|variaveis|anexo|arquivo|imagem|pis|cnh|beneficio|vulnerabilidade|"
    # o que a LGPD chama de sensível (art. 5º, II) e o que costuma vir junto: nunca pode entrar sem classificação
    r"saude|doenca|cid|laudo|deficiencia|alergia|alergias|medicamento|medicamentos|sanguineo|raca|cor|etnia|religiao|crenca|sexo|genero|orientacao|"
    r"sindical|politica|biometria|biometrico|digital|genetico)($|_)"
)

MASCARA_SENSIVEL = "[omitido: dado pessoal sensível]"
MASCARA_CRIANCA = "[omitido: dado pessoal em tabela que pode ter criança ou adolescente]"


_CRIANCAS_DERIVADAS: set = set()  # preenchido por `aplicar`


def pode_ter_crianca(tabela: str) -> bool:
    entrada = CLASSIFICACAO.get(tabela)
    return bool(entrada and entrada.criancas) or tabela in _CRIANCAS_DERIVADAS


def coluna(tabela: str, nome: str) -> Optional[Coluna]:
    if nome in NAO_PESSOAIS.get(tabela, ()):
        return NP
    entrada = CLASSIFICACAO.get(tabela)
    return entrada.colunas.get(nome) if entrada else None


def mascarar_para_auditoria(tabela: str, dados):
    """O "antes e depois" que vai para a Auditoria sem o valor de coluna sensível nem o de coluna pessoal de tabela que pode ter dado de criança (só a chave
    fica, para se saber O QUE mudou). A Auditoria não tem prazo de guarda: um valor sensível gravado ali ficaria para sempre."""
    entrada = CLASSIFICACAO.get(tabela)
    if entrada is None or not isinstance(dados, dict):
        return dados
    saida = {}
    for chave, valor in dados.items():
        c = entrada.colunas.get(chave)
        if c is not None and c.categoria == SENSIVEL and valor is not None:
            saida[chave] = MASCARA_SENSIVEL
        elif c is not None and c.categoria == PESSOAL and not c.visivel_na_auditoria and pode_ter_crianca(tabela) and valor is not None:
            saida[chave] = MASCARA_CRIANCA
        else:
            saida[chave] = valor
    return saida


def aplicar(metadata) -> None:
    """Escreve a classificação nas colunas e tabelas do modelo (`info`): é dali que o inventário e os controles leem."""
    marcadas = {nome for nome, entrada in CLASSIFICACAO.items() if entrada.criancas}
    adultos = {nome for nome, entrada in CLASSIFICACAO.items() if entrada.nao_herda_crianca}
    _CRIANCAS_DERIVADAS.clear()
    _CRIANCAS_DERIVADAS.update(
        nome for nome, tabela in metadata.tables.items()
        if nome not in marcadas | adultos and any(fk.column.table.name in marcadas for col in tabela.columns for fk in col.foreign_keys)
    )
    for nome, tabela in metadata.tables.items():
        entrada = CLASSIFICACAO.get(nome, Tabela())
        tabela.info["lgpd_criancas"] = pode_ter_crianca(nome)
        tabela.info["lgpd_titulares"] = tuple(sorted(set(entrada.titulares) | _titulares_pelas_chaves(tabela)))
        for col in tabela.columns:
            c = coluna(nome, col.name)
            if c is not None:
                col.info["lgpd"] = c.categoria
                col.info["lgpd_pode_conter_sensivel"] = c.pode_conter_sensivel
                if c.leitura_auditada:
                    col.info["lgpd_leitura_auditada"] = c.leitura_auditada


def _titulares_pelas_chaves(tabela) -> set:
    return {TITULAR_POR_CHAVE[fk.column.table.name] for col in tabela.columns for fk in col.foreign_keys if fk.column.table.name in TITULAR_POR_CHAVE}


def inventario_do_modelo(metadata=None) -> list[dict]:
    """Cada tabela que guarda dado de pessoa, lida do próprio modelo: titulares, colunas pessoais, sensíveis, de texto livre e se pode ter dado de criança."""
    if metadata is None:
        from app.database import Base
        metadata = Base.metadata
    saida = []
    for nome, tabela in sorted(metadata.tables.items()):
        pessoais = [c.name for c in tabela.columns if c.info.get("lgpd") == PESSOAL]
        sensiveis = [c.name for c in tabela.columns if c.info.get("lgpd") == SENSIVEL]
        titulares = list(tabela.info.get("lgpd_titulares", ()))
        if not (pessoais or sensiveis or titulares):
            continue
        saida.append({
            "tabela": nome, "titulares": titulares,
            "pode_ter_crianca": bool(tabela.info.get("lgpd_criancas") or CLASSIFICACAO.get(nome, Tabela()).adolescentes),
            "colunas_pessoais": pessoais, "colunas_sensiveis": sensiveis,
            "texto_livre_que_pode_ter_sensivel": [c.name for c in tabela.columns if c.info.get("lgpd_pode_conter_sensivel")],
            "leitura_auditada": sorted({c.info["lgpd_leitura_auditada"] for c in tabela.columns if c.info.get("lgpd_leitura_auditada")}),
        })
    return saida
