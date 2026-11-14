import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'

import { MenuDoModulo } from '@/components/layout/MenuDoModulo'
import { agruparItens, itemDaRota } from '@/lib/menu-do-modulo'
import { modulos } from '@/lib/modulos'

// v9.5c (desenho aprovado pelo Presidente, rodada 4, 13/11): dentro de um módulo, a coluna mostra os grupos em LISTA SUSPENSA - só o grupo da tela aberta
// vem aberto, os outros abrem no clique (nunca tudo de uma vez) - e, recolhida, só os ícones, cada um com o nome para o leitor de tela.
const associados = modulos.find((m) => m.rota === '/associados')!

function montar(endereco: string, recolhido = false) {
  render(
    <MemoryRouter initialEntries={[endereco]}>
      <nav aria-label="Telas de Associados">
        <MenuDoModulo
          modulo={associados}
          permissoes={['associados']}
          recolhido={recolhido}
          aoNavegar={() => {}}
        />
      </nav>
      <Routes>
        <Route
          path="*"
          element={<Link to="/associados/graficos">ir aos gráficos</Link>}
        />
      </Routes>
    </MemoryRouter>,
  )
  return screen.getByRole('navigation', { name: 'Telas de Associados' })
}

describe('coluna do módulo em grupos (v9.5c)', () => {
  it('junta os itens pelos grupos, na ordem do desenho aprovado', () => {
    expect(agruparItens(associados.itens!).map((g) => g.nome)).toEqual([
      'Cadastro',
      'Filiação',
      'Análises',
    ])
    // um módulo que ainda não ganhou grupos fica com a lista de sempre
    const semGrupo = modulos.find((m) => m.rota === '/comunicacao')!
    expect(agruparItens(semGrupo.itens!)).toHaveLength(1)
    expect(agruparItens(semGrupo.itens!)[0].nome).toBe('')
  })

  it('acha o item da tela aberta, também numa tela de dentro (a ficha é da lista)', () => {
    expect(itemDaRota(associados.itens!, '/associados/novo')?.rotulo).toBe(
      'Novo associado',
    )
    expect(itemDaRota(associados.itens!, '/associados/123')?.rotulo).toBe(
      'Lista de associados',
    )
  })

  it('só o grupo da tela aberta vem aberto; os outros abrem e fecham no clique', async () => {
    const menu = montar('/associados/propostas')
    const filiacao = within(menu).getByRole('button', { name: /Filiação/ })
    const cadastro = within(menu).getByRole('button', { name: /Cadastro/ })
    expect(filiacao).toHaveAttribute('aria-expanded', 'true')
    expect(cadastro).toHaveAttribute('aria-expanded', 'false')
    expect(
      within(menu).getByRole('link', { name: 'Propostas de filiação' }),
    ).toHaveAttribute('aria-current', 'page')
    // a tela de um grupo fechado não aparece
    expect(
      within(menu).queryByRole('link', { name: 'Novo associado' }),
    ).not.toBeInTheDocument()

    await userEvent.click(cadastro)
    expect(cadastro).toHaveAttribute('aria-expanded', 'true')
    expect(
      within(menu).getByRole('link', { name: 'Novo associado' }),
    ).toBeVisible()
    // fechar de novo, inclusive o grupo da tela aberta
    await userEvent.click(filiacao)
    expect(filiacao).toHaveAttribute('aria-expanded', 'false')
    expect(
      within(menu).queryByRole('link', { name: 'Propostas de filiação' }),
    ).not.toBeInTheDocument()
  })

  it('ir para uma tela de outro grupo por um link da página abre o grupo dela', async () => {
    const menu = montar('/associados')
    expect(
      within(menu).getByRole('button', { name: /Análises/ }),
    ).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(screen.getByRole('link', { name: 'ir aos gráficos' }))
    expect(
      within(menu).getByRole('button', { name: /Análises/ }),
    ).toHaveAttribute('aria-expanded', 'true')
    expect(
      within(menu).getByRole('link', { name: 'Gráficos' }),
    ).toHaveAttribute('aria-current', 'page')
  })

  it('recolhida, mostra só os ícones, cada um com o nome da tela e a volta ao Início', () => {
    const menu = montar('/associados/qualidade', true)
    expect(within(menu).queryByRole('button')).not.toBeInTheDocument()
    const nomes = within(menu)
      .getAllByRole('link')
      .map((l) => l.getAttribute('aria-label'))
    expect(nomes).toEqual([
      'Início',
      'Lista de associados',
      'Novo associado',
      'Importar em lote',
      'Propostas de filiação',
      'Qualidade da base',
      'Gráficos',
    ])
    expect(
      within(menu).getByRole('link', { name: 'Qualidade da base' }),
    ).toHaveAttribute('aria-current', 'page')
  })
})
