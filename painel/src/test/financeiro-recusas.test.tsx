import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
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
  resumirTitulos: vi.fn(),
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
    cargos_autorizados: ['PRESIDENTE'],
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

  function desenhar(endereco = '/financeiro/relatorios') {
    const cliente = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    return render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={[endereco]}>
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

  it('v9.3o: um relatório por aba; todos carregam ao abrir e o do endereço aparece', async () => {
    vi.mocked(api.obterBalancete).mockResolvedValue([])
    desenhar('/financeiro/relatorios?relatorio=inadimplencia')
    expect(
      (await screen.findAllByRole('tab')).map((aba) => aba.textContent),
    ).toEqual([
      'Balancete',
      'Receitas x despesas',
      'Inadimplência',
      'Extrato por conta',
      'Por projeto',
      'Padrões suspeitos',
      'Prestação de contas',
    ])
    expect(
      screen.getByRole('tab', { name: 'Inadimplência', selected: true }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Inadimplência' })).toBeVisible()
    // os outros relatórios já carregaram (ficam montados), só não aparecem
    expect(api.obterBalancete).toHaveBeenCalled()
    expect(api.obterPadroesSuspeitos).toHaveBeenCalled()
    expect(
      screen.queryByRole('heading', { name: 'Balancete por período' }),
    ).not.toBeInTheDocument()
  })

  it('v9.3z2: no celular o balancete é uma lista de duas linhas por conta (a tabela fica para telas maiores, sem virar cartões)', async () => {
    vi.mocked(api.obterBalancete).mockResolvedValue([
      {
        id_conta: 1,
        codigo_contabil: '1.1.1',
        descricao_conta: 'Caixa',
        tipo: 'Ativo',
        saldo_anterior: 100,
        debitos_periodo: 50,
        creditos_periodo: 20,
        saldo_atual: 130,
      },
      {
        id_conta: 2,
        codigo_contabil: '1.1.2',
        descricao_conta: 'Conta parada',
        tipo: 'Ativo',
        saldo_anterior: 0,
        debitos_periodo: 0,
        creditos_periodo: 0,
        saldo_atual: 0,
      },
    ])
    const { container } = desenhar()
    const lista = await screen.findByRole('list', {
      name: 'Contas do balancete',
    })
    await waitFor(() => expect(lista).toHaveTextContent('1.1.1 — Caixa'))
    expect(lista).toHaveTextContent(/R\$\s130,00/)
    expect(lista).toHaveTextContent(/débitos R\$\s50,00 · créditos R\$\s20,00/)
    // a conta sem movimento não aparece (nem na lista, nem na tabela)
    expect(lista).not.toHaveTextContent('Conta parada')
    expect(container.querySelector('table[data-sem-cartao]')).not.toBeNull()
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

// v9.6b: o Início do Financeiro virou a Visão geral (os lugares que mudam sozinhos): os testes dela estão em src/test/visao-geral-do-financeiro.test.tsx
