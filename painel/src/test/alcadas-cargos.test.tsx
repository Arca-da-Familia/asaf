import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import type { OpcaoDeCatalogo } from '@/lib/api'
import { AlcadasAprovacaoPage } from '@/pages/AlcadasAprovacao'

// v9.3r (pedido do Presidente: nada de nome técnico na tela): o formulário de alçada pedia os cargos DIGITADOS em código ("TESOUREIRO,PRESIDENTE").
// Agora a pessoa marca os cargos pelo nome, e o que vai ao servidor continua sendo o código, na ordem da lista (a do Estatuto).
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarAlcadasAprovacao: vi.fn(),
  listarDelegacoesAprovacao: vi.fn(),
  listarOpcoesCatalogo: vi.fn(),
  listarAssociadosParaSelecao: vi.fn(),
  criarAlcadaAprovacao: vi.fn(),
  alternarAlcadaAprovacao: vi.fn(),
}))

function cargo(codigo: string, rotulo: string, ordem: number): OpcaoDeCatalogo {
  return {
    id_opcao: ordem,
    id_pai: null,
    codigo,
    rotulo,
    ordem,
    ativo: true,
    cor: null,
    icone: null,
  }
}

const CARGOS = [
  cargo('PRESIDENTE', 'Presidente', 1),
  cargo('VICE_PRESIDENTE', '1º Vice-Presidente', 2),
  cargo('TESOUREIRO', '1º Tesoureiro', 3),
  cargo('VICE_TESOUREIRO', '2º Tesoureiro', 4),
]

function desenhar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <AlcadasAprovacaoPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.listarAlcadasAprovacao).mockResolvedValue([])
  vi.mocked(api.listarDelegacoesAprovacao).mockResolvedValue([])
  vi.mocked(api.listarAssociadosParaSelecao).mockResolvedValue([])
  vi.mocked(api.listarOpcoesCatalogo).mockResolvedValue(CARGOS)
  vi.mocked(api.criarAlcadaAprovacao).mockResolvedValue(
    {} as Awaited<ReturnType<typeof api.criarAlcadaAprovacao>>,
  )
})

async function abrirFormulario() {
  const u = userEvent.setup()
  const { container } = desenhar()
  await u.click(await screen.findByRole('button', { name: 'Nova alçada' }))
  const grupo = await screen.findByRole('group', {
    name: 'Cargos que podem aprovar',
  })
  await within(grupo).findByRole('checkbox', { name: 'Presidente' })
  return { u, grupo, container }
}

describe('Alçadas: os cargos são marcados pelo nome, nunca digitados em código', () => {
  it('mostra uma caixa por cargo da lista, com o nome do cargo, e nenhum campo para digitar código', async () => {
    const { grupo } = await abrirFormulario()
    expect(
      within(grupo)
        .getAllByRole('checkbox')
        .map((c) => c.closest('label')?.textContent),
    ).toEqual([
      'Presidente',
      '1º Vice-Presidente',
      '1º Tesoureiro',
      '2º Tesoureiro',
    ])
    expect(screen.queryByPlaceholderText(/Cargos \(ex/)).toBeNull()
    expect(document.body.textContent).not.toMatch(/[A-Z]+_[A-Z]+/)
    expect(screen.getByLabelText('Valor mínimo (R$)')).toBeInTheDocument()
    expect(screen.getByLabelText('Valor máximo (R$)')).toBeInTheDocument()
  })

  it('sem nenhum cargo marcado a tela recusa e não envia nada', async () => {
    const { u } = await abrirFormulario()
    await u.click(screen.getByRole('button', { name: 'Cadastrar alçada' }))
    expect(
      await screen.findByText('Marque ao menos um cargo que pode aprovar.'),
    ).toBeInTheDocument()
    expect(api.criarAlcadaAprovacao).not.toHaveBeenCalled()
  })

  it('envia os códigos dos cargos marcados, na ordem da lista (não na ordem dos cliques)', async () => {
    const { u, grupo } = await abrirFormulario()
    await u.type(screen.getByLabelText('Valor mínimo (R$)'), '5000')
    await u.click(
      within(grupo).getByRole('checkbox', { name: '1º Tesoureiro' }),
    )
    await u.click(within(grupo).getByRole('checkbox', { name: 'Presidente' }))
    await u.click(
      within(grupo).getByRole('checkbox', { name: '2º Tesoureiro' }),
    )
    // desmarcar tira da lista
    await u.click(
      within(grupo).getByRole('checkbox', { name: '2º Tesoureiro' }),
    )
    await u.click(screen.getByLabelText(/Exige dupla assinatura/))
    await u.click(screen.getByRole('button', { name: 'Cadastrar alçada' }))
    await waitFor(() =>
      expect(api.criarAlcadaAprovacao).toHaveBeenCalledWith({
        valor_minimo: 5000,
        valor_maximo: null,
        cargos_autorizados: ['PRESIDENTE', 'TESOUREIRO'],
        exige_dupla_assinatura: true,
      }),
    )
  })

  it('a mensagem de "marque um cargo" some quando a pessoa marca um', async () => {
    const { u, grupo } = await abrirFormulario()
    await u.click(screen.getByRole('button', { name: 'Cadastrar alçada' }))
    await screen.findByText('Marque ao menos um cargo que pode aprovar.')
    await u.click(within(grupo).getByRole('checkbox', { name: 'Presidente' }))
    await waitFor(() =>
      expect(
        screen.queryByText('Marque ao menos um cargo que pode aprovar.'),
      ).toBeNull(),
    )
  })

  it('o formulário aberto passa no axe', async () => {
    const { container } = await abrirFormulario()
    expect(await axe(container)).toHaveNoViolations()
  })
})
