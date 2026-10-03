/**
 * Estatuto Social da ASAF (v5.2) — lê o `ESTATUTO_ASAF.txt` da raiz do repositório (a MESMA fonte que
 * o sistema usa em `DocumentoEstatuto`) e o transforma em estrutura para a página `/estatuto/`.
 *
 * REGRA DE OURO: o texto jurídico não é reescrito. Este módulo só descobre a estrutura (capítulos,
 * artigos, parágrafos, incisos, alíneas) e junta as linhas quebradas à mão do arquivo em parágrafos.
 * Erros de português do original ("Assembléia", "apartir"...) ficam como estão: é o texto vigente.
 * `tests/estatuto.test.ts` prova que nenhuma palavra se perde, repete ou troca de ordem.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type TipoBloco = 'paragrafo' | 'item' | 'subitem' | 'verso'

export interface BlocoEstatuto {
  tipo: TipoBloco
  /** "I", "a", "§ 1º", "Parágrafo único" — vazio em parágrafo corrido. */
  marcador: string
  texto: string
}

export interface ArtigoEstatuto {
  numero: number
  /** "Art. 1º" (até o 9) / "Art. 12" (do 10 em diante) — a grafia jurídica brasileira. */
  rotulo: string
  blocos: BlocoEstatuto[]
}

export interface CapituloEstatuto {
  /** Numeral romano, como no original ("III"). */
  numeral: string
  titulo: string
  artigos: ArtigoEstatuto[]
}

export interface Estatuto {
  titulo: string
  sigla: string
  preambulo: string
  capitulos: CapituloEstatuto[]
}

const ROMANOS = 'I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII'
const RE_CAPITULO = /^CAPITULO\s+([IVX]+)\s*$/i
const RE_ARTIGO = /^ART\.\s*(\d+)\s*º?\s*(?:-\s*)?(.*)$/
const RE_PARAGRAFO_UNICO = /^Parágrafo\s+[ÚU]nico\s*-\s*(.*)$/i
const RE_PARAGRAFO_NUM = /^§\s*(\d+)\s*º?\s*-\s*(.*)$/
const RE_INCISO = new RegExp(`^(${ROMANOS})\\s*[-.]\\s*(.*)$`)
const RE_ALINEA = /^([a-z])\.\s+(.*)$/

/** "DO NOME, FUNÇÃO" -> "Do nome, função"; "Dos ASSOCIADOS" -> "Dos associados"; sem ponto final. */
export function normalizarTitulo(bruto: string): string {
  const palavras = bruto
    .trim()
    .replace(/\.$/, '')
    .split(/\s+/)
    .map((p) =>
      p === p.toLocaleUpperCase('pt-BR') && /\p{L}/u.test(p)
        ? p.toLocaleLowerCase('pt-BR')
        : p,
    )
  const frase = palavras.join(' ')
  return frase.charAt(0).toLocaleUpperCase('pt-BR') + frase.slice(1)
}

function rotuloDoArtigo(numero: number): string {
  return numero <= 9 ? `Art. ${numero}º` : `Art. ${numero}`
}

/**
 * Transforma o texto do Estatuto em estrutura. Aceita CRLF e LF (o arquivo é CRLF no Windows e LF
 * no CI). Levanta erro se a estrutura não bater com o que se espera (35 artigos em ordem): melhor o
 * build falhar do que publicar um Estatuto truncado.
 */
export function analisarEstatuto(fonte: string): Estatuto {
  const linhas = fonte.replace(/\r\n?/g, '\n').split('\n')

  const cabecalho: string[] = []
  const preambulo: string[] = []
  const capitulos: CapituloEstatuto[] = []
  let capitulo: CapituloEstatuto | null = null
  let artigo: ArtigoEstatuto | null = null
  let secao: 'cabecalho' | 'preambulo' | 'corpo' = 'cabecalho'
  let aguardaTituloDeCapitulo = false
  /** A linha anterior foi em branco: o próximo texto corrido abre um novo parágrafo. */
  let quebraDeParagrafo = false
  /** Dentro de um verso entre aspas (a oração do Art. 33): preserva a quebra de linha. */
  let emVerso = false

  const abrirBloco = (tipo: TipoBloco, marcador: string, texto: string) => {
    artigo!.blocos.push({ tipo, marcador, texto: texto.trim() })
    quebraDeParagrafo = false
  }
  const anexarAoUltimo = (texto: string) => {
    const ultimo = artigo!.blocos[artigo!.blocos.length - 1]!
    ultimo.texto = `${ultimo.texto} ${texto.trim()}`.trim()
  }

  for (const bruta of linhas) {
    const linha = bruta.trim()

    if (linha === '') {
      quebraDeParagrafo = true
      continue
    }

    if (secao === 'cabecalho') {
      if (/^PRE[ÂA]MBULO$/i.test(linha)) secao = 'preambulo'
      else cabecalho.push(linha)
      continue
    }

    const cap = RE_CAPITULO.exec(linha)
    if (cap) {
      secao = 'corpo'
      capitulo = { numeral: cap[1]!.toUpperCase(), titulo: '', artigos: [] }
      capitulos.push(capitulo)
      artigo = null
      aguardaTituloDeCapitulo = true
      emVerso = false
      continue
    }

    if (secao === 'preambulo') {
      preambulo.push(linha)
      continue
    }

    if (aguardaTituloDeCapitulo) {
      capitulo!.titulo = normalizarTitulo(linha)
      aguardaTituloDeCapitulo = false
      continue
    }

    const art = RE_ARTIGO.exec(linha)
    if (art && capitulo) {
      const numero = Number(art[1])
      artigo = { numero, rotulo: rotuloDoArtigo(numero), blocos: [] }
      capitulo.artigos.push(artigo)
      emVerso = false
      abrirBloco('paragrafo', '', art[2] ?? '')
      continue
    }

    if (!artigo) continue

    // Verso: linha recuada que abre aspas (a oração oficial do Art. 33). Cada linha do verso fica
    // numa linha própria até as aspas fecharem.
    if (emVerso) {
      const ultimo = artigo.blocos[artigo.blocos.length - 1]!
      ultimo.texto = `${ultimo.texto}\n${linha}`
      if (/["”]\.?$/.test(linha)) emVerso = false
      continue
    }
    if (/^\s{2,}["“]/.test(bruta)) {
      abrirBloco('verso', '', linha)
      emVerso = !/["”]\.?$/.test(linha)
      continue
    }

    let m: RegExpExecArray | null
    if ((m = RE_PARAGRAFO_UNICO.exec(linha))) {
      abrirBloco('paragrafo', 'Parágrafo único', m[1] ?? '')
    } else if ((m = RE_PARAGRAFO_NUM.exec(linha))) {
      abrirBloco('paragrafo', `§ ${m[1]}º`, m[2] ?? '')
    } else if ((m = RE_INCISO.exec(linha))) {
      abrirBloco('item', m[1]!, m[2] ?? '')
    } else if ((m = RE_ALINEA.exec(linha))) {
      abrirBloco('subitem', m[1]!, m[2] ?? '')
    } else if (quebraDeParagrafo) {
      abrirBloco('paragrafo', '', linha)
    } else {
      anexarAoUltimo(linha)
    }
  }

  const numeros = capitulos.flatMap((c) => c.artigos.map((a) => a.numero))
  const esperado = Array.from({ length: 35 }, (_, i) => i + 1)
  if (JSON.stringify(numeros) !== JSON.stringify(esperado)) {
    throw new Error(
      `Estatuto: esperava os artigos 1 a 35 em ordem, achei [${numeros.join(', ')}]. ` +
        'O formato de ESTATUTO_ASAF.txt mudou? Ajuste src/lib/estatuto.ts.',
    )
  }
  if (capitulos.some((c) => c.titulo === '' || c.artigos.length === 0)) {
    throw new Error('Estatuto: capítulo sem título ou sem artigos.')
  }

  return {
    titulo: normalizarTitulo(cabecalho[0] ?? ''),
    sigla: cabecalho[1] ?? '',
    preambulo: preambulo.join(' '),
    capitulos,
  }
}

/** Lê o arquivo da raiz do repositório (o build roda dentro de `site/`). */
export function carregarEstatuto(): Estatuto {
  const caminho = resolve(process.cwd(), '..', 'ESTATUTO_ASAF.txt')
  let fonte: string
  try {
    fonte = readFileSync(caminho, 'utf-8')
  } catch {
    throw new Error(
      `Não achei ${caminho}. O build do site precisa do repositório inteiro (o Estatuto mora na raiz).`,
    )
  }
  return analisarEstatuto(fonte)
}

/** Artigo pelo número. Levanta erro se não existir (o build não publica citação quebrada). */
export function buscarArtigo(e: Estatuto, numero: number): ArtigoEstatuto {
  const achado = e.capitulos
    .flatMap((c) => c.artigos)
    .find((a) => a.numero === numero)
  if (!achado) throw new Error(`Estatuto: o artigo ${numero} não existe.`)
  return achado
}

/** Só os incisos (`item`) de um artigo — ex.: as 6 exigências do Art. 12, os direitos do Art. 13. */
export function incisosDoArtigo(e: Estatuto, numero: number): BlocoEstatuto[] {
  return buscarArtigo(e, numero).blocos.filter((b) => b.tipo === 'item')
}

export interface GrupoDeBlocos {
  tipo: 'corpo' | 'lista'
  blocos: BlocoEstatuto[]
}

/** Junta incisos/alíneas consecutivos numa lista (semântica certa para leitor de tela). */
export function agruparBlocos(blocos: BlocoEstatuto[]): GrupoDeBlocos[] {
  const grupos: GrupoDeBlocos[] = []
  for (const bloco of blocos) {
    const ehItem = bloco.tipo === 'item' || bloco.tipo === 'subitem'
    const ultimo = grupos[grupos.length - 1]
    if (ehItem && ultimo?.tipo === 'lista') ultimo.blocos.push(bloco)
    else grupos.push({ tipo: ehItem ? 'lista' : 'corpo', blocos: [bloco] })
  }
  return grupos
}

/**
 * Remonta o texto (todas as palavras, na ordem em que o leitor as vê) — usado só pelo teste que
 * compara com a fonte. Não é para exibição.
 */
export function textoCorrido(e: Estatuto): string {
  const partes = [e.titulo, e.sigla, 'PREÂMBULO', e.preambulo]
  for (const c of e.capitulos) {
    partes.push(`CAPITULO ${c.numeral}`, c.titulo)
    for (const a of c.artigos) {
      partes.push(a.rotulo)
      for (const b of a.blocos) partes.push(b.marcador, b.texto)
    }
  }
  return partes.join(' ')
}

/** Palavras (letras/dígitos), sem acento e em minúsculas — para comparar fonte e estrutura. */
export function palavras(texto: string): string[] {
  return (
    texto
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLocaleLowerCase('pt-BR')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  )
}
