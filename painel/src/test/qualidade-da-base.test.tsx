import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import type { SinalDeRevisao } from '@/lib/api'
import { QualidadeDaBasePage } from '@/pages/QualidadeDaBase'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarFilaDeRevisao: vi.fn(),
  escanearDuplicidade: vi.fn(),
  higienizarContatos: vi.fn(),
  ignorarItemDaFila: vi.fn(),
  mesclarPessoas: vi.fn(),
  anonimizarVencidos: vi.fn(),
}))

const duplicado: SinalDeRevisao = {
  id_fila: 1,
  tipo_sinal: 'duplicidade_nome_nascimento',
  detalhe: 'Mesmo nome e mesma data de nascimento',
  status: 'pendente',
  criado_em: '2026-10-05T10:00:00',
  id_pessoa_a: 10,
  nome_pessoa_a: 'Maria Souza',
  id_pessoa_b: 11,
  nome_pessoa_b: 'Maria de Souza',
  e_associado_a: true,
  matricula_a: 5,
  e_associado_b: false,
  matricula_b: null,
}
const telefone: SinalDeRevisao = {
  id_fila: 2,
  tipo_sinal: 'contato_telefone_invalido',
  detalhe: 'Telefone 123',
  status: 'pendente',
  criado_em: '2026-10-05T10:00:00',
  id_pessoa_a: 12,
  nome_pessoa_a: 'João Lima',
  id_pessoa_b: null,
  nome_pessoa_b: null,
  e_associado_a: true,
  matricula_a: 7,
  e_associado_b: false,
  matricula_b: null,
}

function desenhar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <QualidadeDaBasePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.listarFilaDeRevisao).mockResolvedValue([duplicado, telefone])
})

describe('Qualidade da base (v5.4c: a tela que faltava para as rotas da v1.8)', () => {
  it('lista a fila com o tipo de cada sinal e oferece mesclar só onde há duas pessoas', async () => {
    desenhar()
    const dup = within(
      await screen.findByRole('listitem', {
        name: 'Possível cadastro duplicado: Maria Souza',
      }),
    )
    expect(
      dup.getByRole('button', { name: 'Mesclar os dois cadastros' }),
    ).toBeInTheDocument()
    expect(
      dup.getByRole('button', { name: 'Não é duplicado — ignorar' }),
    ).toBeInTheDocument()
    const tel = within(
      screen.getByRole('listitem', {
        name: 'Telefone com formato inválido: João Lima',
      }),
    )
    expect(
      tel.queryByRole('button', { name: 'Mesclar os dois cadastros' }),
    ).not.toBeInTheDocument()
    expect(
      tel.getByRole('button', { name: 'Já resolvido — ignorar' }),
    ).toBeInTheDocument()
  })

  it('fila vazia diz isso', async () => {
    vi.mocked(api.listarFilaDeRevisao).mockResolvedValue([])
    desenhar()
    expect(
      await screen.findByText('Nada na fila de revisão'),
    ).toBeInTheDocument()
  })

  it('as buscas mostram quantos achados novos entraram na fila', async () => {
    const u = userEvent.setup()
    vi.mocked(api.escanearDuplicidade).mockResolvedValue({
      mensagem: '2 novo(s) candidato(s) a duplicidade adicionado(s) à fila.',
      novos: 2,
    })
    vi.mocked(api.higienizarContatos).mockResolvedValue({
      mensagem: '0 telefone(s) com formato inválido adicionado(s) à fila.',
      novos: 0,
    })
    desenhar()
    await u.click(
      await screen.findByRole('button', {
        name: 'Procurar cadastros duplicados',
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      '2 novo(s) candidato(s)',
    )
    await u.click(
      screen.getByRole('button', { name: 'Procurar telefones inválidos' }),
    )
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('0 telefone(s)'),
    )
  })

  it('ignorar um item chama o servidor', async () => {
    const u = userEvent.setup()
    vi.mocked(api.ignorarItemDaFila).mockResolvedValue({
      mensagem: 'Item marcado como ignorado.',
    })
    desenhar()
    await u.click(
      await screen.findByRole('button', { name: 'Não é duplicado — ignorar' }),
    )
    await waitFor(() => expect(api.ignorarItemDaFila).toHaveBeenCalledWith(1))
    expect(await screen.findByRole('status')).toHaveTextContent('ignorado')
  })

  it('mesclar exige escolher quem fica e digitar o nome de quem será absorvido', async () => {
    const u = userEvent.setup()
    vi.mocked(api.mesclarPessoas).mockResolvedValue({
      mensagem: 'Pessoas mescladas com sucesso.',
    })
    desenhar()
    await u.click(
      await screen.findByRole('button', { name: 'Mesclar os dois cadastros' }),
    )
    const botao = screen.getByRole('button', { name: 'Mesclar (irreversível)' })
    expect(botao).toBeDisabled()

    // escolhe manter a segunda: a absorvida passa a ser a primeira
    await u.click(
      screen.getByLabelText(
        /Manter Maria de Souza \(pessoa sem cadastro de associado\)/,
      ),
    )
    await u.type(
      screen.getByLabelText(
        'Digite o nome de quem será absorvido para confirmar',
      ),
      'Maria Souza',
    )
    expect(botao).toBeEnabled()
    await u.click(botao)
    await waitFor(() =>
      expect(api.mesclarPessoas).toHaveBeenCalledWith(11, {
        id_pessoa_absorvida: 10,
        nome_confirmacao: 'Maria Souza',
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Pessoas mescladas com sucesso.',
    )
  })

  it('a recusa do servidor (nome que não confere, dois associados) aparece e nada some', async () => {
    const u = userEvent.setup()
    vi.mocked(api.mesclarPessoas).mockRejectedValue(
      new Error(
        'Nome de confirmação não confere com o nome da pessoa que será absorvida.',
      ),
    )
    desenhar()
    await u.click(
      await screen.findByRole('button', { name: 'Mesclar os dois cadastros' }),
    )
    await u.type(
      screen.getByLabelText(
        'Digite o nome de quem será absorvido para confirmar',
      ),
      'Outro Nome',
    )
    await u.click(
      screen.getByRole('button', { name: 'Mesclar (irreversível)' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('não confere')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('anonimizar em lote pede confirmação e mostra o total', async () => {
    const u = userEvent.setup()
    vi.mocked(api.anonimizarVencidos).mockResolvedValue({
      mensagem: '3 associado(s) anonimizado(s).',
      total: 3,
    })
    desenhar()
    await u.click(
      await screen.findByRole('button', {
        name: 'Anonimizar desligados com prazo vencido',
      }),
    )
    expect(api.anonimizarVencidos).not.toHaveBeenCalled()
    expect(
      await screen.findByText(/Apaga de forma definitiva o CPF/),
    ).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Anonimizar agora' }))
    await waitFor(() => expect(api.anonimizarVencidos).toHaveBeenCalled())
    expect(await screen.findByRole('status')).toHaveTextContent(
      '3 associado(s) anonimizado(s).',
    )
  })

  it('não tem violação de acessibilidade (axe), nem com a mesclagem aberta', async () => {
    const u = userEvent.setup()
    const { container } = desenhar()
    await u.click(
      await screen.findByRole('button', { name: 'Mesclar os dois cadastros' }),
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
