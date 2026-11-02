import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/api'
import * as privacidade from '@/lib/privacidade'
import { IncidentesDeSegurancaPage } from '@/pages/IncidentesDeSeguranca'

vi.mock('@/lib/privacidade', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/privacidade')>()),
  obterIncidentes: vi.fn(),
  registrarIncidente: vi.fn(),
  atualizarIncidente: vi.fn(),
  encerrarIncidente: vi.fn(),
}))

const incidente = (
  extra: Partial<privacidade.IncidenteDeSeguranca> = {},
): privacidade.IncidenteDeSeguranca => ({
  id_incidente: 7,
  numero: 2,
  ensaio: false,
  titulo: 'Planilha enviada ao endereço errado',
  descricao: 'A lista de inscritos foi enviada a outra pessoa.',
  ocorrido_em: null,
  conhecido_em: '2026-10-30T12:00:00',
  dados_afetados: null,
  pessoas_afetadas: null,
  quantidade_estimada: null,
  contencao: null,
  risco: 'A_AVALIAR',
  risco_rotulo: 'Risco ainda não avaliado',
  motivo_do_risco: null,
  comunicado_anpd_em: null,
  protocolo_anpd: null,
  comunicado_pessoas_em: null,
  como_pessoas: null,
  licao_aprendida: null,
  acao_corretiva: null,
  situacao: 'ABERTO',
  encerrado_em: null,
  registrado_em: '2026-10-30T12:00:00',
  precedente: false,
  prazo_para_comunicar: '2026-11-04',
  situacao_do_prazo: 'no_prazo',
  ...extra,
})

const registro = (
  extra: Partial<privacidade.RegistroDeIncidentes> = {},
): privacidade.RegistroDeIncidentes => ({
  itens: [incidente()],
  ensaios: { ultimo_ensaio_em: null, proximo_ate: null, pendente: true },
  hoje: '2026-11-02',
  dias_uteis_para_comunicar: 3,
  pode_gerir: true,
  ...extra,
})

function desenhar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <IncidentesDeSegurancaPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.resetAllMocks())

describe('Incidentes de segurança (v7.4b)', () => {
  it('mostra o plano, o ensaio pendente e o prazo; passa no axe', async () => {
    vi.mocked(privacidade.obterIncidentes).mockResolvedValue(registro())
    const { container } = desenhar()
    const plano = await screen.findByRole('region', {
      name: 'Plano de resposta',
    })
    expect(plano).toHaveTextContent('Comunicar em até 3 dias úteis')
    expect(screen.getByTestId('ensaio-anual')).toHaveAttribute(
      'data-pendente',
      'sim',
    )
    const cartao = screen.getByRole('listitem', { name: 'Incidente nº 2' })
    expect(cartao).toHaveTextContent(
      'Comunicar até 04/11/2026 se houver risco relevante',
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  it('registra com a data em UTC e mostra a recusa do servidor ao encerrar', async () => {
    const u = userEvent.setup()
    vi.mocked(privacidade.obterIncidentes).mockResolvedValue(registro())
    vi.mocked(privacidade.registrarIncidente).mockResolvedValue(registro())
    vi.mocked(privacidade.atualizarIncidente).mockResolvedValue(registro())
    vi.mocked(privacidade.encerrarIncidente).mockRejectedValue(
      new ApiError(
        422,
        'Para encerrar falta: avaliar o risco; a lição aprendida.',
      ),
    )
    desenhar()
    const form = await screen.findByRole('form', {
      name: 'Registrar incidente',
    })
    await u.type(within(form).getByLabelText('Título'), 'Senha exposta')
    await u.type(
      within(form).getByLabelText('O que aconteceu'),
      'A senha apareceu numa conversa.',
    )
    await u.type(
      within(form).getByLabelText('Quando a associação soube'),
      '2026-11-02T10:30',
    )
    await u.click(within(form).getByRole('checkbox'))
    await u.click(within(form).getByRole('button', { name: 'Registrar' }))
    expect(privacidade.registrarIncidente).toHaveBeenCalledWith({
      titulo: 'Senha exposta',
      descricao: 'A senha apareceu numa conversa.',
      conhecido_em: new Date('2026-11-02T10:30').toISOString(),
      ensaio: true,
    })

    const cartao = screen.getByRole('listitem', { name: 'Incidente nº 2' })
    await u.click(
      within(cartao).getByRole('button', { name: 'Completar o registro' }),
    )
    await u.click(
      within(cartao).getByRole('button', { name: 'Salvar e encerrar' }),
    )
    expect(await within(cartao).findByRole('alert')).toHaveTextContent(
      'Para encerrar falta: avaliar o risco',
    )
  })

  it('quem só lê não vê o formulário nem o botão de completar', async () => {
    vi.mocked(privacidade.obterIncidentes).mockResolvedValue(
      registro({
        pode_gerir: false,
        ensaios: {
          ultimo_ensaio_em: '2026-10-01T12:00:00',
          proximo_ate: '2027-10-01',
          pendente: false,
        },
        itens: [
          incidente({
            situacao: 'ENCERRADO',
            encerrado_em: '2026-11-02T12:00:00',
            risco: 'SEM_RISCO_RELEVANTE',
            risco_rotulo: 'Sem risco relevante: fica só no registro',
            situacao_do_prazo: 'sem_obrigacao',
            licao_aprendida: 'Conferir o destinatário.',
            precedente: true,
          }),
        ],
      }),
    )
    desenhar()
    const cartao = await screen.findByRole('listitem', {
      name: 'Incidente nº 2',
    })
    expect(cartao).toHaveTextContent('registrado depois, como precedente')
    expect(cartao).toHaveTextContent('Conferir o destinatário.')
    expect(
      screen.queryByRole('form', { name: 'Registrar incidente' }),
    ).toBeNull()
    expect(
      within(cartao).queryByRole('button', { name: 'Completar o registro' }),
    ).toBeNull()
    expect(screen.getByTestId('ensaio-anual')).toHaveTextContent(
      'o próximo deve ser feito até 01/10/2027',
    )
  })
})
