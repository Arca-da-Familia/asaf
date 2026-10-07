import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import { TitulosPage } from '@/pages/Titulos'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarTitulos: vi.fn(),
  resumirTitulos: vi.fn(),
  listarPlanoContas: vi.fn(),
  listarAssociadosParaSelecao: vi.fn(),
  listarFornecedores: vi.fn(),
}))

function mesAtual() {
  const h = new Date()
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`
}

function desenhar(tipoFixo?: 'A Receber' | 'A Pagar') {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <TitulosPage tipoFixo={tipoFixo} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const titulo = (id: number) => ({
  id_titulo: id,
  tipo_titulo: 'A Receber',
  id_associado: 1,
  descricao: `Mensalidade ${id}`,
  conta_contabil: 'Mensalidades',
  beneficiario: 'Joana',
  valor_original: 60,
  saldo_devedor: 60,
  data_vencimento: '2026-10-10',
  status: 'Pendente',
  competencia: null,
  competencia_fim: null,
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.listarTitulos).mockResolvedValue([titulo(1), titulo(2)])
  vi.mocked(api.resumirTitulos).mockResolvedValue({
    total: 60,
    soma_original: 3600,
    soma_saldo: 3000,
  })
  vi.mocked(api.listarPlanoContas).mockResolvedValue([
    {
      id_conta: 1,
      codigo_contabil: '4.1',
      descricao_conta: 'Mensalidades',
      tipo: 'Receita',
    },
    {
      id_conta: 2,
      codigo_contabil: '5.1',
      descricao_conta: 'Despesas gerais',
      tipo: 'Despesa',
    },
    {
      id_conta: 3,
      codigo_contabil: '1.1',
      descricao_conta: 'Caixa',
      tipo: 'Ativo',
    },
  ] as Awaited<ReturnType<typeof api.listarPlanoContas>>)
  vi.mocked(api.listarAssociadosParaSelecao).mockResolvedValue([])
  vi.mocked(api.listarFornecedores).mockResolvedValue([])
})

describe('Títulos: filtros por mês, categoria, texto e paginação', () => {
  it('começa no mês atual, na primeira página, com o resumo do que filtrou; passa no axe', async () => {
    const { container } = desenhar()
    expect(await screen.findByText(/— Mensalidade 1/)).toBeInTheDocument()
    expect(api.listarTitulos).toHaveBeenLastCalledWith(
      expect.objectContaining({ mes: mesAtual(), pagina: 1, por_pagina: 25 }),
    )
    expect(
      await screen.findByText(/60 título\(s\) · Original/),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Mês de vencimento')).toHaveValue(mesAtual())
    expect(await axe(container)).toHaveNoViolations()
  })

  it('"Todo o período" tira o mês do filtro e dá para voltar ao mês atual', async () => {
    const u = userEvent.setup()
    desenhar()
    await screen.findByText(/— Mensalidade 1/)
    await u.click(screen.getByRole('button', { name: 'Todo o período' }))
    await waitFor(() =>
      expect(
        vi.mocked(api.listarTitulos).mock.lastCall?.[0]?.mes,
      ).toBeUndefined(),
    )
    await u.click(screen.getByRole('button', { name: 'Voltar ao mês atual' }))
    await waitFor(() =>
      expect(vi.mocked(api.listarTitulos).mock.lastCall?.[0]?.mes).toBe(
        mesAtual(),
      ),
    )
  })

  it('situação e categoria mudam a consulta e voltam para a página 1', async () => {
    const u = userEvent.setup()
    desenhar()
    await screen.findByText(/— Mensalidade 1/)
    await u.selectOptions(screen.getByDisplayValue('Todos os status'), 'Pago')
    await waitFor(() =>
      expect(api.listarTitulos).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'Pago', pagina: 1 }),
      ),
    )
    await u.selectOptions(screen.getByLabelText('Categoria'), '2')
    await waitFor(() =>
      expect(api.listarTitulos).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'Pago', id_conta_contabil: 2 }),
      ),
    )
  })

  it('a busca por texto vai ao servidor depois de uma pausa', async () => {
    const u = userEvent.setup()
    desenhar()
    await screen.findByText(/— Mensalidade 1/)
    await u.type(
      screen.getByLabelText('Buscar por descrição, nome ou fornecedor'),
      'luz',
    )
    await waitFor(
      () =>
        expect(api.listarTitulos).toHaveBeenLastCalledWith(
          expect.objectContaining({ busca: 'luz' }),
        ),
      { timeout: 3000 },
    )
  })

  it('com 60 títulos são 3 páginas de 25; "Próxima página" pede a página 2 e a anterior volta', async () => {
    const u = userEvent.setup()
    desenhar()
    await screen.findByText('Página 1 de 3')
    expect(
      screen.getByRole('button', { name: 'Página anterior' }),
    ).toBeDisabled()
    await u.click(screen.getByRole('button', { name: 'Próxima página' }))
    await screen.findByText('Página 2 de 3')
    expect(api.listarTitulos).toHaveBeenLastCalledWith(
      expect.objectContaining({ pagina: 2 }),
    )
    await u.click(screen.getByRole('button', { name: 'Página anterior' }))
    await screen.findByText('Página 1 de 3')
  })

  it('sem títulos para o filtro, diz isso e não mostra paginação', async () => {
    vi.mocked(api.listarTitulos).mockResolvedValue([])
    vi.mocked(api.resumirTitulos).mockResolvedValue({
      total: 0,
      soma_original: 0,
      soma_saldo: 0,
    })
    desenhar()
    expect(
      await screen.findByText('Nenhum título encontrado.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Página 1 de/)).not.toBeInTheDocument()
  })
})

describe('Entradas e Saídas: uma página para cada', () => {
  it('Entradas só pede a receber, só oferece categorias de receita e não tem o filtro de tipo', async () => {
    desenhar('A Receber')
    expect(
      await screen.findByRole('heading', { name: 'Entradas', level: 1 }),
    ).toBeInTheDocument()
    expect(api.listarTitulos).toHaveBeenLastCalledWith(
      expect.objectContaining({ tipo_titulo: 'A Receber' }),
    )
    expect(screen.queryByDisplayValue('Todos os tipos')).not.toBeInTheDocument()
    const categoria = screen.getByLabelText('Categoria')
    await waitFor(() => expect(categoria).toHaveTextContent('Mensalidades'))
    expect(categoria).not.toHaveTextContent('Despesas gerais')
  })

  it('Saídas só pede a pagar e só oferece categorias de despesa', async () => {
    desenhar('A Pagar')
    expect(
      await screen.findByRole('heading', { name: 'Saídas', level: 1 }),
    ).toBeInTheDocument()
    expect(api.listarTitulos).toHaveBeenLastCalledWith(
      expect.objectContaining({ tipo_titulo: 'A Pagar' }),
    )
    const categoria = screen.getByLabelText('Categoria')
    await waitFor(() => expect(categoria).toHaveTextContent('Despesas gerais'))
    expect(categoria).not.toHaveTextContent('Mensalidades')
  })
})
