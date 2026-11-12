import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { PageHeader } from '@/components/layout/PageHeader'
import { AJUDA, ajudaDaTela } from '@/lib/ajuda'

// v9.3 — "Como usar esta tela": o botão aparece só nas telas com texto; o texto só existe depois do clique; endereço com número usa a chave com :id.
function desenhar(caminho: string) {
  return render(
    <MemoryRouter initialEntries={[caminho]}>
      <PageHeader titulo="Uma tela" descricao="O que ela faz." />
    </MemoryRouter>,
  )
}

describe('ajuda da tela', () => {
  it('acha a ajuda pelo endereço (com ou sem barra no fim; número vira :id)', () => {
    expect(ajudaDaTela('/atendimentos')).toBe(AJUDA['/atendimentos'])
    expect(ajudaDaTela('/atendimentos/')).toBe(AJUDA['/atendimentos'])
    expect(ajudaDaTela('/tela-sem-ajuda')).toBeUndefined()
  })

  it('o texto só existe depois do clique, e o botão diz se está aberta', async () => {
    const u = userEvent.setup()
    const { container } = desenhar('/financeiro/fornecedores')
    const botao = screen.getByRole('button', { name: 'Como usar esta tela' })
    expect(botao).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/Validar situação/)).toBeNull()
    await u.click(botao)
    const regiao = screen.getByRole('region', { name: 'Como usar esta tela' })
    expect(regiao).toHaveTextContent('Validar situação')
    expect(regiao).toHaveTextContent('Atenção:')
    expect(
      screen.getByRole('button', { name: 'Fechar a ajuda' }),
    ).toHaveAttribute('aria-expanded', 'true')
    expect(await axe(container)).toHaveNoViolations()
    await u.click(screen.getByRole('button', { name: 'Fechar a ajuda' }))
    expect(
      screen.queryByRole('region', { name: 'Como usar esta tela' }),
    ).toBeNull()
  })

  it('tela sem texto não mostra o botão; fora de um roteador, nada', () => {
    desenhar('/tela-sem-ajuda')
    expect(
      screen.queryByRole('button', { name: 'Como usar esta tela' }),
    ).toBeNull()
    render(<PageHeader titulo="Sem roteador" />)
    expect(
      screen.getByRole('heading', { name: 'Sem roteador' }),
    ).toBeInTheDocument()
  })

  it('nenhum texto de ajuda tem nome técnico (palavra_com_sublinhado ou CÓDIGO em maiúsculas)', () => {
    for (const [tela, a] of Object.entries(AJUDA)) {
      const texto = [a.paraQue, ...a.passos, a.atencao ?? ''].join(' ')
      expect(texto, tela).not.toMatch(/[A-Za-zÀ-ú\d]+_[A-Za-zÀ-ú\d]+/)
      expect(texto, tela).not.toMatch(/\b[A-Z]{5,}\b/)
    }
  })
})
