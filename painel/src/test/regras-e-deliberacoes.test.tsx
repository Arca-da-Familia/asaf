import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import { formatarDia, formatarVigencia } from '@/lib/datas'
import { validarValorDaRegra } from '@/lib/estatuto'
import { DeliberacoesPendentesPage } from '@/pages/DeliberacoesPendentes'
import { RegrasDoEstatutoPage } from '@/pages/RegrasDoEstatuto'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarRegrasEstatutarias: vi.fn(),
  historicoDaRegraEstatutaria: vi.fn(),
  reformarRegraEstatutaria: vi.fn(),
  listarDeliberacoesPendentes: vi.fn(),
  listarAtas: vi.fn(),
  listarAssociados: vi.fn(),
}))

function desenhar(pagina: React.ReactNode) {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>{pagina}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const regra = (
  id: number,
  parametro: string,
  valor: string,
  tipo: string,
  extra: Partial<api.RegraEstatutaria> = {},
): api.RegraEstatutaria => ({
  id_regra: id,
  parametro,
  valor,
  tipo,
  categoria: 'regras',
  descricao: `Descrição de ${parametro}`,
  artigo_origem: 'Art. 6º',
  id_documento_estatuto: null,
  vigencia_inicio: '2013-05-23T00:00:00',
  vigencia_fim: null,
  ...extra,
})

describe('validarValorDaRegra (o espelho do que o servidor recusa)', () => {
  it.each([
    ['QUORUM_1A_CONVOCACAO', 'fracao', 'abc'],
    ['QUORUM_1A_CONVOCACAO', 'fracao', '2/0'],
    ['QUORUM_1A_CONVOCACAO', 'fracao', '5/3'],
    ['QUORUM_1A_CONVOCACAO', 'fracao', '0/3'],
    ['DURACAO_MANDATO_ANOS', 'numero', '0'],
    ['DURACAO_MANDATO_ANOS', 'numero', '4.5'],
    ['DURACAO_MANDATO_ANOS', 'numero', 'quatro'],
    ['PROCURACAO_PERMITIDA', 'booleano', 'talvez'],
    ['MESES_AGO_ESTATUTARIA', 'texto', '13'],
    ['MESES_AGO_ESTATUTARIA', 'texto', '2,2'],
    ['MESES_AGO_ESTATUTARIA', 'texto', 'fev,ago'],
    ['QUORUM_1A_CONVOCACAO', 'fracao', '   '],
  ])('recusa %s (%s) = "%s"', (parametro, tipo, valor) => {
    expect(validarValorDaRegra(parametro, tipo, valor)).toBeTruthy()
  })

  it.each([
    ['QUORUM_1A_CONVOCACAO', 'fracao', '2/3'],
    ['QUORUM_2A_CONVOCACAO', 'fracao', '1/2+1'],
    ['QUORUM_1A_CONVOCACAO', 'fracao', '2 / 3'],
    ['DURACAO_MANDATO_ANOS', 'numero', '4'],
    ['PROCURACAO_PERMITIDA', 'booleano', 'nao'],
    ['MESES_AGO_ESTATUTARIA', 'texto', '2,8'],
    ['REGRA_DESEMPATE', 'texto', 'QUALQUER TEXTO LIVRE'],
  ])('aceita %s (%s) = "%s"', (parametro, tipo, valor) => {
    expect(validarValorDaRegra(parametro, tipo, valor)).toBeNull()
  })
})

describe('datas só-dia (o fuso de Belém não pode empurrar para o dia anterior)', () => {
  it('formatarDia mostra o dia gravado, e formatarVigencia distingue dia (meia-noite) de instante', () => {
    const fusoAntes = process.env.TZ
    process.env.TZ = 'America/Belem'
    try {
      expect(formatarDia('2026-01-15T00:00:00')).toBe('15/01/2026')
      expect(formatarDia(null)).toBe('')
      expect(formatarVigencia('2013-05-23T00:00:00')).toBe('23/05/2013')
      // um instante de verdade (hora diferente de meia-noite) mostra a hora local: 01:30 UTC = 22:30 do dia anterior em Belém
      expect(formatarVigencia('2026-10-06T01:30:00')).toContain('05/10/2026')
    } finally {
      process.env.TZ = fusoAntes
    }
  })
})

describe('Regras do Estatuto', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(api.listarRegrasEstatutarias).mockResolvedValue([
      regra(1, 'QUORUM_1A_CONVOCACAO', '2/3', 'fracao'),
      regra(2, 'DURACAO_MANDATO_ANOS', '4', 'numero', {
        artigo_origem: 'Art. 25 / Art. 32',
      }),
    ])
    vi.mocked(api.historicoDaRegraEstatutaria).mockResolvedValue([
      regra(9, 'QUORUM_1A_CONVOCACAO', '3/4', 'fracao', {
        vigencia_inicio: '2026-10-06T15:00:00',
      }),
      regra(1, 'QUORUM_1A_CONVOCACAO', '2/3', 'fracao', {
        vigencia_fim: '2026-10-06T15:00:00',
      }),
    ])
    vi.mocked(api.reformarRegraEstatutaria).mockResolvedValue(
      regra(9, 'QUORUM_1A_CONVOCACAO', '3/4', 'fracao'),
    )
  })

  it('lista cada regra com valor, artigo de origem e descrição, e passa no axe', async () => {
    const { container } = desenhar(<RegrasDoEstatutoPage />)
    expect(await screen.findByText('QUORUM_1A_CONVOCACAO')).toBeInTheDocument()
    expect(
      screen.getByText('Art. 25 / Art. 32', { exact: false }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Descrição de DURACAO_MANDATO_ANOS'),
    ).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('o histórico mostra todas as vigências, a atual marcada', async () => {
    const u = userEvent.setup()
    desenhar(<RegrasDoEstatutoPage />)
    await u.click(
      await screen.findByRole('button', {
        name: 'Histórico de QUORUM_1A_CONVOCACAO',
      }),
    )
    const lista = (await screen.findByText('Histórico de vigências'))
      .parentElement!
    expect(within(lista).getByText('3/4')).toBeInTheDocument()
    expect(within(lista).getByText(/(vigente)/)).toBeInTheDocument()
  })

  it('valor que quebraria o quórum é recusado no campo e NADA é enviado', async () => {
    const u = userEvent.setup()
    desenhar(<RegrasDoEstatutoPage />)
    await u.click(
      await screen.findByRole('button', {
        name: 'Reformar QUORUM_1A_CONVOCACAO',
      }),
    )
    const campo = screen.getByLabelText('Novo valor')
    await u.clear(campo)
    await u.type(campo, '2/0')
    await u.click(screen.getByRole('button', { name: 'Reformar regra' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /fração como 2\/3/,
    )
    expect(api.reformarRegraEstatutaria).not.toHaveBeenCalled()

    // valor igual ao que já vale também não é reforma
    await u.clear(campo)
    await u.type(campo, '2/3')
    await u.click(screen.getByRole('button', { name: 'Reformar regra' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /igual ao que já vale/,
    )
    expect(api.reformarRegraEstatutaria).not.toHaveBeenCalled()
  })

  it('valor válido pede confirmação (dizendo de quanto para quanto) e só então reforma', async () => {
    const u = userEvent.setup()
    desenhar(<RegrasDoEstatutoPage />)
    await u.click(
      await screen.findByRole('button', {
        name: 'Reformar QUORUM_1A_CONVOCACAO',
      }),
    )
    const campo = screen.getByLabelText('Novo valor')
    await u.clear(campo)
    await u.type(campo, '3/4')
    await u.click(screen.getByRole('button', { name: 'Reformar regra' }))

    const dialogo = await screen.findByRole('alertdialog')
    expect(dialogo).toHaveTextContent('De “2/3” para “3/4”')
    expect(api.reformarRegraEstatutaria).not.toHaveBeenCalled()

    await u.click(
      within(dialogo).getByRole('button', { name: 'Reformar regra' }),
    )
    await waitFor(() =>
      expect(api.reformarRegraEstatutaria).toHaveBeenCalledWith(
        'QUORUM_1A_CONVOCACAO',
        { valor: '3/4', artigo_origem: 'Art. 6º' },
      ),
    )
  })

  it('a recusa do servidor aparece uma vez, no formulário, e a regra continua como estava', async () => {
    const u = userEvent.setup()
    vi.mocked(api.reformarRegraEstatutaria).mockRejectedValue(
      new Error('Informe uma fração como 2/3.'),
    )
    desenhar(<RegrasDoEstatutoPage />)
    await u.click(
      await screen.findByRole('button', {
        name: 'Reformar DURACAO_MANDATO_ANOS',
      }),
    )
    const campo = screen.getByLabelText('Novo valor')
    await u.clear(campo)
    await u.type(campo, '5')
    await u.click(screen.getByRole('button', { name: 'Reformar regra' }))
    await u.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Reformar regra',
      }),
    )
    expect(
      await screen.findAllByText('Informe uma fração como 2/3.'),
    ).toHaveLength(1)
  })
})

describe('Deliberações pendentes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(api.listarAssociados).mockResolvedValue([
      { id_associado: 3, nome_completo: 'Carla de Teste' } as Awaited<
        ReturnType<typeof api.listarAssociados>
      >[number],
    ])
    vi.mocked(api.listarAtas).mockResolvedValue([
      { id_ata: 40, id_assembleia: 7 } as Awaited<
        ReturnType<typeof api.listarAtas>
      >[number],
    ])
  })

  it('lista o que está pendente, com responsável, prazo (dia certo), atraso e o caminho até a ata', async () => {
    const fusoAntes = process.env.TZ
    process.env.TZ = 'America/Belem'
    try {
      vi.mocked(api.listarDeliberacoesPendentes).mockResolvedValue([
        {
          id_deliberacao: 1,
          id_ata: 40,
          tipo: 'Genérica',
          texto: 'Reformar o telhado da sede',
          ano_exercicio: null,
          status_execucao: 'Pendente',
          id_associado_responsavel: 3,
          prazo_execucao: '2020-03-10T00:00:00',
          concluida_em: null,
          observacao_conclusao: null,
        },
        {
          id_deliberacao: 2,
          id_ata: 40,
          tipo: 'Eleição',
          texto: 'Eleger a nova diretoria',
          ano_exercicio: null,
          status_execucao: 'Pendente',
          id_associado_responsavel: null,
          prazo_execucao: '2099-01-01T00:00:00',
          concluida_em: null,
          observacao_conclusao: null,
        },
      ])
      const { container } = desenhar(<DeliberacoesPendentesPage />)
      const primeira = (
        await screen.findByText('Reformar o telhado da sede')
      ).closest('div.rounded-md')! as HTMLElement
      expect(
        within(primeira).getByText(/Responsável: Carla de Teste/),
      ).toBeInTheDocument()
      expect(
        within(primeira).getByText(/prazo 10\/03\/2020/),
      ).toBeInTheDocument()
      expect(within(primeira).getByText('Atrasada')).toBeInTheDocument()
      expect(
        within(primeira).getByRole('link', { name: 'Abrir a ata' }),
      ).toHaveAttribute('href', '/governanca/7/ata?ata=40')
      const segunda = screen
        .getByText('Eleger a nova diretoria')
        .closest('div.rounded-md')! as HTMLElement
      expect(within(segunda).queryByText('Atrasada')).not.toBeInTheDocument()
      expect(
        within(segunda).getByText(/Sem responsável definido/),
      ).toBeInTheDocument()
      expect(await axe(container)).toHaveNoViolations()
    } finally {
      process.env.TZ = fusoAntes
    }
  })

  it('sem nada pendente, diz isso', async () => {
    vi.mocked(api.listarDeliberacoesPendentes).mockResolvedValue([])
    desenhar(<DeliberacoesPendentesPage />)
    expect(
      await screen.findByText('Nenhuma deliberação pendente'),
    ).toBeInTheDocument()
  })
})
