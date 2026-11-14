// v9.5c (desenho aprovado pelo Presidente, rodada 4, 13/11) - a coluna verde do módulo pode ser recolhida em ícones pelo botão do alto. A escolha fica guardada
// neste navegador (é conveniência de quem usa, não dado do sistema) e as telas leem por este contexto: a ficha do associado, com o menu recolhido, leva as
// abas para uma coluna à direita (rodada 5).
import { createContext, useContext } from 'react'

import type { ItemModulo } from './modulos'
import { cn } from './utils'

const CHAVE = 'painel-menu-do-modulo-recolhido'

export function lerMenuRecolhido(): boolean {
  try {
    return window.localStorage.getItem(CHAVE) === '1'
  } catch {
    return false // sem memória do navegador (aba anônima, bloqueio): começa aberto
  }
}

export function guardarMenuRecolhido(recolhido: boolean): void {
  try {
    window.localStorage.setItem(CHAVE, recolhido ? '1' : '0')
  } catch {
    // sem memória do navegador: a escolha vale só enquanto a página estiver aberta
  }
}

export const MenuRecolhidoContext = createContext(false)

export function useMenuDoModuloRecolhido(): boolean {
  return useContext(MenuRecolhidoContext)
}

export type GrupoDoMenu = { nome: string; itens: ItemModulo[] }

// Junta os itens pelo `grupo` (na ordem em que o primeiro item de cada grupo aparece). Módulo sem nenhum grupo devolve um grupo só, sem nome: a lista fica
// como sempre foi, sem lista suspensa (os módulos ganham grupos um a um, na rodada de desenho de cada um).
export function agruparItens(itens: ItemModulo[]): GrupoDoMenu[] {
  if (!itens.some((i) => i.grupo)) return [{ nome: '', itens }]
  const grupos: GrupoDoMenu[] = []
  for (const item of itens) {
    const nome = item.grupo ?? 'Outras telas'
    const grupo = grupos.find((g) => g.nome === nome)
    if (grupo) grupo.itens.push(item)
    else grupos.push({ nome, itens: [item] })
  }
  return grupos
}

// O item da rota aberta: o de rota igual, senão o de rota mais longa que começa a rota aberta (ex.: /associados/12 é da lista, /associados).
export function itemDaRota(
  itens: ItemModulo[],
  caminho: string,
): ItemModulo | undefined {
  const exato = itens.find((i) => i.rota === caminho)
  if (exato) return exato
  return itens
    .filter((i) => caminho.startsWith(`${i.rota}/`))
    .sort((a, b) => b.rota.length - a.rota.length)[0]
}

// as cores da coluna verde (os pares texto/fundo estão em src/test/tokens-contraste.test.ts)
export function navNaColuna({ isActive }: { isActive: boolean }) {
  return cn(
    'flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
    isActive
      ? 'bg-brand-secondary font-bold text-brand-secondary-foreground'
      : 'font-medium text-barra-foreground hover:bg-barra-2',
  )
}
