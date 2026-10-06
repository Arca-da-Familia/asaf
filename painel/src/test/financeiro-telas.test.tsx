import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import { ComprasPage } from '@/pages/Compras'
import { DocumentosEmitidosPage } from '@/pages/DocumentosEmitidos'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  me: vi.fn(),
  listarDocumentosEmitidos: vi.fn(),
  listarEventos: vi.fn(),
  listarSolicitacoesCompra: vi.fn(),
  listarAprovacoesCompra: vi.fn(),
  listarCotacoesCompra: vi.fn(),
  listarFornecedores: vi.fn(),
  listarPlanoContas: vi.fn(),
}))

function desenhar(pagina: React.ReactNode) {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>{pagina}</MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('Documentos emitidos', () => {
  const documento = {
    id_documento: 7,
    id_template: 2,
    nome_template: 'Certificado de participação',
    numero_sequencial: 12,
    contexto_tipo: 'Evento',
    id_contexto: 5,
    titulo_contexto: 'Oficina de Teste',
    id_pessoa: 9,
    nome_pessoa: 'Maria de Teste',
    caminho_arquivo: '/uploads/documentos/abc123.pdf',
    emitida_em: '2026-10-06T15:20:00',
  }

  beforeEach(() => {
    vi.mocked(api.listarEventos).mockResolvedValue([
      { id_evento: 5, titulo: 'Oficina de Teste' } as Awaited<
        ReturnType<typeof api.listarEventos>
      >[number],
    ])
    vi.mocked(api.listarDocumentosEmitidos).mockResolvedValue([documento])
  })

  it('lista número, modelo, pessoa, evento e abre o PDF; passa no axe', async () => {
    const { container } = desenhar(<DocumentosEmitidosPage />)
    expect(
      await screen.findByText(/Nº 12 · Certificado de participação/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Maria de Teste · Oficina de Teste/),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir o PDF' })).toHaveAttribute(
      'href',
      expect.stringContaining('/uploads/documentos/abc123.pdf'),
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  it('filtra por evento (refaz a consulta com o evento escolhido)', async () => {
    const u = userEvent.setup()
    desenhar(<DocumentosEmitidosPage />)
    await screen.findByText(/Nº 12/)
    await u.selectOptions(screen.getByLabelText('Evento'), '5')
    await waitFor(() =>
      expect(api.listarDocumentosEmitidos).toHaveBeenLastCalledWith({
        contexto_tipo: 'Evento',
        id_contexto: 5,
      }),
    )
  })

  it('sem nada emitido, diz isso', async () => {
    vi.mocked(api.listarDocumentosEmitidos).mockResolvedValue([])
    desenhar(<DocumentosEmitidosPage />)
    expect(
      await screen.findByText('Nenhum documento emitido'),
    ).toBeInTheDocument()
  })
})

describe('Compras: trilha de aprovação', () => {
  const solicitacao = (id: number, status: string) => ({
    id_solicitacao: id,
    descricao: `Compra ${id}`,
    justificativa: null,
    id_fornecedor: null,
    valor_estimado: 850,
    id_conta_contabil: 1,
    id_centro_custo: null,
    status,
    id_usuario_solicitante: 1,
    motivo_reprovacao: null,
    id_titulo_gerado: null,
    data_solicitacao: '2026-10-06T15:00:00',
  })

  beforeEach(() => {
    vi.mocked(api.listarFornecedores).mockResolvedValue([])
    vi.mocked(api.listarPlanoContas).mockResolvedValue([])
    vi.mocked(api.listarCotacoesCompra).mockResolvedValue([])
    vi.mocked(api.listarAprovacoesCompra).mockResolvedValue([
      {
        id_aprovacao: 1,
        id_usuario_aprovador: 3,
        nome_aprovador: 'Fábio de Teste',
        id_delegacao_usada: null,
        data_aprovacao: '2026-10-06T15:10:00',
      },
      {
        id_aprovacao: 2,
        id_usuario_aprovador: 4,
        nome_aprovador: 'Ana de Teste',
        id_delegacao_usada: 8,
        data_aprovacao: '2026-10-06T15:20:00',
      },
    ])
  })

  it('depois de decidida, a solicitação mostra quem aprovou (pelo nome) e se foi por delegação', async () => {
    const u = userEvent.setup()
    vi.mocked(api.listarSolicitacoesCompra).mockResolvedValue([
      solicitacao(31, 'Aprovada'),
    ])
    desenhar(<ComprasPage />)
    await u.click(await screen.findByRole('button', { name: 'Ver aprovações' }))
    expect(await screen.findByText(/Fábio de Teste —/)).toBeInTheDocument()
    expect(
      screen.getByText(/Ana de Teste — .*\(por delegação\)/),
    ).toBeInTheDocument()
    expect(api.listarAprovacoesCompra).toHaveBeenCalledWith(31)
  })

  it('no painel de quem aprova a trilha também aparece, e sem aprovação diz que ainda não há', async () => {
    const u = userEvent.setup()
    vi.mocked(api.listarAprovacoesCompra).mockResolvedValue([])
    vi.mocked(api.listarSolicitacoesCompra).mockResolvedValue([
      solicitacao(32, 'Aguardando Aprovação'),
    ])
    desenhar(<ComprasPage />)
    await u.click(
      await screen.findByRole('button', { name: 'Cotações / Aprovar' }),
    )
    expect(
      await screen.findByText('Nenhuma aprovação ainda.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Ver aprovações' }),
    ).not.toBeInTheDocument()
  })
})
