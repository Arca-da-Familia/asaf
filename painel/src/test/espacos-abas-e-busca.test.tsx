import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Espaco } from '@/lib/api'
import { EspacosPage } from '@/pages/Espacos'

import { renderizar, simularRedeSemResposta } from './fabricas-despertai'

// v9.3d (pedido do Presidente, 05/11: tela comprida vira "submenu"/tela progressiva): a Reserva de Espaço tinha 20 alturas de notebook. Agora o
// mapa de ocupação fica numa aba própria (`?aba=mapa`) e a lista de espaços tem busca e páginas de 10, com cada espaço operável pelo teclado.

vi.mock('@/lib/use-me', () => ({
  useMe: () => ({ data: { permissoes: ['projetos'] }, isLoading: false }),
}))

const api = vi.hoisted(() => ({
  listarEspacos: vi.fn(),
  obterOcupacaoMapaCalorEspacos: vi.fn(),
  listarOpcoesCatalogo: vi.fn(),
  listarPlanoContas: vi.fn(),
  listarAssociados: vi.fn(),
}))
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  ...api,
}))

function espaco(id: number, nome: string, tipo = 'Sala'): Espaco {
  return {
    id_espaco: id,
    nome,
    tipo,
    capacidade: null,
    recursos_disponiveis: null,
    regras_uso: null,
    horario_funcionamento_inicio: null,
    horario_funcionamento_fim: null,
    exige_aprovacao: false,
    valor_reserva: null,
    isento_para_associado_adimplente: false,
    id_conta_contabil_receita: null,
    prazo_cancelamento_horas: 24,
    taxa_cancelamento_tardio: null,
    limite_no_show_bloqueio: null,
    ativo: true,
  }
}

// 14 espaços em ordem de nome (como o servidor manda); um deles é um Auditório
const espacos = [
  espaco(1, 'Auditório Central', 'Auditório'),
  ...Array.from({ length: 13 }, (_, i) =>
    espaco(i + 2, `Sala ${String(i + 1).padStart(2, '0')}`),
  ),
]

beforeEach(() => {
  vi.clearAllMocks()
  simularRedeSemResposta()
  api.listarEspacos.mockResolvedValue(espacos)
  api.obterOcupacaoMapaCalorEspacos.mockResolvedValue([])
  api.listarOpcoesCatalogo.mockResolvedValue([])
  api.listarPlanoContas.mockResolvedValue([])
  api.listarAssociados.mockResolvedValue([])
})

const itens = () =>
  screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'))

describe('Reserva de Espaço em abas, com a lista em páginas', () => {
  it('abre na aba Espaços com 10 por página; o mapa fica na outra aba', async () => {
    const user = userEvent.setup()
    renderizar(<EspacosPage />, '/reserva-espaco')
    expect(await screen.findByText('Auditório Central')).toBeInTheDocument()
    expect(itens()).toHaveLength(10)
    expect(screen.getByText(/Página 1 de 2 · 14 itens/)).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Mapa de calor de ocupação' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Mapa de ocupação' }))
    expect(
      screen.getByRole('heading', { name: 'Mapa de calor de ocupação' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Espaços', level: 2 }),
    ).not.toBeInTheDocument()
  })

  it('a aba do endereço abre direto', async () => {
    renderizar(<EspacosPage />, '/reserva-espaco?aba=mapa')
    expect(
      await screen.findByRole('tab', {
        name: 'Mapa de ocupação',
        selected: true,
      }),
    ).toBeInTheDocument()
  })

  it('procura pelo nome ou pelo tipo, sem ligar para acento', async () => {
    const user = userEvent.setup()
    renderizar(<EspacosPage />, '/reserva-espaco')
    const campo = await screen.findByLabelText('Procurar espaço')
    await user.type(campo, 'auditorio')
    expect(itens()).toHaveLength(1)
    expect(screen.getByText('1 espaço encontrado.')).toBeInTheDocument()
    await user.clear(campo)
    await user.type(campo, 'sala 13')
    expect(itens()).toHaveLength(1)
    await user.clear(campo)
    await user.type(campo, 'quadra')
    expect(
      screen.getByText('Nenhum espaço com esse nome ou tipo.'),
    ).toBeInTheDocument()
  })

  it('o espaço se abre pelo teclado (Enter), como um botão', async () => {
    const user = userEvent.setup()
    renderizar(<EspacosPage />, '/reserva-espaco')
    await screen.findByText('Auditório Central')
    const primeiro = itens()[0]!
    primeiro.focus()
    await user.keyboard('{Enter}')
    expect(primeiro).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('heading', { name: 'Auditório Central', level: 2 }),
    ).toBeInTheDocument()
  })

  it('a tela passa no axe', async () => {
    const { container } = renderizar(<EspacosPage />, '/reserva-espaco')
    await screen.findByText('Auditório Central')
    expect(await axe(container)).toHaveNoViolations()
  })
})
