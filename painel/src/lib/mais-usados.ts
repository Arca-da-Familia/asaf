// v9.6b (escolha do Presidente, rodada 7b, `fin-menu-2`: "Os cinco grupos, com os seus mais usados no alto") - as telas que ESTA pessoa mais abriu nos
// últimos 30 dias, para os quadradinhos "Seus mais usados" no alto do menu do módulo e para os lugares da Visão geral. Fica guardado neste navegador: é
// conveniência de quem usa, não dado do sistema (não vai ao servidor nem a outro aparelho). Cada pessoa tem a sua lista (a chave leva o número do usuário);
// sem a memória do navegador (aba anônima, bloqueio), a lista fica vazia e nada quebra. Nenhuma tela sai do grupo dela: os quadradinhos são só atalhos.
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

import { itemDaRota } from './menu-do-modulo'
import { itensVisiveis, type ItemModulo, type Modulo } from './modulos'

const PREFIXO = 'painel-mais-usados:'
export const DIAS_DOS_MAIS_USADOS = 30
const JANELA_MS = DIAS_DOS_MAIS_USADOS * 24 * 60 * 60 * 1000
// guarda no máximo este tanto de aberturas por tela (o bastante para contar 30 dias de uso intenso, sem a memória crescer sem fim)
const MAXIMO_POR_TELA = 300
export const QUANTOS_MAIS_USADOS = 4

type Aberturas = Record<string, number[]>

const chave = (idUsuario: number) => `${PREFIXO}${idUsuario}`

function ler(idUsuario: number): Aberturas {
  try {
    const bruto = window.localStorage.getItem(chave(idUsuario))
    if (!bruto) return {}
    const dados: unknown = JSON.parse(bruto)
    if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return {}
    const limpas: Aberturas = {}
    for (const [rota, vezes] of Object.entries(dados)) {
      if (Array.isArray(vezes))
        limpas[rota] = vezes.filter(
          (v): v is number => typeof v === 'number' && Number.isFinite(v),
        )
    }
    return limpas
  } catch {
    return {} // memória do navegador bloqueada ou valor estragado: começa do zero
  }
}

const ouvintes = new Set<() => void>()
let versao = 0

function avisar() {
  versao += 1
  for (const ouvinte of ouvintes) ouvinte()
}

// Conta uma abertura da tela (o Shell chama quando a pessoa chega numa tela do módulo). As aberturas de mais de 30 dias são jogadas fora aqui.
export function registrarAbertura(
  idUsuario: number,
  rota: string,
  agora = Date.now(),
): void {
  const desde = agora - JANELA_MS
  const recentes: Aberturas = {}
  for (const [r, vezes] of Object.entries(ler(idUsuario))) {
    const dentro = vezes.filter((v) => v > desde)
    if (dentro.length) recentes[r] = dentro
  }
  recentes[rota] = [...(recentes[rota] ?? []), agora].slice(-MAXIMO_POR_TELA)
  try {
    window.localStorage.setItem(chave(idUsuario), JSON.stringify(recentes))
  } catch {
    return // sem memória do navegador: os mais usados ficam como estavam
  }
  avisar()
}

// Quantas vezes a pessoa abriu cada tela nos últimos 30 dias (só as que ela abriu)
export function contarAberturas(
  idUsuario: number | undefined,
  agora = Date.now(),
): Record<string, number> {
  if (idUsuario === undefined) return {}
  const desde = agora - JANELA_MS
  const contagem: Record<string, number> = {}
  for (const [rota, vezes] of Object.entries(ler(idUsuario))) {
    const n = vezes.filter((v) => v > desde).length
    if (n) contagem[rota] = n
  }
  return contagem
}

function assinar(aviso: () => void) {
  ouvintes.add(aviso)
  // outra aba do mesmo navegador também conta
  const deOutraAba = (evento: StorageEvent) => {
    if (evento.key?.startsWith(PREFIXO)) {
      versao += 1
      aviso()
    }
  }
  window.addEventListener('storage', deOutraAba)
  return () => {
    ouvintes.delete(aviso)
    window.removeEventListener('storage', deOutraAba)
  }
}

const versaoAtual = () => versao

// As aberturas da pessoa, atualizadas a cada tela aberta (em qualquer componente que use este gancho)
export function useAberturas(idUsuario?: number): Record<string, number> {
  const v = useSyncExternalStore(assinar, versaoAtual, versaoAtual)
  return useMemo(() => {
    void v // a versão só serve para recontar quando muda
    return contarAberturas(idUsuario)
  }, [idUsuario, v])
}

// As telas mais abertas (até 4): a mais aberta primeiro e, no empate, a que vem antes no menu. A Visão geral (fixa) não entra: ela já está sempre no alto.
export function maisUsados(
  itens: ItemModulo[],
  contagem: Record<string, number>,
  quantos = QUANTOS_MAIS_USADOS,
): ItemModulo[] {
  return itens
    .map((item, ordem) => ({ item, ordem, vezes: contagem[item.rota] ?? 0 }))
    .filter((x) => !x.item.fixo && x.vezes > 0)
    .sort((a, b) => b.vezes - a.vezes || a.ordem - b.ordem)
    .slice(0, quantos)
    .map((x) => x.item)
}

// O Shell chama a cada tela aberta: conta a abertura se o módulo tem o menu novo (`grupos`) e a tela é uma das que a pessoa vê. A Visão geral (fixa) não
// conta, porque já fica sempre no alto; a mesma tela não conta de novo só porque os dados da pessoa foram recarregados (só conta quando o endereço muda).
export function useContarAberturaDaTela(
  modulo: Modulo | undefined,
  permissoes: string[],
  idUsuario: number | undefined,
  pathname: string,
): void {
  const ultimaContada = useRef('')
  const item =
    modulo?.grupos && idUsuario !== undefined
      ? itemDaRota(itensVisiveis(modulo, permissoes), pathname)
      : undefined
  const rota = item && !item.fixo ? item.rota : ''
  useEffect(() => {
    if (idUsuario === undefined || !rota) return
    const marca = `${idUsuario}|${pathname}`
    if (ultimaContada.current === marca) return
    ultimaContada.current = marca
    registrarAbertura(idUsuario, rota)
  }, [idUsuario, pathname, rota])
}
