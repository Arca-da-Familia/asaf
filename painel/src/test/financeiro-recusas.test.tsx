import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import {
  alcadaAprovacaoCriarSchema,
  baixarTituloSchema,
  contaAPagarRecorrenteCriarSchema,
  doacaoCriarSchema,
  orcamentoCriarSchema,
} from '@/lib/schemas'
import { lerValorEmReais } from '@/lib/valores'
import { FinanceiroInicioPage } from '@/pages/FinanceiroInicio'
import { RelatoriosPage } from '@/pages/Relatorios'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  obterBalancete: vi.fn(),
  obterReceitasDespesas: vi.fn(),
  obterReceitasDespesasPorCentroCusto: vi.fn(),
  obterRelatorioInadimplencia: vi.fn(),
  listarContasFinanceiras: vi.fn(),
  obterExtratoContaFinanceira: vi.fn(),
  obterRelatorioPorProjeto: vi.fn(),
  listarPrestacoesDeContas: vi.fn(),
  obterPadroesSuspeitos: vi.fn(),
  listarTitulos: vi.fn(),
  listarSolicitacoesCompra: vi.fn(),
}))

describe('campos opcionais em branco não viram 0 nem texto vazio', () => {
  it('baixa: centro de custo, adiantamento e data de competência em branco ficam de fora', () => {
    const lido = baixarTituloSchema.parse({
      valor_pago: '10',
      forma_pagamento: 'Pix',
      id_conta_contabil_contrapartida: '3',
      id_centro_custo: '',
      id_conta_contabil_adiantamento: '',
      data_competencia: '',
    })
    expect(lido.id_centro_custo).toBeUndefined()
    expect(lido.id_conta_contabil_adiantamento).toBeUndefined()
    expect(lido.data_competencia).toBeUndefined()
  })

  it('conta recorrente sem fornecedor não manda fornecedor 0', () => {
    const lido = contaAPagarRecorrenteCriarSchema.parse({
      descricao: 'Aluguel',
      valor: '100',
      id_conta_contabil: '4',
      id_fornecedor: '',
      dia_vencimento: '5',
    })
    expect(lido.id_fornecedor).toBeUndefined()
  })

  it('orçamento e doação: centro e campanha em branco ficam de fora', () => {
    expect(
      orcamentoCriarSchema.parse({
        ano: '2026',
        id_conta_contabil: '4',
        id_centro_custo: '',
        valor_previsto: '100',
        id_deliberacao: '2',
      }).id_centro_custo,
    ).toBeUndefined()
    const doacao = doacaoCriarSchema.parse({
      tipo_doacao: 'Monetaria',
      valor: '10',
      id_campanha: '',
      id_centro_custo_destinacao: '',
      id_conta_contabil: '6',
      id_conta_contabil_caixa: '',
      anonima: false,
      recorrente: false,
    })
    expect(doacao.id_campanha).toBeUndefined()
    expect(doacao.id_centro_custo_destinacao).toBeUndefined()
  })
})

describe('alçada: o teto digitado como se escreve no Brasil', () => {
  const base = {
    valor_minimo: '100',
    cargos_autorizados: 'PRESIDENTE',
    exige_dupla_assinatura: false,
  }

  it('aceita vírgula e milhar, e em branco é "sem teto"', () => {
    expect(
      alcadaAprovacaoCriarSchema.safeParse({
        ...base,
        valor_maximo: '4.999,99',
      }).success,
    ).toBe(true)
    expect(
      alcadaAprovacaoCriarSchema.safeParse({ ...base, valor_maximo: '' })
        .success,
    ).toBe(true)
  })

  it('recusa teto que não é número ou que é menor que o mínimo', () => {
    const texto = alcadaAprovacaoCriarSchema.safeParse({
      ...base,
      valor_maximo: 'muito',
    })
    expect(texto.success).toBe(false)
    const menor = alcadaAprovacaoCriarSchema.safeParse({
      ...base,
      valor_maximo: '50',
    })
    expect(menor.success).toBe(false)
    expect(JSON.stringify(menor.error?.issues)).toContain('menor que o mínimo')
  })

  it('o leitor de valores entende vírgula, milhar e R$', () => {
    expect(lerValorEmReais('9.999.999,99')).toBe('9999999.99')
    expect(lerValorEmReais('R$ 1.200')).toBe('1200')
    expect(lerValorEmReais('abc')).toBeNull()
  })
})

describe('Relatórios: a consulta que falha aparece, e não vira "sem movimento"', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(api.obterReceitasDespesas).mockResolvedValue([])
    vi.mocked(api.obterReceitasDespesasPorCentroCusto).mockResolvedValue([])
    vi.mocked(api.obterRelatorioInadimplencia).mockResolvedValue([])
    vi.mocked(api.listarContasFinanceiras).mockResolvedValue([])
    vi.mocked(api.obterRelatorioPorProjeto).mockResolvedValue([])
    vi.mocked(api.listarPrestacoesDeContas).mockResolvedValue([])
    vi.mocked(api.obterPadroesSuspeitos).mockResolvedValue([])
  })

  function desenhar() {
    const cliente = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    return render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter>
          <RelatoriosPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('balancete recusado pelo servidor mostra a recusa, não "Sem movimento no período"', async () => {
    vi.mocked(api.obterBalancete).mockRejectedValue(
      new Error('A data final não pode ser anterior à inicial.'),
    )
    desenhar()
    expect(
      await screen.findByText('A data final não pode ser anterior à inicial.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Sem movimento no período.'),
    ).not.toBeInTheDocument()
  })

  it('os campos de período têm nome e a página passa no axe', async () => {
    vi.mocked(api.obterBalancete).mockResolvedValue([])
    const { container } = desenhar()
    expect(await screen.findByText('Sem movimento no período.')).toBeVisible()
    expect(screen.getAllByLabelText('De').length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText('Até').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Competência')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('Início do Financeiro: o retrato do dia no lugar da página de obra', () => {
  it('mostra saldo, vencidos, a pagar em 30 dias, compras a aprovar e os atalhos; passa no axe', async () => {
    const ontem = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString()
    const emBreve = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString()
    vi.mocked(api.listarContasFinanceiras).mockResolvedValue([
      { id_conta_financeira: 1, saldo: 1500.5, ativo: true },
      { id_conta_financeira: 2, saldo: 500, ativo: true },
      { id_conta_financeira: 3, saldo: 9999, ativo: false },
    ] as Awaited<ReturnType<typeof api.listarContasFinanceiras>>)
    vi.mocked(api.listarTitulos).mockResolvedValue([
      {
        id_titulo: 1,
        tipo_titulo: 'A Receber',
        descricao: 'Mensalidade atrasada',
        saldo_devedor: 60,
        data_vencimento: ontem,
        status: 'Pendente',
      },
      {
        id_titulo: 2,
        tipo_titulo: 'A Pagar',
        descricao: 'Conta de energia',
        saldo_devedor: 410,
        data_vencimento: emBreve,
        status: 'Pendente',
      },
    ] as Awaited<ReturnType<typeof api.listarTitulos>>)
    vi.mocked(api.listarSolicitacoesCompra).mockResolvedValue([
      { id_solicitacao: 1 },
      { id_solicitacao: 2 },
    ] as Awaited<ReturnType<typeof api.listarSolicitacoesCompra>>)

    const cliente = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const { container } = render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter>
          <FinanceiroInicioPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    // só as contas ativas somam: 1.500,50 + 500,00
    expect(await screen.findByText(/2\.000,50/)).toBeInTheDocument()
    expect(screen.getByText('1 título(s) em atraso')).toBeInTheDocument()
    expect(screen.getByText(/A Pagar — Conta de energia/)).toBeInTheDocument()
    expect(
      screen.getByText(/A Receber — Mensalidade atrasada/),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Compras aguardando aprovação').parentElement,
    ).toHaveTextContent('2')
    expect(screen.getByRole('link', { name: /Títulos/ })).toBeInTheDocument()
    expect(
      screen.queryByText(/entra nas fases seguintes/),
    ).not.toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })
})
