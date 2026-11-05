import { describe, expect, it } from 'vitest'

import { rotularTabelas } from '@/lib/tabelas-em-cartoes'

// v9.3b: no celular cada linha de tabela vira um cartão com o título da coluna antes do valor; o ajudante copia os títulos para as células.
function montar(html: string): HTMLElement {
  const raiz = document.createElement('main')
  raiz.innerHTML = html
  rotularTabelas(raiz)
  return raiz
}

describe('tabelas em cartões no celular', () => {
  it('cada célula ganha o título da sua coluna e a tabela é marcada, com as funções de tabela escritas', () => {
    const raiz =
      montar(`<table><thead><tr><th>Nome</th><th>CPF</th><th></th></tr></thead>
      <tbody><tr><td>Ana</td><td>***-14</td><td><button>Editar</button></td></tr></tbody></table>`)
    const tabela = raiz.querySelector('table')!
    expect(tabela.hasAttribute('data-em-cartoes')).toBe(true)
    expect(tabela.getAttribute('role')).toBe('table')
    const celulas = [...raiz.querySelectorAll('tbody td')]
    expect(celulas.map((c) => c.getAttribute('data-rotulo'))).toEqual([
      'Nome',
      'CPF',
      null,
    ])
    expect(celulas.every((c) => c.getAttribute('role') === 'cell')).toBe(true)
    expect(raiz.querySelector('thead th')!.getAttribute('role')).toBe(
      'columnheader',
    )
  })

  it('título que ocupa duas colunas vale para as duas; a célula que ocupa a linha inteira ("nada encontrado") fica sem rótulo', () => {
    const raiz =
      montar(`<table><thead><tr><th colspan="2">Período</th><th>Valor</th></tr></thead>
      <tbody><tr><td>01/11</td><td>30/11</td><td>R$ 10,00</td></tr><tr><td colspan="3">Nada encontrado</td></tr></tbody></table>`)
    const [l1, l2] = raiz.querySelectorAll('tbody tr')
    expect(
      [...l1!.querySelectorAll('td')].map((c) => c.getAttribute('data-rotulo')),
    ).toEqual(['Período', 'Período', 'Valor'])
    expect(l2!.querySelector('td')!.hasAttribute('data-rotulo')).toBe(false)
  })

  it('tabela marcada como grade (data-sem-cartao) ou sem cabeçalho fica como está', () => {
    const raiz =
      montar(`<table data-sem-cartao><thead><tr><th>Hora</th></tr></thead><tbody><tr><td>8h</td></tr></tbody></table>
      <table><tbody><tr><td>solta</td></tr></tbody></table>`)
    for (const t of raiz.querySelectorAll('table'))
      expect(t.hasAttribute('data-em-cartoes')).toBe(false)
    expect(raiz.querySelector('[data-rotulo]')).toBeNull()
  })

  it('rotular de novo (a tela mudou) acompanha a mudança, sem repetir nem deixar rótulo velho', () => {
    const raiz = montar(
      `<table><thead><tr><th>Nome</th><th>Situação</th></tr></thead><tbody><tr><td>Ana</td><td>Ativa</td></tr></tbody></table>`,
    )
    raiz.querySelector('thead th:nth-child(2)')!.textContent = 'Situação nova'
    rotularTabelas(raiz)
    expect(
      raiz.querySelector('tbody td:nth-child(2)')!.getAttribute('data-rotulo'),
    ).toBe('Situação nova')
  })
})
