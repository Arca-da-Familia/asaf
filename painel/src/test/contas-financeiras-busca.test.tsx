import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import type { ContaFinanceira } from '@/lib/api'
import { ContasFinanceirasPage } from '@/pages/ContasFinanceiras'

// v9.3x (a tela tinha 7,9 alturas de notebook na homologação): as contas por código contábil, em duas colunas, com busca e páginas de 10; a conta
// recém-cadastrada aparece (a lista vai à página dela).
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarContasFinanceiras: vi.fn(),
  listarPlanoContas: vi.fn(),
  listarOpcoesCatalogo: vi.fn(),
  criarContaFinanceira: vi.fn(),
}))

function conta(id: number, codigo: string, descricao: string): ContaFinanceira {
  return {
    id_conta_financeira: id,
    id_conta: 100 + id,
    codigo_contabil: codigo,
    descricao_conta: descricao,
    tipo_conta_financeira: 'Caixa',
    banco: null,
    agencia: null,
    numero_conta: null,
    ativo: true,
    saldo: 0,
  }
}

let contas: ContaFinanceira[] = []

function desenhar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <ContasFinanceirasPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const nomesNaTela = () =>
  [...document.querySelectorAll('p.font-medium')]
    .map((p) => p.textContent ?? '')
    .filter((t) => t.includes(' — '))

beforeEach(() => {
  vi.resetAllMocks()
  // a API devolve na ordem de criação; a tela ordena pelo código (1.1.10 depois de 1.1.9)
  contas = Array.from({ length: 12 }, (_, i) =>
    conta(
      12 - i,
      `1.1.${12 - i}`,
      i === 3 ? 'Poupança da Obra' : `Conta ${12 - i}`,
    ),
  )
  vi.mocked(api.listarContasFinanceiras).mockImplementation(() =>
    Promise.resolve([...contas]),
  )
  vi.mocked(api.listarOpcoesCatalogo).mockResolvedValue([
    {
      id_opcao: 1,
      id_pai: null,
      codigo: 'CONTA_CORRENTE',
      rotulo: 'Conta Corrente',
      ordem: 1,
      ativo: true,
      cor: null,
      icone: null,
    },
  ])
  vi.mocked(api.listarPlanoContas).mockResolvedValue([
    {
      id_conta: 500,
      codigo_contabil: '1.1.99',
      descricao_conta: 'Banco novo',
      tipo: 'Ativo',
      codigo_contabil_pai: '1.1',
      sintetica: false,
    },
  ])
})

describe('Contas financeiras: ordem, busca e páginas de 10', () => {
  it('mostra 10 por página, pelo código contábil (1.1.10 depois de 1.1.9)', async () => {
    const u = userEvent.setup()
    desenhar()
    await screen.findByText('1.1.1 — Conta 1')
    expect(nomesNaTela()).toHaveLength(10)
    expect(nomesNaTela()[8]).toBe('1.1.9 — Poupança da Obra')
    expect(nomesNaTela()[9]).toBe('1.1.10 — Conta 10')
    const paginas = within(
      screen.getByRole('navigation', {
        name: 'Páginas das contas financeiras',
      }),
    )
    await u.click(paginas.getByRole('button', { name: 'Próxima página' }))
    expect(nomesNaTela()).toEqual(['1.1.11 — Conta 11', '1.1.12 — Conta 12'])
  })

  it('procura pelo nome sem acento e pelo código', async () => {
    const u = userEvent.setup()
    desenhar()
    await screen.findByText('1.1.1 — Conta 1')
    const campo = screen.getByLabelText('Procurar conta financeira')
    await u.type(campo, 'poupanca')
    expect(nomesNaTela()).toEqual(['1.1.9 — Poupança da Obra'])
    expect(screen.getByText('1 conta encontrada.')).toBeInTheDocument()
    await u.clear(campo)
    await u.type(campo, '1.1.12')
    expect(nomesNaTela()).toEqual(['1.1.12 — Conta 12'])
  })

  it('a conta recém-cadastrada aparece: a lista vai à página dela', async () => {
    const u = userEvent.setup()
    vi.mocked(api.criarContaFinanceira).mockImplementation(() => {
      contas = [...contas, conta(99, '1.1.99', 'Banco novo')]
      return Promise.resolve({ mensagem: 'ok', id_conta_financeira: 99 })
    })
    desenhar()
    await screen.findByText('1.1.1 — Conta 1')
    await u.click(screen.getByRole('button', { name: 'Nova conta financeira' }))
    await screen.findByRole('option', { name: /Banco novo/ })
    await screen.findByRole('option', { name: 'Conta Corrente' })
    const [contaContabil, tipo] = screen.getAllByRole('combobox')
    await u.selectOptions(contaContabil!, '500')
    await u.selectOptions(tipo!, 'Conta Corrente')
    await u.click(screen.getByRole('button', { name: 'Cadastrar' }))
    await waitFor(() => expect(api.criarContaFinanceira).toHaveBeenCalled())
    expect(await screen.findByText('1.1.99 — Banco novo')).toBeInTheDocument()
    expect(screen.getByText(/^Página 2 de 2/)).toBeInTheDocument()
  })

  it('passa no axe', async () => {
    const { container } = desenhar()
    await screen.findByText('1.1.1 — Conta 1')
    expect(await axe(container)).toHaveNoViolations()
  })
})
