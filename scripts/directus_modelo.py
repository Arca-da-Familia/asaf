"""Modelo editorial do Directus (v5.3): pastas, coleções, perfis de acesso e permissões.

Só DADOS - nenhuma chamada de rede aqui. `scripts/directus_configurar.py` lê este modelo e o aplica
(idempotente); os testes em `tests/test_directus_modelo.py` provam as regras de privilégio mínimo
sem precisar de um Directus no ar.

Regras que este modelo precisa manter (PLANO_PROJETO.md, v5.1/v5.3):
  - o Directus guarda SÓ conteúdo EDITORIAL do site (notícias, textos, banners, fotos, FAQ...). Documento
    oficial (ata, estatuto, certidão, balanço, termo de fomento...), emenda, parcela, pagamento e prestação
    de contas moram no SISTEMA da ASAF, que é a fonte da verdade e controla sigilo/versão pública (decisão do
    usuário, 2026-10-03; PLANO v5.4). Por isso NÃO existe aqui coleção `documentos` (foi criada e removida);
  - nunca dado de associado/financeiro do sistema (esse mora no schema `public`, fora do alcance do
    `directus_app`);
  - cada perfil só tem o que a função dele precisa; permissão no backend, nunca só escondida na tela;
  - rascunho não vaza: quem lê para o site só enxerga `status = publicado`;
  - quem só escreve (Redator) NÃO consegue publicar nem apagar;
  - foto só publica com texto alternativo e autorização de imagem confirmada (ECA/LGPD). As
    `conditions` dos campos só valem NA TELA do Studio; o portão que vale de verdade é o BUILD do site
    (v5.3), que recusa publicar notícia com imagem sem `imagem_alt` e `autorizacao_imagem`.

Fato do Directus 12 (descoberto ao testar, 2026-10-03): regra de permissão personalizada (filtro por
linha, validação, predefinição, lista de campos) é recurso LICENCIADO (`custom_permission_rules_enabled`).
Sem licença só existe "pode tudo / não pode nada" por coleção e ação. O script avisa e não finge.
"""
from __future__ import annotations

STATUS_RASCUNHO = "rascunho"
STATUS_REVISAO = "revisao"
STATUS_PUBLICADO = "publicado"
STATUS_ARQUIVADO = "arquivado"
STATUS_OPCOES = [
    {"text": "Rascunho", "value": STATUS_RASCUNHO},
    {"text": "Em revisão", "value": STATUS_REVISAO},
    {"text": "Publicado", "value": STATUS_PUBLICADO},
    {"text": "Arquivado", "value": STATUS_ARQUIVADO},
]
STATUS_DE_RASCUNHO = [STATUS_RASCUNHO, STATUS_REVISAO]

# ------------------------------------------------------------------------------------------ pastas
# Biblioteca de arquivos do Directus (Studio -> Biblioteca de arquivos): só IMAGENS e mídia do site. Documento
# oficial NÃO vai aqui (vai para o módulo Documentos do sistema). Subpastas ficam debaixo da pasta-mãe.
PASTAS: list[dict] = [
    {"nome": "Fotos de eventos e projetos", "filhas": []},
    {"nome": "Notícias", "filhas": []},
]

# ---------------------------------------------------------------------------------------- coleções
def _campo(nome: str, tipo: str, *, meta: dict | None = None, schema: dict | None = None) -> dict:
    return {"field": nome, "type": tipo, "meta": meta or {}, "schema": schema or {}}


def _campos_de_controle() -> list[dict]:
    """Quem criou/alterou e quando - preenchido pelo Directus, não editável (trilha de auditoria)."""
    somente_leitura = {"readonly": True, "hidden": False, "width": "half"}
    return [
        _campo("user_created", "uuid", meta={**somente_leitura, "special": ["user-created"], "interface": "select-dropdown-m2o",
                                             "options": {"template": "{{avatar}} {{first_name}} {{last_name}}"},
                                             "display": "user", "note": "Quem criou"},
               schema={"is_nullable": True}),
        _campo("date_created", "timestamp", meta={**somente_leitura, "special": ["date-created"], "interface": "datetime",
                                                  "display": "datetime", "note": "Criado em"},
               schema={"is_nullable": True}),
        _campo("user_updated", "uuid", meta={**somente_leitura, "special": ["user-updated"], "interface": "select-dropdown-m2o",
                                             "options": {"template": "{{avatar}} {{first_name}} {{last_name}}"},
                                             "display": "user", "note": "Quem alterou por último"},
               schema={"is_nullable": True}),
        _campo("date_updated", "timestamp", meta={**somente_leitura, "special": ["date-updated"], "interface": "datetime",
                                                  "display": "datetime", "note": "Última atualização (o site mostra esta data)"},
               schema={"is_nullable": True}),
    ]


def _campo_status() -> dict:
    return _campo(
        "status", "string",
        meta={"interface": "select-dropdown", "width": "half", "required": True,
              "options": {"choices": STATUS_OPCOES}, "display": "labels",
              "display_options": {"showAsDot": True, "choices": [
                  {"text": "Rascunho", "value": STATUS_RASCUNHO, "foreground": "#FFFFFF", "background": "#A2B5CD"},
                  {"text": "Em revisão", "value": STATUS_REVISAO, "foreground": "#FFFFFF", "background": "#E3C435"},
                  {"text": "Publicado", "value": STATUS_PUBLICADO, "foreground": "#FFFFFF", "background": "#145238"},
                  {"text": "Arquivado", "value": STATUS_ARQUIVADO, "foreground": "#FFFFFF", "background": "#666666"},
              ]},
              "note": "Só 'Publicado' aparece no site."},
        schema={"default_value": STATUS_RASCUNHO, "is_nullable": False},
    )


def _chave_uuid() -> dict:
    return _campo("id", "uuid", meta={"hidden": True, "readonly": True, "special": ["uuid"]},
                  schema={"is_primary_key": True, "has_auto_increment": False, "is_nullable": False})


COLECOES: list[dict] = [
    {
        "colecao": "noticias",
        "meta": {
            "icon": "newspaper", "note": "Notícias do site. O site mostra só as 'Publicado', da mais recente para a mais antiga.",
            # Sem "arquivar" do Directus: ele põe um chip "Publicado" no alto da lista que confunde. "Arquivado" continua
            # sendo uma Situação normal (some do site, fica guardada).
            "archive_field": None, "archive_value": None, "unarchive_value": None,
            "sort_field": None, "singleton": False, "versioning": True,
            "display_template": "{{titulo}}", "translations": [{"language": "pt-BR", "translation": "Notícias", "singular": "Notícia", "plural": "Notícias"}],
        },
        "campos": [
            _chave_uuid(),
            _campo_status(),
            _campo("titulo", "string", meta={"interface": "input", "required": True, "width": "full",
                                             "options": {"trim": True}}, schema={"is_nullable": False, "max_length": 160}),
            _campo("slug", "string", meta={"interface": "input", "required": True, "width": "half",
                                           "note": "Endereço da notícia no site (sem acento, com hífen). NÃO mude depois de publicada: o link muda junto.",
                                           "options": {"slug": True, "trim": True}},
                   schema={"is_nullable": False, "is_unique": True, "max_length": 120}),
            _campo("publicada_em", "timestamp", meta={"interface": "datetime", "width": "half", "required": True,
                                                      "note": "Data que aparece no site. Data no futuro = só aparece depois dela."},
                   schema={"is_nullable": False}),
            _campo("resumo", "text", meta={"interface": "input-multiline", "required": True, "width": "full",
                                           "note": "Até 300 caracteres. Aparece na lista e na prévia do WhatsApp."},
                   schema={"is_nullable": False}),
            _campo("corpo", "text", meta={"interface": "input-rich-text-html", "required": True, "width": "full"},
                   schema={"is_nullable": False}),
            _campo("imagem", "uuid", meta={"interface": "file-image", "special": ["file"], "width": "half",
                                           "note": "Opcional. Foto de pessoa/criança só com autorização (marque a caixa ao lado)."},
                   schema={"is_nullable": True}),
            _campo("imagem_alt", "string", meta={"interface": "input", "width": "half",
                                                 "note": "OBRIGATÓRIO quando há imagem: descreva a foto para quem não enxerga.",
                                                 "conditions": [{"name": "obrigatorio_com_imagem", "rule": {"_and": [{"imagem": {"_nnull": True}}]},
                                                                 "required": True}]},
                   schema={"is_nullable": True, "max_length": 250}),
            _campo("autorizacao_imagem", "boolean", meta={"interface": "boolean", "width": "half",
                                                          "options": {"label": "Sim, tenho autorização"},
                                                          "note":"Marque SÓ se há autorização de uso de imagem (dos responsáveis, no caso de crianças).",
                                                          "conditions": [{"name": "obrigatorio_com_imagem", "rule": {"_and": [{"imagem": {"_nnull": True}}]},
                                                                          "required": True}]},
                   schema={"is_nullable": False, "default_value": False}),
            *_campos_de_controle(),
        ],
        "relacoes": [{"campo": "imagem", "para": "directus_files"}],
    },
]

# ---------------------------------------------------------------------------- organização do formulário
# O editor da ASAF não é programador: o formulário da notícia é dividido em seções, em português, na ordem em
# que a pessoa escreve (texto -> foto -> publicação). Os rótulos usam `translations` (pt-BR).
def _traduzido(texto: str) -> list[dict]:
    return [{"language": "pt-BR", "translation": texto}]


def _grupo(nome: str, rotulo: str, icone: str, ordem: int, aberto: bool = True) -> dict:
    """Seção do formulário (campo "alias": não guarda dado, só agrupa os campos de dentro)."""
    return {"field": nome, "type": "alias", "schema": None,
            "meta": {"interface": "group-detail", "special": ["alias", "no-data", "group"], "width": "full", "sort": ordem,
                     "translations": _traduzido(rotulo),
                     "options": {"headerIcon": icone, "start": "open" if aberto else "closed"}}}


def _organizar(definicao: dict, secoes: list[tuple], rotulos: dict[str, str]) -> None:
    """`secoes`: (nome, rótulo, ícone, aberta, [campos]). Põe cada campo na sua seção, na ordem, com o rótulo."""
    por_nome = {f["field"]: f for f in definicao["campos"]}
    novos, ordem = [], 0
    for nome, rotulo, icone, aberta, campos in secoes:
        ordem += 1
        novos.append(_grupo(nome, rotulo, icone, ordem, aberta))
        for campo in campos:
            ordem += 1
            meta = por_nome[campo]["meta"]
            meta["group"], meta["sort"] = nome, ordem
            if campo in rotulos:
                meta["translations"] = _traduzido(rotulos[campo])
    por_nome["id"]["meta"]["sort"] = 0
    definicao["campos"] = [por_nome["id"], *novos, *[f for f in definicao["campos"] if f["field"] not in ("id",)]]


_NOTICIAS = next(c for c in COLECOES if c["colecao"] == "noticias")
_organizar(
    _NOTICIAS,
    [
        ("grupo_conteudo", "Conteúdo", "edit_note", True, ["titulo", "slug", "resumo", "corpo"]),
        ("grupo_foto", "Foto da notícia (opcional)", "photo_camera", True, ["imagem", "imagem_alt", "autorizacao_imagem"]),
        ("grupo_publicacao", "Publicação", "event_available", True, ["status", "publicada_em"]),
        ("grupo_historico", "Histórico", "history", False, ["user_created", "date_created", "user_updated", "date_updated"]),
    ],
    {
        "titulo": "Título", "slug": "Endereço da notícia (slug)", "resumo": "Resumo", "corpo": "Texto",
        "imagem": "Foto", "imagem_alt": "Descrição da foto (texto alternativo)",
        "autorizacao_imagem": "Autorização de imagem",
        "status": "Situação", "publicada_em": "Publicar em",
        "user_created": "Criada por", "date_created": "Criada em",
        "user_updated": "Alterada por", "date_updated": "Última alteração",
    },
)
# Sem as definições de campos "mexidas" fora de ordem: o sort acima é o que o Studio usa.
_NOTICIAS["campos"] = sorted(_NOTICIAS["campos"], key=lambda f: f["meta"].get("sort", 0))

# Aparência do Studio (Configurações do projeto): em português, com o nome e a cor da ASAF.
AJUSTES_DO_PROJETO = {
    "project_name": "ASAF — Editor do site",
    "project_descriptor": "Notícias e conteúdo de asaf.org.br",
    "project_color": "#145238",
    "default_language": "pt-BR",
    "public_note": "Acesso restrito a quem edita o site da ASAF. Em caso de dúvida: asaf@asaf.org.br.",
}

# Atalhos na lista de notícias (marcadores globais: aparecem para todos que têm acesso à coleção).
_COLUNAS_DA_LISTA = ["status", "titulo", "publicada_em", "date_updated"]
# O primeiro (`nome` None) NÃO é atalho: é a lista PADRÃO que abre ao entrar em Notícias, sem filtro.
MARCADORES: list[dict] = [
    {"nome": None, "colecao": "noticias", "icone": None, "filtro": None},
    {"nome": "Todas as notícias", "colecao": "noticias", "icone": "newspaper", "filtro": None},
    {"nome": "Para revisar", "colecao": "noticias", "icone": "rate_review", "filtro": {"status": {"_eq": STATUS_REVISAO}}},
    {"nome": "Rascunhos", "colecao": "noticias", "icone": "draw", "filtro": {"status": {"_eq": STATUS_RASCUNHO}}},
    {"nome": "No ar", "colecao": "noticias", "icone": "public", "filtro": {"status": {"_eq": STATUS_PUBLICADO}}},
]
COLUNAS_DA_LISTA = _COLUNAS_DA_LISTA

# Coleções que o Directus de ASAF PODE ter (além das do próprio sistema, `directus_*`). A verificação
# reprova qualquer outra - é a defesa contra dado de negócio parar no CMS.
COLECOES_PERMITIDAS = {c["colecao"] for c in COLECOES}

# --------------------------------------------------------------------------------- perfis e permissões
# Cada perfil = uma "política" (conjunto de permissões) + um "papel" com o mesmo nome. Nenhum recebe
# `admin_access`; o Administrador é o papel que já existe. `app_access` = pode entrar no Studio.
ARQUIVOS = "directus_files"
PASTAS_SISTEMA = "directus_folders"
CAMPOS_ARQUIVO_PUBLICO = ["id", "title", "description", "filename_download", "type", "filesize", "width", "height",
                          "folder", "uploaded_on", "modified_on"]


def _perm(colecao: str, acao: str, *, filtro: dict | None = None, validacao: dict | None = None,
          predefinicao: dict | None = None, campos: list[str] | None = None) -> dict:
    return {"colecao": colecao, "acao": acao, "filtro": filtro or {}, "validacao": validacao or {},
            "predefinicao": predefinicao or {}, "campos": campos if campos is not None else ["*"]}


SO_PUBLICADO = {"status": {"_eq": STATUS_PUBLICADO}}
# Publicado e com data de publicação já alcançada (agendamento): usado só em `noticias`.
NOTICIA_NO_AR = {"_and": [{"status": {"_eq": STATUS_PUBLICADO}}, {"publicada_em": {"_lte": "$NOW"}}]}
SO_RASCUNHO = {"status": {"_in": STATUS_DE_RASCUNHO}}
MEUS = {"user_created": {"_eq": "$CURRENT_USER"}}
MEUS_ARQUIVOS = {"uploaded_by": {"_eq": "$CURRENT_USER"}}


def _crud(colecao: str) -> list[dict]:
    return [_perm(colecao, a) for a in ("create", "read", "update", "delete")]


def _arquivos_editor() -> list[dict]:
    """Enviar e organizar arquivos próprios e de outros editores; não apagar o que é de outro perfil."""
    return [_perm(ARQUIVOS, "create"), _perm(ARQUIVOS, "read"), _perm(ARQUIVOS, "update"),
            _perm(ARQUIVOS, "delete"), _perm(PASTAS_SISTEMA, "read")]


PERFIS: list[dict] = [
    {
        "nome": "Editor de conteúdo",
        "icone": "edit_note",
        "descricao": "Escreve e publica notícias.",
        "app_access": True,
        "permissoes": [*_crud("noticias"), *_arquivos_editor()],
    },
    {
        "nome": "Redator",
        "icone": "draw",
        "descricao": "Escreve notícias em rascunho; quem revisa publica. Não publica, não apaga, só mexe no que é seu.",
        "app_access": True,
        "permissoes": [
            _perm("noticias", "create", validacao={"status": {"_in": STATUS_DE_RASCUNHO}},
                  predefinicao={"status": STATUS_RASCUNHO}),
            _perm("noticias", "read", filtro=MEUS),
            _perm("noticias", "update", filtro={"_and": [MEUS, SO_RASCUNHO]},
                  validacao={"status": {"_in": STATUS_DE_RASCUNHO}}),
            _perm(ARQUIVOS, "create"),
            _perm(ARQUIVOS, "read", filtro=MEUS_ARQUIVOS),
            _perm(PASTAS_SISTEMA, "read"),
        ],
    },
    {
        "nome": "Colaborador de mídia",
        "icone": "photo_camera",
        "descricao": "Só envia fotos. Não vê nem edita texto de nenhuma coleção.",
        "app_access": True,
        "permissoes": [
            _perm(ARQUIVOS, "create"),
            _perm(ARQUIVOS, "read", filtro=MEUS_ARQUIVOS),
            _perm(PASTAS_SISTEMA, "read"),
        ],
    },
    {
        "nome": "Leitor do site",
        "icone": "visibility",
        "descricao": "Conta de serviço do build do site: LÊ somente o que está publicado. Sem acesso ao Studio.",
        "app_access": False,
        "permissoes": [
            _perm("noticias", "read", filtro=NOTICIA_NO_AR),
            _perm(ARQUIVOS, "read", campos=CAMPOS_ARQUIVO_PUBLICO),
            _perm(PASTAS_SISTEMA, "read"),
        ],
    },
]

COLECOES_DE_SISTEMA_PROIBIDAS_A_EDITORES = (
    "directus_users", "directus_roles", "directus_policies", "directus_permissions", "directus_access",
    "directus_settings", "directus_flows", "directus_operations", "directus_collections", "directus_fields",
    "directus_relations", "directus_presets", "directus_webhooks", "directus_extensions", "directus_activity",
    "directus_revisions",
)

# O que já existiu neste modelo e foi RETIRADO. `aplicar` remove do Directus, mas SÓ se estiver vazio
# (nunca apaga conteúdo de ninguém); se houver conteúdo, avisa e não toca. Ordem: filhas antes da mãe.
COLECOES_DESCONTINUADAS = ["documentos"]
PASTAS_DESCONTINUADAS = ["Estatuto e alterações", "Atas", "Registros e certidões", "Balanços e relatórios",
                         "Documentos institucionais", "Emendas e parcerias"]
PERFIS_DESCONTINUADOS = ["Editor de transparência"]
