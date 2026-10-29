import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  EntregaDoRelatorio,
  LiberarRelatorio,
} from '@/components/atendimentos/EntregaDoRelatorio'
import { ApiError, type AtendimentoAberto } from '@/lib/api'
import * as privacidade from '@/lib/privacidade'

vi.mock('@/lib/privacidade', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/privacidade')>()),
  liberarRelatorioAoTitular: vi.fn(),
}))

// v7.2c - a entrega do relatório à pessoa pela Minha conta: no pedido, o estado e o caminho para conferir; na tela do relatório, marcar que conferiu e liberar ESTE
const pedido = {
  id_atendimento: 41,
  protocolo: 'ASAF-2026-00041',
  tipo: 'TITULAR_LGPD',
  identidade_validada: true,
  identidade_validacao: 'AUTOMATICA_CADASTRO',
  email_contato: 'titular@exemplo.com',
  relatorio_liberado_ate: null,
} as unknown as AtendimentoAberto
const IMPRESSAO = 'a'.repeat(64)

function desenhar(no: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>{no}</MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.resetAllMocks())

describe('Entregar o relatório pela Minha conta: no pedido', () => {
  it('o link leva à conferência do relatório do próprio pedido', () => {
    desenhar(<EntregaDoRelatorio a={pedido} />)
    expect(
      screen.getByRole('link', { name: 'Conferir e liberar o relatório' }),
    ).toHaveAttribute('href', '/privacidade/titulares?id_atendimento=41')
    expect(screen.queryByText(/provada só pelo código/)).toBeNull()
  })

  it('já liberado, diz até quando; identidade só pelo código do e-mail é avisada', () => {
    desenhar(
      <EntregaDoRelatorio
        a={{
          ...pedido,
          relatorio_liberado_ate: '2026-11-13T12:00:00',
          identidade_validacao: 'CODIGO_NO_EMAIL',
        }}
      />,
    )
    expect(screen.getByText(/Liberado: a pessoa baixa/)).toHaveTextContent(
      '13/11/2026',
    )
    expect(screen.getByText(/provada só pelo código/)).toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: 'Conferir e liberar de novo (substitui o anterior)',
      }),
    ).toBeInTheDocument()
  })
})

describe('Liberar este relatório na Minha conta', () => {
  it('só libera depois de marcar que conferiu, e manda a impressão do que está na tela', async () => {
    const u = userEvent.setup()
    vi.mocked(privacidade.liberarRelatorioAoTitular).mockResolvedValue({
      id_entrega: 1,
      liberado_em: '2026-10-29T12:00:00',
      valido_ate: '2026-11-13T12:00:00',
    })
    desenhar(
      <LiberarRelatorio
        idAtendimento={41}
        impressao={IMPRESSAO}
        aoMudar={vi.fn()}
      />,
    )
    const botao = screen.getByRole('button', {
      name: 'Liberar na Minha conta por 15 dias',
    })
    expect(botao).toBeDisabled()
    await u.click(
      screen.getByRole('checkbox', {
        name: 'Conferi o relatório: não há nele dado de outra pessoa',
      }),
    )
    await u.click(botao)
    expect(privacidade.liberarRelatorioAoTitular).toHaveBeenCalledWith(
      41,
      IMPRESSAO,
    )
    expect(await screen.findByRole('status')).toHaveTextContent('13/11/2026')
  })

  it('o relatório que mudou desde a conferência é recusado: o motivo aparece e a tela busca de novo', async () => {
    const u = userEvent.setup()
    const aoMudar = vi.fn()
    vi.mocked(privacidade.liberarRelatorioAoTitular).mockRejectedValue(
      new ApiError(
        409,
        'O relatório mudou desde que você o conferiu (entrou ou saiu algum dado): confira de novo antes de liberar.',
      ),
    )
    desenhar(
      <LiberarRelatorio
        idAtendimento={41}
        impressao={IMPRESSAO}
        aoMudar={aoMudar}
      />,
    )
    await u.click(screen.getByRole('checkbox'))
    await u.click(screen.getByRole('button', { name: /Liberar/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'confira de novo',
    )
    expect(aoMudar).toHaveBeenCalled()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })
})
