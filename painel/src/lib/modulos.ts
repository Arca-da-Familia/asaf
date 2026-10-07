import type { LucideIcon } from 'lucide-react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  BookOpen,
  BookText,
  Building2,
  CalendarCheck,
  CalendarPlus,
  CalendarRange,
  FileCheck,
  FileText,
  FileUp,
  Inbox,
  FolderKanban,
  FolderOpen,
  Gavel,
  Globe,
  Handshake,
  HeartHandshake,
  Landmark,
  ListChecks,
  MessageCircleQuestion,
  PartyPopper,
  Receipt,
  Scale,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Truck,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react'

// Endereço do Directus (CMS do site). Definitivo — a chave do plano gratuito do Directus fica
// amarrada a este endereço (PUBLIC_URL do Container App), então não se troca à toa.
export const URL_DIRECTUS =
  import.meta.env.VITE_DIRECTUS_URL ?? 'https://cms.asaf.org.br'

export type ItemModulo = {
  rota: string
  rotulo: string
  icone: LucideIcon
  fim?: boolean // NavLink "end" - só a rota exata fica ativa, não qualquer sub-rota
  // v5.4a - só mostra o item a quem tem esta permissão (ex.: quem só aprova não vê "Novo documento").
  permissao?: string
}

export type Modulo = {
  rota: string
  rotulo: string
  permissao: string
  // v5.4a - outras permissões que TAMBÉM dão acesso ao módulo (ex.: quem só aprova ou só baixa originais
  // enxerga a biblioteca de documentos sem precisar de `documentos`). O backend revalida cada ação.
  permissoesAlternativas?: string[]
  icone: LucideIcon
  // v5.1 - módulo que NÃO é tela do painel: o cartão da tela inicial abre este endereço numa
  // nova aba (ex.: o Directus, onde se edita o conteúdo do site). `rota` vira só um
  // identificador, nunca é registrada no roteador.
  externo?: string
  // v2.5.1d (achado do usuário 2026-09-15) - funções do módulo (Listar, Novo, Gráficos…).
  // Renderizadas na MESMA barra lateral única do painel (Shell.tsx), nunca numa segunda
  // barra ao lado do conteúdo - duas colunas de navegação é ruim em qualquer tela e péssimo
  // no celular, onde a maioria de quem usa o painel está. Módulo sem `itens` (ainda
  // `<EmConstrucao>`) simplesmente não troca a barra - continua mostrando o menu global.
  itens?: ItemModulo[]
}

// Manifesto único dos módulos do painel (v0.2.3). O shell monta o menu filtrando esta lista
// pelas permissões devolvidas por /auth/me — NUNCA há `if (nivel === 'Presidente')` no código.
// Cada módulo de negócio das FASES 1-20 se registra aqui; o shell não precisa saber mais nada.
// Visível se o usuário tem a permissão do módulo OU uma das alternativas. Nunca `if (nivel === ...)`.
export function moduloVisivel(modulo: Modulo, permissoes: string[]): boolean {
  return [modulo.permissao, ...(modulo.permissoesAlternativas ?? [])].some(
    (p) => permissoes.includes(p),
  )
}

export const modulos: Modulo[] = [
  {
    rota: '/associados',
    rotulo: 'Associados',
    permissao: 'associados',
    icone: Users,
    itens: [
      {
        rota: '/associados',
        rotulo: 'Listar associados',
        icone: Users,
        fim: true,
      },
      { rota: '/associados/novo', rotulo: 'Novo associado', icone: UserPlus },
      {
        rota: '/associados/propostas',
        rotulo: 'Propostas de filiação',
        icone: Inbox,
      },
      {
        rota: '/associados/qualidade',
        rotulo: 'Qualidade da base',
        icone: ShieldCheck,
      },
      {
        rota: '/associados/importar',
        rotulo: 'Importar em lote',
        icone: FileUp,
      },
      { rota: '/associados/graficos', rotulo: 'Gráficos', icone: BarChart3 },
    ],
  },
  {
    rota: '/financeiro',
    rotulo: 'Financeiro',
    permissao: 'financeiro',
    icone: Wallet,
    itens: [
      {
        rota: '/financeiro',
        rotulo: 'Início',
        icone: Wallet,
        fim: true,
      },
      {
        rota: '/financeiro/conselho-fiscal',
        rotulo: 'Conselho Fiscal',
        icone: MessageCircleQuestion,
      },
      {
        rota: '/financeiro/titulos',
        rotulo: 'Títulos',
        icone: Receipt,
      },
      {
        rota: '/financeiro/entradas',
        rotulo: 'Entradas',
        icone: ArrowDownToLine,
      },
      {
        rota: '/financeiro/saidas',
        rotulo: 'Saídas',
        icone: ArrowUpFromLine,
      },
      {
        rota: '/financeiro/auditoria-financeira',
        rotulo: 'Auditoria financeira',
        icone: ListChecks,
      },
      {
        rota: '/financeiro/plano-contas',
        rotulo: 'Plano de Contas',
        icone: BookOpen,
      },
      {
        rota: '/financeiro/fornecedores',
        rotulo: 'Fornecedores',
        icone: Truck,
      },
      {
        rota: '/financeiro/exercicios',
        rotulo: 'Exercícios',
        icone: CalendarRange,
      },
      {
        rota: '/financeiro/razao-contabil',
        rotulo: 'Razão Contábil',
        icone: BookText,
      },
      {
        rota: '/financeiro/contas-financeiras',
        rotulo: 'Contas Financeiras',
        icone: Wallet,
      },
      {
        rota: '/financeiro/centros-custo',
        rotulo: 'Centros de Custo',
        icone: BookOpen,
      },
      {
        rota: '/financeiro/planos-contribuicao',
        rotulo: 'Planos de Contribuição',
        icone: Receipt,
      },
      {
        rota: '/financeiro/gerar-cobrancas',
        rotulo: 'Gerar Cobranças',
        icone: Receipt,
      },
      {
        rota: '/financeiro/conciliacao',
        rotulo: 'Conciliação',
        icone: BookText,
      },
      {
        rota: '/financeiro/negociacao-divida',
        rotulo: 'Negociação de Dívida',
        icone: Receipt,
      },
      {
        rota: '/financeiro/compras',
        rotulo: 'Compras',
        icone: Receipt,
      },
      {
        rota: '/financeiro/reembolso-despesa',
        rotulo: 'Reembolso de Despesa',
        icone: Receipt,
      },
      {
        rota: '/financeiro/alcadas-aprovacao',
        rotulo: 'Alçadas de Aprovação',
        icone: BookText,
      },
      {
        rota: '/financeiro/contas-a-pagar-recorrentes',
        rotulo: 'Contas a Pagar Recorrentes',
        icone: Receipt,
      },
      {
        rota: '/financeiro/doacoes',
        rotulo: 'Doações',
        icone: Receipt,
      },
      {
        rota: '/financeiro/orcamento',
        rotulo: 'Orçamento e Fluxo de Caixa',
        icone: BarChart3,
      },
      {
        rota: '/financeiro/relatorios',
        rotulo: 'Relatórios',
        icone: FileText,
      },
    ],
  },
  {
    rota: '/governanca',
    rotulo: 'Governança',
    permissao: 'governanca',
    icone: Landmark,
    itens: [
      {
        rota: '/governanca',
        rotulo: 'Assembleias',
        icone: Gavel,
        fim: true,
      },
      {
        rota: '/governanca/nova',
        rotulo: 'Nova assembleia',
        icone: CalendarPlus,
      },
      {
        rota: '/governanca/peticoes',
        rotulo: 'Petições de convocação',
        icone: Handshake,
      },
      {
        rota: '/governanca/atas',
        rotulo: 'Atas',
        icone: FileText,
      },
      {
        rota: '/governanca/deliberacoes',
        rotulo: 'Deliberações pendentes',
        icone: ListChecks,
      },
      {
        rota: '/governanca/mandatos',
        rotulo: 'Mandatos',
        icone: UserCheck,
      },
      {
        rota: '/governanca/estatuto',
        rotulo: 'Regras do Estatuto',
        icone: Scale,
      },
      {
        rota: '/governanca/disciplina',
        rotulo: 'Disciplina',
        icone: ShieldAlert,
      },
      {
        rota: '/governanca/dissolucao',
        rotulo: 'Dissolução',
        icone: Building2,
      },
    ],
  },
  // v5.4a - biblioteca de documentos institucionais: original privado, versão pública verificada e aprovação
  // de publicação por outra pessoa (Presidente ou Secretário). Dá acesso: preparar (`documentos`), aprovar
  // (`aprovar_publicacao`) ou baixar originais sigilosos (`documentos_originais`).
  {
    rota: '/documentos',
    rotulo: 'Documentos',
    permissao: 'documentos',
    permissoesAlternativas: ['aprovar_publicacao', 'documentos_originais'],
    icone: FolderOpen,
    itens: [
      {
        rota: '/documentos',
        rotulo: 'Biblioteca',
        icone: FolderOpen,
        fim: true,
      },
      {
        rota: '/documentos/novo',
        rotulo: 'Novo documento',
        icone: FileUp,
        permissao: 'documentos',
      },
    ],
  },
  // v5.4a - parcerias e emendas parlamentares: o dinheiro vem do livro-caixa (centro de custo exclusivo) e o site
  // de transparência só mostra o que o Presidente ou o Secretário aprovar. Gerir: `parcerias`; aprovar:
  // `aprovar_publicacao`.
  {
    rota: '/parcerias',
    rotulo: 'Parcerias e emendas',
    permissao: 'parcerias',
    permissoesAlternativas: ['aprovar_publicacao'],
    icone: Handshake,
    itens: [
      {
        rota: '/parcerias',
        rotulo: 'Parcerias e emendas',
        icone: Handshake,
        fim: true,
      },
      {
        rota: '/parcerias/nova',
        rotulo: 'Nova parceria',
        icone: CalendarPlus,
        permissao: 'parcerias',
      },
    ],
  },
  {
    rota: '/projetos',
    rotulo: 'Projetos',
    permissao: 'projetos',
    icone: FolderKanban,
  },
  {
    rota: '/reserva-espaco',
    rotulo: 'Reserva de Espaço',
    permissao: 'projetos',
    icone: CalendarCheck,
  },
  {
    rota: '/beneficiarios',
    rotulo: 'Beneficiários',
    permissao: 'projetos',
    icone: HeartHandshake,
  },
  {
    rota: '/eventos',
    rotulo: 'Eventos',
    permissao: 'projetos',
    icone: PartyPopper,
  },
  {
    rota: '/documentos-emitidos',
    rotulo: 'Documentos emitidos',
    permissao: 'projetos',
    icone: FileCheck,
  },
  {
    rota: '/instituicao',
    rotulo: 'Instituição',
    permissao: 'gerenciar_acesso',
    icone: Building2,
  },
  {
    rota: '/acesso',
    rotulo: 'Níveis e permissões',
    permissao: 'gerenciar_acesso',
    icone: ShieldCheck,
  },
  {
    rota: '/auditoria',
    rotulo: 'Auditoria',
    permissao: 'auditoria',
    icone: ScrollText,
  },
  // v5.1 - atalho para o Directus (CMS do site). Mostrar o cartão é só conveniência: quem
  // protege o conteúdo é o login do próprio Directus (usuário, papel e MFA lá). Por ora reaproveita
  // `gerenciar_acesso` (presidência); quando os papéis de editor do Directus forem mapeados
  // (v5.1), nasce uma permissão própria (`editar_site`) para a secretaria/comunicação.
  {
    rota: '/editar-site',
    rotulo: 'Editar o site',
    permissao: 'gerenciar_acesso',
    icone: Globe,
    externo: URL_DIRECTUS,
  },
]
