export interface ConfiguracaoDoDirectus {
  url: string
  token: string
  obrigatorio: boolean
}

export interface ImagemDaNoticia {
  /** Id do arquivo no Directus. */
  id: string
  /** Texto alternativo (obrigatório para a notícia ir ao ar). */
  alt: string
  largura: number
  altura: number
}

export interface NoticiaPublica {
  id: string
  titulo: string
  /** Endereço da notícia: /noticias/<slug>/ */
  slug: string
  resumo: string
  /** HTML do editor, já limpo (sem script, sem imagem solta, links seguros). */
  corpoHtml: string
  /** ISO em UTC. */
  publicadaEm: string
  atualizadaEm: string | null
  imagem: ImagemDaNoticia | null
}

export interface AvisoDeNoticia {
  id: string
  titulo: string
  motivo: string
}

export interface ResultadoDasNoticias {
  noticias: NoticiaPublica[]
  /** Notícias que NÃO foram publicadas, com o motivo. */
  avisos: AvisoDeNoticia[]
  /** true = sem token (desenvolvimento local): nada foi lido. */
  semDirectus: boolean
}

export interface OpcoesDoDirectus {
  fetchImpl?: typeof fetch
  tentativas?: number
  timeoutMs?: number
  esperaMs?: number
  agora?: Date
}

export const DIRECTUS_URL_PADRAO: string
export const CAMPOS_DA_NOTICIA: string[]

export function configuracaoDoDirectus(
  env?: Record<string, string | undefined>,
): ConfiguracaoDoDirectus

export function sanitizarCorpo(html: unknown): string

export function validarNoticias(
  brutas: unknown[] | null | undefined,
  agora?: Date,
): { noticias: NoticiaPublica[]; avisos: AvisoDeNoticia[] }

export function buscarNoticias(
  config?: ConfiguracaoDoDirectus,
  opcoes?: OpcoesDoDirectus,
): Promise<ResultadoDasNoticias>

export function anunciarAvisosDeNoticias(
  avisos: AvisoDeNoticia[] | null | undefined,
  escrever?: (linha: string) => void,
  noGitHub?: boolean,
): void

export function baixarImagem(
  config: ConfiguracaoDoDirectus,
  idDoArquivo: string,
  opcoes?: OpcoesDoDirectus,
): Promise<Buffer>
