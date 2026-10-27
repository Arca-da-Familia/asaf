import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/api'
import { modulos } from '@/lib/modulos'
import * as privacidade from '@/lib/privacidade'
import { EncarregadoPage } from '@/pages/Encarregado'

vi.mock('@/lib/privacidade', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/privacidade')>()),
  obterSituacaoDoEncarregado: vi.fn(),
  gerarAtoDoEncarregado: vi.fn(),
  registrarAssinaturaDoAto: vi.fn(),
  abrirPdfDoAto: vi.fn(),
  baixarCopiaAssinada: vi.fn(),
}))

const presidente: privacidade.PessoaDoMandato = {
  id_associado: 1,
  nome: 'Maria Presidente',
  cargo: 'Presidente',
  mandato_inicio: '2026-02-10',
  mandato_fim: '2030-02-09',
}
const vice: privacidade.PessoaDoMandato = {
  id_associado: 2,
  nome: 'João Vice',
  cargo: '1º Vice-Presidente',
  mandato_inicio: '2026-02-10',
  mandato_fim: '2030-02-09',
}

const ato = (
  extra: Partial<privacidade.AtoDoEncarregado> = {},
): privacidade.AtoDoEncarregado => ({
  id_ato: 7,
  numero: 3,
  situacao: 'Aguardando assinatura',
  texto: 'ATO Nº 3 — DESIGNAÇÃO DO ENCARREGADO',
  nome_encarregado: presidente.nome,
  nome_substituto: vice.nome,
  cargo_substituto: vice.cargo,
  gerado_em: '2026-10-23T15:00:00',
  assinatura_registrada_em: null,
  tem_copia_assinada: false,
  assinado_nome_arquivo: null,
  encerrado_em: null,
  ...extra,
})

const situacao = (
  extra: Partial<privacidade.SituacaoDoEncarregado> = {},
): privacidade.SituacaoDoEncarregado => ({
  encarregado: presidente,
  substituto: vice,
  ato_vigente: null,
  rascunho: null,
  historico: [],
  avisos: [],
  pode_gerir: true,
  ...extra,
})

function desenhar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <EncarregadoPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.resetAllMocks())

describe('Encarregado de dados (v7.0a)', () => {
  it('o módulo Privacidade só aparece para quem tem `privacidade`', () => {
    const modulo = modulos.find((m) => m.rota === '/privacidade')
    expect(modulo?.permissao).toBe('privacidade')
    expect(modulo?.itens?.map((i) => i.rotulo)).toEqual([
      'Encarregado',
      'Inventário de dados',
      'Relatório de impacto',
      'Avisos de privacidade',
    ])
  })

  it('sem mandato de Presidente: mostra o aviso e não deixa gerar; passa no axe', async () => {
    vi.mocked(privacidade.obterSituacaoDoEncarregado).mockResolvedValue(
      situacao({
        encarregado: null,
        substituto: null,
        avisos: [
          {
            codigo: 'SEM_PRESIDENTE',
            texto: 'Não há mandato vigente de Presidente cadastrado.',
          },
        ],
      }),
    )
    const { container } = desenhar()
    expect(
      await screen.findByText(
        'Não há mandato vigente de Presidente cadastrado.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Sem mandato vigente de Presidente cadastrado.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Gerar o ato de designação' }),
    ).toBeDisabled()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('gerar mostra o ato aguardando assinatura; o botão diz que gerar de novo descarta o não assinado', async () => {
    vi.mocked(privacidade.obterSituacaoDoEncarregado).mockResolvedValue(
      situacao(),
    )
    vi.mocked(privacidade.gerarAtoDoEncarregado).mockResolvedValue(
      situacao({ rascunho: ato(), historico: [ato()] }),
    )
    desenhar()
    expect(await screen.findByTestId('encarregado-de-hoje')).toHaveTextContent(
      'Maria Presidente',
    )
    expect(screen.getByTestId('substituto-de-hoje')).toHaveTextContent(
      'João Vice',
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Gerar o ato de designação' }),
    )
    const quadro = await screen.findByTestId('ato-aguardando-assinatura')
    expect(within(quadro).getByText('Ato nº 3')).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'Gerar de novo (descarta o Ato nº 3, ainda não assinado)',
      }),
    ).toBeInTheDocument()
  })

  it('registrar a assinatura só com o arquivo escolhido; o erro do servidor aparece', async () => {
    vi.mocked(privacidade.obterSituacaoDoEncarregado).mockResolvedValue(
      situacao({ rascunho: ato() }),
    )
    vi.mocked(privacidade.registrarAssinaturaDoAto)
      .mockRejectedValueOnce(
        new ApiError(
          409,
          'O substituto mudou desde que o Ato nº 3 foi gerado.',
        ),
      )
      .mockResolvedValueOnce(
        situacao({
          ato_vigente: ato({
            situacao: 'Vigente',
            tem_copia_assinada: true,
            assinatura_registrada_em: '2026-10-23T16:00:00',
          }),
        }),
      )
    desenhar()
    const botao = await screen.findByRole('button', {
      name: 'Registrar a assinatura',
    })
    expect(botao).toBeDisabled()
    const arquivo = new File(['%PDF-1.4'], 'assinado.pdf', {
      type: 'application/pdf',
    })
    await userEvent.upload(
      screen.getByLabelText('Cópia assinada (PDF, JPG ou PNG)'),
      arquivo,
    )
    await userEvent.click(botao)
    expect(
      await screen.findByText(
        'O substituto mudou desde que o Ato nº 3 foi gerado.',
      ),
    ).toBeInTheDocument()
    await userEvent.click(botao)
    const vigente = await screen.findByTestId('ato-vigente')
    expect(within(vigente).getByText('Vigente')).toBeInTheDocument()
    expect(
      screen.queryByTestId('ato-aguardando-assinatura'),
    ).not.toBeInTheDocument()
    expect(privacidade.registrarAssinaturaDoAto).toHaveBeenLastCalledWith(
      7,
      arquivo,
    )
  })

  it('o ato vigente oferece o PDF e a cópia assinada', async () => {
    const vigente = ato({ situacao: 'Vigente', tem_copia_assinada: true })
    vi.mocked(privacidade.obterSituacaoDoEncarregado).mockResolvedValue(
      situacao({ ato_vigente: vigente, historico: [vigente] }),
    )
    vi.mocked(privacidade.abrirPdfDoAto).mockResolvedValue()
    vi.mocked(privacidade.baixarCopiaAssinada).mockResolvedValue()
    desenhar()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Ver o texto em PDF' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Baixar a cópia assinada' }),
    )
    await waitFor(() =>
      expect(privacidade.baixarCopiaAssinada).toHaveBeenCalledWith(vigente),
    )
    expect(privacidade.abrirPdfDoAto).toHaveBeenCalledWith(vigente)
    expect(
      screen.getByRole('region', { name: 'Histórico dos atos' }),
    ).toHaveTextContent('Maria Presidente')
  })

  it('o arquivo escolhido para um ato não passa para o ato gerado depois (achado da conferência independente)', async () => {
    vi.mocked(privacidade.obterSituacaoDoEncarregado).mockResolvedValue(
      situacao({ rascunho: ato() }),
    )
    vi.mocked(privacidade.gerarAtoDoEncarregado).mockResolvedValue(
      situacao({ rascunho: ato({ id_ato: 8, numero: 4 }) }),
    )
    desenhar()
    await userEvent.upload(
      await screen.findByLabelText('Cópia assinada (PDF, JPG ou PNG)'),
      new File(['%PDF-1.4'], 'ato-3-assinado.pdf', { type: 'application/pdf' }),
    )
    expect(
      screen.getByRole('button', { name: 'Registrar a assinatura' }),
    ).toBeEnabled()
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Gerar de novo (descarta o Ato nº 3, ainda não assinado)',
      }),
    )
    const quadro = await screen.findByTestId('ato-aguardando-assinatura')
    await waitFor(() =>
      expect(within(quadro).getByText('Ato nº 4')).toBeInTheDocument(),
    )
    expect(
      within(quadro).getByRole('button', { name: 'Registrar a assinatura' }),
    ).toBeDisabled()
    expect(privacidade.registrarAssinaturaDoAto).not.toHaveBeenCalled()
  })

  it('quem só vê (o Vice-Presidente) não tem gerar nem registrar', async () => {
    vi.mocked(privacidade.obterSituacaoDoEncarregado).mockResolvedValue(
      situacao({ rascunho: ato(), pode_gerir: false }),
    )
    desenhar()
    expect(await screen.findByTestId('so-o-presidente-gera')).toHaveTextContent(
      'Só o Presidente gera o ato e registra a cópia assinada.',
    )
    expect(screen.queryByRole('button', { name: /^Gerar/ })).toBeNull()
    expect(
      screen.queryByLabelText('Cópia assinada (PDF, JPG ou PNG)'),
    ).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Abrir o PDF para imprimir' }),
    ).toBeInTheDocument()
  })
})
