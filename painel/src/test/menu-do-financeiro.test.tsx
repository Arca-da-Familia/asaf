import { render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MenuDoModulo } from '@/components/layout/MenuDoModulo'
import {
  contarAberturas,
  maisUsados,
  registrarAbertura,
  useContarAberturaDaTela,
} from '@/lib/mais-usados'
import { agruparItens, itensFixos } from '@/lib/menu-do-modulo'
import { itensVisiveis, modulos } from '@/lib/modulos'

// v9.6b (escolha do Presidente, rodada 7b, `fin-menu-2`: "Os cinco grupos, com os seus mais usados no alto"; decisão de 19/11: é o PADRÃO dos módulos) -
// a Visão geral fixa no alto, os grupos com ícone, o número do que espera alguém ao lado da tela, os mais usados da pessoa e, recolhido, um ícone por
// grupo com a lista ao lado.

const financeiro = modulos.find((m) => m.rota === '/financeiro')!
const ID_USUARIO = 11
const OPERA = ['financeiro']
const AUDITA = ['financeiro_auditar']
const CONTADORES = { compras: 2, doacoes: 3, reembolsos: 1, conciliacao: 1 }
const DIA = 24 * 60 * 60 * 1000

function montar({
  endereco = '/financeiro',
  permissoes = OPERA,
  recolhido = false,
  contadores = {},
}: {
  endereco?: string
  permissoes?: string[]
  recolhido?: boolean
  contadores?: Record<string, number>
} = {}) {
  const resultado = render(
    <MemoryRouter initialEntries={[endereco]}>
      <nav aria-label="Telas de Financeiro" className="relative">
        <MenuDoModulo
          modulo={financeiro}
          permissoes={permissoes}
          recolhido={recolhido}
          aoNavegar={() => {}}
          contadores={contadores}
          idUsuario={ID_USUARIO}
        />
      </nav>
      <button type="button">fora do menu</button>
    </MemoryRouter>,
  )
  return {
    ...resultado,
    menu: screen.getByRole('navigation', { name: 'Telas de Financeiro' }),
  }
}

// os botões dos grupos (o nome é o texto visível; o número de telas e de pendências vem depois, no nome acessível)
const nomesDosGrupos = (menu: HTMLElement) =>
  within(menu)
    .queryAllByRole('button', { expanded: false })
    .concat(within(menu).queryAllByRole('button', { expanded: true }))
    .sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    )
    .map((b) => b.querySelector('span')?.textContent)

function guardar(vezesPorRota: Record<string, number>, agora = Date.now()) {
  for (const [rota, vezes] of Object.entries(vezesPorRota))
    for (let i = 0; i < vezes; i += 1)
      registrarAbertura(ID_USUARIO, rota, agora - i * 1000)
}

beforeEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('menu do Financeiro: os 5 grupos e a Visão geral fixa (v9.6b)', () => {
  it('os grupos escolhidos, na ordem, cada um com o seu ícone; a Visão geral fica fora deles', () => {
    expect(
      agruparItens(financeiro.itens!, financeiro.grupos).map((g) => g.nome),
    ).toEqual(['Dia a dia', 'Rotina do mês', 'Cadastros', 'Relatórios', 'Controle'])
    expect(
      agruparItens(financeiro.itens!, financeiro.grupos).every((g) => g.icone),
    ).toBe(true)
    expect(itensFixos(financeiro.itens!).map((i) => i.rotulo)).toEqual([
      'Visão geral',
    ])
    // toda tela do módulo tem um grupo que existe (nenhuma fica perdida fora do menu)
    const nomes = new Set(financeiro.grupos!.map((g) => g.nome))
    for (const item of financeiro.itens!.filter((i) => !i.fixo))
      expect(nomes.has(item.grupo ?? '')).toBe(true)
  })

  it('aberto: Visão geral no alto, os grupos com ícone e o número de telas; só o grupo da tela aberta vem aberto', async () => {
    const { menu } = montar({ endereco: '/financeiro/compras' })
    const visao = within(menu).getByRole('link', { name: 'Visão geral' })
    expect(visao).toHaveAttribute('href', '/financeiro')
    expect(visao).not.toHaveAttribute('aria-current')
    expect(visao.closest('[role="group"]')).toBeNull()
    expect(nomesDosGrupos(menu)).toEqual([
      'Dia a dia',
      'Rotina do mês',
      'Cadastros',
      'Relatórios',
      'Controle',
    ])
    const diaADia = within(menu).getByRole('button', { name: /^Dia a dia/ })
    expect(diaADia).toHaveAccessibleName('Dia a dia 7 telas')
    expect(diaADia).toHaveAttribute('aria-expanded', 'true')
    // a seta e o ícone do grupo
    expect(diaADia.querySelectorAll('svg')).toHaveLength(2)
    expect(
      within(menu).getByRole('button', { name: /^Cadastros/ }),
    ).toHaveAttribute('aria-expanded', 'false')
    const lista = within(menu).getByRole('group', { name: 'Dia a dia' })
    expect(
      within(lista).getByRole('link', { name: 'Compras' }),
    ).toHaveAttribute('aria-current', 'page')
    await userEvent.click(within(menu).getByRole('button', { name: /^Cadastros/ }))
    expect(
      within(menu).getByRole('link', { name: 'Fornecedores' }),
    ).toBeVisible()
  })

  it('na Visão geral, ela é a tela ativa e nenhum grupo vem aberto', () => {
    const { menu } = montar({ endereco: '/financeiro' })
    expect(
      within(menu).getByRole('link', { name: 'Visão geral' }),
    ).toHaveAttribute('aria-current', 'page')
    expect(
      within(menu).queryAllByRole('button', { expanded: true }),
    ).toHaveLength(0)
  })

  it('o número do que espera alguém fica ao lado da tela, e o leitor de tela ouve "pendentes"', () => {
    const { menu } = montar({
      endereco: '/financeiro/compras',
      contadores: CONTADORES,
    })
    expect(
      within(menu).getByRole('link', { name: 'Compras 2 pendentes' }),
    ).toHaveAttribute('aria-current', 'page')
    expect(
      within(menu).getByRole('link', { name: 'Doações 3 pendentes' }),
    ).toBeInTheDocument()
    expect(
      within(menu).getByRole('link', { name: 'Reembolsos 1 pendente' }),
    ).toBeInTheDocument()
    // tela sem nada esperando não tem número
    expect(within(menu).getByRole('link', { name: 'Entradas' })).toBeInTheDocument()
  })

  it('quem só audita vê 2 grupos e 3 telas, sem a Visão geral e sem número de pendência', () => {
    const { menu } = montar({
      endereco: '/financeiro/conselho-fiscal',
      permissoes: AUDITA,
    })
    expect(
      within(menu).queryByRole('link', { name: 'Visão geral' }),
    ).not.toBeInTheDocument()
    expect(nomesDosGrupos(menu)).toEqual(['Relatórios', 'Controle'])
    expect(
      within(menu).getByRole('button', { name: /^Controle/ }),
    ).toHaveAccessibleName('Controle 2 telas')
    expect(
      within(menu).getByRole('button', { name: /^Relatórios/ }),
    ).toHaveAccessibleName('Relatórios 1 tela')
    const telas = itensVisiveis(financeiro, AUDITA).map((i) => i.rotulo)
    expect(telas).toEqual(['Relatórios', 'Conselho Fiscal', 'Auditoria financeira'])
    expect(within(menu).queryByText(/pendente/)).not.toBeInTheDocument()
  })

  it('sem violações de acessibilidade (axe), aberto e com números', async () => {
    guardar({ '/financeiro/compras': 3 })
    const { container } = montar({
      endereco: '/financeiro/compras',
      contadores: CONTADORES,
    })
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('"Seus mais usados" no alto do menu (v9.6b)', () => {
  it('as 4 telas mais abertas nos últimos 30 dias; no empate, a que vem antes no menu; a Visão geral não entra', () => {
    const agora = Date.now()
    guardar(
      {
        '/financeiro': 40,
        '/financeiro/compras': 10,
        '/financeiro/fornecedores': 5,
        '/financeiro/doacoes': 5,
        '/financeiro/razao-contabil': 2,
        '/financeiro/saidas': 1,
      },
      agora,
    )
    // uma abertura de 31 dias atrás não conta (e é jogada fora na próxima abertura)
    registrarAbertura(ID_USUARIO, '/financeiro/exercicios', agora - 31 * DIA)
    const { menu } = montar({ endereco: '/financeiro/saidas' })
    const lista = within(menu).getByRole('list', { name: 'Seus mais usados' })
    expect(
      within(lista)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Compras', 'Doações', 'Fornecedores', 'Razão contábil'])
    // os atalhos são só atalhos: a tela continua no grupo dela, que é quem marca a tela aberta
    const cadastros = within(menu).getByRole('button', { name: /^Cadastros/ })
    const grupoFechado = document.getElementById(
      cadastros.getAttribute('aria-controls')!,
    )!
    expect(grupoFechado).not.toBeVisible()
    expect(
      within(grupoFechado).getByRole('link', {
        name: 'Fornecedores',
        hidden: true,
      }),
    ).toBeInTheDocument()
    expect(
      within(lista).queryByRole('link', { current: 'page' }),
    ).not.toBeInTheDocument()
  })

  it('sem histórico, diz o que vai aparecer ali', () => {
    const { menu } = montar()
    expect(
      within(menu).getByText('As telas que você mais abrir aparecem aqui.'),
    ).toBeInTheDocument()
  })

  it('quem só audita só vê, nos mais usados, as telas que ele pode abrir', () => {
    guardar({ '/financeiro/compras': 9, '/financeiro/conselho-fiscal': 2 })
    const { menu } = montar({
      endereco: '/financeiro/conselho-fiscal',
      permissoes: AUDITA,
    })
    const lista = within(menu).getByRole('list', { name: 'Seus mais usados' })
    expect(
      within(lista)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Conselho Fiscal'])
  })

  it('cada pessoa tem a sua lista, e 30 dias depois a abertura sai da conta', () => {
    const agora = Date.now()
    registrarAbertura(ID_USUARIO, '/financeiro/compras', agora)
    registrarAbertura(99, '/financeiro/saidas', agora)
    expect(contarAberturas(ID_USUARIO, agora)).toEqual({
      '/financeiro/compras': 1,
    })
    expect(contarAberturas(99, agora)).toEqual({ '/financeiro/saidas': 1 })
    expect(contarAberturas(ID_USUARIO, agora + 31 * DIA)).toEqual({})
    expect(contarAberturas(undefined)).toEqual({})
  })

  it('sem a memória do navegador (bloqueada ou estragada), nada quebra e a lista fica vazia', () => {
    window.localStorage.setItem(`painel-mais-usados:${ID_USUARIO}`, '{estragado')
    expect(contarAberturas(ID_USUARIO)).toEqual({})
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('cheio')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    expect(() =>
      registrarAbertura(ID_USUARIO, '/financeiro/compras'),
    ).not.toThrow()
    expect(contarAberturas(ID_USUARIO)).toEqual({})
    const { menu } = montar()
    expect(
      within(menu).getByText('As telas que você mais abrir aparecem aqui.'),
    ).toBeInTheDocument()
  })

  it('maisUsados tira as telas sem permissão (só recebe as visíveis) e as que nunca foram abertas', () => {
    const visiveis = itensVisiveis(financeiro, AUDITA)
    expect(
      maisUsados(visiveis, {
        '/financeiro/compras': 10,
        '/financeiro/auditoria-financeira': 1,
      }).map((i) => i.rotulo),
    ).toEqual(['Auditoria financeira'])
  })
})

describe('a contagem das telas abertas (o Shell chama a cada endereço, v9.6b)', () => {
  // `null` = ainda sem saber quem é (os dados da pessoa não chegaram)
  function contar(
    pathname: string,
    permissoes = OPERA,
    id: number | null = ID_USUARIO,
  ) {
    return renderHook(
      ({ caminho }) =>
        useContarAberturaDaTela(
          financeiro,
          permissoes,
          id ?? undefined,
          caminho,
        ),
      { initialProps: { caminho: pathname } },
    )
  }

  it('conta a tela aberta uma vez por endereço (recarregar os dados não conta de novo); a ficha conta para a tela da lista', () => {
    const { rerender } = contar('/financeiro/compras')
    rerender({ caminho: '/financeiro/compras' })
    expect(contarAberturas(ID_USUARIO)).toEqual({ '/financeiro/compras': 1 })
    rerender({ caminho: '/financeiro/saidas' })
    rerender({ caminho: '/financeiro/compras' })
    expect(contarAberturas(ID_USUARIO)).toEqual({
      '/financeiro/compras': 2,
      '/financeiro/saidas': 1,
    })
  })

  it('não conta a Visão geral, a tela que a pessoa não pode abrir, nem sem saber quem é', () => {
    contar('/financeiro')
    contar('/financeiro/compras', AUDITA)
    contar('/financeiro/saidas', OPERA, null)
    expect(contarAberturas(ID_USUARIO)).toEqual({})
  })

  it('módulo ainda sem o menu novo (sem grupos) não conta', () => {
    const comunicacao = modulos.find((m) => m.rota === '/comunicacao')!
    expect(comunicacao.grupos).toBeUndefined()
    renderHook(() =>
      useContarAberturaDaTela(
        comunicacao,
        ['comunicar'],
        ID_USUARIO,
        comunicacao.itens![0]!.rota,
      ),
    )
    expect(contarAberturas(ID_USUARIO)).toEqual({})
  })
})

describe('menu recolhido: um ícone por grupo, a lista ao lado (v9.6b)', () => {
  it('mostra Início, a Visão geral e um botão por grupo, com a soma das pendências do grupo', () => {
    const { menu } = montar({
      endereco: '/financeiro/compras',
      recolhido: true,
      contadores: CONTADORES,
    })
    expect(within(menu).getByRole('link', { name: 'Início' })).toHaveAttribute(
      'href',
      '/',
    )
    expect(
      within(menu).getByRole('link', { name: 'Visão geral' }),
    ).toHaveAttribute('href', '/financeiro')
    expect(nomesDosGrupos(menu)).toEqual([
      'Dia a dia',
      'Rotina do mês',
      'Cadastros',
      'Relatórios',
      'Controle',
    ])
    // Compras 2 + Doações 3 + Reembolsos 1
    expect(
      within(menu).getByRole('button', { name: 'Dia a dia 6 pendentes' }),
    ).toBeInTheDocument()
    expect(
      within(menu).getByRole('button', { name: 'Rotina do mês 1 pendente' }),
    ).toBeInTheDocument()
    expect(
      within(menu).getByRole('button', { name: 'Cadastros' }),
    ).toBeInTheDocument()
    // as telas só aparecem com a lista aberta
    expect(
      within(menu).queryByRole('link', { name: /Compras/ }),
    ).not.toBeInTheDocument()
  })

  it('o grupo abre a lista ao lado com o foco na primeira tela; Esc fecha e devolve o foco ao botão', async () => {
    const { menu } = montar({
      endereco: '/financeiro/compras',
      recolhido: true,
      contadores: CONTADORES,
    })
    const botao = within(menu).getByRole('button', { name: /^Dia a dia/ })
    expect(botao).toHaveAttribute('aria-expanded', 'false')
    expect(botao).not.toHaveAttribute('aria-controls')
    await userEvent.click(botao)
    expect(botao).toHaveAttribute('aria-expanded', 'true')
    const lista = within(menu).getByRole('group', { name: 'Dia a dia' })
    expect(botao).toHaveAttribute('aria-controls', lista.id)
    expect(within(lista).getByRole('link', { name: 'Entradas' })).toHaveFocus()
    expect(
      within(lista).getByRole('link', { name: 'Compras 2 pendentes' }),
    ).toHaveAttribute('aria-current', 'page')
    await userEvent.keyboard('{Escape}')
    expect(
      within(menu).queryByRole('group', { name: 'Dia a dia' }),
    ).not.toBeInTheDocument()
    expect(botao).toHaveFocus()
    expect(botao).toHaveAttribute('aria-expanded', 'false')
  })

  it('clicar fora, no botão de fechar ou numa tela fecha a lista; outro grupo troca a lista', async () => {
    const { menu } = montar({ endereco: '/financeiro/compras', recolhido: true })
    const cadastros = within(menu).getByRole('button', { name: 'Cadastros' })
    await userEvent.click(cadastros)
    expect(within(menu).getByRole('group', { name: 'Cadastros' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'fora do menu' }))
    expect(within(menu).queryByRole('group')).not.toBeInTheDocument()

    await userEvent.click(cadastros)
    await userEvent.click(
      within(menu).getByRole('button', { name: 'Fechar a lista de Cadastros' }),
    )
    expect(within(menu).queryByRole('group')).not.toBeInTheDocument()
    expect(cadastros).toHaveFocus()

    await userEvent.click(cadastros)
    await userEvent.click(within(menu).getByRole('button', { name: 'Controle' }))
    expect(within(menu).queryByRole('group', { name: 'Cadastros' })).not.toBeInTheDocument()
    const controle = within(menu).getByRole('group', { name: 'Controle' })
    await userEvent.click(within(controle).getByRole('link', { name: 'Conselho Fiscal' }))
    expect(within(menu).queryByRole('group')).not.toBeInTheDocument()
  })

  it('quem só audita vê, recolhido, só os 2 grupos dele e nenhuma Visão geral', () => {
    const { menu } = montar({
      endereco: '/financeiro/conselho-fiscal',
      permissoes: AUDITA,
      recolhido: true,
    })
    expect(nomesDosGrupos(menu)).toEqual(['Relatórios', 'Controle'])
    expect(
      within(menu).queryByRole('link', { name: 'Visão geral' }),
    ).not.toBeInTheDocument()
  })

  it('sem violações de acessibilidade (axe), com a lista aberta', async () => {
    const { menu, container } = montar({
      endereco: '/financeiro/compras',
      recolhido: true,
      contadores: CONTADORES,
    })
    await userEvent.click(within(menu).getByRole('button', { name: /^Dia a dia/ }))
    expect(await axe(container)).toHaveNoViolations()
  })
})
