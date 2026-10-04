/**
 * Navegação do site — fonte única do cabeçalho, do menu de celular e do rodapé.
 *
 * Regra: só entra aqui página que EXISTE (o teste e2e confere que todo link interno responde 200).
 * Página nova = uma linha aqui; ela aparece em todos os menus e, pelo sitemap, entra sozinha na
 * auditoria de acessibilidade e SEO.
 */
export interface ItemDeNavegacao {
  rotulo: string
  href: string
}

/** Menu do topo. Poucos itens, os que o visitante mais procura. */
export const NAVEGACAO_PRINCIPAL: ItemDeNavegacao[] = [
  { rotulo: 'Quem somos', href: '/quem-somos/' },
  { rotulo: 'Projetos', href: '/projetos/' },
  { rotulo: 'Eventos', href: '/eventos/' },
  { rotulo: 'Notícias', href: '/noticias/' },
  { rotulo: 'Transparência', href: '/transparencia/' },
  { rotulo: 'Como ajudar', href: '/como-ajudar/' },
  { rotulo: 'Contato', href: '/contato/' },
]

export interface GrupoDoRodape {
  titulo: string
  itens: ItemDeNavegacao[]
}

/** Mapa do site no rodapé. Transparência e Privacidade ficam sempre à vista (PLANO v5.7). */
export const GRUPOS_DO_RODAPE: GrupoDoRodape[] = [
  {
    titulo: 'A ASAF',
    itens: [
      { rotulo: 'Quem somos', href: '/quem-somos/' },
      { rotulo: 'Diretoria e Conselho', href: '/diretoria/' },
      { rotulo: 'Estatuto Social', href: '/estatuto/' },
      { rotulo: 'Transparência', href: '/transparencia/' },
    ],
  },
  {
    titulo: 'Atividades',
    itens: [
      { rotulo: 'Projetos', href: '/projetos/' },
      { rotulo: 'Agenda de eventos', href: '/eventos/' },
      { rotulo: 'Notícias', href: '/noticias/' },
    ],
  },
  {
    titulo: 'Participe',
    itens: [
      { rotulo: 'Como ajudar', href: '/como-ajudar/' },
      { rotulo: 'Seja associado', href: '/seja-associado/' },
      { rotulo: 'Seja voluntário', href: '/seja-voluntario/' },
      { rotulo: 'Contato', href: '/contato/' },
    ],
  },
  {
    titulo: 'Informações legais',
    itens: [
      { rotulo: 'Política de Privacidade', href: '/privacidade/' },
      { rotulo: 'Termos de Uso', href: '/termos/' },
    ],
  },
]

export interface Migalha {
  rotulo: string
  /** Sem href = página atual. */
  href?: string
}

/** Compara caminho da página com o href do menu ("/quem-somos/" vale também para subpáginas). */
export function ehPaginaAtual(href: string, caminhoAtual: string): boolean {
  if (href.includes('#') || href === '/') return false
  return caminhoAtual === href || caminhoAtual.startsWith(href)
}
