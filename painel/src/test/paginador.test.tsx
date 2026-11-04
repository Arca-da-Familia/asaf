import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { describe, expect, it, vi } from 'vitest'

import { Paginador } from '@/components/data/Paginador'

// v9.2c - a peça "Página X de Y" das listas que o servidor pagina (doações, reservas, documentos emitidos).
describe('Paginador (v9.2c)', () => {
  it('mostra a página, o total e anda para a próxima e para a anterior; passa no axe', async () => {
    const aoMudar = vi.fn()
    const u = userEvent.setup()
    const { container } = render(
      <Paginador
        rotulo="Páginas das doações"
        pagina={2}
        porPagina={20}
        total={47}
        aoMudar={aoMudar}
      />,
    )
    const nav = screen.getByRole('navigation', { name: 'Páginas das doações' })
    expect(nav).toHaveTextContent('Página 2 de 3 · 47 itens')
    await u.click(screen.getByRole('button', { name: 'Próxima página' }))
    expect(aoMudar).toHaveBeenLastCalledWith(3)
    await u.click(screen.getByRole('button', { name: 'Página anterior' }))
    expect(aoMudar).toHaveBeenLastCalledWith(1)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('na primeira e na última página o botão sem destino fica desligado', () => {
    const { rerender } = render(
      <Paginador pagina={1} porPagina={20} total={47} aoMudar={() => {}} />,
    )
    expect(
      screen.getByRole('button', { name: 'Página anterior' }),
    ).toBeDisabled()
    rerender(
      <Paginador pagina={3} porPagina={20} total={47} aoMudar={() => {}} />,
    )
    expect(
      screen.getByRole('button', { name: 'Próxima página' }),
    ).toBeDisabled()
  })

  it('some quando tudo cabe numa página', () => {
    render(
      <Paginador pagina={1} porPagina={20} total={20} aoMudar={() => {}} />,
    )
    expect(screen.queryByRole('navigation')).toBeNull()
  })
})
