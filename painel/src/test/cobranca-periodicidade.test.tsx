import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ContribuicaoDoAssociado } from '@/components/associados/ContribuicaoDoAssociado'
import * as api from '@/lib/api'
import type {
  ContribuicaoDoAssociado as Contribuicao,
  PlanoDeContribuicao,
  PrevisaoCobranca,
} from '@/lib/api'
import { GerarCobrancasPage } from '@/pages/GerarCobrancas'
import { PlanosContribuicaoPage } from '@/pages/PlanosContribuicao'

// v9.6a - a cobrança respeita a periodicidade (decisão do Presidente, 21/11/2026): os planos mensal e semestral; cada associado escolhe o seu (a
// secretaria marca na ficha, aba Situação); o semestral é cobrado em janeiro e julho; o que não pôde ser cobrado aparece como aviso na geração.
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  obterContribuicaoDoAssociado: vi.fn(),
  mudarContribuicaoDoAssociado: vi.fn(),
  gerarCobrancas: vi.fn(),
  gerarCobrancaBloco: vi.fn(),
  listarAssociadosParaSelecao: vi.fn(),
  listarPlanosContribuicao: vi.fn(),
  listarIsencoesContribuicao: vi.fn(),
  listarOpcoesCatalogo: vi.fn(),
  listarCampanhasDescontoAntecipado: vi.fn(),
  listarPlanoContas: vi.fn(),
  criarPlanoContribuicao: vi.fn(),
  alternarPlanoContribuicao: vi.fn(),
}))

function cliente() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function desenhar(no: React.ReactNode) {
  return render(
    <QueryClientProvider client={cliente()}>
      <MemoryRouter>{no}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const CONTRIBUICAO: Contribuicao = {
  id_associado: 17,
  categoria: 'Efetivo',
  periodicidade: 'Mensal',
  tem_plano: true,
  opcoes: [
    {
      periodicidade: 'Mensal',
      id_plano: 1,
      descricao: 'Mensalidade',
      valor: 100,
      meses: 1,
      quando_cobra: 'todo mês',
      dia_vencimento: 10,
    },
    {
      periodicidade: 'Semestral',
      id_plano: 2,
      descricao: 'Semestralidade',
      valor: 540,
      meses: 6,
      quando_cobra: 'em janeiro e julho',
      dia_vencimento: 10,
    },
  ],
}

function plano(
  id: number,
  periodicidade: string,
  extra: Partial<PlanoDeContribuicao> = {},
): PlanoDeContribuicao {
  return {
    id_plano: id,
    categoria: 'Efetivo',
    descricao: `Contribuição ${periodicidade.toLowerCase()}`,
    periodicidade,
    dia_vencimento: 10,
    cobranca_por_nucleo_familiar: false,
    id_conta_contabil: 7,
    ativo: true,
    valor_vigente: periodicidade === 'Mensal' ? 100 : 540,
    id_conta_contabil_receita_diferida: periodicidade === 'Mensal' ? null : 9,
    quando_cobra:
      periodicidade === 'Mensal' ? 'todo mês' : 'em janeiro e julho',
    ...extra,
  }
}

const opcao = (codigo: string, rotulo: string, id: number) => ({
  id_opcao: id,
  id_pai: null,
  codigo,
  rotulo,
  ordem: id,
  ativo: true,
  cor: null,
  icone: null,
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.obterContribuicaoDoAssociado).mockResolvedValue(CONTRIBUICAO)
  vi.mocked(api.listarPlanosContribuicao).mockResolvedValue([
    plano(1, 'Mensal'),
    plano(2, 'Semestral'),
  ])
  vi.mocked(api.listarIsencoesContribuicao).mockResolvedValue([])
  vi.mocked(api.listarAssociadosParaSelecao).mockResolvedValue([])
  vi.mocked(api.listarCampanhasDescontoAntecipado).mockResolvedValue([])
  vi.mocked(api.listarOpcoesCatalogo).mockResolvedValue([
    opcao('MENSAL', 'Mensal', 1),
    opcao('SEMESTRAL', 'Semestral', 2),
  ])
  vi.mocked(api.listarPlanoContas).mockResolvedValue([
    {
      id_conta: 7,
      codigo_contabil: '4.1.1',
      descricao_conta: 'Contribuições',
      tipo: 'Receita',
      codigo_contabil_pai: null,
      sintetica: false,
    },
    {
      id_conta: 9,
      codigo_contabil: '2.1.5',
      descricao_conta: 'Contribuições a reconhecer',
      tipo: 'Passivo',
      codigo_contabil_pai: null,
      sintetica: false,
    },
  ] as Awaited<ReturnType<typeof api.listarPlanoContas>>)
})

describe('Contribuição na ficha do associado (v9.6a)', () => {
  it('mostra as formas da categoria com valor e quando cobra; salvar só depois de mudar', async () => {
    const u = userEvent.setup()
    vi.mocked(api.mudarContribuicaoDoAssociado).mockResolvedValue({
      mensagem: 'Forma de pagamento mudada para semestral.',
      periodicidade: 'Semestral',
    })
    desenhar(<ContribuicaoDoAssociado idAssociado={17} />)
    const mensal = await screen.findByRole('radio', { name: /Mensal/ })
    const semestral = screen.getByRole('radio', { name: /Semestral/ })
    expect(mensal).toBeChecked()
    expect(
      screen.getByText('R$ 540,00 em janeiro e julho, vencimento dia 10'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('R$ 100,00 todo mês, vencimento dia 10'),
    ).toBeInTheDocument()
    const salvar = screen.getByRole('button', {
      name: 'Salvar forma de pagamento',
    })
    expect(salvar).toBeDisabled()
    await u.click(semestral)
    expect(salvar).toBeEnabled()
    // a releitura depois de guardar fica pendurada (rede lenta): a tela não pode voltar a marcar "Mensal" nem ficar em "Salvando…"
    // (o print da homologação da v9.6a mostrou isso)
    vi.mocked(api.obterContribuicaoDoAssociado).mockReturnValue(
      new Promise(() => {}),
    )
    await u.click(salvar)
    await waitFor(() =>
      expect(api.mudarContribuicaoDoAssociado).toHaveBeenCalledWith(
        17,
        'Semestral',
      ),
    )
    expect(
      await screen.findByText('Forma de pagamento mudada para semestral.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Semestral/ })).toBeChecked()
    expect(
      screen.getByRole('button', { name: 'Salvar forma de pagamento' }),
    ).toBeDisabled()
  })

  it('a recusa do servidor aparece; forma sem plano e categoria sem plano são explicadas', async () => {
    const u = userEvent.setup()
    vi.mocked(api.mudarContribuicaoDoAssociado).mockRejectedValue(
      new api.ApiError(
        400,
        'A categoria Efetivo não tem plano semestral ativo.',
      ),
    )
    vi.mocked(api.obterContribuicaoDoAssociado).mockResolvedValue({
      ...CONTRIBUICAO,
      periodicidade: 'Anual',
      tem_plano: false,
    })
    desenhar(<ContribuicaoDoAssociado idAssociado={17} />)
    expect(
      await screen.findByText(/A forma marcada \(anual\) não tem plano ativo/),
    ).toBeInTheDocument()
    await u.click(screen.getByRole('radio', { name: /Semestral/ }))
    await u.click(
      screen.getByRole('button', { name: 'Salvar forma de pagamento' }),
    )
    expect(
      await screen.findByText(
        'A categoria Efetivo não tem plano semestral ativo.',
      ),
    ).toBeInTheDocument()
  })

  it('categoria sem plano nenhum: diz que a pessoa não é cobrada', async () => {
    vi.mocked(api.obterContribuicaoDoAssociado).mockResolvedValue({
      ...CONTRIBUICAO,
      categoria: 'Honorário',
      opcoes: [],
    })
    desenhar(<ContribuicaoDoAssociado idAssociado={17} />)
    expect(
      await screen.findByText(
        /A categoria Honorário não tem plano de contribuição ativo/,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('radio')).toBeNull()
  })

  it('passa no axe', async () => {
    const { container } = desenhar(<ContribuicaoDoAssociado idAssociado={17} />)
    await screen.findByRole('radio', { name: /Mensal/ })
    expect(await axe(container)).toHaveNoViolations()
  })
})

const PREVIA: PrevisaoCobranca = {
  competencia: '2027-01',
  confirmado: false,
  total_gerados: 2,
  total_ja_existentes: 0,
  total_dependentes_pulados: 0,
  total_isentos_totais: 0,
  total_cobertos_por_bloco: 0,
  valor_total: 370,
  detalhes: [
    {
      id_associado: 1,
      nome: 'Ana Mensal',
      id_plano: 1,
      descricao_plano: 'Mensalidade',
      valor: 100,
      periodicidade: 'Mensal',
      periodo: '01/2027',
      meses: 1,
      meses_do_periodo: 1,
    },
    {
      id_associado: 2,
      nome: 'Bia Semestral',
      id_plano: 2,
      descricao_plano: 'Semestralidade',
      valor: 270,
      periodicidade: 'Semestral',
      periodo: '04/2027 a 06/2027',
      meses: 3,
      meses_do_periodo: 6,
    },
  ],
  avisos: [
    '1 associado(s) da categoria Fundador pagam semestral, mas não há plano semestral ativo nessa categoria, então não foram cobrados. Cadastre o plano ou mude a forma de pagamento no cadastro de cada um.',
  ],
  associados_sem_plano: [
    {
      id_associado: 3,
      nome: 'Caio Sem Plano',
      categoria: 'Fundador',
      periodicidade: 'Semestral',
    },
  ],
  reconhecimentos_receita_diferida: [],
}

describe('Gerar cobranças com a periodicidade (v9.6a)', () => {
  it('a linha do semestral mostra o período e a proporção; o mensal fica como sempre; os avisos aparecem com quem ficou de fora', async () => {
    const u = userEvent.setup()
    vi.mocked(api.gerarCobrancas).mockResolvedValue(PREVIA)
    desenhar(<GerarCobrancasPage />)
    await u.type(screen.getByPlaceholderText('2026-10'), '2027-01')
    await u.click(screen.getByRole('button', { name: 'Ver prévia' }))
    const linhaSemestral = (await screen.findByText(/Bia Semestral/)).closest(
      'div',
    )!
    expect(linhaSemestral).toHaveTextContent(
      'Bia Semestral — Semestralidade · semestral de 04/2027 a 06/2027 (proporcional: 3 de 6 meses)',
    )
    expect(linhaSemestral).toHaveTextContent('R$ 270,00')
    const linhaMensal = screen.getByText(/Ana Mensal/).closest('div')!
    expect(linhaMensal.textContent?.replace(/\s/g, ' ')).toBe(
      'Ana Mensal — MensalidadeR$ 100,00',
    )
    expect(
      screen.getByText('Atenção: nem todos foram cobrados'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/categoria Fundador pagam semestral/),
    ).toBeInTheDocument()
    await u.click(screen.getByText('Quem ficou sem cobrança (1)'))
    expect(
      screen.getByText('Caio Sem Plano — Fundador, semestral'),
    ).toBeVisible()
    expect(
      screen.getByText(
        /já coberto\(s\) por título-bloco \(semestre ou pagamento antecipado\)/,
      ),
    ).toBeInTheDocument()
  })

  it('sem aviso, o quadro não aparece', async () => {
    const u = userEvent.setup()
    vi.mocked(api.gerarCobrancas).mockResolvedValue({
      ...PREVIA,
      avisos: [],
      associados_sem_plano: [],
    })
    desenhar(<GerarCobrancasPage />)
    await u.type(screen.getByPlaceholderText('2026-10'), '2027-01')
    await u.click(screen.getByRole('button', { name: 'Ver prévia' }))
    await screen.findByText(/Bia Semestral/)
    expect(screen.queryByText('Atenção: nem todos foram cobrados')).toBeNull()
  })
})

describe('Planos de contribuição com a periodicidade (v9.6a)', () => {
  it('o semestral mostra quando cobra; a conta de receita a reconhecer só aparece fora do mensal e é exigida', async () => {
    const u = userEvent.setup()
    vi.mocked(api.criarPlanoContribuicao).mockResolvedValue({
      mensagem: 'ok',
      id_plano: 5,
    })
    desenhar(<PlanosContribuicaoPage />)
    expect(
      await screen.findByText(
        'Semestral · cobrado em janeiro e julho · vencimento dia 10',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Mensal · vencimento dia 10')).toBeInTheDocument()

    await u.click(screen.getByRole('button', { name: 'Novo plano' }))
    expect(
      screen.queryByRole('combobox', {
        name: 'Conta de receita a reconhecer (Passivo)',
      }),
    ).toBeNull()
    await u.type(
      screen.getByPlaceholderText('Categoria (ex.: Efetivo)'),
      'Efetivo',
    )
    await u.type(screen.getByPlaceholderText('Descrição'), 'Semestralidade')
    await u.clear(screen.getByPlaceholderText('Valor inicial'))
    await u.type(screen.getByPlaceholderText('Valor inicial'), '540')
    await u.selectOptions(
      screen.getByRole('combobox', { name: 'Periodicidade' }),
      'Semestral',
    )
    const diferida = await screen.findByRole('combobox', {
      name: 'Conta de receita a reconhecer (Passivo)',
    })
    // só contas de Passivo
    expect(within(diferida).queryByText(/Contribuições$/)).toBeNull()
    const formulario = diferida.closest('form')!
    await u.selectOptions(
      within(formulario)
        .getAllByRole('combobox')
        .find(
          (c) =>
            c !== diferida &&
            (c as HTMLSelectElement).options[0]?.text.startsWith(
              'Conta contábil',
            ),
        )!,
      '7',
    )
    await u.click(screen.getByRole('button', { name: 'Cadastrar' }))
    expect(
      await screen.findByText(
        'Selecione a conta de receita a reconhecer (Passivo).',
      ),
    ).toBeInTheDocument()
    expect(api.criarPlanoContribuicao).not.toHaveBeenCalled()
    await u.selectOptions(diferida, '9')
    await u.click(screen.getByRole('button', { name: 'Cadastrar' }))
    await waitFor(() =>
      expect(api.criarPlanoContribuicao).toHaveBeenCalledWith(
        expect.objectContaining({
          periodicidade: 'Semestral',
          id_conta_contabil: 7,
          id_conta_contabil_receita_diferida: 9,
        }),
      ),
    )
  })

  it('o mensal não manda a conta de receita a reconhecer', async () => {
    const u = userEvent.setup()
    vi.mocked(api.criarPlanoContribuicao).mockResolvedValue({
      mensagem: 'ok',
      id_plano: 5,
    })
    desenhar(<PlanosContribuicaoPage />)
    await u.click(await screen.findByRole('button', { name: 'Novo plano' }))
    await u.type(
      screen.getByPlaceholderText('Categoria (ex.: Efetivo)'),
      'Fundador',
    )
    await u.type(screen.getByPlaceholderText('Descrição'), 'Mensalidade')
    await u.clear(screen.getByPlaceholderText('Valor inicial'))
    await u.type(screen.getByPlaceholderText('Valor inicial'), '60')
    const conta = screen
      .getAllByRole('combobox')
      .find((c) =>
        (c as HTMLSelectElement).options[0]?.text.startsWith('Conta contábil'),
      )!
    await u.selectOptions(conta, '7')
    await u.click(screen.getByRole('button', { name: 'Cadastrar' }))
    await waitFor(() => expect(api.criarPlanoContribuicao).toHaveBeenCalled())
    expect(
      vi.mocked(api.criarPlanoContribuicao).mock.calls[0]?.[0],
    ).not.toHaveProperty('id_conta_contabil_receita_diferida')
  })

  it('desativar e reativar um plano; a recusa do servidor (outro igual ativo) aparece no cartão', async () => {
    const u = userEvent.setup()
    vi.mocked(api.listarPlanosContribuicao).mockResolvedValue([
      plano(1, 'Mensal'),
      plano(2, 'Semestral', { ativo: false }),
    ])
    vi.mocked(api.alternarPlanoContribuicao).mockImplementation(async (id) => {
      if (id === 2)
        throw new api.ApiError(
          409,
          'Já existe o plano ativo "Outro" para a categoria Efetivo, semestral.',
        )
      return { mensagem: 'Plano desativado.' }
    })
    desenhar(<PlanosContribuicaoPage />)
    await u.click(await screen.findByRole('button', { name: 'Desativar' }))
    await waitFor(() =>
      expect(api.alternarPlanoContribuicao).toHaveBeenCalledWith(1, false),
    )
    await u.click(screen.getByRole('button', { name: 'Reativar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Já existe o plano ativo "Outro" para a categoria Efetivo, semestral.',
    )
    expect(
      screen.getByText(
        /Semestral · cobrado em janeiro e julho · vencimento dia 10 · inativo/,
      ),
    ).toBeInTheDocument()
  })
})
