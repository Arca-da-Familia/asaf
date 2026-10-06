import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import { SessaoAssembleiaPage } from '@/pages/SessaoAssembleia'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  me: vi.fn(),
  obterAssembleia: vi.fn(),
  listarAssociados: vi.fn(),
  listarCredenciamentos: vi.fn(),
  listarHabilitados: vi.fn(),
  obterQuorum: vi.fn(),
  listarItensPauta: vi.fn(),
  listarOcorrencias: vi.fn(),
  credenciar: vi.fn(),
  registrarSaidaCredenciamento: vi.fn(),
}))

const associado = (id: number, nome: string) =>
  ({ id_associado: id, nome_completo: nome }) as Awaited<
    ReturnType<typeof api.listarAssociados>
  >[number]

function desenhar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={['/governanca/7/sessao']}>
        <Routes>
          <Route
            path="/governanca/:id/sessao"
            element={<SessaoAssembleiaPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.me).mockResolvedValue({
    id_usuario: 1,
    id_associado: 1,
    nome_completo: 'Presidente de Teste',
    email: 'p@teste.local',
    nivel: 'Presidente',
    mfa_ativado: false,
    mfa_obrigatorio: false,
    mfa_pendente: false,
    permissoes: ['governanca'],
  })
  vi.mocked(api.obterAssembleia).mockResolvedValue({
    id_assembleia: 7,
    tipo: 'Ordinária',
    status: 'Em andamento',
  } as Awaited<ReturnType<typeof api.obterAssembleia>>)
  vi.mocked(api.listarAssociados).mockResolvedValue([
    associado(1, 'Ana de Teste'),
    associado(2, 'Bruno de Teste'),
    associado(3, 'Carla de Teste'),
  ])
  vi.mocked(api.listarHabilitados).mockResolvedValue([
    { id_associado: 1, habilitado: true },
    { id_associado: 2, habilitado: true },
    { id_associado: 3, habilitado: true },
  ] as Awaited<ReturnType<typeof api.listarHabilitados>>)
  vi.mocked(api.obterQuorum).mockResolvedValue({
    convocacao_aplicavel: '1ª',
    quorum_regra: '2/3',
    total_habilitados: 3,
    credenciados_habilitados: 1,
    minimo_exigido: 2,
    quorum_atingido: false,
  })
  vi.mocked(api.listarItensPauta).mockResolvedValue([])
  vi.mocked(api.listarOcorrencias).mockResolvedValue([])
  vi.mocked(api.listarCredenciamentos).mockResolvedValue([
    {
      id_credenciamento: 11,
      id_associado: 1,
      modalidade: 'Presencial',
      hora_entrada: '2026-10-06T15:00:00',
      hora_saida: null,
    },
    {
      id_credenciamento: 12,
      id_associado: 2,
      modalidade: 'Remoto',
      hora_entrada: '2026-10-06T15:01:00',
      hora_saida: '2026-10-06T15:30:00',
    },
  ])
  vi.mocked(api.credenciar).mockResolvedValue({
    id_credenciamento: 12,
    id_associado: 2,
    nome_completo: 'Bruno de Teste',
    modalidade: 'Remoto',
    hora_entrada: '2026-10-06T15:01:00',
  } as Awaited<ReturnType<typeof api.credenciar>>)
})

describe('Chamada da sessão (achado v5.4d: quem saiu continuava listado como presente)', () => {
  it('"Presentes" só conta quem está na sala; quem saiu aparece em "Saíram", fora de "Faltantes"', async () => {
    desenhar()
    expect(
      await screen.findByRole('heading', { name: 'Presentes (1)' }),
    ).toBeInTheDocument()
    const presentes = screen.getByRole('heading', { name: 'Presentes (1)' })
      .nextElementSibling as HTMLElement
    expect(within(presentes).getByText(/Ana de Teste/)).toBeInTheDocument()
    expect(
      within(presentes).queryByText(/Bruno de Teste/),
    ).not.toBeInTheDocument()
    expect(
      within(presentes).getByRole('button', { name: 'Registrar saída' }),
    ).toBeInTheDocument()

    expect(
      screen.getByRole('heading', { name: 'Saíram (1)' }),
    ).toBeInTheDocument()
    const saiu = screen.getByRole('heading', { name: 'Saíram (1)' })
      .nextElementSibling as HTMLElement
    expect(within(saiu).getByText(/Bruno de Teste/)).toBeInTheDocument()
    expect(within(saiu).getByText(/saiu/)).toBeInTheDocument()

    // só a Carla, que nunca chegou, está em falta
    expect(
      screen.getByRole('heading', { name: 'Faltantes até agora (1)' }),
    ).toBeInTheDocument()
  })

  it('"Registrar retorno" credencia de novo quem saiu, na mesma modalidade em que estava', async () => {
    const u = userEvent.setup()
    vi.mocked(api.credenciar).mockClear()
    desenhar()
    await u.click(
      await screen.findByRole('button', { name: 'Registrar retorno' }),
    )
    await waitFor(() => expect(api.credenciar).toHaveBeenCalled())
    expect(api.credenciar).toHaveBeenCalledWith(7, {
      id_associado: 2,
      modalidade: 'Remoto',
    })
  })

  it('a recusa do servidor aparece UMA vez, tanto pelo formulário quanto pelo botão da lista', async () => {
    const u = userEvent.setup()
    const recusa = 'Associado já está credenciado e presente nesta sessão.'
    vi.mocked(api.credenciar).mockRejectedValue(new Error(recusa))
    desenhar()

    // pelo botão da lista (a mensagem não pode vir duplicada)
    await u.click(
      await screen.findByRole('button', { name: 'Registrar retorno' }),
    )
    expect(await screen.findAllByText(recusa)).toHaveLength(1)

    // pelo formulário (o próprio formulário já mostra; a página não repete)
    await u.selectOptions(screen.getAllByRole('combobox')[0]!, '3')
    await u.click(screen.getByRole('button', { name: 'Credenciar' }))
    await waitFor(() => expect(api.credenciar).toHaveBeenCalledTimes(2))
    expect(await screen.findAllByText(recusa)).toHaveLength(1)
  })

  it('sem ninguém na sala e com quem saiu, diz que não há ninguém presente (e não "ninguém credenciado")', async () => {
    vi.mocked(api.listarCredenciamentos).mockResolvedValue([
      {
        id_credenciamento: 12,
        id_associado: 2,
        modalidade: 'Presencial',
        hora_entrada: '2026-10-06T15:01:00',
        hora_saida: '2026-10-06T15:30:00',
      },
    ])
    desenhar()
    expect(
      await screen.findByRole('heading', { name: 'Presentes (0)' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText('Ninguém presente no momento.'),
    ).toBeInTheDocument()
  })

  it('enquanto quem já entrou não chegou, NÃO mostra todos como faltantes (um clique credenciaria quem já está na sala)', async () => {
    vi.mocked(api.listarCredenciamentos).mockReturnValue(new Promise(() => {}))
    desenhar()
    expect(await screen.findByText('Carregando a chamada…')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Marcar presença' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: /Faltantes/ }),
    ).not.toBeInTheDocument()
  })
})
