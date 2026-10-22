import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RelatorioAnualParaOSite } from '@/components/documentos/RelatorioAnualParaOSite'
import { DocumentoDetalhePage } from '@/pages/DocumentoDetalhe'

import { relatorio } from './fabricas-despertai'

// v6.3c - o relatório anual: o sistema monta os números, a secretaria escreve a apresentação, outra pessoa aprova. Só de ano encerrado.
vi.mock('@/lib/use-me', () => ({
  useMe: () => ({ data: { permissoes: ['documentos'] }, isLoading: false }),
}))
const documentos = vi.hoisted(() => ({
  situacaoDoRelatorioAnual: vi.fn(),
  prepararRelatorioAnual: vi.fn(),
  gravarApresentacaoDoRelatorio: vi.fn(),
  obterDocumento: vi.fn(),
  listarDocumentos: vi.fn(),
  listarHistoricoDoDocumento: vi.fn(),
}))
vi.mock('@/lib/documentos', async (original) => ({
  ...(await original<typeof import('@/lib/documentos')>()),
  ...documentos,
}))

function renderizar(inicio: string) {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[inicio]}>
        <Routes>
          <Route path="/documentos" element={<RelatorioAnualParaOSite />} />
          <Route path="/documentos/:id" element={<DocumentoDetalhePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const ANO = new Date().getFullYear() - 1
const documentoDoRelatorio = (extra: Record<string, unknown> = {}) =>
  relatorio({
    id_documento: 70,
    tipo: 'RELATORIO_ANUAL',
    tipo_rotulo: 'Relatório anual de atividades',
    titulo: `Relatório anual de atividades ${ANO}`,
    classificacao: 'Pública',
    situacao: 'Rascunho',
    ano: ANO,
    pode_editar: true,
    tem_versao_publica: true,
    publico_formato: 'TEXTO',
    gerado_pelo_sistema: true,
    apresentacao: '',
    ...extra,
  })

beforeEach(() => {
  vi.clearAllMocks()
  documentos.listarDocumentos.mockResolvedValue([])
  documentos.listarHistoricoDoDocumento.mockResolvedValue([])
})

describe('Relatório anual de atividades', () => {
  it('ano que ainda não acabou: diz isso e não deixa montar', async () => {
    documentos.situacaoDoRelatorioAnual.mockResolvedValue({
      ano: ANO,
      ano_encerrado: false,
      primeiro_ano: 2020,
      registros_desde: '2020-03-01',
      documento: null,
    })
    renderizar('/documentos')
    expect(await screen.findByRole('status')).toHaveTextContent(
      'ainda não acabou',
    )
    expect(
      screen.getByRole('button', { name: 'Montar o relatório do ano' }),
    ).toBeDisabled()
  })

  it('ano anterior ao sistema: diz desde quando há registros e não deixa montar', async () => {
    documentos.situacaoDoRelatorioAnual.mockResolvedValue({
      ano: ANO,
      ano_encerrado: true,
      primeiro_ano: ANO + 1,
      registros_desde: `${ANO + 1}-03-01`,
      documento: null,
    })
    renderizar('/documentos')
    expect(await screen.findByRole('status')).toHaveTextContent(
      `só tem registros desde 01/03/${ANO + 1}`,
    )
    expect(
      screen.getByRole('button', { name: 'Montar o relatório do ano' }),
    ).toBeDisabled()
  })

  it('monta, abre o documento e a apresentação é a única parte escrita (salva com o ano)', async () => {
    const usuario = userEvent.setup()
    documentos.situacaoDoRelatorioAnual.mockResolvedValue({
      ano: ANO,
      ano_encerrado: true,
      primeiro_ano: 2020,
      registros_desde: '2020-03-01',
      documento: null,
    })
    documentos.prepararRelatorioAnual.mockResolvedValue({
      id_documento: 70,
      situacao: 'Rascunho',
      versao: 1,
    })
    documentos.obterDocumento.mockResolvedValue(documentoDoRelatorio())
    documentos.gravarApresentacaoDoRelatorio.mockResolvedValue({
      id_documento: 70,
      situacao: 'Rascunho',
      versao: 1,
    })
    renderizar('/documentos')
    await usuario.click(
      await screen.findByRole('button', { name: 'Montar o relatório do ano' }),
    )
    const campo = await screen.findByLabelText(/^Apresentação da diretoria/)
    expect(
      screen.queryByText('Ou cole o texto da versão pública'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Enviar a versão pública (PDF)'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Criar nova versão' }),
    ).not.toBeInTheDocument()
    const salvar = screen.getByRole('button', {
      name: 'Salvar a apresentação',
    })
    expect(salvar).toBeDisabled() // menos de 40 caracteres
    const texto =
      'O ano foi de muito trabalho nas oficinas e nos eventos com a comunidade.'
    await usuario.type(campo, texto)
    // alterada e não salva: avisa e não deixa enviar para revisão (iria a versão antiga)
    expect(screen.getByText(/alteração ainda não salva/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Enviar para revisão' }),
    ).toBeDisabled()
    await usuario.click(salvar)
    await waitFor(() =>
      expect(documentos.gravarApresentacaoDoRelatorio).toHaveBeenCalledWith(
        ANO,
        texto,
      ),
    )
  })

  it('a apresentação já gravada chega preenchida; publicado, abrir só abre e a versão nova pede confirmação', async () => {
    const usuario = userEvent.setup()
    documentos.situacaoDoRelatorioAnual.mockResolvedValue({
      ano: ANO,
      ano_encerrado: true,
      primeiro_ano: 2020,
      registros_desde: '2020-03-01',
      documento: { id_documento: 70, situacao: 'Aprovado', versao: 1 },
    })
    documentos.obterDocumento.mockResolvedValue(
      documentoDoRelatorio({
        situacao: 'Aprovado',
        pode_editar: false,
        apresentacao: 'A apresentação que foi aprovada e publicada no site.',
      }),
    )
    renderizar('/documentos')
    await usuario.click(
      await screen.findByRole('button', {
        name: 'Preparar uma versão nova do relatório',
      }),
    )
    expect(documentos.prepararRelatorioAnual).not.toHaveBeenCalled()
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }))
    await usuario.click(
      screen.getByRole('button', { name: 'Abrir o relatório deste ano' }),
    )
    expect(
      await screen.findByText(
        'A apresentação que foi aprovada e publicada no site.',
      ),
    ).toBeInTheDocument()
    expect(documentos.prepararRelatorioAnual).not.toHaveBeenCalled()
  })
})
