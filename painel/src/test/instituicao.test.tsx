import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import { InstituicaoPage } from '@/pages/Instituicao'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarCamposDaInstituicao: vi.fn(),
  editarCampoDaInstituicao: vi.fn(),
}))

const campo = (
  chave: string,
  grupo: string,
  rotulo: string,
  extra: Partial<api.CampoDaInstituicao> = {},
): api.CampoDaInstituicao => ({
  chave,
  grupo,
  rotulo,
  ajuda: `Ajuda de ${rotulo}`,
  tipo: 'texto',
  valor: '',
  pode_ser_publico: true,
  publico: true,
  atualizado_em: null,
  ...extra,
})

function desenhar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <InstituicaoPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.listarCamposDaInstituicao).mockResolvedValue([
    campo('NOME_INSTITUICAO', 'Identidade', 'Nome da instituição', {
      valor: 'ASAF',
    }),
    campo('CNPJ', 'Identidade', 'CNPJ'),
    campo('TELEFONE_INSTITUCIONAL', 'Contato', 'Telefone / WhatsApp'),
    campo('CHAVE_PIX', 'Financeiro', 'Chave Pix', { publico: false }),
    campo('EMAIL_REMETENTE', 'Sistema', 'E-mail remetente', {
      pode_ser_publico: false,
      publico: false,
    }),
  ])
  vi.mocked(api.editarCampoDaInstituicao).mockResolvedValue({
    chave: 'X',
    valor: '',
    publico: true,
  })
})

describe('Instituição', () => {
  it('mostra os campos por grupo, diz o que vai para o site e o que é só interno; passa no axe', async () => {
    const { container } = desenhar()
    expect(
      await screen.findByLabelText('Nome da instituição'),
    ).toHaveValue('ASAF')
    for (const grupo of ['Identidade', 'Contato', 'Financeiro', 'Sistema']) {
      expect(screen.getByRole('region', { name: grupo })).toBeInTheDocument()
    }
    // Nome, CNPJ, telefone e chave Pix podem ir para o site (4 marcas); o e-mail remetente é só interno
    expect(screen.getAllByLabelText('Aparece no site')).toHaveLength(4)
    expect(screen.getByText('Só interno')).toBeInTheDocument()
    expect(
      screen.getAllByLabelText('Aparece no site')[3],
    ).not.toBeChecked() // a chave Pix só vai se alguém decidir
    expect(await axe(container)).toHaveNoViolations()
  })

  it('salvar só liga quando o valor mudou e grava o valor digitado', async () => {
    const u = userEvent.setup()
    desenhar()
    const cnpj = await screen.findByLabelText('CNPJ')
    const salvar = within(cnpj.closest('div.rounded-md')!)
    const botao = salvar.getByRole('button', { name: 'Salvar' })
    expect(botao).toBeDisabled()
    await u.type(cnpj, '11.222.333/0001-81')
    expect(botao).toBeEnabled()
    await u.click(botao)
    await waitFor(() =>
      expect(api.editarCampoDaInstituicao).toHaveBeenCalledWith('CNPJ', {
        valor: '11.222.333/0001-81',
      }),
    )
    expect(await salvar.findByText('Salvo.')).toBeInTheDocument()
  })

  it('a marca "Aparece no site" grava na hora e avisa', async () => {
    const u = userEvent.setup()
    desenhar()
    await screen.findByLabelText('Chave Pix')
    const marca = screen.getAllByLabelText('Aparece no site')[3]!
    await u.click(marca)
    await waitFor(() =>
      expect(api.editarCampoDaInstituicao).toHaveBeenCalledWith('CHAVE_PIX', {
        publico: true,
      }),
    )
    expect(await screen.findByText('Agora aparece no site.')).toBeInTheDocument()
  })

  it('a recusa do servidor aparece no próprio campo, em português', async () => {
    const u = userEvent.setup()
    vi.mocked(api.editarCampoDaInstituicao).mockRejectedValue(
      new Error('CNPJ inválido: os dígitos verificadores não conferem.'),
    )
    desenhar()
    const cnpj = await screen.findByLabelText('CNPJ')
    await u.type(cnpj, '11.111.111/1111-11')
    await u.click(
      within(cnpj.closest('div.rounded-md')!).getByRole('button', {
        name: 'Salvar',
      }),
    )
    expect(
      await screen.findByText(/CNPJ inválido: os dígitos verificadores/),
    ).toBeInTheDocument()
  })
})
