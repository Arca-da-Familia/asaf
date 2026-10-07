import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AlocarVoluntarioNoTurno } from '@/components/projetos/AlocarVoluntarioNoTurno'
import * as api from '@/lib/api'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarAlocacoesDoProjeto: vi.fn(),
  listarAssociadosParaSelecao: vi.fn(),
  alocarVoluntario: vi.fn(),
}))

function desenhar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <AlocarVoluntarioNoTurno idProjeto={7} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.listarAssociadosParaSelecao).mockResolvedValue([
    { id_associado: 11, nome_completo: 'Ana Souza', cpf_final: '34' },
    { id_associado: 12, nome_completo: 'Bia Lima', cpf_final: '56' },
  ])
  vi.mocked(api.listarAlocacoesDoProjeto).mockResolvedValue([])
  vi.mocked(api.alocarVoluntario).mockResolvedValue({
    mensagem: 'Voluntário escalado com sucesso!',
  })
})

describe('Alocar voluntário direto num turno', () => {
  it('mostra a escala do projeto com o nome, o turno e a situação; passa no axe', async () => {
    vi.mocked(api.listarAlocacoesDoProjeto).mockResolvedValue([
      {
        id_alocacao: 1,
        id_projeto: 7,
        id_associado: 11,
        nome_associado: 'Ana Souza',
        funcao_desempenhada: 'Recepção',
        id_vaga: null,
        turno_data_hora_inicio: '2026-11-02T08:00:00',
        turno_data_hora_fim: '2026-11-02T12:00:00',
        habilidades_exigidas: null,
        horas_previstas: 4,
        horas_realizadas: 0,
        status: 'CONFIRMADA',
      },
    ])
    const { container } = desenhar()
    expect(await screen.findByText(/Ana Souza — Recepção/)).toHaveTextContent(
      '4 h previstas · CONFIRMADA',
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  it('sem ninguém na escala, diz isso', async () => {
    desenhar()
    expect(
      await screen.findByText('Ninguém está na escala deste projeto ainda.'),
    ).toBeInTheDocument()
  })

  it('o formulário vazio mostra o que falta e não envia nada', async () => {
    const u = userEvent.setup()
    desenhar()
    await u.click(await screen.findByRole('button', { name: 'Alocar agora' }))
    expect(await screen.findByText('Escolha o voluntário.')).toBeInTheDocument()
    expect(screen.getByText('Informe a função.')).toBeInTheDocument()
    expect(screen.getByText('Informe o início do turno.')).toBeInTheDocument()
    expect(screen.getByText('Informe o fim do turno.')).toBeInTheDocument()
    expect(api.alocarVoluntario).not.toHaveBeenCalled()
  })

  it('escolhe a pessoa, a função e o turno e aloca', async () => {
    const u = userEvent.setup()
    desenhar()
    await screen.findByRole('option', { name: 'Bia Lima' })
    await u.selectOptions(screen.getByLabelText('Voluntário'), 'Bia Lima')
    await u.type(
      screen.getByLabelText('Função do voluntário'),
      'Apoio na cozinha',
    )
    await u.type(
      screen.getByLabelText('Início do turno do voluntário'),
      '2026-11-02T13:00',
    )
    await u.type(
      screen.getByLabelText('Fim do turno do voluntário'),
      '2026-11-02T17:00',
    )
    await u.clear(screen.getByLabelText('Horas previstas do voluntário'))
    await u.type(screen.getByLabelText('Horas previstas do voluntário'), '4')
    await u.click(screen.getByRole('button', { name: 'Alocar agora' }))
    await waitFor(() => expect(api.alocarVoluntario).toHaveBeenCalledTimes(1))
    const enviado = vi.mocked(api.alocarVoluntario).mock.calls[0]![0]
    expect(enviado).toMatchObject({
      id_projeto: 7,
      id_associado: 12,
      funcao_desempenhada: 'Apoio na cozinha',
      horas_previstas: 4,
    })
    expect(enviado.turno_data_hora_inicio).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // depois de alocar, a escala é lida de novo
    await waitFor(() =>
      expect(vi.mocked(api.listarAlocacoesDoProjeto).mock.calls.length).toBe(2),
    )
  })

  it('a recusa do servidor (sem termo de voluntariado) aparece em português', async () => {
    const u = userEvent.setup()
    vi.mocked(api.alocarVoluntario).mockRejectedValue(
      new Error('Esta pessoa não tem termo de adesão de voluntário vigente.'),
    )
    desenhar()
    await screen.findByRole('option', { name: 'Ana Souza' })
    await u.selectOptions(screen.getByLabelText('Voluntário'), 'Ana Souza')
    await u.type(screen.getByLabelText('Função do voluntário'), 'Recepção')
    await u.type(
      screen.getByLabelText('Início do turno do voluntário'),
      '2026-11-02T08:00',
    )
    await u.type(
      screen.getByLabelText('Fim do turno do voluntário'),
      '2026-11-02T12:00',
    )
    await u.click(screen.getByRole('button', { name: 'Alocar agora' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'não tem termo de adesão de voluntário vigente',
    )
  })
})
