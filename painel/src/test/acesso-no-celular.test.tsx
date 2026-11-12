import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import { AcessoPage } from '@/pages/Acesso'

// v9.3z2 (no celular a matriz de permissões tinha 21,5 alturas de tela): no celular, um nível por vez, escolhido numa lista, cada permissão com o
// nome e a explicação; a partir do tablet continua a matriz (o jsdom não aplica o CSS: aqui as duas existem).
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarNiveisAcesso: vi.fn(),
  listarPermissoes: vi.fn(),
  atribuirPermissao: vi.fn(),
  removerPermissao: vi.fn(),
}))

function desenhar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <AcessoPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.listarNiveisAcesso).mockResolvedValue([
    {
      id_nivel: 1,
      nome_nivel: 'Presidente',
      is_conselho_fiscal: false,
      exige_mfa: true,
      permissoes: [10],
    },
    {
      id_nivel: 2,
      nome_nivel: 'Diretoria',
      is_conselho_fiscal: false,
      exige_mfa: false,
      permissoes: [11],
    },
  ])
  vi.mocked(api.listarPermissoes).mockResolvedValue([
    {
      id_permissao: 10,
      modulo: 'associados',
      codigo_permissao: 'associados',
      nome: 'Cadastro de associados',
      descricao: 'Ver e editar o cadastro.',
    },
    {
      id_permissao: 11,
      modulo: 'financeiro',
      codigo_permissao: 'financeiro',
      nome: 'Financeiro (operar)',
      descricao: 'Lançar e aprovar.',
    },
  ])
  vi.mocked(api.atribuirPermissao).mockResolvedValue(
    {} as Awaited<ReturnType<typeof api.atribuirPermissao>>,
  )
})

describe('Acesso no celular: um nível por vez', () => {
  it('mostra as permissões do nível escolhido, com o nome e a explicação, marcadas como na matriz', async () => {
    const u = userEvent.setup()
    desenhar()
    const lista = await screen.findByRole('list', {
      name: 'Permissões de Presidente',
    })
    const cadastro = within(lista).getByRole('checkbox', {
      name: /Cadastro de associados/,
    })
    expect(cadastro).toBeChecked()
    expect(
      within(lista).getByText('Ver e editar o cadastro.'),
    ).toBeInTheDocument()
    expect(
      within(lista).getByRole('checkbox', { name: /Financeiro \(operar\)/ }),
    ).not.toBeChecked()
    expect(screen.getByText('Exige o segundo passo')).toBeInTheDocument()

    await u.selectOptions(screen.getByLabelText('Nível'), 'Diretoria')
    const daDiretoria = screen.getByRole('list', {
      name: 'Permissões de Diretoria',
    })
    expect(
      within(daDiretoria).getByRole('checkbox', {
        name: /Financeiro \(operar\)/,
      }),
    ).toBeChecked()
    expect(screen.queryByText('Exige o segundo passo')).toBeNull()
  })

  it('marcar uma permissão no celular atribui ao nível escolhido', async () => {
    const u = userEvent.setup()
    desenhar()
    const lista = await screen.findByRole('list', {
      name: 'Permissões de Presidente',
    })
    await u.click(
      within(lista).getByRole('checkbox', { name: /Financeiro \(operar\)/ }),
    )
    await waitFor(() =>
      expect(api.atribuirPermissao).toHaveBeenCalledWith(1, 11),
    )
  })

  it('a matriz continua lá para telas maiores, e a página passa no axe', async () => {
    const { container } = desenhar()
    await screen.findByRole('list', { name: 'Permissões de Presidente' })
    expect(
      screen.getByRole('checkbox', {
        name: 'Cadastro de associados — Presidente',
      }),
    ).toBeChecked()
    expect(await axe(container)).toHaveNoViolations()
  })
})
