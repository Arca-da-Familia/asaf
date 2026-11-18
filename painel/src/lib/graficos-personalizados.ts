import { useMemo, useSyncExternalStore } from 'react'

// v9.5h: o "Personalizar" do painel de Gráficos dos associados (pedido do Presidente na rodada 5: "melhorar o personalizar"; e "não quero salvar,
// que toda vez que eu entre volte aos predefinidos" - por isso há "Usar só desta vez" e "Voltar ao painel padrão"). A escolha fica guardada NESTE
// navegador, separada por pessoa (a chave leva o número do login), como o menu recolhido; o painel dos outros não muda. O que está guardado é lido
// como dado desconhecido: o que não for reconhecido é ignorado e o padrão vale.

export type IdDoGrafico =
  | 'mes'
  | 'situacao'
  | 'quadro'
  | 'categoria'
  | 'idade'
  | 'filiacao'
  | 'bairro'
  | 'tempo'

export type GraficoDoCatalogo = {
  id: IdDoGrafico
  titulo: string
  explica: string
  // largo ocupa meia linha no computador; normal, um terço
  largo: boolean
  padrao: boolean
}

// na ordem do painel padrão (o desenho aprovado: entradas e saídas e a situação em cima; categoria, idade e filiação embaixo; depois o tamanho do quadro)
export const CATALOGO_DE_GRAFICOS: GraficoDoCatalogo[] = [
  {
    id: 'mes',
    titulo: 'Entradas e saídas por mês',
    explica: 'Quantos entraram e quantos saíram em cada mês do período',
    largo: true,
    padrao: true,
  },
  {
    id: 'situacao',
    titulo: 'Por situação',
    explica: 'Em dia, inadimplente, em experiência, licenciado...',
    largo: true,
    padrao: true,
  },
  {
    id: 'categoria',
    titulo: 'Por categoria',
    explica: 'A divisão do quadro entre as categorias',
    largo: false,
    padrao: true,
  },
  {
    id: 'idade',
    titulo: 'Faixa de idade',
    explica: 'Quantos em cada faixa de idade',
    largo: false,
    padrao: true,
  },
  {
    id: 'filiacao',
    titulo: 'Filiação: do pedido à aprovação',
    explica: 'Os pedidos recebidos no período e onde estão',
    largo: false,
    padrao: true,
  },
  {
    id: 'quadro',
    titulo: 'Tamanho do quadro',
    explica: 'Quantos estavam no quadro no fim de cada mês',
    largo: true,
    padrao: true,
  },
  {
    id: 'bairro',
    titulo: 'Onde moram',
    explica: 'Os bairros com mais associados',
    largo: false,
    padrao: false,
  },
  {
    id: 'tempo',
    titulo: 'Tempo de associação',
    explica: 'Há quanto tempo cada um entrou',
    largo: false,
    padrao: false,
  },
]

export type FiltrosGuardados = {
  meses?: string
  situacao?: string
  categoria?: string
  bairro?: string
}

export type Arranjo = {
  numeros: boolean
  graficos: { id: IdDoGrafico; visivel: boolean }[]
  // os filtros com que o painel abre (só quando a pessoa pediu)
  filtros?: FiltrosGuardados
}

export function arranjoPadrao(): Arranjo {
  return {
    numeros: true,
    graficos: CATALOGO_DE_GRAFICOS.map((g) => ({
      id: g.id,
      visivel: g.padrao,
    })),
  }
}

export function mesmoArranjo(a: Arranjo, b: Arranjo): boolean {
  return (
    a.numeros === b.numeros &&
    a.graficos.length === b.graficos.length &&
    a.graficos.every(
      (g, i) =>
        g.id === b.graficos[i]?.id && g.visivel === b.graficos[i]?.visivel,
    ) &&
    JSON.stringify(a.filtros ?? null) === JSON.stringify(b.filtros ?? null)
  )
}

const chave = (idUsuario: number) => `asaf.graficos-associados.${idUsuario}`
const IDS = new Set<string>(CATALOGO_DE_GRAFICOS.map((g) => g.id))
const FILTROS = ['meses', 'situacao', 'categoria', 'bairro'] as const

// o que veio do navegador vira um arranjo válido: gráficos desconhecidos ou repetidos saem; os que faltam (um gráfico novo numa versão futura) entram no
// fim, com a visibilidade do padrão
function limpar(dado: unknown): Arranjo | null {
  if (!dado || typeof dado !== 'object') return null
  const bruto = dado as Record<string, unknown>
  if (!Array.isArray(bruto.graficos)) return null
  const vistos = new Set<string>()
  const graficos: Arranjo['graficos'] = []
  for (const item of bruto.graficos) {
    if (!item || typeof item !== 'object') continue
    const { id, visivel } = item as Record<string, unknown>
    if (typeof id !== 'string' || !IDS.has(id) || vistos.has(id)) continue
    vistos.add(id)
    graficos.push({ id: id as IdDoGrafico, visivel: visivel === true })
  }
  for (const g of CATALOGO_DE_GRAFICOS)
    if (!vistos.has(g.id)) graficos.push({ id: g.id, visivel: g.padrao })
  const arranjo: Arranjo = { numeros: bruto.numeros !== false, graficos }
  if (bruto.filtros && typeof bruto.filtros === 'object') {
    const filtros: FiltrosGuardados = {}
    for (const nome of FILTROS) {
      const valor = (bruto.filtros as Record<string, unknown>)[nome]
      if (typeof valor === 'string' && valor) filtros[nome] = valor
    }
    arranjo.filtros = filtros
  }
  return arranjo
}

export function arranjoDoTexto(texto: string | null): Arranjo | null {
  if (!texto) return null
  try {
    return limpar(JSON.parse(texto))
  } catch {
    // texto estragado: vale o padrão
    return null
  }
}

function lerTexto(idUsuario: number): string | null {
  try {
    return window.localStorage.getItem(chave(idUsuario))
  } catch {
    // navegador sem armazenamento (janela anônima, bloqueio): vale o padrão
    return null
  }
}

const EVENTO = 'asaf-graficos-personalizados'

function assinar(avisar: () => void): () => void {
  window.addEventListener(EVENTO, avisar)
  window.addEventListener('storage', avisar)
  return () => {
    window.removeEventListener(EVENTO, avisar)
    window.removeEventListener('storage', avisar)
  }
}

// o arranjo guardado por esta pessoa neste navegador (ou null); a tela se atualiza sozinha quando ele muda (inclusive em outra aba)
export function useArranjoGuardado(
  idUsuario: number | undefined,
): Arranjo | null {
  const texto = useSyncExternalStore(
    assinar,
    () => (idUsuario ? lerTexto(idUsuario) : null),
    () => null,
  )
  return useMemo(() => arranjoDoTexto(texto), [texto])
}

export function guardarArranjo(idUsuario: number, arranjo: Arranjo): boolean {
  try {
    window.localStorage.setItem(chave(idUsuario), JSON.stringify(arranjo))
    window.dispatchEvent(new Event(EVENTO))
    return true
  } catch {
    return false
  }
}

export function apagarArranjoGuardado(idUsuario: number): void {
  try {
    window.localStorage.removeItem(chave(idUsuario))
    window.dispatchEvent(new Event(EVENTO))
  } catch {
    // sem armazenamento: não há o que apagar
  }
}
