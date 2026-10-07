import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NucleoFamiliarDoBeneficiario } from '@/components/projetos/NucleoFamiliarDoBeneficiario'
import * as api from '@/lib/api'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarNucleoFamiliar: vi.fn(),
  listarOpcoesCatalogo: vi.fn(),
}))

const beneficiario: api.Beneficiario = {
  id_beneficiario: 5,
  id_pessoa: 50,
  nome_completo: 'Pedro Alves',
  data_nascimento: null,
  consentimento_lgpd_registrado: true,
  observacao_consentimento: null,
  data_consentimento: null,
}

function desenhar(onFechar = vi.fn()) {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <NucleoFamiliarDoBeneficiario
        beneficiario={beneficiario}
        onFechar={onFechar}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.listarOpcoesCatalogo).mockResolvedValue([
    {
      id_opcao: 1,
      id_pai: null,
      codigo: 'FILHO',
      rotulo: 'Filho(a)',
      ordem: 1,
      ativo: true,
      cor: null,
      icone: null,
    },
  ])
})

describe('Núcleo familiar do beneficiário', () => {
  it('diz quem é quem na família, de qualquer lado; passa no axe', async () => {
    vi.mocked(api.listarNucleoFamiliar).mockResolvedValue([
      {
        id_dependente: 1,
        id_pessoa_titular: 40,
        id_pessoa_vinculada: 50,
        grau_parentesco: 'FILHO',
        nome_titular: 'Maria Alves',
        nome_vinculada: 'Pedro Alves',
        beneficiario_e: 'dependente',
      },
      {
        id_dependente: 2,
        id_pessoa_titular: 50,
        id_pessoa_vinculada: 60,
        grau_parentesco: 'FILHO',
        nome_titular: 'Pedro Alves',
        nome_vinculada: 'Ana Alves',
        beneficiario_e: 'titular',
      },
    ])
    const { container } = desenhar()
    expect(
      await screen.findByText('Pedro Alves é Filho(a) de Maria Alves'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Ana Alves é Filho(a) de Pedro Alves'),
    ).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('sem vínculos, diz onde se cadastram', async () => {
    vi.mocked(api.listarNucleoFamiliar).mockResolvedValue([])
    desenhar()
    expect(
      await screen.findByText(/Nenhum vínculo familiar cadastrado/),
    ).toHaveTextContent('aba Vínculos')
  })

  it('"Fechar" avisa a tela', async () => {
    const u = userEvent.setup()
    vi.mocked(api.listarNucleoFamiliar).mockResolvedValue([])
    const onFechar = vi.fn()
    desenhar(onFechar)
    await u.click(await screen.findByRole('button', { name: 'Fechar' }))
    expect(onFechar).toHaveBeenCalled()
  })
})
