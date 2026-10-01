import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DataTable, type ColunaTabela } from '@/components/data/DataTable'

// O DataTable é usado por 6 telas (Associados, Assembleias, Atas, Auditoria, Beneficiários,
// catálogo). Estes testes travam o contrato — ordenação, filtro global, paginação no cliente e
// no servidor, seleção — para que uma troca de versão do TanStack Table não passe despercebida.

type Pessoa = { nome: string; email: string; status: string }

const NOMES = [
  'Ana Lima',
  'Beatriz Alves',
  'Carlos Mendes',
  'Daniel Souza',
  'Eduarda Reis',
  'Fernanda Dias',
  'Gustavo Reis',
  'Helena Prado',
  'Igor Nunes',
  'Juliana Prado',
  'Marcos Vieira',
  'Zeca Pagodinho',
]
const PESSOAS: Pessoa[] = NOMES.map((nome, i) => ({
  nome,
  email: `${nome.split(' ')[0]!.toLowerCase()}@exemplo.com`,
  status: i % 3 === 0 ? 'Inadimplente' : 'Ativo',
}))

const colunas: ColunaTabela<Pessoa>[] = [
  { accessorKey: 'nome', header: 'Nome' },
  { accessorKey: 'email', header: 'E-mail' },
  { accessorKey: 'status', header: 'Status' },
]

/** Texto da primeira coluna de cada linha do corpo da tabela, na ordem em que aparecem. */
function nomesNaTela(): string[] {
  const corpo = screen.getAllByRole('rowgroup')[1]!
  return within(corpo)
    .queryAllByRole('row')
    .map((linha) => within(linha).queryAllByRole('cell')[0]?.textContent ?? '')
}

describe('DataTable', () => {
  it('mostra a primeira página (10 de 12) e o total de registros', () => {
    render(<DataTable dados={PESSOAS} colunas={colunas} />)

    expect(nomesNaTela()).toHaveLength(10)
    expect(nomesNaTela()[0]).toBe('Ana Lima')
    expect(screen.getByText(/12\s+registro\(s\)/)).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })

  it('ordena ao clicar no cabeçalho: crescente, depois decrescente', async () => {
    render(<DataTable dados={PESSOAS} colunas={colunas} />)
    const cabecalhoNome = screen.getByRole('button', { name: 'Nome' })

    await userEvent.click(cabecalhoNome)
    expect(nomesNaTela()[0]).toBe('Ana Lima')
    expect(nomesNaTela()[9]).toBe('Juliana Prado')

    await userEvent.click(cabecalhoNome)
    expect(nomesNaTela()[0]).toBe('Zeca Pagodinho')
    expect(nomesNaTela()[1]).toBe('Marcos Vieira')
  })

  it('ACESSIBILIDADE: coluna que não ordena não vira botão (cabeçalho vazio nem caixa dentro de botão)', () => {
    const comAcoes: ColunaTabela<Pessoa>[] = [
      ...colunas,
      { id: 'acoes', header: '', cell: () => <span>ações</span> },
    ]
    render(<DataTable dados={PESSOAS} colunas={comAcoes} selecionavel />)
    const cabecalho = screen.getAllByRole('rowgroup')[0]!

    // Só as 3 colunas com dado ordenam: 3 botões — a de ações e a de seleção NÃO são botões.
    const botoes = within(cabecalho).getAllByRole('button')
    expect(botoes.map((b) => b.textContent)).toEqual([
      'Nome',
      'E-mail',
      'Status',
    ])
    // Todo botão do cabeçalho tem nome acessível (era o defeito: botão vazio).
    for (const b of botoes) expect(b).toHaveAccessibleName()
    // A caixa "Selecionar todos" é um controle solto, não filho de botão.
    const todos = within(cabecalho).getByRole('checkbox', {
      name: 'Selecionar todos',
    })
    expect(todos.closest('button')).toBeNull()
  })

  it('ACESSIBILIDADE: o cabeçalho informa a ordenação (aria-sort) e os ícones são decorativos', async () => {
    render(<DataTable dados={PESSOAS} colunas={colunas} />)
    const th = (nome: string) =>
      screen.getByRole('columnheader', { name: nome })

    expect(th('Nome')).toHaveAttribute('aria-sort', 'none')
    await userEvent.click(screen.getByRole('button', { name: 'Nome' }))
    expect(th('Nome')).toHaveAttribute('aria-sort', 'ascending')
    expect(th('E-mail')).toHaveAttribute('aria-sort', 'none')
    await userEvent.click(screen.getByRole('button', { name: 'Nome' }))
    expect(th('Nome')).toHaveAttribute('aria-sort', 'descending')
    // Ícones de seta não entram no nome do botão (aria-hidden).
    expect(screen.getByRole('button', { name: 'Nome' })).toHaveAccessibleName(
      'Nome',
    )
  })

  it('filtro global procura em todas as colunas e atualiza o total', async () => {
    render(<DataTable dados={PESSOAS} colunas={colunas} />)

    await userEvent.type(screen.getByLabelText('Filtrar'), 'prado')

    expect(nomesNaTela()).toEqual(['Helena Prado', 'Juliana Prado'])
    expect(screen.getByText(/2\s+registro\(s\)/)).toBeInTheDocument()
  })

  it('filtro sem resultado mostra o estado vazio, não uma tabela em branco', async () => {
    render(<DataTable dados={PESSOAS} colunas={colunas} />)

    await userEvent.type(screen.getByLabelText('Filtrar'), 'xyzxyz')

    expect(screen.getByText('Nada encontrado')).toBeInTheDocument()
  })

  it('filtroGlobal={false} esconde o campo de filtro', () => {
    render(<DataTable dados={PESSOAS} colunas={colunas} filtroGlobal={false} />)

    expect(screen.queryByLabelText('Filtrar')).not.toBeInTheDocument()
  })

  it('pagina no cliente: próxima/anterior e tamanho da página', async () => {
    render(<DataTable dados={PESSOAS} colunas={colunas} />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Próxima página' }),
    )
    expect(nomesNaTela()).toEqual(['Marcos Vieira', 'Zeca Pagodinho'])
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Próxima página' }),
    ).toBeDisabled()

    await userEvent.click(
      screen.getByRole('button', { name: 'Página anterior' }),
    )
    expect(nomesNaTela()).toHaveLength(10)

    await userEvent.selectOptions(
      screen.getByLabelText('Registros por página'),
      '25',
    )
    expect(nomesNaTela()).toHaveLength(12)
    expect(screen.getByText('1 / 1')).toBeInTheDocument()
  })

  it('paginação no servidor: mostra os dados recebidos como estão e avisa o chamador', async () => {
    const aoPaginar = vi.fn()
    render(
      <DataTable
        dados={PESSOAS.slice(0, 3)}
        colunas={colunas}
        filtroGlobal={false}
        manualPagination
        totalRegistros={48}
        pageCount={5}
        onPaginationChange={aoPaginar}
      />,
    )

    expect(nomesNaTela()).toHaveLength(3)
    expect(screen.getByText(/48\s+registro\(s\)/)).toBeInTheDocument()
    expect(screen.getByText('1 / 5')).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', { name: 'Próxima página' }),
    )

    expect(aoPaginar).toHaveBeenLastCalledWith({ pageIndex: 1, pageSize: 10 })
    expect(screen.getByText('2 / 5')).toBeInTheDocument()
    // Os dados continuam sendo os que o chamador passou (nada de fatiar de novo no cliente).
    expect(nomesNaTela()).toHaveLength(3)
  })

  it('seleção: "Selecionar todos" marca a página inteira e cada linha pode ser desmarcada', async () => {
    render(<DataTable dados={PESSOAS} colunas={colunas} selecionavel />)

    const todos = screen.getByLabelText('Selecionar todos')
    const linhas = screen.getAllByLabelText('Selecionar linha')
    expect(linhas).toHaveLength(10)
    expect(todos).not.toBeChecked()

    await userEvent.click(todos)
    for (const caixa of screen.getAllByLabelText('Selecionar linha'))
      expect(caixa).toBeChecked()
    expect(screen.getByLabelText('Selecionar todos')).toBeChecked()

    await userEvent.click(screen.getAllByLabelText('Selecionar linha')[0]!)
    expect(screen.getAllByLabelText('Selecionar linha')[0]).not.toBeChecked()
    expect(screen.getByLabelText('Selecionar todos')).not.toBeChecked()
  })
})
