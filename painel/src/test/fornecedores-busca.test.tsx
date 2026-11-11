import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import type { Fornecedor } from '@/lib/api'
import { FornecedoresPage } from '@/pages/Fornecedores'

// v9.3s (a tela tinha 11,2 alturas de notebook na homologação): a lista de fornecedores ganhou busca (razão social sem acento, ou CNPJ) e páginas
// de 10; o fornecedor recém-cadastrado aparece (a lista vai à página dele).
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarFornecedores: vi.fn(),
  criarFornecedor: vi.fn(),
  atualizarFornecedor: vi.fn(),
  validarSituacaoCadastral: vi.fn(),
  listarDadosBancariosFornecedor: vi.fn(),
}))

function fornecedor(
  id: number,
  razao: string,
  cnpj = String(10_000_000_000_000 + id),
): Fornecedor {
  return {
    id_fornecedor: id,
    razao_social: razao,
    cnpj,
    categoria_servico: 'Material de escritório',
    telefone: '91933334444',
    situacao_cadastral: null,
    data_ultima_validacao_cadastral: null,
  }
}

// em ordem alfabética, como a API devolve
const DOZE = [
  fornecedor(1, 'Alfa Papelaria'),
  fornecedor(2, 'Beta Limpeza'),
  fornecedor(3, 'Casa do Construtor', '11222333000181'),
  fornecedor(4, 'Delta Gráfica'),
  fornecedor(5, 'Eco Serviços'),
  fornecedor(6, 'Fama Comércio'),
  fornecedor(7, 'Gama Transportes'),
  fornecedor(8, 'Hora Certa'),
  fornecedor(9, 'Ideal Móveis'),
  fornecedor(10, 'Júpiter Informática'),
  fornecedor(11, 'Lima Alimentos'),
  fornecedor(12, 'Mundo Elétrico'),
]

let base: Fornecedor[] = []

function desenhar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <FornecedoresPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const nomesNaTela = () =>
  [...document.querySelectorAll('p.font-medium')].map((p) => p.textContent)

beforeEach(() => {
  vi.resetAllMocks()
  base = [...DOZE]
  vi.mocked(api.listarFornecedores).mockImplementation(() =>
    Promise.resolve([...base]),
  )
})

describe('Fornecedores: busca e páginas de 10', () => {
  it('mostra 10 por página, com a busca e os botões de página', async () => {
    const u = userEvent.setup()
    desenhar()
    await screen.findByText('Alfa Papelaria')
    expect(nomesNaTela()).toHaveLength(10)
    expect(screen.queryByText('Lima Alimentos')).toBeNull()
    expect(screen.getByLabelText('Procurar fornecedor')).toBeInTheDocument()
    const paginas = within(
      screen.getByRole('navigation', { name: 'Páginas dos fornecedores' }),
    )
    await u.click(paginas.getByRole('button', { name: 'Próxima página' }))
    expect(nomesNaTela()).toEqual(['Lima Alimentos', 'Mundo Elétrico'])
  })

  it('procura pela razão social sem acento e pelo CNPJ (com ou sem pontos)', async () => {
    const u = userEvent.setup()
    desenhar()
    await screen.findByText('Alfa Papelaria')
    const campo = screen.getByLabelText('Procurar fornecedor')
    await u.type(campo, 'comercio')
    expect(nomesNaTela()).toEqual(['Fama Comércio'])
    expect(screen.getByText('1 fornecedor encontrado.')).toBeInTheDocument()
    await u.clear(campo)
    await u.type(campo, '11.222.333')
    expect(nomesNaTela()).toEqual(['Casa do Construtor'])
    await u.clear(campo)
    await u.type(campo, 'ninguém')
    expect(
      screen.getByText('Nenhum fornecedor com esse nome ou CNPJ.'),
    ).toBeInTheDocument()
    expect(screen.getByText('0 fornecedores encontrados.')).toBeInTheDocument()
  })

  it('com até 10 fornecedores não há busca nem botões de página', async () => {
    base = DOZE.slice(0, 10)
    desenhar()
    await screen.findByText('Alfa Papelaria')
    expect(screen.queryByLabelText('Procurar fornecedor')).toBeNull()
    expect(
      screen.queryByRole('navigation', { name: 'Páginas dos fornecedores' }),
    ).toBeNull()
  })

  it('o fornecedor recém-cadastrado aparece: a lista vai à página dele', async () => {
    const u = userEvent.setup()
    vi.mocked(api.criarFornecedor).mockImplementation((dados) => {
      base = [...base, fornecedor(13, dados.razao_social)].sort((a, b) =>
        a.razao_social.localeCompare(b.razao_social),
      )
      return Promise.resolve({ mensagem: 'ok', id_fornecedor: 13 })
    })
    desenhar()
    await screen.findByText('Alfa Papelaria')
    await u.click(screen.getByRole('button', { name: 'Novo fornecedor' }))
    await u.type(screen.getByPlaceholderText('Razão social'), 'Zeta Papéis')
    await u.type(screen.getByPlaceholderText('CNPJ'), '11.444.777/0001-61')
    await u.type(
      screen.getByPlaceholderText('Categoria de serviço'),
      'Papelaria',
    )
    await u.type(screen.getByPlaceholderText('Telefone'), '91988887777')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('Zeta Papéis')).toBeInTheDocument()
    expect(nomesNaTela()).toEqual([
      'Lima Alimentos',
      'Mundo Elétrico',
      'Zeta Papéis',
    ])
  })

  it('a busca que não acha o fornecedor novo sai, para ele aparecer', async () => {
    const u = userEvent.setup()
    vi.mocked(api.criarFornecedor).mockImplementation((dados) => {
      base = [...base, fornecedor(13, dados.razao_social)].sort((a, b) =>
        a.razao_social.localeCompare(b.razao_social),
      )
      return Promise.resolve({ mensagem: 'ok', id_fornecedor: 13 })
    })
    desenhar()
    await screen.findByText('Alfa Papelaria')
    await u.type(screen.getByLabelText('Procurar fornecedor'), 'alfa')
    await u.click(screen.getByRole('button', { name: 'Novo fornecedor' }))
    await u.type(screen.getByPlaceholderText('Razão social'), 'Zeta Papéis')
    await u.type(screen.getByPlaceholderText('CNPJ'), '11.444.777/0001-61')
    await u.type(
      screen.getByPlaceholderText('Categoria de serviço'),
      'Papelaria',
    )
    await u.type(screen.getByPlaceholderText('Telefone'), '91988887777')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('Zeta Papéis')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByLabelText('Procurar fornecedor')).toHaveValue(''),
    )
  })

  it('a lista com busca e páginas passa no axe', async () => {
    const { container } = desenhar()
    await screen.findByText('Alfa Papelaria')
    expect(await axe(container)).toHaveNoViolations()
  })
})
