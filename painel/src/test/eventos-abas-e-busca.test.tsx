import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EventosPage } from '@/pages/Eventos'

import {
  evento,
  renderizar,
  simularRedeSemResposta,
} from './fabricas-despertai'

// v9.3c (pedido do Presidente, 05/11: tela comprida vira "submenu"/tela progressiva): a tela de Eventos tinha 28 alturas de notebook. Agora a lista
// tem busca e páginas de 10, e o evento aberto mostra as 15 partes em 4 abas (Programação, Inscritos, Cobrança, Presença e certificado), com a aba no
// endereço (`&aba=pagamento`).

vi.mock('@/lib/use-me', () => ({
  useMe: () => ({
    data: {
      permissoes: [
        'projetos',
        'gerenciar_checkin_evento',
        'exportar_presencas_evento',
        'exportar_inscricoes_evento',
      ],
    },
    isLoading: false,
  }),
}))

const api = vi.hoisted(() => ({
  listarEventos: vi.fn(),
  listarProjetos: vi.fn(),
  listarOpcoesCatalogo: vi.fn(),
  listarEspacos: vi.fn(),
  listarAssociados: vi.fn(),
  listarFotosDoEvento: vi.fn(),
  apiFetchBlob: vi.fn(),
}))
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  ...api,
}))

const documentos = vi.hoisted(() => ({ listarDocumentos: vi.fn() }))
vi.mock('@/lib/documentos', async (original) => ({
  ...(await original<typeof import('@/lib/documentos')>()),
  ...documentos,
}))

// 23 eventos, o nº 23 primeiro (o servidor manda o mais recente primeiro)
const muitos = Array.from({ length: 23 }, (_, i) =>
  evento({
    id_evento: 23 - i,
    titulo: i === 5 ? 'Encontro de Família' : `Palestra ${23 - i}`,
  }),
)

beforeEach(() => {
  vi.clearAllMocks()
  simularRedeSemResposta()
  api.listarEventos.mockResolvedValue(muitos)
  api.listarProjetos.mockResolvedValue([])
  api.listarOpcoesCatalogo.mockResolvedValue([])
  api.listarEspacos.mockResolvedValue([])
  api.listarAssociados.mockResolvedValue([])
  api.listarFotosDoEvento.mockResolvedValue([])
  documentos.listarDocumentos.mockResolvedValue([])
})

function linhasDaLista(): HTMLElement[] {
  return screen
    .getAllByRole('button')
    .filter((b) => b.hasAttribute('aria-pressed'))
}

describe('lista de eventos com busca e páginas', () => {
  it('mostra 10 por página e passa para a seguinte', async () => {
    const user = userEvent.setup()
    renderizar(<EventosPage />, '/eventos')
    expect(await screen.findByText('Palestra 23')).toBeInTheDocument()
    expect(linhasDaLista()).toHaveLength(10)
    expect(screen.getByText(/Página 1 de 3 · 23 itens/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Próxima/ }))
    expect(await screen.findByText('Palestra 13')).toBeInTheDocument()
    expect(screen.queryByText('Palestra 23')).not.toBeInTheDocument()
  })

  it('procura pelo título sem ligar para acento e maiúscula, e pelo número', async () => {
    const user = userEvent.setup()
    renderizar(<EventosPage />, '/eventos')
    const campo = await screen.findByLabelText('Procurar evento')
    await user.type(campo, 'familia')
    expect(linhasDaLista()).toHaveLength(1)
    expect(screen.getByText('Encontro de Família')).toBeInTheDocument()
    expect(screen.getByText('1 evento encontrado.')).toBeInTheDocument()
    await user.clear(campo)
    await user.type(campo, 'nº 3')
    expect(linhasDaLista()).toHaveLength(1)
    expect(screen.getByText('Palestra 3')).toBeInTheDocument()
    await user.clear(campo)
    await user.type(campo, 'nada disso')
    expect(
      screen.getByText('Nenhum evento com esse título ou número.'),
    ).toBeInTheDocument()
  })

  it('o evento pedido no endereço abre, e a lista vai à página onde ele está', async () => {
    renderizar(<EventosPage />, '/eventos?evento=2')
    expect(
      await screen.findByRole('heading', { name: 'Palestra 2', level: 2 }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Página 3 de 3/)).toBeInTheDocument()
    expect(
      linhasDaLista().find((l) => l.getAttribute('aria-pressed') === 'true'),
    ).toHaveTextContent('Palestra 2')
  })
})

describe('as partes do evento em abas', () => {
  it('abre na Programação; a Cobrança mostra só as partes dela', async () => {
    const user = userEvent.setup()
    renderizar(<EventosPage />, '/eventos?evento=23')
    const abas = await screen.findByRole('tablist', {
      name: 'Partes do evento',
    })
    expect(
      within(abas)
        .getAllByRole('tab')
        .map((a) => a.textContent),
    ).toEqual([
      'Programação',
      'Inscritos',
      'Cobrança',
      'Presença e certificado',
    ])
    expect(
      screen.getByRole('tab', { name: 'Programação', selected: true }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /Programação \(sessões/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Cobrança de inscrição' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Cobrança' }))
    expect(
      screen.getByRole('heading', { name: 'Cobrança de inscrição' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Fechamento financeiro' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: /Programação \(sessões/ }),
    ).not.toBeInTheDocument()
  })

  it('a aba do endereço abre direto; setas do teclado andam entre as abas', async () => {
    const user = userEvent.setup()
    renderizar(<EventosPage />, '/eventos?evento=23&aba=presenca')
    const presenca = await screen.findByRole('tab', {
      name: 'Presença e certificado',
      selected: true,
    })
    expect(
      screen.getByRole('heading', { name: /Portaria \(check-in/ }),
    ).toBeInTheDocument()
    presenca.focus()
    await user.keyboard('{ArrowRight}')
    expect(
      screen.getByRole('tab', { name: 'Programação', selected: true }),
    ).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(
      screen.getByRole('tab', {
        name: 'Presença e certificado',
        selected: true,
      }),
    ).toHaveFocus()
  })

  it('a tela com as abas passa no axe', async () => {
    const { container } = renderizar(
      <EventosPage />,
      '/eventos?evento=23&aba=inscritos',
    )
    await screen.findByRole('tab', { name: 'Inscritos', selected: true })
    expect(await axe(container)).toHaveNoViolations()
  })
})
