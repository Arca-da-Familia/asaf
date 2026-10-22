import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GeradosPeloSistema } from '@/components/documentos/GeradosPeloSistema'
import { ApiError } from '@/lib/api'
import { DocumentoDetalhePage } from '@/pages/DocumentoDetalhe'

import { relatorio } from './fabricas-despertai'

// v6.3b - as contas do exercício no site: só depois da aprovação em Assembleia; o documento é gerado dos lançamentos (ninguém digita).
vi.mock('@/lib/use-me', () => ({
  useMe: () => ({ data: { permissoes: ['documentos'] }, isLoading: false }),
}))
const documentos = vi.hoisted(() => ({
  situacaoDasContasNoSite: vi.fn(),
  prepararContasParaOSite: vi.fn(),
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
          <Route path="/documentos" element={<GeradosPeloSistema />} />
          <Route path="/documentos/:id" element={<DocumentoDetalhePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  documentos.listarDocumentos.mockResolvedValue([])
  documentos.listarHistoricoDoDocumento.mockResolvedValue([])
})

describe('Contas do exercício para o site', () => {
  it('sem a aprovação em Assembleia diz isso e mostra a recusa do servidor', async () => {
    const usuario = userEvent.setup()
    documentos.situacaoDasContasNoSite.mockResolvedValue({
      ano: new Date().getFullYear() - 1,
      aprovadas_pela_assembleia: false,
      aprovadas_em: null,
      lancamentos_registrados_depois: 0,
      documento: null,
    })
    documentos.prepararContasParaOSite.mockRejectedValue(
      new ApiError(409, 'As contas ainda não foram aprovadas pela Assembleia.'),
    )
    renderizar('/documentos')
    expect(await screen.findByRole('status')).toHaveTextContent(
      'ainda não foram aprovadas pela Assembleia',
    )
    await usuario.click(
      screen.getByRole('button', { name: 'Preparar as contas para o site' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'ainda não foram aprovadas pela Assembleia',
    )
  })

  it('aprovadas: prepara e abre o documento gerado, que não oferece texto nem arquivo', async () => {
    const usuario = userEvent.setup()
    documentos.situacaoDasContasNoSite.mockResolvedValue({
      ano: new Date().getFullYear() - 1,
      aprovadas_pela_assembleia: true,
      aprovadas_em: '2026-03-20',
      lancamentos_registrados_depois: 0,
      documento: null,
    })
    documentos.prepararContasParaOSite.mockResolvedValue({
      id_documento: 90,
      situacao: 'Rascunho',
      versao: 1,
    })
    documentos.obterDocumento.mockResolvedValue(
      relatorio({
        id_documento: 90,
        tipo: 'BALANCO',
        tipo_rotulo: 'Balanço / prestação de contas anual',
        titulo: 'Prestação de contas do exercício 2025',
        classificacao: 'Pública',
        situacao: 'Rascunho',
        pode_editar: true,
        tem_versao_publica: true,
        publico_formato: 'TEXTO',
        gerado_pelo_sistema: true,
      }),
    )
    renderizar('/documentos')
    expect(await screen.findByRole('status')).toHaveTextContent(
      'aprovadas pela Assembleia em 20/03/2026',
    )
    await usuario.click(
      screen.getByRole('button', { name: 'Preparar as contas para o site' }),
    )
    await waitFor(() =>
      expect(documentos.obterDocumento).toHaveBeenCalledWith(90),
    )
    expect(
      await screen.findByText(/montados dos dados do sistema/),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Enviar a versão pública (PDF)'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Ou cole o texto da versão pública'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Enviar o arquivo')).not.toBeInTheDocument()
    // a versão nova do gerado é só pela tela de origem
    expect(
      screen.queryByRole('button', { name: 'Criar nova versão' }),
    ).not.toBeInTheDocument()
  })

  it('com as contas já publicadas, abrir só abre; a versão nova pede confirmação; avisa os lançamentos de depois', async () => {
    const usuario = userEvent.setup()
    documentos.situacaoDasContasNoSite.mockResolvedValue({
      ano: new Date().getFullYear() - 1,
      aprovadas_pela_assembleia: true,
      aprovadas_em: '2026-03-20',
      lancamentos_registrados_depois: 2,
      documento: { id_documento: 90, situacao: 'Aprovado', versao: 1 },
    })
    documentos.prepararContasParaOSite.mockResolvedValue({
      id_documento: 91,
      situacao: 'Rascunho',
      versao: 2,
    })
    documentos.obterDocumento.mockResolvedValue(
      relatorio({ id_documento: 90, gerado_pelo_sistema: true }),
    )
    renderizar('/documentos')
    expect(
      await screen.findByText(
        /2 lançamentos deste exercício foram registrados/,
      ),
    ).toBeInTheDocument()
    await usuario.click(
      screen.getByRole('button', { name: 'Preparar uma versão nova' }),
    )
    expect(documentos.prepararContasParaOSite).not.toHaveBeenCalled()
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }))
    await usuario.click(
      screen.getByRole('button', { name: 'Abrir as contas deste exercício' }),
    )
    await waitFor(() =>
      expect(documentos.obterDocumento).toHaveBeenCalledWith(90),
    )
    expect(documentos.prepararContasParaOSite).not.toHaveBeenCalled()
  })

  it('a confirmação da versão nova prepara; a recusa por dado pessoal mostra o achado mascarado', async () => {
    const usuario = userEvent.setup()
    documentos.situacaoDasContasNoSite.mockResolvedValue({
      ano: new Date().getFullYear() - 1,
      aprovadas_pela_assembleia: true,
      aprovadas_em: '2026-03-20',
      lancamentos_registrados_depois: 0,
      documento: { id_documento: 90, situacao: 'Aprovado', versao: 1 },
    })
    documentos.prepararContasParaOSite.mockRejectedValue(
      new ApiError(
        422,
        'O texto gerado tem dado pessoal: corrija na origem.',
        [],
        undefined,
        {
          mensagem: 'O texto gerado tem dado pessoal: corrija na origem.',
          resultado: {
            ok: false,
            paginas: 1,
            caracteres: 300,
            bloqueios: [
              {
                codigo: 'CPF',
                mensagem: 'CPF no texto',
                pagina: 1,
                amostra: '529.***.***-25',
              },
            ],
            avisos: [],
          },
        },
      ),
    )
    renderizar('/documentos')
    await usuario.click(
      await screen.findByRole('button', { name: 'Preparar uma versão nova' }),
    )
    await usuario.click(
      screen.getByRole('button', { name: 'Confirmar a versão nova' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'corrija na origem',
    )
    expect(screen.getByText('529.***.***-25')).toBeInTheDocument()
    expect(documentos.prepararContasParaOSite).toHaveBeenCalledTimes(1)
  })
})
