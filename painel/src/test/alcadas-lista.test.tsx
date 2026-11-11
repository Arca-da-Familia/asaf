import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import type { AlcadaAprovacao, DelegacaoAprovacao } from '@/lib/api'
import { AlcadasAprovacaoPage } from '@/pages/AlcadasAprovacao'

// v9.3s (a tela tinha 10,6 alturas de notebook na homologação): as faixas em vigor e as inativas em abas, 10 por página; a faixa inativada sai
// de "Em vigor" e a tela diz para onde ela foi; as delegações também em páginas.
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarAlcadasAprovacao: vi.fn(),
  listarDelegacoesAprovacao: vi.fn(),
  listarOpcoesCatalogo: vi.fn(),
  listarAssociadosParaSelecao: vi.fn(),
  criarAlcadaAprovacao: vi.fn(),
  alternarAlcadaAprovacao: vi.fn(),
}))

function faixa(
  id: number,
  minimo: number,
  maximo: number | null,
  ativo = true,
): AlcadaAprovacao {
  return {
    id_alcada: id,
    valor_minimo: minimo,
    valor_maximo: maximo,
    cargos_autorizados: ['PRESIDENTE'],
    exige_dupla_assinatura: false,
    ativo,
  }
}

function delegacao(id: number): DelegacaoAprovacao {
  return {
    id_delegacao: id,
    id_associado_delegante: 1,
    id_associado_delegado: 2,
    nome_delegante: 'Ana Lúcia',
    nome_delegado: 'Gisele Moraes',
    data_inicio: '2026-11-01T00:00:00',
    data_fim: '2026-11-20T00:00:00',
    motivo: `Férias ${id}`,
  } as DelegacaoAprovacao
}

let base: AlcadaAprovacao[] = []

function desenhar(endereco = '/financeiro/alcadas-aprovacao') {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[endereco]}>
        <AlcadasAprovacaoPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const faixasNaTela = () =>
  [...document.querySelectorAll('[data-alcada]')].map(
    (c) => c.querySelector('p')?.textContent?.replace(/\s/g, ' ') ?? '',
  )

beforeEach(() => {
  vi.resetAllMocks()
  // como a API devolve: por valor mínimo
  base = [
    faixa(1, 0, 999.99),
    faixa(5, 1, 50, false),
    faixa(2, 1000, 4999.99),
    faixa(6, 2000, 3000, false),
    faixa(3, 5000, null),
  ]
  vi.mocked(api.listarAlcadasAprovacao).mockImplementation(() =>
    Promise.resolve([...base].sort((a, b) => a.valor_minimo - b.valor_minimo)),
  )
  vi.mocked(api.listarDelegacoesAprovacao).mockResolvedValue([])
  vi.mocked(api.listarAssociadosParaSelecao).mockResolvedValue([])
  vi.mocked(api.listarOpcoesCatalogo).mockResolvedValue([
    {
      id_opcao: 1,
      id_pai: null,
      codigo: 'PRESIDENTE',
      rotulo: 'Presidente',
      ordem: 1,
      ativo: true,
      cor: null,
      icone: null,
    },
  ])
  vi.mocked(api.alternarAlcadaAprovacao).mockImplementation((id, ativo) => {
    base = base.map((a) => (a.id_alcada === id ? { ...a, ativo } : a))
    return Promise.resolve(
      {} as Awaited<ReturnType<typeof api.alternarAlcadaAprovacao>>,
    )
  })
})

describe('Alçadas: em vigor e inativas em abas', () => {
  it('abre nas faixas em vigor, por valor; as inativas ficam na outra aba, a mais recente primeiro', async () => {
    const u = userEvent.setup()
    desenhar()
    expect(
      await screen.findByRole('tab', { name: 'Em vigor (3)' }),
    ).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(faixasNaTela()).toHaveLength(3))
    expect(faixasNaTela()[0]).toMatch(/R\$ 0,00 até R\$ 999,99/)
    expect(faixasNaTela()[2]).toMatch(/R\$ 5\.000,00 até sem teto/)
    await u.click(screen.getByRole('tab', { name: 'Inativas (2)' }))
    expect(faixasNaTela()).toHaveLength(2)
    // id 6 é mais recente que o 5
    expect(faixasNaTela()[0]).toMatch(/R\$ 2\.000,00 até R\$ 3\.000,00/)
    expect(screen.getAllByRole('button', { name: 'Reativar' })).toHaveLength(2)
  })

  it('inativar tira a faixa de "Em vigor" e a tela diz para onde ela foi', async () => {
    const u = userEvent.setup()
    desenhar()
    await screen.findByRole('tab', { name: 'Em vigor (3)' })
    await waitFor(() => expect(faixasNaTela()).toHaveLength(3))
    const cartao = document.querySelector('[data-alcada="2"]') as HTMLElement
    await u.click(within(cartao).getByRole('button', { name: 'Inativar' }))
    expect(
      await screen.findByText(
        'Faixa de R$ 1.000,00 até R$ 4.999,99 inativada — ela agora está na aba Inativas.',
        { normalizer: (t) => t.replace(/\s/g, ' ') },
      ),
    ).toBeInTheDocument()
    expect(document.querySelector('[data-alcada="2"]')).toBeNull()
    expect(
      screen.getByRole('tab', { name: 'Inativas (3)' }),
    ).toBeInTheDocument()
    await u.click(screen.getByRole('tab', { name: 'Inativas (3)' }))
    const inativa = document.querySelector('[data-alcada="2"]') as HTMLElement
    expect(within(inativa).getByText('Inativa')).toBeInTheDocument()
    await u.click(within(inativa).getByRole('button', { name: 'Reativar' }))
    expect(
      await screen.findByText(/reativada — ela voltou para a aba Em vigor\./),
    ).toBeInTheDocument()
  })

  it('a aba fica no endereço (dá para mandar o link das inativas)', async () => {
    desenhar('/financeiro/alcadas-aprovacao?alcadas=inativas')
    expect(
      await screen.findByRole('tab', { name: 'Inativas (2)' }),
    ).toHaveAttribute('aria-selected', 'true')
  })

  it('com mais de 10 faixas há páginas, e a faixa recém-cadastrada aparece (a lista vai à página dela)', async () => {
    const u = userEvent.setup()
    base = Array.from({ length: 12 }, (_, i) =>
      faixa(i + 1, (i + 1) * 100, (i + 1) * 100 + 99),
    )
    vi.mocked(api.criarAlcadaAprovacao).mockImplementation((dados) => {
      base = [
        ...base,
        faixa(99, dados.valor_minimo, dados.valor_maximo ?? null),
      ]
      return Promise.resolve({ mensagem: 'ok', id_alcada: 99 })
    })
    desenhar()
    await screen.findByRole('tab', { name: 'Em vigor (12)' })
    await waitFor(() => expect(faixasNaTela()).toHaveLength(10))
    expect(
      screen.getByRole('navigation', { name: 'Páginas das alçadas' }),
    ).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Nova alçada' }))
    await u.clear(screen.getByLabelText('Valor mínimo (R$)'))
    await u.type(screen.getByLabelText('Valor mínimo (R$)'), '90000')
    await u.click(await screen.findByRole('checkbox', { name: 'Presidente' }))
    await u.click(screen.getByRole('button', { name: 'Cadastrar alçada' }))
    await waitFor(() =>
      expect(document.querySelector('[data-alcada="99"]')).not.toBeNull(),
    )
    expect(screen.getByText(/^Página 2 de 2/)).toBeInTheDocument()
  })

  it('as delegações também ficam em páginas de 10, a mais recente primeiro', async () => {
    vi.mocked(api.listarDelegacoesAprovacao).mockResolvedValue(
      Array.from({ length: 13 }, (_, i) => delegacao(13 - i)),
    )
    desenhar()
    expect(await screen.findByText(/Férias 13/)).toBeInTheDocument()
    expect(screen.queryByText(/Férias 3 ·/)).toBeNull()
    expect(
      screen.getByRole('navigation', { name: 'Páginas das delegações' }),
    ).toBeInTheDocument()
  })

  it('as abas e a lista passam no axe', async () => {
    const { container } = desenhar()
    await screen.findByRole('tab', { name: 'Em vigor (3)' })
    await waitFor(() => expect(faixasNaTela()).toHaveLength(3))
    expect(await axe(container)).toHaveNoViolations()
  })
})
