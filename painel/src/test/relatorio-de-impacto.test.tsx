import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/api'
import * as privacidade from '@/lib/privacidade'
import { RelatorioDeImpactoPage } from '@/pages/RelatorioDeImpacto'

vi.mock('@/lib/privacidade', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/privacidade')>()),
  obterRelatoriosDeImpacto: vi.fn(),
  salvarRelatorioDeImpacto: vi.fn(),
  aprovarRelatorioDeImpacto: vi.fn(),
  suspenderRelatorioDeImpacto: vi.fn(),
  abrirPdfDoRelatorio: vi.fn(),
}))

const SECOES = [
  { chave: 'descricao', rotulo: 'Descrição do tratamento' },
  { chave: 'parecer_do_encarregado', rotulo: 'Parecer do encarregado' },
]

const tratamento = (
  extra: Partial<privacidade.TratamentoDeAltoRisco> = {},
): privacidade.TratamentoDeAltoRisco => ({
  codigo: 'ATENDIMENTO_SOCIAL',
  nome: 'Prontuário e encaminhamentos de beneficiários',
  ligado: true,
  versao_do_plano: 'v4.2',
  por_que_alto_risco: 'Dado sensível de criança.',
  liberado: false,
  aprovado: null,
  rascunho: null,
  suspenso: null,
  proposta: { descricao: 'Proposta do sistema.', parecer_do_encarregado: '' },
  historico: [],
  ...extra,
})

const dados = (
  extra: Partial<privacidade.RelatoriosDeImpacto> = {},
): privacidade.RelatoriosDeImpacto => ({
  tratamentos: [
    tratamento(),
    tratamento({
      codigo: 'BIOMETRIA',
      nome: 'Biometria',
      ligado: false,
      versao_do_plano: 'v20.3',
      proposta: null,
    }),
  ],
  secoes: SECOES,
  pode_gerir: true,
  ...extra,
})

const rascunho: privacidade.VersaoDoRelatorio = {
  id_relatorio: 1,
  versao: 1,
  situacao: 'Rascunho',
  secoes: { descricao: 'Proposta do sistema.', parecer_do_encarregado: 'ok' },
  criado_em: '2026-10-23T15:00:00',
  atualizado_em: null,
  aprovado_em: null,
  suspenso_em: null,
  motivo_suspensao: null,
}

function desenhar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <RelatorioDeImpactoPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.resetAllMocks())

describe('Relatório de impacto (v7.0d)', () => {
  it('mostra o fechado e o ainda não construído; passa no axe', async () => {
    vi.mocked(privacidade.obterRelatoriosDeImpacto).mockResolvedValue(dados())
    const { container } = desenhar()
    expect(
      await screen.findByText('Fechado: sem relatório aprovado'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Ainda não existe no sistema (v20.3)'),
    ).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('o rascunho nasce da proposta do sistema; salvar envia as seções; aprovar mostra a recusa do servidor', async () => {
    vi.mocked(privacidade.obterRelatoriosDeImpacto).mockResolvedValue(dados())
    vi.mocked(privacidade.salvarRelatorioDeImpacto).mockResolvedValue(
      dados({ tratamentos: [tratamento({ rascunho, proposta: null })] }),
    )
    vi.mocked(privacidade.aprovarRelatorioDeImpacto).mockRejectedValue(
      new ApiError(422, 'Preencha antes de aprovar: Parecer do encarregado.'),
    )
    desenhar()
    const cartao = await screen.findByRole('region', {
      name: 'Prontuário e encaminhamentos de beneficiários',
    })
    await userEvent.click(
      within(cartao).getByRole('button', { name: 'Escrever o rascunho' }),
    )
    expect(
      within(cartao).getByLabelText('Descrição do tratamento'),
    ).toHaveValue('Proposta do sistema.')
    await userEvent.type(
      within(cartao).getByLabelText('Parecer do encarregado'),
      'De acordo.',
    )
    await userEvent.click(
      within(cartao).getByRole('button', { name: 'Salvar o rascunho' }),
    )
    expect(privacidade.salvarRelatorioDeImpacto).toHaveBeenCalledWith(
      'ATENDIMENTO_SOCIAL',
      {
        descricao: 'Proposta do sistema.',
        parecer_do_encarregado: 'De acordo.',
      },
    )
    await userEvent.click(
      await within(cartao).findByRole('button', {
        name: 'Aprovar o relatório',
      }),
    )
    expect(
      await within(cartao).findByText(
        'Preencha antes de aprovar: Parecer do encarregado.',
      ),
    ).toBeInTheDocument()
  })

  it('suspender pede o motivo; quem só vê não tem os botões de decidir', async () => {
    const aprovado = {
      ...rascunho,
      situacao: 'Aprovado' as const,
      aprovado_em: '2026-10-23T16:00:00',
    }
    vi.mocked(privacidade.obterRelatoriosDeImpacto).mockResolvedValueOnce(
      dados({
        tratamentos: [tratamento({ liberado: true, aprovado, proposta: null })],
      }),
    )
    vi.mocked(privacidade.suspenderRelatorioDeImpacto).mockResolvedValue(
      dados({
        tratamentos: [
          tratamento({
            suspenso: {
              ...aprovado,
              situacao: 'Suspenso',
              motivo_suspensao: 'Revisar os riscos.',
            },
            proposta: null,
          }),
        ],
      }),
    )
    desenhar()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Suspender o tratamento' }),
    )
    await userEvent.type(
      screen.getByLabelText('Motivo da suspensão'),
      'Revisar os riscos.',
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirmar a suspensão' }),
    )
    expect(
      await screen.findByText('Suspenso: Revisar os riscos.'),
    ).toBeInTheDocument()
    expect(privacidade.suspenderRelatorioDeImpacto).toHaveBeenCalledWith(
      'ATENDIMENTO_SOCIAL',
      'Revisar os riscos.',
    )
  })

  it('quem só vê (o Vice-Presidente) lê e abre o PDF, sem escrever, aprovar nem suspender', async () => {
    vi.mocked(privacidade.obterRelatoriosDeImpacto).mockResolvedValue(
      dados({ pode_gerir: false }),
    )
    desenhar()
    await screen.findByText('Fechado: sem relatório aprovado')
    expect(screen.queryByRole('button', { name: /rascunho/ })).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Aprovar o relatório' }),
    ).toBeNull()
    expect(
      screen.getAllByRole('button', { name: 'Abrir em PDF' }),
    ).toHaveLength(2)
  })
})
