import { describe, expect, it } from 'vitest'

import {
  GRUPOS_DO_RODAPE,
  NAVEGACAO_PRINCIPAL,
  ehPaginaAtual,
} from '../src/config/navegacao'

describe('ehPaginaAtual', () => {
  it('casa a própria página e as subpáginas', () => {
    expect(ehPaginaAtual('/quem-somos/', '/quem-somos/')).toBe(true)
    expect(ehPaginaAtual('/projetos/', '/projetos/horta/')).toBe(true)
  })
  it('não marca a home nem âncoras (não são "uma página")', () => {
    expect(ehPaginaAtual('/', '/')).toBe(false)
    expect(ehPaginaAtual('/#eventos', '/')).toBe(false)
  })
  it('não confunde páginas diferentes', () => {
    expect(ehPaginaAtual('/contato/', '/quem-somos/')).toBe(false)
  })
})

describe('menus', () => {
  const todos = [
    ...NAVEGACAO_PRINCIPAL,
    ...GRUPOS_DO_RODAPE.flatMap((g) => g.itens),
  ]
  it('todo link interno é absoluto (começa com "/")', () => {
    for (const item of todos) expect(item.href.startsWith('/')).toBe(true)
  })
  it('Transparência e Privacidade estão sempre no rodapé (PLANO v5.7)', () => {
    const hrefsDoRodape = GRUPOS_DO_RODAPE.flatMap((g) =>
      g.itens.map((i) => i.href),
    )
    expect(hrefsDoRodape).toContain('/transparencia/')
    expect(hrefsDoRodape).toContain('/privacidade/')
  })
})
