import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as privacidade from '@/lib/privacidade'
import { RelatorioDeAtendimentoDoTitularPage } from '@/pages/RelatorioDeAtendimentoDoTitular'

vi.mock('@/lib/privacidade', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/privacidade')>()),
  obterRelatorioDeAtendimentoDoTitular: vi.fn(),
}))

// v7.2f - o relatório de atendimento das solicitações do titular, para a Diretoria: só contagens do ano
const RELATORIO: privacidade.RelatorioDeAtendimentoDoTitular = {
  ano: 2026,
  ano_atual: 2026,
  total: 7,
  por_direito: [
    {
      codigo: 'ACESSO',
      rotulo: 'Acessar os dados que a associação tem sobre mim',
      total: 4,
    },
  ],
  por_resultado: [{ codigo: 'ATENDIDO', rotulo: 'Atendido', total: 5 }],
  por_fundamento: [],
  por_canal: [{ codigo: 'painel', rotulo: 'Painel (Meu perfil)', total: 2 }],
  respondidos: 6,
  respondidos_no_prazo: 5,
  respondidos_fora_do_prazo: 1,
  em_andamento_vencidos: 0,
  tempo_medio_de_resposta_dias: 3.5,
  relatorios_entregues: 2,
  eliminacoes_feitas: 1,
}

function desenhar() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RelatorioDeAtendimentoDoTitularPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(privacidade.obterRelatorioDeAtendimentoDoTitular).mockResolvedValue(
    RELATORIO,
  )
})

describe('Relatório de atendimento', () => {
  it('mostra os totais, o prazo, o tempo médio e as contagens; passa no axe', async () => {
    const { container } = desenhar()
    expect(
      await screen.findByText('Respondidos fora do prazo'),
    ).toBeInTheDocument()
    expect(screen.getByText('3,5 dias')).toBeInTheDocument()
    const direito = screen.getByRole('region', { name: 'Por direito pedido' })
    expect(
      within(direito).getByText(
        'Acessar os dados que a associação tem sobre mim',
      ),
    ).toBeInTheDocument()
    expect(
      within(
        screen.getByRole('region', {
          name: 'Fundamento do que não foi atendido por inteiro',
        }),
      ).getByText('Nenhum.'),
    ).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('abre no ano de hoje dado pelo servidor (Belém) e trocar o ano pede o relatório daquele ano', async () => {
    const u = userEvent.setup()
    desenhar()
    await screen.findByText('Respondidos fora do prazo')
    expect(
      privacidade.obterRelatorioDeAtendimentoDoTitular,
    ).toHaveBeenCalledWith(undefined)
    expect(screen.getByLabelText('Ano')).toHaveValue('2026')
    await u.selectOptions(screen.getByLabelText('Ano'), '2025')
    expect(
      privacidade.obterRelatorioDeAtendimentoDoTitular,
    ).toHaveBeenLastCalledWith(2025)
  })
})
