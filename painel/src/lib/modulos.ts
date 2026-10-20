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
  FilePlus,
  FileText,
  FileUp,
  Inbox,
  FolderKanban,
  FolderOpen,
  Gavel,
  Globe,
  Handshake,
  Headset,
  HeartHandshake,
  Landmark,
  ListChecks,
  Megaphone,
  MessageCircleQuestion,
  PartyPopper,
  Receipt,
  Scale,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
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

// Os itens do módulo que a pessoa vê: sem `permissao` própria, todos de quem entra no módulo; com ela, só de quem a tem (v5.4a; v5.7e usa para o Conselho Fiscal ver só o que audita).
export function itensVisiveis(
  modulo: Modulo,
  permissoes: string[],
): ItemModulo[] {
  return (modulo.itens ?? []).filter(
    (item) => !item.permissao || permissoes.includes(item.permissao),
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
  // v5.5a - fila única de atendimento: o que chega pelo formulário do site (contato, pedido de informação sobre recursos públicos, solicitação
  // de titular de dados da LGPD, voluntariado) com protocolo e prazo. Só quem tem a permissão `atendimento`.
  {
    rota: '/atendimentos',
    rotulo: 'Atendimento',
    permissao: 'atendimento',
    icone: Headset,
  },
  // v6.1 - comunicação interna: publicar avisos no mural de um grupo calculado e acompanhar quem leu e confirmou. Só quem tem `comunicar`
  // (por padrão o Presidente e os Secretários); o mural e "Meus avisos" de cada pessoa ficam fora do módulo (menu pessoal e Início).
  {
    rota: '/comunicacao',
    rotulo: 'Comunicação',
    permissao: 'comunicar',
    icone: Megaphone,
    itens: [
      {
        rota: '/comunicacao',
        rotulo: 'Avisos publicados',
        icone: Megaphone,
        fim: true,
      },
      { rota: '/comunicacao/novo', rotulo: 'Novo aviso', icone: FilePlus },
    ],
  },
  {
    rota: '/financeiro',
    rotulo: 'Financeiro',
    permissao: 'financeiro',
    // v5.7e (decisão do Presidente, 2026-10-19): o Conselho Fiscal AUDITA, não opera. `financeiro_auditar` é a permissão SECUNDÁRIA do módulo: abre só Conselho Fiscal,
    // Auditoria financeira e Relatórios (cada item sem `permissao` própria); o resto do módulo pede `financeiro`. O servidor revalida cada ação.
    permissoesAlternativas: ['financeiro_auditar'],
    icone: Wallet,
    itens: [
      {
        rota: '/financeiro',
        rotulo: 'Início',
        permissao: 'financeiro',
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
        permissao: 'financeiro',
        rotulo: 'Títulos',
        icone: Receipt,
      },
      {
        rota: '/financeiro/entradas',
        permissao: 'financeiro',
        rotulo: 'Entradas',
        icone: ArrowDownToLine,
      },
      {
        rota: '/financeiro/saidas',
        permissao: 'financeiro',
        rotulo: 'Saídas',
        icone: ArrowUpFromLine,
      },
      {
        rota: '/financeiro/registrar-saida',
        permissao: 'financeiro',
        rotulo: 'Registrar saída',
        icone: FilePlus,
      },
      {
        rota: '/financeiro/auditoria-financeira',
        rotulo: 'Auditoria financeira',
        icone: ListChecks,
      },
      {
        rota: '/financeiro/plano-contas',
        permissao: 'financeiro',
        rotulo: 'Plano de Contas',
        icone: BookOpen,
      },
      {
        rota: '/financeiro/fornecedores',
        permissao: 'financeiro',
        rotulo: 'Fornecedores',
        icone: Truck,
      },
      {
        rota: '/financeiro/exercicios',
        permissao: 'financeiro',
        rotulo: 'Exercícios',
        icone: CalendarRange,
      },
      {
        rota: '/financeiro/razao-contabil',
        permissao: 'financeiro',
        rotulo: 'Razão Contábil',
        icone: BookText,
      },
      {
        rota: '/financeiro/contas-financeiras',
        permissao: 'financeiro',
        rotulo: 'Contas Financeiras',
        icone: Wallet,
      },
      {
        rota: '/financeiro/centros-custo',
        permissao: 'financeiro',
        rotulo: 'Centros de Custo',
        icone: BookOpen,
      },
      {
        rota: '/financeiro/planos-contribuicao',
        permissao: 'financeiro',
        rotulo: 'Planos de Contribuição',
        icone: Receipt,
      },
      {
        rota: '/financeiro/gerar-cobrancas',
        permissao: 'financeiro',
        rotulo: 'Gerar Cobranças',
        icone: Receipt,
      },
      {
        rota: '/financeiro/conciliacao',
        permissao: 'financeiro',
        rotulo: 'Conciliação',
        icone: BookText,
      },
      {
        rota: '/financeiro/negociacao-divida',
        permissao: 'financeiro',
        rotulo: 'Negociação de Dívida',
        icone: Receipt,
      },
      {
        rota: '/financeiro/compras',
        permissao: 'financeiro',
        rotulo: 'Compras',
        icone: Receipt,
      },
      {
        rota: '/financeiro/reembolso-despesa',
        permissao: 'financeiro',
        rotulo: 'Reembolso de Despesa',
        icone: Receipt,
      },
      {
        rota: '/financeiro/alcadas-aprovacao',
        permissao: 'financeiro',
        rotulo: 'Alçadas de Aprovação',
        icone: BookText,
      },
      {
        rota: '/financeiro/contas-a-pagar-recorrentes',
        permissao: 'financeiro',
        rotulo: 'Contas a Pagar Recorrentes',
        icone: Receipt,
      },
      {
        rota: '/financeiro/doacoes',
        permissao: 'financeiro',
        rotulo: 'Doações',
        icone: Receipt,
      },
      {
        rota: '/financeiro/orcamento',
        permissao: 'financeiro',
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
    rota: '/regras',
    rotulo: 'Regras do sistema',
    permissao: 'gerenciar_acesso',
    icone: SlidersHorizontal,
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
  // protege o conteúdo é o login do próprio Directus (usuário, papel e MFA lá). v5.7g: a permissão
  // é a própria (`editar_site`), que a secretaria/comunicação recebe pela tela Níveis e permissões
  // sem ganhar nenhum poder sobre o acesso do sistema (antes o atalho reaproveitava `gerenciar_acesso`).
  {
    rota: '/editar-site',
    rotulo: 'Editar o site',
    permissao: 'editar_site',
    icone: Globe,
    externo: URL_DIRECTUS,
  },
]
