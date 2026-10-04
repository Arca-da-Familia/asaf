/**
 * Composição da Diretoria e do Conselho Fiscal (v5.4b): os cargos vêm do ESTATUTO (Art. 19: Diretoria Executiva com sete
 * cargos; Art. 24: Conselho Fiscal com três membros) e os OCUPANTES vêm do sistema (mandatos vigentes). A página mostra
 * todos os cargos desde o primeiro dia; o cargo sem ocupante registrado aparece como "ocupante ainda não publicado" (não
 * "vago": a diretoria pode estar empossada e ainda não registrada no sistema) e se preenche sozinho quando o mandato é
 * registrado.
 */
import type { MembroDaDiretoria } from '../../scripts/lib/conteudo-publico.mjs'

export interface Assento {
  /** Código do cargo no catálogo do sistema (nunca muda). */
  codigo: string
  rotulo: string
  /** Artigo do Estatuto que cria o cargo. */
  artigo: string
}

export const ORGAO_DIRETORIA = 'DIRETORIA_EXECUTIVA'
export const ORGAO_CONSELHO = 'CONSELHO_FISCAL'

/** Art. 19, na ordem do Estatuto. */
export const CARGOS_DA_DIRETORIA: Assento[] = [
  { codigo: 'PRESIDENTE', rotulo: 'Presidente', artigo: 'Art. 19, I' },
  {
    codigo: 'VICE_PRESIDENTE',
    rotulo: '1º Vice-Presidente',
    artigo: 'Art. 19, II',
  },
  {
    codigo: 'VICE_PRESIDENTE_2',
    rotulo: '2º Vice-Presidente',
    artigo: 'Art. 19, III',
  },
  { codigo: 'SECRETARIO', rotulo: '1º Secretário', artigo: 'Art. 19, IV' },
  { codigo: 'VICE_SECRETARIO', rotulo: '2º Secretário', artigo: 'Art. 19, V' },
  { codigo: 'TESOUREIRO', rotulo: '1º Tesoureiro', artigo: 'Art. 19, VI' },
  {
    codigo: 'VICE_TESOUREIRO',
    rotulo: '2º Tesoureiro',
    artigo: 'Art. 19, VII',
  },
]

/** Art. 24: o Conselho Fiscal é composto por três membros. */
export const CARGO_DO_CONSELHO: Assento = {
  codigo: 'CONSELHO_FISCAL',
  rotulo: 'Conselheiro Fiscal',
  artigo: 'Art. 24',
}
export const MEMBROS_DO_CONSELHO = 3

export interface CargoComOcupantes {
  assento: Assento
  ocupantes: MembroDaDiretoria[]
}

export interface Composicao {
  diretoria: CargoComOcupantes[]
  conselho: CargoComOcupantes[]
  /** Quantos dos três lugares do Conselho ainda não têm ocupante publicado. */
  lugaresDoConselhoSemOcupante: number
  /** Mandato vigente num cargo que não está no Estatuto (não some: aparece à parte). */
  outros: MembroDaDiretoria[]
  /** Há pelo menos um ocupante publicado? */
  temOcupantes: boolean
}

export function montarComposicao(membros: MembroDaDiretoria[]): Composicao {
  const usados = new Set<MembroDaDiretoria>()
  const doCargo = (orgao: string, codigo: string) => {
    const lista = membros.filter(
      (m) => m.orgao_codigo === orgao && m.cargo_codigo === codigo,
    )
    for (const m of lista) usados.add(m)
    return lista
  }

  const diretoria = CARGOS_DA_DIRETORIA.map((assento) => ({
    assento,
    ocupantes: doCargo(ORGAO_DIRETORIA, assento.codigo),
  }))
  const doConselho = doCargo(ORGAO_CONSELHO, CARGO_DO_CONSELHO.codigo)
  // Um cartão por conselheiro publicado; os lugares que faltam para os três viram cartão "sem ocupante publicado".
  const conselho: CargoComOcupantes[] = [
    ...doConselho.map((m) => ({ assento: CARGO_DO_CONSELHO, ocupantes: [m] })),
    ...Array.from(
      { length: Math.max(0, MEMBROS_DO_CONSELHO - doConselho.length) },
      () => ({ assento: CARGO_DO_CONSELHO, ocupantes: [] }),
    ),
  ]
  return {
    diretoria,
    conselho,
    lugaresDoConselhoSemOcupante: Math.max(
      0,
      MEMBROS_DO_CONSELHO - doConselho.length,
    ),
    outros: membros.filter((m) => !usados.has(m)),
    temOcupantes: membros.length > 0,
  }
}
