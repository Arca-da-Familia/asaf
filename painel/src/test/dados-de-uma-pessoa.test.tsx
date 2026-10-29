import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as privacidade from '@/lib/privacidade'
import { DadosDeUmaPessoaPage } from '@/pages/DadosDeUmaPessoa'

vi.mock('@/lib/privacidade', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/privacidade')>()),
  buscarTitulares: vi.fn(),
  obterRelatorioDoTitular: vi.fn(),
}))

function desenhar(rota = '/privacidade/titulares') {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[rota]}>
        <DadosDeUmaPessoaPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(privacidade.buscarTitulares).mockResolvedValue([
    {
      id_pessoa: 9,
      nome_completo: 'Joana da Silva',
      cpf_final: '***.***.*456-78',
      associado: true,
      beneficiario: false,
    },
  ])
  vi.mocked(privacidade.obterRelatorioDoTitular).mockResolvedValue({
    gerado_em: '2026-10-28T12:00:00',
    pessoa: {
      id_pessoa: 9,
      nome_completo: 'Joana da Silva',
      cpf: '12345678909',
    },
    total_de_linhas: 1,
    algum_corte: true,
    fora_do_relatorio: 'A Auditoria do sistema não entra neste relatório.',
    impressao: 'b'.repeat(64),
    secoes: [
      {
        tabela: 'pessoas',
        tem_dado_sensivel: false,
        cortado: true,
        atividades: [
          {
            codigo: 'CADASTRO',
            nome: 'Cadastro de associados',
            finalidade: 'Manter o cadastro.',
            bases_legais: ['Execução do vínculo associativo'],
            base_legal_conferida: false,
            compartilhado_com: ['Microsoft (Azure)'],
            transferencia_internacional: true,
            prazos_de_guarda: ['Associado desligado: 1825 dias'],
          },
        ],
        linhas: [
          {
            numero: 9,
            nome_completo: 'Joana da Silva',
            email_contato: 'joana@exemplo.com',
            data_nascimento: '1990-03-04T00:00:00',
          },
        ],
      },
    ],
  })
})

describe('Dados de uma pessoa', () => {
  it('busca pelo nome, gera o relatório com a atividade de cada lugar; passa no axe', async () => {
    const u = userEvent.setup()
    const { container } = desenhar()
    await u.type(
      screen.getByLabelText('Nome, CPF ou e-mail do cadastro'),
      'Joana',
    )
    await u.click(screen.getByRole('button', { name: 'Buscar' }))
    await u.click(
      await screen.findByRole('button', {
        name: 'Gerar o relatório de Joana da Silva',
      }),
    )
    expect(privacidade.obterRelatorioDoTitular).toHaveBeenCalledWith({
      id_pessoa: 9,
      email: undefined,
      id_atendimento: undefined,
    })
    const secao = await screen.findByRole('region', {
      name: 'Dados na tabela pessoas',
    })
    expect(secao).toHaveTextContent('Para que serve: Manter o cadastro.')
    expect(secao).toHaveTextContent('há transferência internacional')
    expect(secao).toHaveTextContent('joana@exemplo.com')
    expect(secao).toHaveTextContent(
      'proposta, ainda não conferida pelo encarregado',
    )
    expect(secao).toHaveTextContent(
      'Há mais registros do que os mostrados aqui',
    )
    expect(secao).toHaveTextContent('Email contato')
    expect(
      screen.getByText('A Auditoria do sistema não entra neste relatório.'),
    ).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('o atalho do pedido abre direto o relatório da pessoa', async () => {
    desenhar('/privacidade/titulares?id_pessoa=9')
    const relatorio = await screen.findByRole('article', {
      name: 'Relatório dos dados',
    })
    expect(relatorio).toHaveTextContent('Joana da Silva')
    // o nascimento guardado à meia-noite sai no dia certo (não na véspera às 21h, pelo fuso de Belém)
    expect(relatorio).toHaveTextContent('04/03/1990')
  })

  it('v7.2c: só o número do pedido também abre o relatório (o que será entregue)', async () => {
    desenhar('/privacidade/titulares?id_atendimento=41')
    expect(
      await screen.findByRole('article', { name: 'Relatório dos dados' }),
    ).toHaveTextContent('Joana da Silva')
    expect(privacidade.obterRelatorioDoTitular).toHaveBeenCalledWith({
      id_pessoa: undefined,
      email: undefined,
      id_atendimento: 41,
    })
    // aberto pelo pedido, libera-se ESTE relatório
    expect(
      screen.getByRole('region', {
        name: 'Liberar este relatório na Minha conta',
      }),
    ).toBeInTheDocument()
  })

  it('v7.2c: aberto pelo cadastro (não pelo pedido), não oferece liberar', async () => {
    desenhar('/privacidade/titulares?id_pessoa=9&id_atendimento=41')
    await screen.findByRole('article', { name: 'Relatório dos dados' })
    expect(
      screen.queryByRole('region', {
        name: 'Liberar este relatório na Minha conta',
      }),
    ).toBeNull()
  })
})
