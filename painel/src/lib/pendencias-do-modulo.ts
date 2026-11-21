// v9.6b - os números de pendência do menu do módulo: ao lado de cada tela que tem algo esperando alguém ("Compras 2") e, na faixa recolhida, a soma no
// ícone do grupo. Cada módulo diz de onde vêm os seus números; por enquanto só o Financeiro tem (`GET /api/financeiro/pendencias`). Só pede quem opera
// (`financeiro`): quem só audita nem chama a rota (o servidor recusaria com 403).
import { useQuery } from '@tanstack/react-query'

import { obterPendenciasDoFinanceiro } from './api'
import type { ItemModulo, Modulo } from './modulos'

export const CHAVE_DAS_PENDENCIAS_DO_FINANCEIRO = [
  'financeiro',
  'pendencias',
] as const

export function podeVerPendenciasDoFinanceiro(permissoes: string[]): boolean {
  return permissoes.includes('financeiro')
}

export function usePendenciasDoFinanceiro(habilitado: boolean) {
  return useQuery({
    queryKey: CHAVE_DAS_PENDENCIAS_DO_FINANCEIRO,
    queryFn: obterPendenciasDoFinanceiro,
    enabled: habilitado,
    staleTime: 30_000,
  })
}

export function usePendenciasDoModulo(
  modulo: Modulo | undefined,
  permissoes: string[],
): Record<string, number> {
  const ehFinanceiro =
    modulo?.rota === '/financeiro' && podeVerPendenciasDoFinanceiro(permissoes)
  const { data } = usePendenciasDoFinanceiro(ehFinanceiro)
  return ehFinanceiro && data ? data.contadores : {}
}

export function pendenciasDoItem(
  item: ItemModulo,
  contadores: Record<string, number>,
): number {
  return item.pendencia ? (contadores[item.pendencia] ?? 0) : 0
}

export function pendenciasDosItens(
  itens: ItemModulo[],
  contadores: Record<string, number>,
): number {
  return itens.reduce((soma, i) => soma + pendenciasDoItem(i, contadores), 0)
}

export function textoDasPendencias(n: number): string {
  return n === 1 ? '1 pendente' : `${n} pendentes`
}
