import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  BookOpen,
  BookText,
  Building2,
  CalendarPlus,
  CalendarRange,
  FileText,
  FileUp,
  FolderKanban,
  Gavel,
  Handshake,
  Landmark,
  MessageCircleQuestion,
  Receipt,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Truck,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react'

export type ItemModulo = {
  rota: string
  rotulo: string
  icone: LucideIcon
  fim?: boolean // NavLink "end" - só a rota exata fica ativa, não qualquer sub-rota
}

export type Modulo = {
  rota: string
  rotulo: string
  permissao: string
  icone: LucideIcon
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
        rota: '/governanca/mandatos',
        rotulo: 'Mandatos',
        icone: UserCheck,
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
  {
    rota: '/projetos',
    rotulo: 'Projetos',
    permissao: 'projetos',
    icone: FolderKanban,
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
]
