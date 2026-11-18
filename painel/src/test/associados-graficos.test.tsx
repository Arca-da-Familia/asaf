import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import type { PainelDeGraficosDeAssociados } from '@/lib/api'
import { AssociadosGraficosPage } from '@/pages/AssociadosGraficos'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  me: vi.fn(),
  obterPainelDeGraficosDeAssociados: vi.fn(),
}))

const CHAVE = 'asaf.graficos-associados.7'

function painel(
  sobrescrever: Partial<PainelDeGraficosDeAssociados> = {},
): PainelDeGraficosDeAssociados {
  const meses = [
    '2025-12',
    '2026-01',
    '2026-02',
    '2026-03',
    '2026-04',
    '2026-05',
    '2026-06',
    '2026-07',
    '2026-08',
    '2026-09',
    '2026-10',
    '2026-11',
  ]
  return {
    periodo: { meses: 12, de: '2025-12', ate: '2026-11' },
    filtros_disponiveis: {
      situacoes: [
        'Ativo - Em Dia',
        'Ativo - Inadimplente',
        'Licenciado',
        'Desligado',
      ],
      categorias: ['Contribuinte', 'Efetivo'],
      bairros: ['Marco', 'Pedreira'],
    },
    numeros: {
      cadastrados: 142,
      no_quadro: 131,
      desligados: 11,
      ativos: 117,
      em_dia: 108,
      percentual_em_dia: 92,
      entraram: 23,
      sairam: 6,
      idade_media: 44,
      idade_minima: 16,
      idade_maxima: 81,
      com_acesso: 97,
      percentual_com_acesso: 74,
    },
    por_mes: meses.map((mes, i) => ({ mes, entraram: i % 3, sairam: i % 2 })),
    quadro_por_mes: meses.map((mes, i) => ({ mes, total: 114 + i })),
    por_situacao: [
      { nome: 'Ativo - Em Dia', total: 108 },
      { nome: 'Ativo - Inadimplente', total: 9 },
      { nome: 'Licenciado', total: 14 },
      { nome: 'Desligado', total: 11 },
    ],
    por_categoria: [
      { nome: 'Efetivo', total: 100 },
      { nome: 'Contribuinte', total: 31 },
    ],
    faixas_de_idade: [
      { faixa: '16–17', total: 2 },
      { faixa: '18–29', total: 19 },
      { faixa: '30–44', total: 41 },
      { faixa: '45–59', total: 44 },
      { faixa: '60 ou mais', total: 25 },
    ],
    por_bairro: [
      { nome: 'Marco', total: 28 },
      { nome: 'Pedreira', total: 21 },
      { nome: 'Outros bairros', total: 82 },
    ],
    tempo_de_associacao: [
      { faixa: 'Menos de 1 ano', total: 23 },
      { faixa: '10 anos ou mais', total: 15 },
    ],
    filiacao: {
      pedidos: 31,
      com_os_3_socios: 26,
      aprovados: 23,
      recusados: 3,
      em_andamento: 5,
    },
    ...sobrescrever,
  }
}

function desenhar(endereco = '/associados/graficos') {
  vi.mocked(api.me).mockResolvedValue({
    id_usuario: 7,
    id_associado: 1,
    nome_completo: 'Quem Olha',
    email: 'a@b.c',
    nivel: 'Presidente',
    mfa_ativado: false,
    mfa_obrigatorio: false,
    mfa_pendente: false,
    permissoes: ['associados'],
  })
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[endereco]}>
        <AssociadosGraficosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const titulos = () =>
  screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)

beforeAll(() => {
  // os gráficos medem o tamanho da caixa; o navegador de teste não mede nada
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

beforeEach(() => {
  vi.resetAllMocks()
  window.localStorage.clear()
  vi.mocked(api.obterPainelDeGraficosDeAssociados).mockResolvedValue(painel())
})

describe('Gráficos dos associados (v9.5h)', () => {
  it('mostra os 6 números e os gráficos do painel padrão, sem erro de acessibilidade', async () => {
    const { container } = desenhar()
    const numeros = await screen.findByRole('region', {
      name: 'Números principais',
    })
    expect(within(numeros).getByText('131')).toBeInTheDocument()
    expect(within(numeros).getByText('142 cadastrados')).toBeInTheDocument()
    expect(within(numeros).getByText('92%')).toBeInTheDocument()
    expect(within(numeros).getByText('108 de 117 ativos')).toBeInTheDocument()
    expect(within(numeros).getByText('+23')).toBeInTheDocument()
    expect(within(numeros).getByText('44 anos')).toBeInTheDocument()
    expect(within(numeros).getByText('ao painel · 74%')).toBeInTheDocument()
    expect(titulos()).toEqual([
      'Entradas e saídas por mês',
      'Por situação',
      'Por categoria',
      'Faixa de idade',
      'Filiação em 12 meses',
      'Tamanho do quadro',
    ])
    expect(api.obterPainelDeGraficosDeAssociados).toHaveBeenCalledWith({
      meses: 12,
      situacao: undefined,
      categoria: undefined,
      bairro: undefined,
    })
    expect(await axe(container)).toHaveNoViolations()
  })

  it('os filtros pedem ao servidor só aquela parte do quadro', async () => {
    const u = userEvent.setup()
    desenhar()
    await screen.findByRole('region', { name: 'Números principais' })
    await u.selectOptions(screen.getByLabelText('Situação'), 'Licenciado')
    await u.selectOptions(screen.getByLabelText('Período'), '24')
    await waitFor(() =>
      expect(api.obterPainelDeGraficosDeAssociados).toHaveBeenLastCalledWith({
        meses: 24,
        situacao: 'Licenciado',
        categoria: undefined,
        bairro: undefined,
      }),
    )
    expect(
      screen.getAllByRole('button', { name: 'Limpar filtros' }).length,
    ).toBeGreaterThan(0)
  })

  it('uma situação ou categoria leva à lista dessas pessoas; a filiação leva às propostas', async () => {
    desenhar('/associados/graficos?categoria=Efetivo')
    const situacao = await screen.findByRole('region', { name: 'Por situação' })
    expect(
      within(situacao).getByRole('link', {
        name: /Ativo - Inadimplente.*ver a lista/,
      }),
    ).toHaveAttribute(
      'href',
      '/associados?situacao=Ativo+-+Inadimplente&categoria=Efetivo',
    )
    const categoria = screen.getByRole('region', { name: 'Por categoria' })
    expect(
      within(categoria).getByRole('link', {
        name: /Contribuinte.*ver a lista/,
      }),
    ).toHaveAttribute('href', '/associados?categoria=Contribuinte')
    expect(
      within(
        screen.getByRole('region', { name: 'Filiação em 12 meses' }),
      ).getByRole('link', {
        name: 'Ver as propostas',
      }),
    ).toHaveAttribute('href', '/associados/propostas')
  })

  it('"Ver em tabela" mostra os números do gráfico', async () => {
    const u = userEvent.setup()
    desenhar()
    const quadro = await screen.findByRole('region', {
      name: 'Tamanho do quadro',
    })
    await u.click(within(quadro).getByRole('button', { name: 'Ver em tabela' }))
    const tabela = within(quadro).getByRole('table', {
      name: 'Tamanho do quadro',
    })
    expect(
      within(tabela).getByRole('rowheader', { name: 'novembro de 2026' }),
    ).toBeInTheDocument()
    expect(within(tabela).getByText('125')).toBeInTheDocument()
    expect(
      within(quadro).getByRole('button', { name: 'Ver o gráfico' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('Personalizar: esconde, muda a ordem, guarda para a pessoa e volta ao padrão', async () => {
    const u = userEvent.setup()
    const { unmount } = desenhar()
    await screen.findByRole('region', { name: 'Números principais' })
    await u.click(screen.getByRole('button', { name: 'Personalizar' }))
    const janela = screen.getByRole('dialog', { name: 'Personalizar o painel' })
    expect(await axe(janela)).toHaveNoViolations()
    await u.click(
      within(janela).getByRole('checkbox', { name: /Por situação/ }),
    )
    await u.click(within(janela).getByRole('checkbox', { name: /Onde moram/ }))
    await u.click(
      within(janela).getByRole('button', {
        name: 'Descer Entradas e saídas por mês',
      }),
    )
    await u.click(
      within(janela).getByRole('button', {
        name: 'Descer Entradas e saídas por mês',
      }),
    )
    // o painel muda na hora, para conferir
    expect(
      screen.queryByRole('region', { name: 'Por situação' }),
    ).not.toBeInTheDocument()
    await u.click(
      within(janela).getByRole('button', { name: 'Guardar para mim' }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Painel guardado para você.',
    )
    expect(titulos()).toEqual([
      'Por categoria',
      'Entradas e saídas por mês',
      'Faixa de idade',
      'Filiação em 12 meses',
      'Tamanho do quadro',
      'Onde moram',
    ])
    expect(
      JSON.parse(window.localStorage.getItem(CHAVE) ?? '{}').graficos[0],
    ).toEqual({
      id: 'situacao',
      visivel: false,
    })

    // abrindo de novo, continua do jeito guardado
    unmount()
    desenhar()
    await screen.findByRole('region', { name: 'Onde moram' })
    expect(
      screen.queryByRole('region', { name: 'Por situação' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/Você está vendo o seu painel personalizado/),
    ).toBeInTheDocument()

    await u.click(screen.getByRole('button', { name: 'Personalizar' }))
    await u.click(
      screen.getByRole('button', { name: 'Voltar ao painel padrão' }),
    )
    expect(window.localStorage.getItem(CHAVE)).toBeNull()
    expect(
      await screen.findByRole('region', { name: 'Por situação' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Onde moram' }),
    ).not.toBeInTheDocument()
  })

  it('"Usar só desta vez" não guarda; Esc fecha sem mudar nada', async () => {
    const u = userEvent.setup()
    desenhar()
    await screen.findByRole('region', { name: 'Números principais' })
    await u.click(screen.getByRole('button', { name: 'Personalizar' }))
    await u.click(screen.getByRole('checkbox', { name: 'Os números do alto' }))
    await u.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Números principais' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Personalizar' })).toHaveFocus()

    await u.click(screen.getByRole('button', { name: 'Personalizar' }))
    await u.click(screen.getByRole('checkbox', { name: 'Os números do alto' }))
    await u.click(screen.getByRole('button', { name: 'Usar só desta vez' }))
    expect(
      screen.queryByRole('region', { name: 'Números principais' }),
    ).not.toBeInTheDocument()
    expect(window.localStorage.getItem(CHAVE)).toBeNull()
    expect(
      screen.getByText(/painel personalizado \(só desta vez\)/),
    ).toBeInTheDocument()
  })

  it('quem guardou "abrir com os filtros de agora" abre com eles', async () => {
    const u = userEvent.setup()
    const { unmount } = desenhar('/associados/graficos?situacao=Licenciado')
    await screen.findByRole('region', { name: 'Números principais' })
    await u.click(screen.getByRole('button', { name: 'Personalizar' }))
    await u.click(
      screen.getByRole('checkbox', {
        name: /Abrir sempre com os filtros de agora/,
      }),
    )
    await u.click(screen.getByRole('button', { name: 'Guardar para mim' }))
    unmount()

    vi.mocked(api.obterPainelDeGraficosDeAssociados).mockClear()
    desenhar('/associados/graficos')
    await waitFor(() =>
      expect(api.obterPainelDeGraficosDeAssociados).toHaveBeenLastCalledWith({
        meses: 12,
        situacao: 'Licenciado',
        categoria: undefined,
        bairro: undefined,
      }),
    )
    expect(screen.getByLabelText('Situação')).toHaveValue('Licenciado')
  })

  it('texto estragado no navegador é ignorado e vale o padrão', async () => {
    window.localStorage.setItem(
      CHAVE,
      '{"graficos":[{"id":"idade","visivel":false}',
    )
    desenhar()
    await screen.findByRole('region', { name: 'Números principais' })
    expect(titulos()).toContain('Faixa de idade')
  })

  it('gráfico desconhecido guardado sai; os que faltam entram com o padrão', async () => {
    window.localStorage.setItem(
      CHAVE,
      JSON.stringify({
        numeros: true,
        graficos: [
          { id: 'nao-existe', visivel: true },
          { id: 'tempo', visivel: true },
          { id: 'idade', visivel: false },
        ],
      }),
    )
    desenhar()
    await screen.findByRole('region', { name: 'Números principais' })
    expect(titulos()).toEqual([
      'Tempo de associação',
      'Entradas e saídas por mês',
      'Por situação',
      'Por categoria',
      'Filiação em 12 meses',
      'Tamanho do quadro',
    ])
  })

  it('sem ninguém nos filtros, explica e oferece limpar', async () => {
    vi.mocked(api.obterPainelDeGraficosDeAssociados).mockResolvedValue(
      painel({
        numeros: { ...painel().numeros, cadastrados: 0, no_quadro: 0 },
      }),
    )
    desenhar('/associados/graficos?bairro=Marco')
    expect(
      await screen.findByText('Nenhum associado com estes filtros'),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: 'Limpar filtros' }).length,
    ).toBeGreaterThan(0)
  })
})
