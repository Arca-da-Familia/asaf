import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import { RegistrarSaidaPage } from '@/pages/RegistrarSaida'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarPlanoContas: vi.fn(),
  listarFornecedores: vi.fn(),
  listarAssociadosParaSelecao: vi.fn(),
  listarCentrosCusto: vi.fn(),
  enviarComprovante: vi.fn(),
  registrarSaida: vi.fn(),
}))

function desenhar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <RegistrarSaidaPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const pdf = (nome: string) =>
  new File(['%PDF-1.4 teste'], nome, { type: 'application/pdf' })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.listarPlanoContas).mockResolvedValue([
    {
      id_conta: 31,
      codigo_contabil: '5.01.01',
      descricao_conta: 'Material de limpeza',
      tipo: 'Despesa',
      codigo_contabil_pai: null,
      sintetica: false,
    },
    {
      id_conta: 32,
      codigo_contabil: '5.09.01',
      descricao_conta: 'Reembolsos',
      tipo: 'Despesa',
      codigo_contabil_pai: null,
      sintetica: false,
    },
    {
      id_conta: 33,
      codigo_contabil: '5.00',
      descricao_conta: 'Despesas (grupo)',
      tipo: 'Despesa',
      codigo_contabil_pai: null,
      sintetica: true,
    },
    {
      id_conta: 11,
      codigo_contabil: '1.01.02',
      descricao_conta: 'Banco do Brasil',
      tipo: 'Ativo',
      codigo_contabil_pai: null,
      sintetica: false,
    },
  ])
  vi.mocked(api.listarFornecedores).mockResolvedValue([
    {
      id_fornecedor: 7,
      razao_social: 'Papelaria Central',
    } as api.Fornecedor,
  ])
  vi.mocked(api.listarAssociadosParaSelecao).mockResolvedValue([
    { id_associado: 12, nome_completo: 'Bia Lima', cpf_final: '56' },
  ])
  vi.mocked(api.listarCentrosCusto).mockResolvedValue([])
  vi.mocked(api.enviarComprovante).mockImplementation(async (arquivo) => ({
    comprovante: `/uploads/comprovantes/${arquivo.name}`,
  }))
  vi.mocked(api.registrarSaida).mockResolvedValue({
    mensagem: 'Saída registrada.',
    id_titulo: 50,
    id_lancamento: 60,
    numero_sequencial: 9,
    dias_ate_o_lancamento: 0,
    lancamento_tardio: false,
  })
})

async function preencher(u: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('option', { name: /Material de limpeza/ })
  await screen.findByRole('option', { name: 'Papelaria Central' })
  await u.selectOptions(
    screen.getByLabelText('Categoria da saída'),
    '5.01.01 — Material de limpeza',
  )
  await u.type(
    screen.getByLabelText('Descrição'),
    'Material de limpeza da sede',
  )
  await u.selectOptions(
    screen.getByLabelText('Fornecedor'),
    'Papelaria Central',
  )
  await u.type(screen.getByLabelText('Valor (R$)'), '123.45')
  await u.selectOptions(screen.getByLabelText('Forma de pagamento'), 'Pix')
  await u.type(screen.getByLabelText('Data da despesa'), '2026-10-05')
  await u.type(screen.getByLabelText('Data do pagamento'), '2026-10-06')
  await u.selectOptions(
    screen.getByLabelText('De onde saiu o dinheiro'),
    '1.01.02 — Banco do Brasil',
  )
}

describe('Registrar saída', () => {
  it('só oferece categorias de despesa analíticas e contas de banco ou caixa; passa no axe', async () => {
    const { container } = desenhar()
    await screen.findByRole('option', { name: /Material de limpeza/ })
    expect(
      screen.getByRole('option', { name: /5.09.01 — Reembolsos/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('option', { name: /Despesas \(grupo\)/ }),
    ).toBeNull()
    expect(
      screen.getByRole('option', { name: /Banco do Brasil/ }),
    ).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('o formulário vazio diz o que falta e não envia nada', async () => {
    const u = userEvent.setup()
    desenhar()
    await u.click(
      await screen.findByRole('button', { name: 'Registrar saída' }),
    )
    expect(
      await screen.findByText('Escolha a categoria da saída.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Descreva a saída (pelo menos 3 letras).'),
    ).toBeInTheDocument()
    expect(screen.getByText('Escolha o fornecedor.')).toBeInTheDocument()
    expect(
      screen.getByText('Informe um valor maior que zero.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Informe a forma de pagamento.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Informe a data da despesa.')).toBeInTheDocument()
    expect(screen.getByText('Informe a data do pagamento.')).toBeInTheDocument()
    expect(
      screen.getByText('Escolha de onde saiu o dinheiro.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Anexe a nota fiscal.')).toBeInTheDocument()
    expect(
      screen.getByText('Anexe o comprovante do pagamento.'),
    ).toBeInTheDocument()
    expect(api.registrarSaida).not.toHaveBeenCalled()
  })

  it('anexa a nota e o comprovante, registra a saída e mostra o resultado com o atalho para a lista', async () => {
    const u = userEvent.setup()
    desenhar()
    await preencher(u)
    await u.upload(screen.getByLabelText('Nota fiscal'), pdf('nota.pdf'))
    await u.upload(
      screen.getByLabelText('Comprovante do pagamento'),
      pdf('pix.pdf'),
    )
    expect(await screen.findByText('Nota fiscal: anexado.')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Registrar saída' }))
    await waitFor(() => expect(api.registrarSaida).toHaveBeenCalledTimes(1))
    expect(vi.mocked(api.registrarSaida).mock.calls[0]![0]).toEqual({
      id_conta_contabil: 31,
      descricao: 'Material de limpeza da sede',
      valor: 123.45,
      data_despesa: '2026-10-05',
      data_pagamento: '2026-10-06',
      forma_pagamento: 'Pix',
      id_conta_contabil_contrapartida: 11,
      id_fornecedor: 7,
      id_associado: undefined,
      id_centro_custo: undefined,
      nota_fiscal: '/uploads/comprovantes/nota.pdf',
      comprovante: '/uploads/comprovantes/pix.pdf',
    })
    const resultado = await screen.findByRole('status')
    expect(resultado).toHaveTextContent(
      'Saída registrada: “Material de limpeza da sede” (título #50, lançamento nº 9).',
    )
    expect(resultado).not.toHaveTextContent('Atenção')
    expect(screen.getByRole('link', { name: 'Ver em Saídas' })).toHaveAttribute(
      'href',
      '/financeiro/saidas?mes=2026-10&busca=Material%20de%20limpeza%20da%20sede',
    )
    // o formulário volta vazio, pronto para a próxima
    expect(screen.getByLabelText('Descrição')).toHaveValue('')
  })

  it('reembolso: o associado é quem recebeu', async () => {
    const u = userEvent.setup()
    desenhar()
    await preencher(u)
    await u.selectOptions(screen.getByLabelText('Quem recebeu'), 'associado')
    await u.selectOptions(await screen.findByLabelText('Associado'), 'Bia Lima')
    await u.upload(screen.getByLabelText('Nota fiscal'), pdf('nota.pdf'))
    await u.upload(
      screen.getByLabelText('Comprovante do pagamento'),
      pdf('pix.pdf'),
    )
    await screen.findByText('Comprovante do pagamento: anexado.')
    await u.click(screen.getByRole('button', { name: 'Registrar saída' }))
    await waitFor(() => expect(api.registrarSaida).toHaveBeenCalledTimes(1))
    const enviado = vi.mocked(api.registrarSaida).mock.calls[0]![0]
    expect(enviado.id_associado).toBe(12)
    expect(enviado.id_fornecedor).toBeUndefined()
  })

  it('saída lançada muito depois do pagamento avisa que ficou marcada como lançamento tardio', async () => {
    const u = userEvent.setup()
    vi.mocked(api.registrarSaida).mockResolvedValue({
      mensagem: 'Saída registrada.',
      id_titulo: 51,
      id_lancamento: 61,
      numero_sequencial: 10,
      dias_ate_o_lancamento: 20,
      lancamento_tardio: true,
    })
    desenhar()
    await preencher(u)
    await u.upload(screen.getByLabelText('Nota fiscal'), pdf('nota.pdf'))
    await u.upload(
      screen.getByLabelText('Comprovante do pagamento'),
      pdf('pix.pdf'),
    )
    await screen.findByText('Comprovante do pagamento: anexado.')
    await u.click(screen.getByRole('button', { name: 'Registrar saída' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Atenção: esta saída foi lançada 20 dias depois do pagamento',
    )
  })

  it('a recusa do servidor aparece no formulário, em português', async () => {
    const u = userEvent.setup()
    vi.mocked(api.registrarSaida).mockRejectedValue(
      new Error(
        'Nenhum exercício contábil aberto. Abra um exercício antes de lançar.',
      ),
    )
    desenhar()
    await preencher(u)
    await u.upload(screen.getByLabelText('Nota fiscal'), pdf('nota.pdf'))
    await u.upload(
      screen.getByLabelText('Comprovante do pagamento'),
      pdf('pix.pdf'),
    )
    await screen.findByText('Comprovante do pagamento: anexado.')
    await u.click(screen.getByRole('button', { name: 'Registrar saída' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nenhum exercício contábil aberto',
    )
    expect(screen.queryByRole('status')).toBeNull()
  })
})
