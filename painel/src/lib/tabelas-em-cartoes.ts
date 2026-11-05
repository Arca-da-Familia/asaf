import { useEffect, type RefObject } from 'react'

// v9.3b (pedido do Presidente, 05/11: "tabelas no telefone, trocar por cartões empilhados, mais confortável"): no celular, cada linha de tabela vira um
// CARTÃO com "Rótulo: valor" empilhados. Uma peça só para todas as tabelas do painel (a padrão, DataTable, e as 20 próprias das telas), sem mexer em cada
// uma: este ajudante copia o título de cada coluna para as células dela (`data-rotulo`) e marca a tabela (`data-em-cartoes`); o desenho de cartão é do
// index.css e só vale abaixo de 640 px. As funções de tabela vão escritas (role) porque o celular desenha as partes da tabela como blocos, e alguns
// navegadores deixam de anunciá-la como tabela ao leitor de tela quando isso acontece. Tabela que é uma GRADE (o mapa de calor dia × hora) fica de fora
// com `data-sem-cartao`.

function textoDoTitulo(th: Element): string {
  return (th.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** Rotula as células das tabelas dentro de `raiz` com o título da coluna e marca as tabelas que viram cartões no celular. */
export function rotularTabelas(raiz: ParentNode): void {
  for (const tabela of raiz.querySelectorAll('table')) {
    if (tabela.hasAttribute('data-sem-cartao')) continue
    const linhasDoTopo = tabela.tHead?.rows
    if (!linhasDoTopo || linhasDoTopo.length === 0) continue
    // o título de cada coluna, contando os que ocupam mais de uma (colSpan)
    const titulos: string[] = []
    const ultimaDoTopo = linhasDoTopo[linhasDoTopo.length - 1]
    if (!ultimaDoTopo) continue
    for (const th of ultimaDoTopo.cells) {
      for (let i = 0; i < Math.max(1, th.colSpan); i++)
        titulos.push(textoDoTitulo(th))
    }
    tabela.setAttribute('data-em-cartoes', '')
    tabela.setAttribute('role', 'table')
    tabela.tHead?.setAttribute('role', 'rowgroup')
    for (const tr of linhasDoTopo) {
      tr.setAttribute('role', 'row')
      for (const th of tr.cells) th.setAttribute('role', 'columnheader')
    }
    for (const corpo of tabela.tBodies) {
      corpo.setAttribute('role', 'rowgroup')
      for (const tr of corpo.rows) {
        tr.setAttribute('role', 'row')
        let coluna = 0
        for (const celula of tr.cells) {
          celula.setAttribute(
            'role',
            celula.tagName === 'TH' ? 'rowheader' : 'cell',
          )
          const titulo = titulos[coluna]
          // célula que ocupa a linha inteira (o "nada encontrado") ou coluna sem título (ações): sem rótulo
          if (titulo && celula.colSpan < titulos.length)
            celula.setAttribute('data-rotulo', titulo)
          else celula.removeAttribute('data-rotulo')
          coluna += Math.max(1, celula.colSpan)
        }
      }
    }
  }
}

/** Mantém as tabelas dentro de `ref` rotuladas enquanto a tela muda (dados chegando, página trocada, filtro). */
export function useTabelasEmCartoes(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const raiz = ref.current
    if (!raiz) return
    let agendado = 0
    const rotular = () => {
      agendado = 0
      observador.disconnect()
      rotularTabelas(raiz)
      observador.observe(raiz, {
        childList: true,
        subtree: true,
        characterData: true,
      })
    }
    const observador = new MutationObserver(() => {
      if (!agendado) agendado = requestAnimationFrame(rotular)
    })
    rotular()
    return () => {
      observador.disconnect()
      if (agendado) cancelAnimationFrame(agendado)
    }
  }, [ref])
}
