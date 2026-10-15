/**
 * Composição da Diretoria e do Conselho Fiscal (v5.4b): os cargos vêm do ESTATUTO (Art. 19: Diretoria Executiva com sete
 * cargos; Art. 24: Conselho Fiscal com três membros) e os OCUPANTES vêm do sistema (mandatos vigentes). A página mostra
 * todos os cargos desde o primeiro dia; o cargo sem ocupante registrado aparece como "ocupante ainda não publicado" (não
 * "vago": a diretoria pode estar empossada e ainda não registrada no sistema) e se preenche sozinho quando o mandato é
 * registrado.
 *
 * v5.7c: cada ocupante pode ter a FOTO (só de quem autorizou o uso da imagem); o Presidente fica em destaque e quem não tem foto ganha o círculo de
 * iniciais (`iniciaisDoNome`). As funções daqui são puras: a página e o cartão (components/CartaoDeMembro.astro) só as aplicam.
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
/** O cargo que a página mostra em destaque, maior que os demais: o Presidente, primeiro do Art. 19. */
export const CARGO_EM_DESTAQUE = 'PRESIDENTE'

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
  /** O primeiro cargo da Diretoria (o Presidente) aparece em destaque, maior que os demais (v5.7c). */
  destaque: boolean
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

  const diretoria: CargoComOcupantes[] = CARGOS_DA_DIRETORIA.map((assento) => ({
    assento,
    ocupantes: doCargo(ORGAO_DIRETORIA, assento.codigo),
    destaque: assento.codigo === CARGO_EM_DESTAQUE,
  }))
  const doConselho = doCargo(ORGAO_CONSELHO, CARGO_DO_CONSELHO.codigo)
  // Um cartão por conselheiro publicado; os lugares que faltam para os três viram cartão "sem ocupante publicado".
  const conselho: CargoComOcupantes[] = [
    ...doConselho.map((m) => ({
      assento: CARGO_DO_CONSELHO,
      ocupantes: [m],
      destaque: false,
    })),
    ...Array.from(
      { length: Math.max(0, MEMBROS_DO_CONSELHO - doConselho.length) },
      () => ({ assento: CARGO_DO_CONSELHO, ocupantes: [], destaque: false }),
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

/** Palavras de ligação que não entram nas iniciais ("Maria de Teste da Silva" -> "MS"). */
const PALAVRAS_DE_LIGACAO = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])

/**
 * As iniciais do círculo de quem não tem foto (v5.7c): a primeira letra do primeiro nome e a do último sobrenome, sem as palavras de ligação
 * ("de", "da", "do", "das", "dos", "e"). Um nome só vale uma letra. Em maiúscula, com acento mantido ("Ágata" -> "Á"); palavra sem letra
 * (número, sinal) não conta. Nome vazio devolve texto vazio.
 */
export function iniciaisDoNome(nome: string): string {
  const letras = nome
    .split(/\s+/)
    .filter((palavra) => !PALAVRAS_DE_LIGACAO.has(palavra.toLowerCase()))
    .map((palavra) => /^[^\p{L}\p{N}]*(\p{L})/u.exec(palavra)?.[1])
    .filter((letra): letra is string => letra !== undefined)
  if (letras.length === 0) return ''
  const escolhidas =
    letras.length === 1 ? [letras[0]!] : [letras[0]!, letras.at(-1)!]
  return escolhidas.join('').toLocaleUpperCase('pt-BR')
}

/**
 * O nome do Presidente da Diretoria Executiva (mandato vigente publicado pelo sistema), ou `null` se o mandato ainda não foi registrado. É quem a Política de
 * Privacidade nomeia como encarregado pelo tratamento de dados pessoais (decisão do Presidente, 2026-10-09: a associação não tem segunda pessoa para o papel).
 */
export function presidenteDaDiretoria(
  membros: MembroDaDiretoria[],
): string | null {
  return (
    membros.find(
      (m) =>
        m.orgao_codigo === ORGAO_DIRETORIA &&
        m.cargo_codigo === 'PRESIDENTE' &&
        m.nome.trim() !== '',
    )?.nome ?? null
  )
}
