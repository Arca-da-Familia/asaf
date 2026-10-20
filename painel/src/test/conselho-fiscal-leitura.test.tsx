import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import type { LancamentoContabilCF, TituloFinanceiroCF } from '@/lib/api'
import { ConselhoFiscalPage } from '@/pages/ConselhoFiscal'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarTitulosConselhoFiscal: vi.fn(),
  listarCaixaConselhoFiscal: vi.fn(),
  listarPareceres: vi.fn(),
  listarQuestionamentos: vi.fn(),
  listarRespostas: vi.fn(),
}))
vi.mock('@/lib/use-me', () => ({
  useMe: () => ({ data: { permissoes: ['financeiro_auditar'] } }),
}))

// v5.7g - as duas leituras do Conselho Fiscal (títulos e razão) são paginadas (25 por vez) e têm busca pelo texto. O servidor de mentira abaixo repete o contrato do de verdade:
// `{ total, pagina, por_pagina, itens }`, com a busca e a situação filtrando no servidor.
const POR_PAGINA = 25

function titulo(n: number, status = 'Pendente'): TituloFinanceiroCF {
  return {
    id_titulo: n,
    tipo_titulo: 'A Pagar',
    id_associado: null,
    id_fornecedor: null,
    descricao: `Conta de teste ${String(n).padStart(3, '0')}`,
    valor_original: 100 + n,
    saldo_devedor: 100 + n,
    data_emissao: null,
    data_vencimento: '2026-12-01T12:00:00',
    status,
  }
}

function lancamento(n: number): LancamentoContabilCF {
  return {
    id_lancamento: n,
    numero_sequencial: n,
    id_titulo: null,
    historico: `Lançamento de teste ${String(n).padStart(3, '0')}`,
    data_lancamento: '2026-10-01T12:00:00',
    forma_pagamento: null,
    estornado: false,
    partidas: [
      { id_conta: 1, tipo_partida: 'Debito', valor: 10 },
      { id_conta: 2, tipo_partida: 'Credito', valor: 10 },
    ],
  }
}

let titulos: TituloFinanceiroCF[] = []
let lancamentos: LancamentoContabilCF[] = []

function pagina<T>(todos: T[], numero: number) {
  return {
    total: todos.length,
    pagina: numero,
    por_pagina: POR_PAGINA,
    itens: todos.slice((numero - 1) * POR_PAGINA, numero * POR_PAGINA),
  }
}

function prepararServidor() {
  vi.mocked(api.listarTitulosConselhoFiscal).mockImplementation(
    async (filtros = {}) => {
      const achados = titulos.filter(
        (t) =>
          (!filtros.status || t.status === filtros.status) &&
          (!filtros.busca ||
            t.descricao.toLowerCase().includes(filtros.busca.toLowerCase())),
      )
      return pagina(achados, filtros.pagina ?? 1)
    },
  )
  vi.mocked(api.listarCaixaConselhoFiscal).mockImplementation(
    async (filtros = {}) => {
      const achados = lancamentos.filter(
        (l) =>
          !filtros.busca ||
          l.historico.toLowerCase().includes(filtros.busca.toLowerCase()),
      )
      return pagina(achados, filtros.pagina ?? 1)
    },
  )
  vi.mocked(api.listarPareceres).mockResolvedValue([])
}

function desenhar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <ConselhoFiscalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const blocoDeTitulos = () =>
  screen
    .getByRole('heading', { name: /Títulos financeiros/ })
    .closest('section') as HTMLElement
const blocoDoRazao = () =>
  screen
    .getByRole('heading', { name: /Razão contábil/ })
    .closest('section') as HTMLElement

beforeEach(() => {
  vi.resetAllMocks()
  titulos = Array.from({ length: 60 }, (_, i) => titulo(i + 1))
  lancamentos = Array.from({ length: 30 }, (_, i) => lancamento(i + 1))
  prepararServidor()
})

describe('Conselho Fiscal: títulos paginados', () => {
  it('mostra 25 por página, o total do servidor e a navegação; só a página pedida vai ao servidor', async () => {
    desenhar()
    const bloco = within(blocoDeTitulos())
    expect(await bloco.findByText(/Conta de teste 001/)).toBeVisible()
    expect(bloco.getByText(/Conta de teste 025/)).toBeVisible()
    expect(bloco.queryByText(/Conta de teste 026/)).toBeNull()
    expect(bloco.getByText('60 títulos')).toBeVisible()
    const nav = bloco.getByRole('navigation', { name: 'Páginas de títulos' })
    expect(within(nav).getByText('Página 1 de 3')).toBeVisible()
    expect(
      within(nav).getByRole('button', { name: 'Página anterior' }),
    ).toBeDisabled()
    expect(api.listarTitulosConselhoFiscal).toHaveBeenCalledWith({
      status: undefined,
      busca: undefined,
      pagina: 1,
    })
  })

  it('a próxima página traz outros títulos, e a última não tem "próxima"', async () => {
    const u = userEvent.setup()
    desenhar()
    const bloco = within(blocoDeTitulos())
    await bloco.findByText(/Conta de teste 001/)
    const nav = () =>
      bloco.getByRole('navigation', { name: 'Páginas de títulos' })
    await u.click(within(nav()).getByRole('button', { name: 'Próxima página' }))
    expect(await bloco.findByText(/Conta de teste 026/)).toBeVisible()
    expect(bloco.queryByText(/Conta de teste 001/)).toBeNull()
    expect(within(nav()).getByText('Página 2 de 3')).toBeVisible()
    await u.click(within(nav()).getByRole('button', { name: 'Próxima página' }))
    expect(await bloco.findByText(/Conta de teste 060/)).toBeVisible()
    expect(
      within(nav()).getByRole('button', { name: 'Próxima página' }),
    ).toBeDisabled()
    await u.click(
      within(nav()).getByRole('button', { name: 'Página anterior' }),
    )
    expect(await bloco.findByText(/Conta de teste 026/)).toBeVisible()
  })

  it('a busca espera parar de digitar, vai ao servidor e volta para a primeira página', async () => {
    const u = userEvent.setup()
    desenhar()
    const bloco = within(blocoDeTitulos())
    await bloco.findByText(/Conta de teste 001/)
    await u.click(
      within(
        bloco.getByRole('navigation', { name: 'Páginas de títulos' }),
      ).getByRole('button', { name: 'Próxima página' }),
    )
    await bloco.findByText(/Conta de teste 026/)
    await u.type(bloco.getByLabelText('Buscar título'), 'teste 047')
    await waitFor(() =>
      expect(api.listarTitulosConselhoFiscal).toHaveBeenLastCalledWith({
        status: undefined,
        busca: 'teste 047',
        pagina: 1,
      }),
    )
    expect(await bloco.findByText(/Conta de teste 047/)).toBeVisible()
    expect(bloco.getByText('1 título')).toBeVisible()
    // um resultado só: não há navegação
    expect(
      bloco.queryByRole('navigation', { name: 'Páginas de títulos' }),
    ).toBeNull()
  })

  it('busca sem resultado diz que nada foi encontrado; mudar a situação volta à primeira página e combina com a busca', async () => {
    const u = userEvent.setup()
    titulos = Array.from({ length: 60 }, (_, i) =>
      titulo(i + 1, i % 2 === 0 ? 'Pago' : 'Pendente'),
    )
    desenhar()
    const bloco = within(blocoDeTitulos())
    await bloco.findByText(/Conta de teste 001/)
    await u.click(
      within(
        bloco.getByRole('navigation', { name: 'Páginas de títulos' }),
      ).getByRole('button', { name: 'Próxima página' }),
    )
    await bloco.findByText(/Conta de teste 026/)
    await u.selectOptions(
      bloco.getByLabelText('Filtrar títulos por situação'),
      'Pago',
    )
    await waitFor(() =>
      expect(api.listarTitulosConselhoFiscal).toHaveBeenLastCalledWith({
        status: 'Pago',
        busca: undefined,
        pagina: 1,
      }),
    )
    expect(await bloco.findByText('30 títulos')).toBeVisible()
    await u.type(bloco.getByLabelText('Buscar título'), 'nada-disso')
    expect(await bloco.findByText('Nenhum título encontrado.')).toBeVisible()
  })

  it('com até 25 títulos não há navegação', async () => {
    titulos = titulos.slice(0, 25)
    desenhar()
    const bloco = within(blocoDeTitulos())
    expect(await bloco.findByText(/Conta de teste 025/)).toBeVisible()
    expect(bloco.getByText('25 títulos')).toBeVisible()
    expect(
      bloco.queryByRole('navigation', { name: 'Páginas de títulos' }),
    ).toBeNull()
  })
})

describe('Conselho Fiscal: razão paginado', () => {
  it('25 por página, o total, a próxima página e a busca pelo histórico', async () => {
    const u = userEvent.setup()
    desenhar()
    const bloco = within(blocoDoRazao())
    expect(await bloco.findByText('Lançamento de teste 001')).toBeVisible()
    expect(bloco.queryByText('Lançamento de teste 026')).toBeNull()
    expect(bloco.getByText('30 lançamentos')).toBeVisible()
    await u.click(
      within(
        bloco.getByRole('navigation', { name: 'Páginas do razão' }),
      ).getByRole('button', { name: 'Próxima página' }),
    )
    expect(await bloco.findByText('Lançamento de teste 030')).toBeVisible()
    expect(bloco.queryByText('Lançamento de teste 001')).toBeNull()
    await u.type(bloco.getByLabelText('Buscar lançamento'), 'teste 012')
    await waitFor(() =>
      expect(api.listarCaixaConselhoFiscal).toHaveBeenLastCalledWith({
        busca: 'teste 012',
        pagina: 1,
      }),
    )
    expect(await bloco.findByText('Lançamento de teste 012')).toBeVisible()
    expect(bloco.getByText('1 lançamento')).toBeVisible()
  })

  it('razão vazio diz que nada foi registrado; busca sem resultado diz que nada foi encontrado', async () => {
    const u = userEvent.setup()
    lancamentos = []
    desenhar()
    const bloco = within(blocoDoRazao())
    expect(
      await bloco.findByText('Nenhum lançamento registrado ainda.'),
    ).toBeVisible()
    await u.type(bloco.getByLabelText('Buscar lançamento'), 'xyz')
    expect(
      await bloco.findByText('Nenhum lançamento encontrado.'),
    ).toBeVisible()
  })
})

describe('Conselho Fiscal: acessibilidade', () => {
  it('as duas leituras paginadas, com busca e navegação, não têm violação (axe)', async () => {
    const { container } = desenhar()
    await within(blocoDeTitulos()).findByText(/Conta de teste 001/)
    await within(blocoDoRazao()).findByText('Lançamento de teste 001')
    expect(await axe(container)).toHaveNoViolations()
  })
})
