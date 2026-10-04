/**
 * Funções puras da Transparência (v5.4b): endereço dos PDFs, dinheiro, agrupamento por ano e dados abertos (CSV).
 * Ficam fora das páginas para serem testadas uma a uma — é aqui que um valor errado ou um endereço instável viraria
 * um número errado no site de uma associação que busca financiamento público.
 */
import type {
  DocumentoDaParceria,
  DocumentoPublico,
  ParceriaDetalhada,
  ParceriaPublica,
  PagamentoPublico,
} from '../../scripts/lib/conteudo-publico.mjs'

const REAIS = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

/** 50000 -> "R$ 50.000,00". */
export function formatarReais(valor: number): string {
  return REAIS.format(valor)
}

/** "Emenda 123/2026 — Oficinas" -> "emenda-123-2026-oficinas" (sem acento, só letras, números e hífens). */
export function slugDoTitulo(titulo: string, maximo = 60): string {
  const slug = titulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maximo)
    .replace(/-+$/g, '')
  return slug || 'documento'
}

/** Nome do arquivo (sem extensão) do PDF: o id vem primeiro, então um título editado nunca colide com outro. */
export function nomeDoPdf(
  documento: Pick<DocumentoDaParceria, 'id_documento' | 'titulo'>,
): string {
  return `${documento.id_documento}-${slugDoTitulo(documento.titulo)}`
}

/** Endereço PERMANENTE do PDF no próprio site (copiado no build): `/arquivos/transparencia/12-estatuto-social.pdf`. */
export function caminhoDoPdf(
  documento: Pick<DocumentoDaParceria, 'id_documento' | 'titulo'>,
): string {
  return `/arquivos/transparencia/${nomeDoPdf(documento)}.pdf`
}

/**
 * Endereço do documento no site: o PDF copiado (formato PDF) ou a PÁGINA de texto (formato TEXTO). Os dois começam pelo id,
 * então um título editado nunca colide com outro.
 */
export function caminhoDoDocumento(
  documento: Pick<DocumentoDaParceria, 'id_documento' | 'titulo'> & {
    formato?: 'PDF' | 'TEXTO'
  },
): string {
  return documento.formato === 'TEXTO'
    ? `/transparencia/documentos/${nomeDoPdf(documento)}/`
    : caminhoDoPdf(documento)
}

/** Foto de etapa copiada no build: o id da foto é único (um endereço por foto, sempre o mesmo). */
export const caminhoDaFotoDaEtapa = (foto: { id_foto: number }) =>
  `/midia/parcerias/${foto.id_foto}.jpg`

/** Texto publicado -> parágrafos (separados por linha em branco). Linhas simples dentro do parágrafo são mantidas. */
export function paragrafosDoTexto(texto: string): string[] {
  return texto
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
}

/**
 * Agrupa por ano, do mais novo para o mais antigo. NUNCA descarta um ano: a página de emendas mostra todos os
 * anos, porque apagar o histórico do que já foi recebido seria o contrário de transparência.
 */
export function agruparPorAno<T extends { ano: number | null }>(
  itens: T[],
): { ano: number | null; itens: T[] }[] {
  const grupos = new Map<number | null, T[]>()
  for (const item of itens) {
    grupos.set(item.ano, [...(grupos.get(item.ano) ?? []), item])
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => (b ?? -Infinity) - (a ?? -Infinity))
    .map(([ano, lista]) => ({ ano, itens: lista }))
}

export const ehEmenda = (p: Pick<ParceriaPublica, 'tipo_codigo'>) =>
  p.tipo_codigo === 'EMENDA'

/** Texto do beneficiário do pagamento: razão social e CNPJ (fornecedor), função (equipe) ou só a descrição. */
export function beneficiarioDoPagamento(p: PagamentoPublico): string {
  if (p.fornecedor) {
    return `${p.fornecedor.razao_social} (CNPJ ${formatarCnpj(p.fornecedor.cnpj)})`
  }
  if (p.funcao) return `Equipe: ${p.funcao}`
  return '—'
}

/** 12345678000199 -> "12.345.678/0001-99". Se não tiver 14 dígitos, devolve como veio. */
export function formatarCnpj(cnpj: string): string {
  const d = cnpj.replace(/\D/g, '')
  if (d.length !== 14) return cnpj
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

/** Saldo da parceria: o que entrou menos o que saiu, segundo o livro-caixa (não é saldo de extrato bancário). */
export const saldoDaParceria = (
  p: Pick<ParceriaPublica, 'recebido' | 'pago'>,
) => Math.round((p.recebido - p.pago) * 100) / 100

// ------------------------------------------------------------------------------------------------ dados abertos
export type CelulaCsv = string | number | null | undefined

/**
 * Uma célula do CSV (RFC 4180): entre aspas quando tem vírgula, aspas, quebra de linha; aspas dobradas. Texto que
 * começaria com = + - @ (o que o Excel/Calc executaria como fórmula) ganha um apóstrofo na frente: o dado aberto
 * nunca vira um vetor de ataque para quem o abre numa planilha.
 */
export function celulaCsv(valor: CelulaCsv): string {
  if (valor === null || valor === undefined) return ''
  let texto = typeof valor === 'number' ? String(valor) : valor
  if (typeof valor === 'string' && /^[=+\-@\t\r]/.test(texto)) {
    texto = `'${texto}`
  }
  return /[",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

export function paraCsv(
  colunas: readonly string[],
  linhas: Record<string, CelulaCsv>[],
): string {
  const cabecalho = colunas.join(',')
  const corpo = linhas.map((linha) =>
    colunas.map((coluna) => celulaCsv(linha[coluna])).join(','),
  )
  return `${[cabecalho, ...corpo].join('\r\n')}\r\n`
}

export const COLUNAS_DOS_DADOS_ABERTOS = [
  'id',
  'ano',
  'tipo',
  'numero_emenda',
  'identificador_unico',
  'proponente',
  'orgao_concedente',
  'titulo',
  'objeto',
  'situacao',
  'numero_termo',
  'valor_total',
  'recebido',
  'pago',
  'saldo',
  'vigencia_inicio',
  'vigencia_fim',
  'ultima_atualizacao',
  'pagina',
] as const

/** Uma linha por parceria; `pagina` é o endereço completo da página dela no site. */
export function linhasDosDadosAbertos(
  parcerias: ParceriaPublica[],
  enderecoDaPagina: (p: ParceriaPublica) => string,
): Record<string, CelulaCsv>[] {
  return parcerias.map((p) => ({
    id: p.id_parceria,
    ano: p.ano,
    tipo: p.tipo,
    numero_emenda: p.numero_emenda,
    identificador_unico: p.identificador_unico,
    proponente: p.proponente,
    orgao_concedente: p.orgao_concedente,
    titulo: p.titulo,
    objeto: p.objeto,
    situacao: p.situacao,
    numero_termo: p.numero_termo,
    valor_total: p.valor_total,
    recebido: p.recebido,
    pago: p.pago,
    saldo: saldoDaParceria(p),
    vigencia_inicio: p.vigencia_inicio,
    vigencia_fim: p.vigencia_fim,
    ultima_atualizacao: p.ultima_atualizacao,
    pagina: enderecoDaPagina(p),
  }))
}

/** Os documentos de uma parceria, na ordem em que foram aprovados (o id cresce com o cadastro). */
export const documentosOrdenados = (p: Pick<ParceriaDetalhada, 'documentos'>) =>
  [...p.documentos].sort((a, b) => a.id_documento - b.id_documento)

/** Por tipo de documento (na ordem em que a API manda os tipos) e, dentro de cada tipo, o ano mais novo primeiro. */
export function agruparDocumentosPorTipo(
  documentos: DocumentoPublico[],
): { tipo: string; documentos: DocumentoPublico[] }[] {
  const grupos = new Map<string, DocumentoPublico[]>()
  for (const d of documentos) {
    grupos.set(d.tipo, [...(grupos.get(d.tipo) ?? []), d])
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
    .map(([tipo, lista]) => ({
      tipo,
      documentos: [...lista].sort(
        (a, b) =>
          (b.ano ?? 0) - (a.ano ?? 0) ||
          b.versao - a.versao ||
          a.titulo.localeCompare(b.titulo, 'pt-BR'),
      ),
    }))
}
