import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import type {
  CampanhaDescontoAntecipado,
  IsencaoContribuicao,
  PlanoDeContribuicao,
} from '@/lib/api'
import { PlanosContribuicaoPage } from '@/pages/PlanosContribuicao'

// v9.3t (a tela tinha 10,6 alturas de notebook na homologação: planos, isenções e campanhas, uma lista embaixo da outra): uma parte por aba (no
// endereço, ?parte=), cada lista em páginas de 10; o plano recém-cadastrado aparece; as datas da campanha como se lê no Brasil.
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarPlanosContribuicao: vi.fn(),
  listarIsencoesContribuicao: vi.fn(),
  listarAssociadosParaSelecao: vi.fn(),
  listarOpcoesCatalogo: vi.fn(),
  listarCampanhasDescontoAntecipado: vi.fn(),
  listarPlanoContas: vi.fn(),
  criarPlanoContribuicao: vi.fn(),
  alternarCampanhaDescontoAntecipado: vi.fn(),
}))

function plano(id: number, descricao: string): PlanoDeContribuicao {
  return {
    id_plano: id,
    categoria: 'Efetivo',
    descricao,
    periodicidade: 'Mensal',
    dia_vencimento: 10,
    cobranca_por_nucleo_familiar: false,
    id_conta_contabil: 7,
    ativo: true,
    valor_vigente: 50,
  }
}

function isencao(id: number): IsencaoContribuicao {
  return {
    id_isencao: id,
    id_associado: id,
    id_plano: null,
    motivo: 'DIFICULDADE_FINANCEIRA',
    percentual_desconto: 40,
    data_inicio: '2026-11-01',
    data_fim: null,
  }
}

const CAMPANHA: CampanhaDescontoAntecipado = {
  id_campanha: 1,
  percentual_desconto: 10,
  quantidade_meses: 6,
  meses_gatilho: [1, 7],
  id_conta_contabil_receita_diferida: 9,
  motivo: 'Decisão da assembleia',
  ativo: true,
  data_vigencia_inicio: '2026-11-11T00:00:00',
  data_vigencia_fim: null,
}

let planos: PlanoDeContribuicao[] = []

function Endereco() {
  const local = useLocation()
  return <p data-testid="endereco">{local.search}</p>
}

function desenhar(endereco = '/financeiro/planos-contribuicao') {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[endereco]}>
        <PlanosContribuicaoPage />
        <Endereco />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  planos = [plano(1, 'Mensalidade'), plano(2, 'Família')]
  vi.mocked(api.listarPlanosContribuicao).mockImplementation(() =>
    Promise.resolve([...planos]),
  )
  vi.mocked(api.listarIsencoesContribuicao).mockResolvedValue(
    Array.from({ length: 12 }, (_, i) => isencao(12 - i)),
  )
  vi.mocked(api.listarAssociadosParaSelecao).mockResolvedValue(
    Array.from({ length: 12 }, (_, i) => ({
      id_associado: i + 1,
      nome_completo: `Pessoa ${i + 1}`,
    })) as Awaited<ReturnType<typeof api.listarAssociadosParaSelecao>>,
  )
  vi.mocked(api.listarOpcoesCatalogo).mockImplementation((chave) =>
    Promise.resolve(
      chave === 'motivo_isencao_contribuicao'
        ? [
            {
              id_opcao: 1,
              id_pai: null,
              codigo: 'DIFICULDADE_FINANCEIRA',
              rotulo: 'Dificuldade financeira comprovada',
              ordem: 1,
              ativo: true,
              cor: null,
              icone: null,
            },
          ]
        : [
            {
              id_opcao: 2,
              id_pai: null,
              codigo: 'MENSAL',
              rotulo: 'Mensal',
              ordem: 1,
              ativo: true,
              cor: null,
              icone: null,
            },
          ],
    ),
  )
  vi.mocked(api.listarCampanhasDescontoAntecipado).mockResolvedValue([CAMPANHA])
  vi.mocked(api.listarPlanoContas).mockResolvedValue([
    {
      id_conta: 7,
      codigo_contabil: '3.1.1',
      descricao_conta: 'Mensalidades',
      tipo: 'Receita',
      codigo_contabil_pai: null,
      sintetica: false,
    },
  ])
})

describe('Planos de contribuição: uma parte por aba', () => {
  it('abre nos planos; isenções e campanhas ficam nas outras abas, e a aba vai para o endereço', async () => {
    const u = userEvent.setup()
    desenhar()
    expect(await screen.findByRole('tab', { name: 'Planos' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(
      await screen.findByRole('heading', { name: 'Planos cadastrados' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Isenções' })).toBeNull()
    await u.click(screen.getByRole('tab', { name: 'Isenções' }))
    expect(
      screen.getByRole('heading', { name: 'Isenções' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Nova isenção' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('endereco')).toHaveTextContent('parte=isencoes')
    await u.click(
      screen.getByRole('tab', { name: 'Desconto por pagamento antecipado' }),
    )
    expect(screen.getByTestId('endereco')).toHaveTextContent('parte=campanhas')
    await u.click(screen.getByRole('tab', { name: 'Planos' }))
    expect(screen.getByTestId('endereco')).toHaveTextContent('')
  })

  it('o endereço com ?parte= abre direto na parte (as isenções em páginas de 10, com o nome da pessoa e do motivo)', async () => {
    desenhar('/financeiro/planos-contribuicao?parte=isencoes')
    expect(
      await screen.findByRole('tab', { name: 'Isenções' }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(
      await screen.findByText(/Pessoa 12 — 40% de desconto/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Pessoa 2 — 40% de desconto/)).toBeNull()
    expect(
      screen.getByRole('navigation', { name: 'Páginas das isenções' }),
    ).toBeInTheDocument()
    expect(
      screen.getAllByText(/Dificuldade financeira comprovada/).length,
    ).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(/DIFICULDADE_FINANCEIRA/)
  })

  it('a campanha mostra a data como se lê no Brasil (não 2026-11-11T00:00:00)', async () => {
    desenhar('/financeiro/planos-contribuicao?parte=campanhas')
    expect(await screen.findByText(/desde 11\/11\/2026/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/2026-11-11/)
  })

  it('o plano recém-cadastrado aparece: a lista vai à página dele', async () => {
    const u = userEvent.setup()
    planos = Array.from({ length: 12 }, (_, i) =>
      plano(i + 1, `Plano ${String(i + 1).padStart(2, '0')}`),
    )
    vi.mocked(api.criarPlanoContribuicao).mockImplementation(() => {
      planos = [...planos, plano(99, 'Zeta')]
      return Promise.resolve({ mensagem: 'ok', id_plano: 99 })
    })
    desenhar()
    expect(await screen.findByText(/Plano 01/)).toBeInTheDocument()
    expect(screen.queryByText(/Plano 11/)).toBeNull()
    await u.click(screen.getByRole('button', { name: 'Novo plano' }))
    await u.type(
      screen.getByPlaceholderText('Categoria (ex.: Efetivo)'),
      'Efetivo',
    )
    await u.type(screen.getByPlaceholderText(/^Descrição/), 'Zeta')
    await u.clear(screen.getByPlaceholderText('Dia de vencimento'))
    await u.type(screen.getByPlaceholderText('Dia de vencimento'), '10')
    await u.clear(screen.getByPlaceholderText('Valor inicial'))
    await u.type(screen.getByPlaceholderText('Valor inicial'), '50')
    const selects = screen.getAllByRole('combobox')
    for (const s of selects) {
      const opcoes = [...(s as HTMLSelectElement).options].filter(
        (o) => o.value && o.value !== '0',
      )
      if (opcoes[0]) await u.selectOptions(s, opcoes[0].value)
    }
    await u.click(screen.getByRole('button', { name: 'Cadastrar' }))
    await waitFor(() => expect(api.criarPlanoContribuicao).toHaveBeenCalled())
    expect(await screen.findByText(/Efetivo — Zeta/)).toBeInTheDocument()
    expect(screen.getByText(/^Página 2 de 2/)).toBeInTheDocument()
  })

  it('as abas passam no axe', async () => {
    const { container } = desenhar()
    await screen.findByRole('heading', { name: 'Planos cadastrados' })
    await screen.findByText(/Efetivo — Mensalidade/)
    expect(await axe(container)).toHaveNoViolations()
  })
})
