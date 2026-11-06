import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PlanoDeContas } from '@/lib/api'
import { PlanoContasPage } from '@/pages/PlanoContas'

import { renderizar } from './fabricas-despertai'

// v9.3e (pedido do Presidente, 05/11: tela comprida vira "submenu"): o Plano de Contas tinha 16 alturas de notebook. Agora uma aba por tipo
// contábil (`?tipo=receita`), em páginas de 20; a busca procura em todos os tipos; a conta recém-criada aparece na aba e na página dela.

const api = vi.hoisted(() => ({
  listarPlanoContas: vi.fn(),
  listarOpcoesCatalogo: vi.fn(),
  criarContaContabil: vi.fn(),
}))
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  ...api,
}))

function conta(
  id: number,
  codigo: string,
  descricao: string,
  tipo: string,
): PlanoDeContas {
  return {
    id_conta: id,
    codigo_contabil: codigo,
    descricao_conta: descricao,
    tipo,
    codigo_contabil_pai: null,
    sintetica: false,
  }
}

// em ordem de código (como o servidor manda): 2 de Ativo, 1 de Passivo, 25 de Receita, 1 de Despesa
const contas = [
  conta(1, '1.1', 'Caixa', 'Ativo'),
  conta(2, '1.2', 'Banco do Brasil', 'Ativo'),
  conta(3, '2.1', 'Fornecedores a pagar', 'Passivo'),
  ...Array.from({ length: 25 }, (_, i) =>
    conta(
      10 + i,
      `3.${String(i + 1).padStart(2, '0')}`,
      i === 7 ? 'Doações de Família' : `Receita ${i + 1}`,
      'Receita',
    ),
  ),
  conta(40, '4.1', 'Energia elétrica', 'Despesa'),
]

beforeEach(() => {
  vi.clearAllMocks()
  api.listarPlanoContas.mockResolvedValue(contas)
  api.listarOpcoesCatalogo.mockResolvedValue([
    { codigo: 'RECEITA', rotulo: 'Receita' },
  ])
})

const linhas = () =>
  screen
    .getAllByRole('button', { name: 'Editar' })
    .map((b) => b.parentElement!.parentElement!)

describe('Plano de Contas em abas por tipo', () => {
  it('uma aba por tipo, na ordem contábil; abre no Ativo', async () => {
    renderizar(<PlanoContasPage />, '/financeiro/plano-contas')
    const fileira = await screen.findByRole('tablist', {
      name: 'Tipos de conta',
    })
    expect(
      within(fileira)
        .getAllByRole('tab')
        .map((a) => a.textContent),
    ).toEqual(['Ativo', 'Passivo', 'Receita', 'Despesa'])
    expect(screen.getByRole('tab', { name: 'Ativo', selected: true }))
    expect(linhas()).toHaveLength(2)
    expect(screen.getByText(/1\.1 — Caixa/)).toBeInTheDocument()
    expect(screen.queryByText(/Energia elétrica/)).not.toBeInTheDocument()
  })

  it('a aba de Receita tem 25 contas em páginas de 20', async () => {
    const user = userEvent.setup()
    renderizar(<PlanoContasPage />, '/financeiro/plano-contas?tipo=receita')
    await screen.findByRole('tab', { name: 'Receita', selected: true })
    expect(linhas()).toHaveLength(20)
    expect(screen.getByText(/Página 1 de 2 · 25 itens/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Próxima/ }))
    expect(linhas()).toHaveLength(5)
    await user.click(screen.getByRole('tab', { name: 'Despesa' }))
    expect(linhas()).toHaveLength(1)
    expect(screen.getByText(/Energia elétrica/)).toBeInTheDocument()
  })

  it('a busca acha em qualquer tipo, por código ou descrição, sem acento', async () => {
    const user = userEvent.setup()
    renderizar(<PlanoContasPage />, '/financeiro/plano-contas')
    const campo = await screen.findByLabelText('Procurar conta')
    await user.type(campo, 'familia')
    expect(linhas()).toHaveLength(1)
    expect(screen.getByText(/Doações de Família/)).toBeInTheDocument()
    expect(screen.getByText('1 conta encontrada.')).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    await user.clear(campo)
    await user.type(campo, '4.1')
    expect(screen.getByText(/Energia elétrica/)).toBeInTheDocument()
    await user.clear(campo)
    await user.type(campo, 'nada disso')
    expect(
      screen.getByText('Nenhuma conta com esse código ou descrição.'),
    ).toBeInTheDocument()
  })

  it('a tela passa no axe', async () => {
    const { container } = renderizar(
      <PlanoContasPage />,
      '/financeiro/plano-contas',
    )
    await screen.findByRole('tab', { name: 'Ativo', selected: true })
    expect(await axe(container)).toHaveNoViolations()
  })
})
