import { render, screen } from '@testing-library/react'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it } from 'vitest'

import { AvisoDeAmbiente } from '@/components/layout/AvisoDeAmbiente'
import { ehHomologacao, TEXTO_DO_AMBIENTE_DE_TESTE } from '@/lib/ambiente'

describe('ambiente de homologação (teste)', () => {
  afterEach(() => {
    document.title = 'ASAF · Painel'
    document.head
      .querySelectorAll('meta[name="robots"]')
      .forEach((m) => m.remove())
  })

  it('só o valor "homologacao" liga o ambiente de teste: a produção (variável ausente) nunca', () => {
    expect(ehHomologacao('homologacao')).toBe(true)
    for (const outro of [undefined, '', 'producao', 'Homologacao', 'true'])
      expect(ehHomologacao(outro)).toBe(false)
  })

  it('no teste: mostra a faixa, marca o título e pede que buscadores não indexem; ao sair, desfaz tudo', () => {
    document.title = 'ASAF · Painel'
    const { unmount } = render(<AvisoDeAmbiente ativo />)
    expect(screen.getByRole('status')).toHaveTextContent(
      TEXTO_DO_AMBIENTE_DE_TESTE,
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'todos os dados são inventados',
    )
    expect(document.title).toBe('[TESTE] ASAF · Painel')
    expect(
      document.head
        .querySelector('meta[name="robots"]')
        ?.getAttribute('content'),
    ).toBe('noindex, nofollow')
    unmount()
    expect(document.title).toBe('ASAF · Painel')
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
  })

  it('na produção: não renderiza nada e não mexe no título nem nos buscadores', () => {
    document.title = 'ASAF · Painel'
    const { container } = render(<AvisoDeAmbiente ativo={false} />)
    expect(container).toBeEmptyDOMElement()
    expect(document.title).toBe('ASAF · Painel')
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
  })

  it('a faixa não tem violação de acessibilidade (axe)', async () => {
    const { container } = render(<AvisoDeAmbiente ativo />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
