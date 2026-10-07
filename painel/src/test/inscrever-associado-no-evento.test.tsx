import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { InscreverAssociadoNoEvento } from '@/components/eventos/InscreverAssociadoNoEvento'
import * as api from '@/lib/api'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarAssociadosParaSelecao: vi.fn(),
  inscreverAssociadoNoEvento: vi.fn(),
}))

function desenhar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <InscreverAssociadoNoEvento idEvento={9} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.listarAssociadosParaSelecao).mockResolvedValue([
    { id_associado: 11, nome_completo: 'Ana Souza', cpf_final: '34' },
    { id_associado: 12, nome_completo: 'Bia Lima', cpf_final: '56' },
  ])
  vi.mocked(api.inscreverAssociadoNoEvento).mockResolvedValue({
    mensagem: 'Inscrição registrada.',
    id_inscricao: 1,
    status: 'Pré-inscrito',
  })
})

describe('Inscrever um associado no evento (pela secretaria)', () => {
  it('só liga o botão depois de escolher a pessoa; passa no axe', async () => {
    const { container } = desenhar()
    await screen.findByRole('option', { name: 'Ana Souza' })
    expect(screen.getByRole('button', { name: 'Inscrever' })).toBeDisabled()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('inscreve a pessoa escolhida e diz a situação (vaga ou lista de espera)', async () => {
    const u = userEvent.setup()
    vi.mocked(api.inscreverAssociadoNoEvento).mockResolvedValue({
      mensagem: 'Inscrição registrada.',
      id_inscricao: 2,
      status: 'Lista de Espera',
    })
    desenhar()
    await screen.findByRole('option', { name: 'Bia Lima' })
    await u.selectOptions(
      screen.getByLabelText('Inscrever um associado'),
      'Bia Lima',
    )
    await u.click(screen.getByRole('button', { name: 'Inscrever' }))
    await waitFor(() =>
      expect(api.inscreverAssociadoNoEvento).toHaveBeenCalledWith(9, {
        id_associado: 12,
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Inscrição registrada: Bia Lima — situação Lista de Espera.',
    )
    // depois de inscrever, a escolha volta ao início (não inscreve a mesma pessoa duas vezes sem querer)
    expect(screen.getByLabelText('Inscrever um associado')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Inscrever' })).toBeDisabled()
  })

  it('a recusa do servidor (já inscrita) aparece em português', async () => {
    const u = userEvent.setup()
    vi.mocked(api.inscreverAssociadoNoEvento).mockRejectedValue(
      new Error(
        "Esta pessoa já está inscrita neste contexto (status 'Pré-inscrito').",
      ),
    )
    desenhar()
    await screen.findByRole('option', { name: 'Ana Souza' })
    await u.selectOptions(
      screen.getByLabelText('Inscrever um associado'),
      'Ana Souza',
    )
    await u.click(screen.getByRole('button', { name: 'Inscrever' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'já está inscrita neste contexto',
    )
    expect(screen.queryByRole('status')).toBeNull()
  })
})
