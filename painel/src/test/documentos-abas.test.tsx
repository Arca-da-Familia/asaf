import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DocumentosPage } from '@/pages/Documentos'

import { relatorio } from './fabricas-despertai'

// v9.3u (a tela tinha 10,1 alturas de notebook na homologação): cada tipo mostra os 5 primeiros e "Ver todos"; com o tipo escolhido, páginas de
// 10; as contas do exercício e o relatório anual ficam em abas ao lado da biblioteca (só para quem prepara documentos).
const permissoes = vi.hoisted(() => ({
  atuais: ['documentos'] as string[],
}))
vi.mock('@/lib/use-me', () => ({
  useMe: () => ({ data: { permissoes: permissoes.atuais }, isLoading: false }),
}))
const documentos = vi.hoisted(() => ({
  listarTiposDeDocumento: vi.fn(),
  listarDocumentos: vi.fn(),
}))
vi.mock('@/lib/documentos', async (original) => ({
  ...(await original<typeof import('@/lib/documentos')>()),
  ...documentos,
}))
// os dois blocos de cima têm os próprios testes (contas-no-site e relatorio-anual): aqui basta saber em que aba aparecem
vi.mock('@/components/documentos/GeradosPeloSistema', () => ({
  GeradosPeloSistema: () => <p>bloco das contas do exercício</p>,
}))
vi.mock('@/components/documentos/RelatorioAnualParaOSite', () => ({
  RelatorioAnualParaOSite: () => <p>bloco do relatório anual</p>,
}))

function Endereco() {
  const local = useLocation()
  return <p data-testid="endereco">{local.search}</p>
}

function renderizar(caminho = '/documentos') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[caminho]}>
        <Routes>
          <Route
            path="/documentos"
            element={
              <>
                <DocumentosPage />
                <Endereco />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const ATAS = Array.from({ length: 13 }, (_, i) =>
  relatorio({
    id_documento: 100 + i,
    titulo: `Ata ${String(i + 1).padStart(2, '0')}`,
    tipo: 'ATA',
    tipo_rotulo: 'Ata',
    vinculo_tipo: null,
    vinculo_id: null,
  }),
)
const RELATORIOS = [
  relatorio({ id_documento: 7, titulo: 'Relatório do bazar' }),
]

beforeEach(() => {
  vi.clearAllMocks()
  permissoes.atuais = ['documentos']
  documentos.listarTiposDeDocumento.mockResolvedValue({
    tipos: [
      { codigo: 'ATA', rotulo: 'Ata' },
      {
        codigo: 'RELATORIO_EVENTO',
        rotulo: 'Relatório de evento ou de projeto',
      },
    ],
    classificacoes: ['Pública', 'Interna', 'Restrita'],
    situacoes: ['Rascunho', 'Em revisão', 'Aprovado', 'Retirado'],
    vinculos: ['evento', 'projeto'],
  })
  documentos.listarDocumentos.mockImplementation((filtros: { tipo?: string }) =>
    Promise.resolve(
      filtros.tipo === 'ATA'
        ? ATAS
        : filtros.tipo
          ? RELATORIOS
          : [...ATAS, ...RELATORIOS],
    ),
  )
})

const linhas = () =>
  screen
    .getAllByRole('link')
    .map((l) => l.textContent)
    .filter((t) => t?.startsWith('Ata '))

describe('Documentos: biblioteca mais curta e partes em abas', () => {
  it('cada tipo mostra os 5 primeiros e o botão "Ver todos"', async () => {
    renderizar()
    await screen.findByText('Ata 01')
    expect(linhas()).toEqual(['Ata 01', 'Ata 02', 'Ata 03', 'Ata 04', 'Ata 05'])
    expect(
      screen.getByRole('button', { name: 'Ver todos os 13 (Ata)' }),
    ).toBeInTheDocument()
    // o tipo com 1 documento não tem o botão
    expect(screen.getByText('Relatório do bazar')).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: /^Ver todos os/ }),
    ).toHaveLength(1)
  })

  it('"Ver todos" escolhe o tipo: a lista dele em páginas de 10, e "Ver todos os tipos" volta', async () => {
    const u = userEvent.setup()
    renderizar()
    await u.click(
      await screen.findByRole('button', { name: 'Ver todos os 13 (Ata)' }),
    )
    await waitFor(() =>
      expect(documentos.listarDocumentos).toHaveBeenLastCalledWith(
        expect.objectContaining({ tipo: 'ATA' }),
      ),
    )
    expect(screen.getByLabelText('Tipo')).toHaveValue('ATA')
    await waitFor(() => expect(linhas()).toHaveLength(10))
    const paginas = within(
      screen.getByRole('navigation', { name: 'Páginas dos documentos' }),
    )
    await u.click(paginas.getByRole('button', { name: 'Próxima página' }))
    expect(linhas()).toEqual(['Ata 11', 'Ata 12', 'Ata 13'])
    await u.click(screen.getByRole('button', { name: 'Ver todos os tipos' }))
    await waitFor(() => expect(screen.getByLabelText('Tipo')).toHaveValue(''))
    expect(await screen.findByText('Relatório do bazar')).toBeInTheDocument()
  })

  it('quem prepara documentos vê as abas; as contas e o relatório anual vão para o endereço', async () => {
    const u = userEvent.setup()
    renderizar()
    expect(
      await screen.findByRole('tab', { name: 'Biblioteca' }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText('bloco das contas do exercício')).toBeNull()
    await u.click(screen.getByRole('tab', { name: 'Contas do exercício' }))
    expect(
      screen.getByText('bloco das contas do exercício'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('endereco')).toHaveTextContent('parte=contas')
    await u.click(screen.getByRole('tab', { name: 'Relatório anual' }))
    expect(screen.getByText('bloco do relatório anual')).toBeInTheDocument()
    expect(screen.getByTestId('endereco')).toHaveTextContent('parte=relatorio')
  })

  it('o endereço com ?parte=relatorio abre direto no relatório anual', async () => {
    renderizar('/documentos?parte=relatorio')
    expect(
      await screen.findByText('bloco do relatório anual'),
    ).toBeInTheDocument()
  })

  it('quem só consulta não vê abas nem os blocos de preparar (e ?parte= é ignorado)', async () => {
    permissoes.atuais = ['documentos_consultar']
    renderizar('/documentos?parte=contas')
    await screen.findByText('Ata 01')
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByText('bloco das contas do exercício')).toBeNull()
  })

  it('sem violação de acessibilidade', async () => {
    const { container } = renderizar()
    await screen.findByText('Ata 01')
    expect(await axe(container)).toHaveNoViolations()
  })
})
