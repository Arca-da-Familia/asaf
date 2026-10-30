import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CpfProtegido } from '@/components/display/CpfProtegido'
import { ApiError } from '@/lib/api'
import * as cpf from '@/lib/cpf-protegido'

vi.mock('@/lib/cpf-protegido', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cpf-protegido')>()),
  revelarCpf: vi.fn(),
}))

beforeEach(() => vi.resetAllMocks())

describe('CPF protegido (v7.3a)', () => {
  it('mostra o escondido e, para quem pode, o completo por clique', async () => {
    const u = userEvent.setup()
    vi.mocked(cpf.revelarCpf).mockResolvedValue({ cpf: '529.982.247-25' })
    const { container } = render(
      <CpfProtegido
        origem="associado"
        id={7}
        mascarado="***.***.***-25"
        podeRevelar
      />,
    )
    expect(screen.getByText('***.***.***-25')).toBeVisible()
    expect(await axe(container)).toHaveNoViolations()
    await u.click(screen.getByRole('button', { name: 'Mostrar o CPF' }))
    expect(cpf.revelarCpf).toHaveBeenCalledWith('associado', 7)
    expect(await screen.findByText('529.982.247-25')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Mostrar o CPF' })).toBeNull()
  })

  it('sem permissão não há botão; sem CPF, um traço', () => {
    const { rerender } = render(
      <CpfProtegido
        origem="proposta"
        id={1}
        mascarado="***.***.***-25"
        podeRevelar={false}
      />,
    )
    expect(screen.getByText('***.***.***-25')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Mostrar o CPF' })).toBeNull()
    rerender(
      <CpfProtegido origem="proposta" id={1} mascarado={null} podeRevelar />,
    )
    expect(screen.getByText('—')).toBeVisible()
  })

  it('a recusa do servidor aparece e o CPF continua escondido', async () => {
    const u = userEvent.setup()
    vi.mocked(cpf.revelarCpf).mockRejectedValue(
      new ApiError(
        403,
        'Só quem atende esta solicitação de titular, enquanto ela está aberta, vê o CPF completo dela.',
      ),
    )
    render(
      <CpfProtegido
        origem="atendimento"
        id={3}
        mascarado="***.***.***-25"
        podeRevelar
      />,
    )
    await u.click(screen.getByRole('button', { name: 'Mostrar o CPF' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Só quem atende esta solicitação de titular',
    )
    expect(screen.getByText('***.***.***-25')).toBeVisible()
  })
})
