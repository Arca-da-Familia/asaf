import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DocumentoDetalhePage } from '@/pages/DocumentoDetalhe'
import { DocumentoNovoPage } from '@/pages/DocumentoNovo'
import { DocumentosPage } from '@/pages/Documentos'

import { relatorio } from './fabricas-despertai'

// Despertai e o contexto do evento (v5.5) - lado dos DOCUMENTOS: o cadastro abre já com o tipo e o vínculo preenchidos
// (botão "Novo relatório deste evento"), o vínculo é visível e editável, e a biblioteca mostra a que o documento pertence.

const permissoes = vi.hoisted(() => ({
  atuais: ['documentos', 'projetos'] as string[],
}))
vi.mock('@/lib/use-me', () => ({
  useMe: () => ({ data: { permissoes: permissoes.atuais }, isLoading: false }),
}))

const documentos = vi.hoisted(() => ({
  listarTiposDeDocumento: vi.fn(),
  listarDocumentos: vi.fn(),
  obterDocumento: vi.fn(),
  listarHistoricoDoDocumento: vi.fn(),
  criarDocumento: vi.fn(),
}))
vi.mock('@/lib/documentos', async (original) => ({
  ...(await original<typeof import('@/lib/documentos')>()),
  ...documentos,
}))

function renderizar(caminhoInicial: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[caminhoInicial]}>
        <Routes>
          <Route path="/documentos" element={<DocumentosPage />} />
          <Route path="/documentos/novo" element={<DocumentoNovoPage />} />
          <Route path="/documentos/:id" element={<DocumentoDetalhePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const NOVO_DO_EVENTO =
  '/documentos/novo?tipo=RELATORIO_EVENTO&vinculo_tipo=evento&vinculo_id=12'

beforeEach(() => {
  vi.clearAllMocks()
  permissoes.atuais = ['documentos', 'projetos']
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
    vinculos: [
      'ata',
      'estatuto',
      'parceria',
      'projeto',
      'evento',
      'assembleia',
    ],
  })
  documentos.criarDocumento.mockResolvedValue(relatorio({ id_documento: 55 }))
  documentos.listarDocumentos.mockResolvedValue([
    relatorio(),
    relatorio({
      id_documento: 6,
      titulo: 'Ata solta',
      tipo: 'ATA',
      tipo_rotulo: 'Ata',
      vinculo_tipo: null,
      vinculo_id: null,
    }),
  ])
  documentos.obterDocumento.mockResolvedValue(relatorio())
  documentos.listarHistoricoDoDocumento.mockResolvedValue([])
})

describe('novo documento já ligado a um evento', () => {
  async function abrir(caminho = NOVO_DO_EVENTO) {
    const usuario = userEvent.setup()
    const resultado = renderizar(caminho)
    await screen.findByRole('option', {
      name: 'Relatório de evento ou de projeto',
    })
    return { usuario, ...resultado }
  }

  it('abre com o tipo "Relatório de evento ou de projeto" e o vínculo preenchidos, dizendo a que pertence', async () => {
    await abrir()
    expect(screen.getByLabelText('Tipo de documento')).toHaveValue(
      'RELATORIO_EVENTO',
    )
    expect(screen.getByLabelText('Pertence a')).toHaveValue('evento')
    expect(screen.getByLabelText('Número')).toHaveValue(12)
    expect(
      screen.getByText('Este documento pertence ao evento nº 12.'),
    ).toBeInTheDocument()
  })

  it('o vínculo é editável: trocar para projeto ou tirar muda a frase', async () => {
    const { usuario } = await abrir()
    await usuario.selectOptions(screen.getByLabelText('Pertence a'), 'projeto')
    const numero = screen.getByLabelText('Número')
    await usuario.clear(numero)
    await usuario.type(numero, '3')
    expect(
      screen.getByText('Este documento pertence ao projeto nº 3.'),
    ).toBeInTheDocument()

    await usuario.selectOptions(screen.getByLabelText('Pertence a'), '')
    await usuario.clear(numero)
    expect(
      screen.queryByText(/Este documento pertence/),
    ).not.toBeInTheDocument()
  })

  it('cadastra enviando o tipo e o vínculo, e abre o documento criado', async () => {
    const { usuario } = await abrir()
    await usuario.type(
      screen.getByLabelText('Título'),
      'Relatório da 1ª edição do Despertai',
    )
    await usuario.click(
      screen.getByRole('button', { name: 'Cadastrar documento' }),
    )
    await waitFor(() =>
      expect(documentos.criarDocumento).toHaveBeenCalledTimes(1),
    )
    const [dados] = documentos.criarDocumento.mock.calls[0]!
    expect(dados).toMatchObject({
      tipo: 'RELATORIO_EVENTO',
      titulo: 'Relatório da 1ª edição do Despertai',
      vinculo_tipo: 'evento',
      vinculo_id: '12',
    })
    // foi para a tela do documento novo
    await waitFor(() =>
      expect(documentos.obterDocumento).toHaveBeenCalledWith(55),
    )
  })

  it('sem o endereço especial abre como sempre: tipo Ata e sem vínculo', async () => {
    const { usuario } = await abrir('/documentos/novo')
    expect(screen.getByLabelText('Tipo de documento')).toHaveValue('ATA')
    expect(screen.getByLabelText('Pertence a')).toHaveValue('')
    expect(screen.getByLabelText('Número')).toHaveValue(null)
    expect(
      screen.queryByText(/Este documento pertence/),
    ).not.toBeInTheDocument()
    await usuario.type(screen.getByLabelText('Título'), 'Ata de reunião')
    await usuario.click(
      screen.getByRole('button', { name: 'Cadastrar documento' }),
    )
    await waitFor(() =>
      expect(documentos.criarDocumento).toHaveBeenCalledTimes(1),
    )
    expect(documentos.criarDocumento.mock.calls[0]![0].vinculo_tipo).toBeFalsy()
  })

  it('outro vínculo do endereço (ex.: parceria) aparece e é entendido; número inválido do endereço é ignorado', async () => {
    await abrir(
      '/documentos/novo?tipo=RELATORIO_EVENTO&vinculo_tipo=parceria&vinculo_id=7',
    )
    expect(screen.getByLabelText('Pertence a')).toHaveValue('parceria')
    expect(
      screen.getByText('Este documento pertence à parceria nº 7.'),
    ).toBeInTheDocument()
  })

  it('número que não é número no endereço não é aceito', async () => {
    await abrir(
      '/documentos/novo?tipo=RELATORIO_EVENTO&vinculo_tipo=evento&vinculo_id=abc',
    )
    expect(screen.getByLabelText('Número')).toHaveValue(null)
    expect(
      screen.queryByText(/Este documento pertence/),
    ).not.toBeInTheDocument()
  })

  it('não cadastra com o tipo de vínculo sem o número, nem com o número sem o tipo', async () => {
    const { usuario } = await abrir('/documentos/novo')
    await usuario.type(screen.getByLabelText('Título'), 'Relatório sem ligação')
    await usuario.selectOptions(screen.getByLabelText('Pertence a'), 'evento')
    await usuario.click(
      screen.getByRole('button', { name: 'Cadastrar documento' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Informe o número do evento ou do projeto/,
    )

    await usuario.selectOptions(screen.getByLabelText('Pertence a'), '')
    await usuario.type(screen.getByLabelText('Número'), '12')
    await usuario.click(
      screen.getByRole('button', { name: 'Cadastrar documento' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Escolha a que o documento pertence/,
    )
    expect(documentos.criarDocumento).not.toHaveBeenCalled()
  })

  it('sem violação de acessibilidade', async () => {
    const { container } = await abrir()
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('biblioteca e documento mostram a que ele pertence', () => {
  it('a lista mostra "Evento nº 12" no documento ligado e nada no solto', async () => {
    renderizar('/documentos')
    expect(await screen.findByText('Evento nº 12')).toBeInTheDocument()
    expect(screen.getAllByText(/nº \d+/)).toHaveLength(1)
  })

  it('o documento ligado a evento leva ao evento (para quem gerencia projetos)', async () => {
    renderizar('/documentos/5')
    const link = await screen.findByRole('link', { name: 'Evento nº 12' })
    expect(link).toHaveAttribute('href', '/eventos?evento=12')
    expect(screen.getByText('Pertence a')).toBeInTheDocument()
  })

  it('documento ligado a projeto leva ao projeto', async () => {
    documentos.obterDocumento.mockResolvedValue(
      relatorio({ vinculo_tipo: 'projeto', vinculo_id: 3 }),
    )
    renderizar('/documentos/5')
    expect(
      await screen.findByRole('link', { name: 'Projeto nº 3' }),
    ).toHaveAttribute('href', '/projetos?projeto=3')
  })

  it('quem não gerencia projetos vê o vínculo como texto, sem link para uma tela que não abre', async () => {
    permissoes.atuais = ['documentos']
    renderizar('/documentos/5')
    expect(await screen.findByText('Evento nº 12')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Evento nº 12' }),
    ).not.toBeInTheDocument()
  })
})
