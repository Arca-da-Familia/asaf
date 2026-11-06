import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import { ApiError } from '@/lib/api'
import * as privacidade from '@/lib/privacidade'
import { RevisaoDoProgramaPage } from '@/pages/RevisaoDoPrograma'

// v9.3g: as permissões aparecem pelo nome em português (o servidor manda o nome de cada código)
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarNomesDasPermissoes: vi.fn(),
}))
vi.mock('@/lib/privacidade', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/privacidade')>()),
  obterRevisoesDoPrograma: vi.fn(),
  montarRevisaoDoPrograma: vi.fn(),
  anotarRevisaoDoPrograma: vi.fn(),
  aprovarRevisaoDoPrograma: vi.fn(),
}))

const retrato: privacidade.RetratoDoPrograma = {
  periodo: { de: '2025-11-03T12:00:00', ate: '2026-11-03T12:00:00' },
  encarregado: { nome: 'Ana Presidente', ato_vigente: 1, avisos: [] },
  inventario: {
    atividades: 14,
    base_legal_a_conferir: 2,
    tabelas_sem_atividade: [],
  },
  prazos_de_guarda: [{ rotulo: 'Pedidos da fila de atendimento', dias: 1825 }],
  acessos: [
    {
      nome: 'Bruno Vice',
      nivel: 'Associado',
      permissoes: ['associados', 'privacidade'],
    },
  ],
  incidentes: {
    registrados: 1,
    com_risco_relevante: 0,
    comunicados_a_anpd: 0,
    abertos: 0,
    ensaios: 1,
  },
  ensaios: { ultimo_ensaio_em: null, proximo_ate: null, pendente: true },
  pedidos_de_titular: {
    total: 3,
    respondidos: 3,
    respondidos_no_prazo: 3,
    em_andamento_vencidos: 0,
  },
  treinamento: { precisam: 5, feitos: 4, pendentes: 1, atrasados: 0 },
}

const dados = (
  extra: Partial<privacidade.RevisoesDoPrograma> = {},
): privacidade.RevisoesDoPrograma => ({
  situacao: {
    ultima_aprovada_em: null,
    pendente: true,
    atrasada: false,
    proxima_em: 'janeiro de 2026',
  },
  revisoes: [
    {
      id_revisao: 4,
      situacao: 'RASCUNHO',
      retrato,
      observacoes: null,
      montada_em: '2026-11-03T12:00:00',
      aprovada_em: null,
    },
  ],
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
        <RevisaoDoProgramaPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.resetAllMocks())

describe('Revisão anual do programa (v7.5b)', () => {
  it('mostra o retrato e a situação pendente; passa no axe', async () => {
    vi.mocked(api.listarNomesDasPermissoes).mockResolvedValue({
      associados: 'Cadastro de associados',
      privacidade: 'Programa de privacidade (consultar)',
    })
    vi.mocked(privacidade.obterRevisoesDoPrograma).mockResolvedValue(dados())
    const { container } = desenhar()
    expect(await screen.findByTestId('situacao-da-revisao')).toHaveAttribute(
      'data-pendente',
      'sim',
    )
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: 'Quem tem acesso a quê' }),
      ).toHaveTextContent(
        'Bruno Vice (Associado): Cadastro de associados, Programa de privacidade (consultar)',
      ),
    )
    expect(
      screen.getByRole('region', { name: 'Prazos de guarda' }),
    ).toHaveTextContent('Pedidos da fila de atendimento: 1825 dias')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('aprovar salva as observações antes e mostra a recusa do servidor', async () => {
    const u = userEvent.setup()
    vi.mocked(privacidade.obterRevisoesDoPrograma).mockResolvedValue(dados())
    vi.mocked(privacidade.anotarRevisaoDoPrograma).mockResolvedValue(dados())
    vi.mocked(privacidade.aprovarRevisaoDoPrograma).mockRejectedValue(
      new ApiError(
        422,
        'Escreva as observações da revisão (o que está bom e o que melhorar) antes de aprovar.',
      ),
    )
    desenhar()
    const rascunho = await screen.findByRole('listitem', {
      name: /Revisão de 03\/11\/2026/,
    })
    await u.type(within(rascunho).getByRole('textbox'), 'ok')
    await u.click(
      within(rascunho).getByRole('button', { name: 'Salvar e aprovar' }),
    )
    expect(privacidade.anotarRevisaoDoPrograma).toHaveBeenCalledWith(4, 'ok')
    expect(await within(rascunho).findByRole('alert')).toHaveTextContent(
      'Escreva as observações',
    )
  })

  it('quem só lê não monta nem aprova; a aprovada mostra as observações', async () => {
    vi.mocked(privacidade.obterRevisoesDoPrograma).mockResolvedValue(
      dados({
        pode_gerir: false,
        situacao: {
          ultima_aprovada_em: '2026-11-03T12:00:00',
          pendente: false,
          atrasada: false,
          proxima_em: 'janeiro de 2027',
        },
        revisoes: [
          {
            id_revisao: 4,
            situacao: 'APROVADA',
            retrato,
            observacoes: 'Tudo em dia.',
            montada_em: '2026-11-03T12:00:00',
            aprovada_em: '2026-11-03T12:00:00',
          },
        ],
      }),
    )
    desenhar()
    expect(await screen.findByText('Tudo em dia.')).toBeVisible()
    expect(screen.getByTestId('situacao-da-revisao')).toHaveTextContent(
      'A próxima é em janeiro de 2027.',
    )
    expect(
      screen.queryByRole('button', { name: 'Montar o retrato de hoje' }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Salvar e aprovar' }),
    ).toBeNull()
  })
})
