import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import type { PendenciasDoFinanceiro } from '@/lib/api'
import { useMe } from '@/lib/use-me'
import { FinanceiroInicioPage } from '@/pages/FinanceiroInicio'

// v9.6b (escolha do Presidente, rodada 7b, `fin-inicio-2`): a Visão geral do Financeiro - o saldo nas contas em destaque e 6 LUGARES que mudam sozinhos
// (4 no celular): 1º o que está em atraso, 2º o que precisa de você e, no que sobrar, as telas que a pessoa mais abriu. "Aprovar" abre a janela com o
// resumo do pedido e só lá se aprova.

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  obterPendenciasDoFinanceiro: vi.fn(),
  listarContasFinanceiras: vi.fn(),
  obterReceitasDespesasPorCentroCusto: vi.fn(),
  listarTitulos: vi.fn(),
  aprovarSolicitacaoCompra: vi.fn(),
}))
vi.mock('@/lib/use-me', () => ({ useMe: vi.fn() }))

const ID_USUARIO = 7

function diaLocal(data: Date): string {
  const d = (n: number) => String(n).padStart(2, '0')
  return `${data.getFullYear()}-${d(data.getMonth() + 1)}-${d(data.getDate())}`
}

function semPendencias(): PendenciasDoFinanceiro {
  return {
    hoje: diaLocal(new Date()),
    compras_para_aprovar: { total: 0, itens: [] },
    pix_do_site: { a_conferir: 0, vencidos: 0 },
    mensalidades_em_atraso: { titulos: 0, associados: 0, soma: 0 },
    a_pagar_vencidas: { total: 0, soma: 0, mais_antiga: null },
    reembolsos_para_decidir: { total: 0 },
    perguntas_sem_resposta: {
      total: 0,
      mes_mais_antigo: null,
      da_auditoria: false,
    },
    extrato_sem_fechar: { competencia: '2026-10', contas: 0, nomes: [] },
    contadores: { compras: 0, doacoes: 0, reembolsos: 0, conciliacao: 0 },
  }
}

function compra(
  id: number,
  extra: Partial<api.CompraParaAprovar> = {},
): api.CompraParaAprovar {
  return {
    id_solicitacao: id,
    descricao: `Pedido ${id}`,
    valor: 1250.5,
    fornecedor: 'Papelaria Central',
    data_solicitacao: '2026-11-18T13:00:00',
    solicitante: 'Ana Souza',
    alcada: {
      valor_minimo: 1000,
      valor_maximo: 5000,
      cargos: 'Presidente, 1º Tesoureiro',
      exigidas: 2,
    },
    assinaturas: [{ nome: 'Bruno Lima', data: '2026-11-19T15:00:00' }],
    faltam_cotacoes: 0,
    ...extra,
  }
}

// todas as pendências de uma vez: 2 em atraso e 5 que precisam de você (7 ao todo, para 6 lugares)
function todasAsPendencias(): PendenciasDoFinanceiro {
  return {
    ...semPendencias(),
    compras_para_aprovar: { total: 2, itens: [compra(41), compra(42)] },
    pix_do_site: { a_conferir: 3, vencidos: 1 },
    mensalidades_em_atraso: { titulos: 4, associados: 3, soma: 200 },
    a_pagar_vencidas: {
      total: 1,
      soma: 310,
      mais_antiga: {
        id_titulo: 9,
        descricao: 'Conta de energia',
        fornecedor: 'Equatorial',
        valor: 310,
        vencimento: '2026-11-05T00:00:00',
      },
    },
    reembolsos_para_decidir: { total: 1 },
    perguntas_sem_resposta: {
      total: 2,
      mes_mais_antigo: '2026-09',
      da_auditoria: true,
    },
    extrato_sem_fechar: {
      competencia: '2026-10',
      contas: 1,
      nomes: ['Banco do Brasil'],
    },
    contadores: { compras: 2, doacoes: 3, reembolsos: 1, conciliacao: 1 },
  }
}

const conta = (
  id: number,
  descricao: string,
  saldo: number,
  ativo = true,
): api.ContaFinanceira => ({
  id_conta_financeira: id,
  id_conta: 100 + id,
  codigo_contabil: null,
  descricao_conta: descricao,
  tipo_conta_financeira: 'Conta Corrente',
  banco: null,
  agencia: null,
  numero_conta: null,
  ativo,
  saldo,
})

function guardarAberturas(vezesPorRota: Record<string, number>) {
  const agora = Date.now()
  const dados: Record<string, number[]> = {}
  for (const [rota, vezes] of Object.entries(vezesPorRota))
    dados[rota] = Array.from({ length: vezes }, (_, i) => agora - i * 60_000)
  window.localStorage.setItem(
    `painel-mais-usados:${ID_USUARIO}`,
    JSON.stringify(dados),
  )
}

function Endereco() {
  const local = useLocation()
  return <p data-testid="endereco">{local.pathname + local.search}</p>
}

function montar(endereco = '/financeiro') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[endereco]}>
        <Routes>
          <Route path="/financeiro" element={<FinanceiroInicioPage />} />
          <Route path="*" element={<p>Outra tela</p>} />
        </Routes>
        <Endereco />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const lugares = () =>
  Array.from(document.querySelectorAll<HTMLElement>('li[data-lugar]'))

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  vi.mocked(useMe).mockReturnValue({
    data: { id_usuario: ID_USUARIO, permissoes: ['financeiro'] },
    isLoading: false,
  } as ReturnType<typeof useMe>)
  vi.mocked(api.obterPendenciasDoFinanceiro).mockResolvedValue(semPendencias())
  vi.mocked(api.listarContasFinanceiras).mockResolvedValue([
    conta(1, 'Banco do Brasil', 1000),
    conta(2, 'Caixa da tesouraria', 250.25),
    conta(3, 'Conta encerrada', 99999, false),
  ])
  vi.mocked(api.obterReceitasDespesasPorCentroCusto).mockResolvedValue([
    {
      id_centro_custo: 1,
      nome_centro_custo: 'Geral',
      receitas: 800,
      despesas: 300,
      resultado: 500,
    },
    {
      id_centro_custo: 2,
      nome_centro_custo: 'Despertai',
      receitas: 200,
      despesas: 50,
      resultado: 150,
    },
  ])
  vi.mocked(api.listarTitulos).mockResolvedValue([])
})

describe('Visão geral do Financeiro: o saldo e o mês (v9.6b)', () => {
  it('o saldo soma só as contas ativas e a linha do mês junta os centros de custo', async () => {
    montar()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Visão geral' }),
    ).toBeInTheDocument()
    const saldo = screen.getByRole('region', { name: /Saldo nas contas/ })
    // 1.000,00 + 250,25 (a conta encerrada fica de fora)
    expect(await within(saldo).findByText('R$ 1.250,25')).toBeInTheDocument()
    expect(within(saldo).queryByText(/Conta encerrada/)).not.toBeInTheDocument()
    expect(
      await within(saldo).findByText(
        /receitas de R\$ 1\.000,00 e despesas de R\$ 350,00/,
      ),
    ).toBeInTheDocument()
  })

  it('o movimento é do mês escolhido: o seletor muda o endereço e a consulta', async () => {
    montar('/financeiro?mes=2026-03')
    await waitFor(() =>
      expect(api.obterReceitasDespesasPorCentroCusto).toHaveBeenCalledWith({
        dataInicio: '2026-03-01',
        dataFim: '2026-03-31T23:59:59',
      }),
    )
    expect(screen.getByText('Março de 2026')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Próximo mês' }))
    expect(screen.getByTestId('endereco')).toHaveTextContent(
      '/financeiro?mes=2026-04',
    )
    await waitFor(() =>
      expect(api.obterReceitasDespesasPorCentroCusto).toHaveBeenCalledWith({
        dataInicio: '2026-04-01',
        dataFim: '2026-04-30T23:59:59',
      }),
    )
  })

  it('com mais de 4 contas, mostra as 4 maiores e o "e mais" leva à lista', async () => {
    vi.mocked(api.listarContasFinanceiras).mockResolvedValue([
      conta(1, 'Conta A', 10),
      conta(2, 'Conta B', 50),
      conta(3, 'Conta C', 40),
      conta(4, 'Conta D', 30),
      conta(5, 'Conta E', 20),
      conta(6, 'Conta F', 5),
    ])
    montar()
    const saldo = screen.getByRole('region', { name: /Saldo nas contas/ })
    expect(
      await within(saldo).findByText('e mais 2 contas ·', { exact: false }),
    ).toBeInTheDocument()
    expect(
      within(saldo).getByRole('link', { name: 'Ver todas' }),
    ).toHaveAttribute('href', '/financeiro/contas-financeiras')
    expect(within(saldo).getAllByText('Conta B')).not.toHaveLength(0)
    expect(within(saldo).queryAllByText('Conta F')).toHaveLength(0)
  })

  it('os próximos vencimentos são os em aberto de hoje em diante', async () => {
    vi.mocked(api.listarTitulos).mockResolvedValue([
      {
        id_titulo: 5,
        tipo_titulo: 'A Pagar',
        descricao: 'Aluguel do salão',
        data_vencimento: '2026-12-10T00:00:00',
        saldo_devedor: 900,
      } as api.TituloFinanceiro,
    ])
    montar()
    expect(await screen.findByText('Aluguel do salão')).toBeInTheDocument()
    expect(api.listarTitulos).toHaveBeenCalledWith({
      status: 'Pendente',
      data_de: diaLocal(new Date()),
      pagina: 1,
      por_pagina: 5,
    })
    expect(screen.getByText('A pagar')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Ver todos os títulos' }),
    ).toHaveAttribute('href', '/financeiro/titulos')
  })
})

describe('Visão geral do Financeiro: os lugares que mudam sozinhos (v9.6b)', () => {
  it('1º o que está em atraso, 2º o que precisa de você; só 6 lugares, e do 5º em diante somem no celular', async () => {
    vi.mocked(api.obterPendenciasDoFinanceiro).mockResolvedValue(
      todasAsPendencias(),
    )
    montar()
    await screen.findByText('4 mensalidades em atraso')
    expect(lugares().map((l) => l.dataset.lugar)).toEqual([
      'mensalidades',
      'a-pagar',
      'compras',
      'pix',
      'reembolsos',
      'perguntas',
    ])
    expect(lugares().map((l) => l.dataset.estado)).toEqual([
      'atraso',
      'atraso',
      'pend',
      'pend',
      'pend',
      'pend',
    ])
    // 4 no celular: o 5º e o 6º só aparecem da tela pequena para cima
    expect(lugares().map((l) => l.className.includes('hidden'))).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
    ])
    expect(
      screen.getByText('Conta de energia venceu em 05/11'),
    ).toBeInTheDocument()
    // cada lugar leva à tela da ação
    expect(
      screen.getByRole('link', { name: /4 mensalidades em atraso/ }),
    ).toHaveAttribute('href', '/financeiro/entradas?vencidos=1')
    expect(
      screen.getByRole('link', { name: /Conta de energia venceu/ }),
    ).toHaveAttribute('href', '/financeiro/saidas?vencidos=1')
    expect(
      screen.getByRole('link', {
        name: /2 perguntas do Conselho sem resposta/,
      }),
    ).toHaveAttribute(
      'href',
      '/financeiro/auditoria-financeira?mes=2026-09&situacao=Suspenso',
    )
    // "Aprovar" não é link: abre a janela
    expect(
      screen.getByRole('button', { name: /2 compras para aprovar/ }),
    ).toBeInTheDocument()
  })

  it('no que sobra, as telas que a pessoa mais abriu (sem a Visão geral e sem repetir a tela de uma pendência) e depois os atalhos', async () => {
    vi.mocked(api.obterPendenciasDoFinanceiro).mockResolvedValue({
      ...semPendencias(),
      reembolsos_para_decidir: { total: 1 },
      contadores: { compras: 0, doacoes: 0, reembolsos: 1, conciliacao: 0 },
    })
    guardarAberturas({
      '/financeiro': 50, // a Visão geral é fixa: nunca vira lugar
      '/financeiro/reembolso-despesa': 30, // já é o lugar da pendência
      '/financeiro/fornecedores': 9,
      '/financeiro/razao-contabil': 12,
    })
    montar()
    await screen.findByText('1 reembolso para decidir')
    expect(lugares().map((l) => l.dataset.lugar)).toEqual([
      'reembolsos',
      'usado:/financeiro/razao-contabil',
      'usado:/financeiro/fornecedores',
      'atalho:/financeiro/registrar-saida',
      'atalho:/financeiro/entradas',
      'atalho:/financeiro/saidas',
    ])
    expect(
      screen.getByText('Você abriu 12 vezes nos últimos 30 dias'),
    ).toBeInTheDocument()
    // a legenda explica a cor do atalho só quando há atalho
    expect(
      within(
        screen.getByRole('list', { name: 'O que cada cor quer dizer' }),
      ).getByText('Atalho (até você usar mais telas)'),
    ).toBeInTheDocument()
  })

  it('sem nada pendente e sem histórico, os 6 lugares são os atalhos de sempre', async () => {
    montar()
    await waitFor(() => expect(lugares()).toHaveLength(6))
    expect(lugares().every((l) => l.dataset.estado === 'atalho')).toBe(true)
    expect(
      screen.getByRole('link', {
        name: /Registrar saída.*Uma despesa já paga/,
      }),
    ).toHaveAttribute('href', '/financeiro/registrar-saida')
  })

  it('se as pendências não chegam, avisa e mostra os atalhos mesmo assim', async () => {
    vi.mocked(api.obterPendenciasDoFinanceiro).mockRejectedValue(
      new Error('Sem conexão'),
    )
    montar()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não deu para ver as pendências agora: Sem conexão',
    )
    expect(lugares()).toHaveLength(6)
  })

  it('sem violações de acessibilidade (axe), com todos os estados na tela', async () => {
    vi.mocked(api.obterPendenciasDoFinanceiro).mockResolvedValue({
      ...todasAsPendencias(),
      pix_do_site: { a_conferir: 0, vencidos: 0 },
      reembolsos_para_decidir: { total: 0 },
      perguntas_sem_resposta: {
        total: 0,
        mes_mais_antigo: null,
        da_auditoria: false,
      },
      extrato_sem_fechar: { competencia: '2026-10', contas: 0, nomes: [] },
    })
    guardarAberturas({ '/financeiro/fornecedores': 3 })
    const { container } = montar()
    await screen.findByText('2 compras para aprovar')
    await screen.findByText('R$ 1.250,25')
    expect(lugares().map((l) => l.dataset.estado)).toEqual([
      'atraso',
      'atraso',
      'pend',
      'usado',
      'atalho',
      'atalho',
    ])
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('Visão geral do Financeiro: a janela de aprovar (v9.6b)', () => {
  it('mostra o resumo de cada pedido e só aprova no botão de cada um; o resultado aparece no lugar do botão', async () => {
    vi.mocked(api.obterPendenciasDoFinanceiro).mockResolvedValue({
      ...semPendencias(),
      compras_para_aprovar: {
        total: 2,
        itens: [
          compra(41),
          compra(42, {
            descricao: 'Cadeiras',
            faltam_cotacoes: 1,
            assinaturas: [],
            alcada: {
              valor_minimo: 5000,
              valor_maximo: null,
              cargos: 'Presidente',
              exigidas: 1,
            },
          }),
        ],
      },
      contadores: { compras: 2, doacoes: 0, reembolsos: 0, conciliacao: 0 },
    })
    vi.mocked(api.aprovarSolicitacaoCompra).mockResolvedValue({
      mensagem: 'Assinatura registrada: falta 1 de 2.',
    })
    montar()
    const lugar = await screen.findByRole('button', {
      name: /2 compras para aprovar/,
    })
    await userEvent.click(lugar)
    const janela = screen.getByRole('alertdialog', {
      name: 'Compras para aprovar',
    })
    expect(api.aprovarSolicitacaoCompra).not.toHaveBeenCalled()
    const pedidos = within(janela).getAllByRole('listitem')
    expect(pedidos).toHaveLength(2)
    const [primeiro, segundo] = pedidos as [HTMLElement, HTMLElement]
    expect(within(primeiro).getByText('Pedido 41')).toBeInTheDocument()
    expect(within(primeiro).getByText('R$ 1.250,50')).toBeInTheDocument()
    expect(within(primeiro).getByText('Papelaria Central')).toBeInTheDocument()
    expect(
      within(primeiro).getByText(/Ana Souza em 18\/11\/2026/),
    ).toBeInTheDocument()
    expect(
      within(primeiro).getByText(
        'de R$ 1.000,00 a R$ 5.000,00 · Presidente, 1º Tesoureiro · duas assinaturas',
      ),
    ).toBeInTheDocument()
    expect(
      within(primeiro).getByText(/Bruno Lima em 19\/11\/2026/),
    ).toBeInTheDocument()
    // o pedido sem as cotações não tem botão: diz o que falta
    expect(
      within(segundo).queryByRole('button', { name: 'Aprovar este pedido' }),
    ).not.toBeInTheDocument()
    expect(within(segundo).getByText(/Faltam 1 cotação/)).toBeInTheDocument()
    expect(
      within(segundo).getByText(
        'a partir de R$ 5.000,00 · Presidente · uma assinatura',
      ),
    ).toBeInTheDocument()
    expect(within(segundo).getByText('Ninguém ainda')).toBeInTheDocument()

    const botao = within(primeiro).getByRole('button', {
      name: 'Aprovar este pedido',
    })
    expect(botao).toHaveFocus()
    await userEvent.click(botao)
    expect(api.aprovarSolicitacaoCompra).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.aprovarSolicitacaoCompra).mock.calls[0]?.[0]).toBe(41)
    const resposta = await within(primeiro).findByRole('status')
    expect(resposta).toHaveTextContent('Assinatura registrada: falta 1 de 2.')
    expect(resposta).toHaveFocus()
    // as pendências são pedidas de novo (o número do menu e os lugares se atualizam)
    await waitFor(() =>
      expect(api.obterPendenciasDoFinanceiro).toHaveBeenCalledTimes(2),
    )
    expect(await axe(janela)).toHaveNoViolations()

    await userEvent.click(
      within(janela).getByRole('button', { name: 'Fechar' }),
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('a recusa do servidor aparece na janela, como alerta', async () => {
    vi.mocked(api.obterPendenciasDoFinanceiro).mockResolvedValue({
      ...semPendencias(),
      compras_para_aprovar: { total: 1, itens: [compra(41)] },
      contadores: { compras: 1, doacoes: 0, reembolsos: 0, conciliacao: 0 },
    })
    vi.mocked(api.aprovarSolicitacaoCompra).mockRejectedValue(
      new api.ApiError(400, 'Seu cargo não está na alçada deste valor.'),
    )
    montar()
    await userEvent.click(
      await screen.findByRole('button', { name: /1 compra para aprovar/ }),
    )
    const janela = screen.getByRole('alertdialog', {
      name: 'Compra para aprovar',
    })
    await userEvent.click(
      within(janela).getByRole('button', { name: 'Aprovar este pedido' }),
    )
    expect(await within(janela).findByRole('alert')).toHaveTextContent(
      'Seu cargo não está na alçada deste valor.',
    )
    expect(
      within(janela).getByRole('link', { name: 'Abrir Compras' }),
    ).toHaveAttribute('href', '/financeiro/compras')
  })

  it('sem conexão com o servidor, a janela diz isso em português (nunca a mensagem do navegador)', async () => {
    vi.mocked(api.obterPendenciasDoFinanceiro).mockResolvedValue({
      ...semPendencias(),
      compras_para_aprovar: { total: 1, itens: [compra(41)] },
      contadores: { compras: 1, doacoes: 0, reembolsos: 0, conciliacao: 0 },
    })
    vi.mocked(api.aprovarSolicitacaoCompra).mockRejectedValue(
      new TypeError('Failed to fetch'),
    )
    montar()
    await userEvent.click(
      await screen.findByRole('button', { name: /1 compra para aprovar/ }),
    )
    const janela = screen.getByRole('alertdialog', {
      name: 'Compra para aprovar',
    })
    await userEvent.click(
      within(janela).getByRole('button', { name: 'Aprovar este pedido' }),
    )
    const alerta = await within(janela).findByRole('alert')
    expect(alerta).toHaveTextContent(
      'Não foi possível aprovar agora (sem conexão com o servidor). Tente de novo.',
    )
    expect(alerta).not.toHaveTextContent('Failed to fetch')
  })
})
