// Mensagens de interface (v0.2.6) — fonte única de todo texto visível do painel.
// Padroniza o vocabulário (sempre "associado", nunca "membro"/"usuário" alternando) e permite
// revisar texto sem mexer em componente. Sem plano de traduzir por ora; se um dia houver, esta
// vira a chave de cada string.
export const mensagens = {
  app: {
    nome: 'ASAF · Painel',
  },
  comum: {
    carregando: 'Carregando…',
    cancelar: 'Cancelar',
    salvar: 'Salvar alterações',
    salvando: 'Salvando…',
    voltar: 'Voltar',
    sair: 'Sair',
    atual: 'atual',
    tentarNovamente: 'Tentar de novo',
    voltarInicio: 'Voltar ao início',
  },
  navegacao: {
    inicio: 'Início',
    meuPerfil: 'Meu perfil',
    buscaGlobal: 'Busca global…',
    abrirMenu: 'Abrir menu',
    recolherMenu: 'Recolher menu',
    expandirMenu: 'Expandir menu',
    notificacoes: 'Notificações',
    ativarModoClaro: 'Ativar modo claro',
    ativarModoEscuro: 'Ativar modo escuro',
  },
  login: {
    subtitulo: 'Entre com seu CPF e senha.',
    subtituloMfa: 'Informe o código do seu autenticador.',
    cpf: 'CPF',
    senha: 'Senha',
    entrar: 'Entrar',
    entrando: 'Entrando…',
    codigoTotp: 'Código TOTP',
    codigoRecuperacao: 'Código de recuperação',
    verificar: 'Verificar',
    verificando: 'Verificando…',
    cpfInvalido: 'CPF inválido. Confira os dígitos e tente novamente.',
    sessaoExpirada: 'Sessão de login expirada. Volte e tente novamente.',
    usarRecuperacao: 'Usar código de recuperação',
    usarAutenticador: 'Usar código do autenticador',
  },
  mfa: {
    titulo: 'Ativação obrigatória de MFA',
    descricao:
      'Seu nível de acesso exige autenticação em duas etapas. Escaneie o QR code com o app autenticador e informe o código gerado.',
    codigoAutenticador: 'Código do autenticador',
    confirmar: 'Confirmar',
    gerandoQr: 'Gerando QR code…',
    codigosTitulo: 'Códigos de recuperação',
    codigosDescricao:
      'Guarde estes códigos em local seguro. Eles são mostrados uma única vez e substituem o autenticador caso você perca o celular.',
    concluir: 'Guardei os códigos — concluir',
  },
  erros: {
    acessoNegado: 'Acesso negado',
    acessoNegadoDescricao: 'Você não tem permissão para acessar esta área',
    permissaoNecessaria: 'permissão necessária',
    procureAdmin: 'Se acredita que isso é um erro, procure um administrador.',
    semConexao:
      'Não foi possível conectar ao servidor. Tente novamente em instantes.',
    naoFoiPossivelCarregar: 'Não foi possível carregar seus dados.',
  },
  emConstrucao:
    'A navegação e a guarda de permissão já estão funcionando. O conteúdo de negócio deste módulo entra nas fases seguintes do plano (a partir da FASE 1).',
  tabela: {
    filtrar: 'Filtrar',
    filtroPlaceholder: 'Filtrar…',
    nadaEncontrado: 'Nada encontrado',
    nadaEncontradoDescricao: 'Nenhum registro para os filtros atuais.',
    registros: 'registro(s)',
    porPagina: '/ página',
    selecionarTodos: 'Selecionar todos',
    selecionarLinha: 'Selecionar linha',
  },
  confirmar: {
    excluirAssociado: 'Excluir associado',
    excluirAssociadoDescricao:
      'Esta ação é irreversível. O registro será removido permanentemente.',
  },
} as const
