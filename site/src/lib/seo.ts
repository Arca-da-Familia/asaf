import { ORGANIZACAO, SITE_URL } from '../config/organizacao'
import { comFusoDaAsaf } from './datas'

/**
 * SEO técnico (v5.0): título, URL canônica e dados estruturados schema.org.
 * Funções puras — testadas em tests/seo.test.ts, sem depender do Astro.
 */

/** "Título | ASAF"; sem título (home) usa o nome completo da organização. */
export function tituloDaPagina(titulo?: string): string {
  return titulo
    ? `${titulo} | ${ORGANIZACAO.sigla}`
    : `${ORGANIZACAO.sigla} — ${ORGANIZACAO.nome}`
}

/**
 * URL canônica absoluta e estável: sempre no domínio de produção (mesmo em build de teste),
 * sem query string nem fragmento, com barra final (o Astro gera `pasta/index.html`).
 * Duas URLs para o mesmo conteúdo dividem a relevância na busca; esta função existe para isso
 * nunca acontecer por descuido.
 */
export function urlCanonica(caminho: string): string {
  const limpo = caminho.split('#')[0]!.split('?')[0]!
  const comBarraInicial = limpo.startsWith('/') ? limpo : `/${limpo}`
  const ehArquivo = /\.[a-z0-9]+$/i.test(comBarraInicial)
  const normalizado =
    ehArquivo || comBarraInicial.endsWith('/')
      ? comBarraInicial
      : `${comBarraInicial}/`
  return `${SITE_URL}${normalizado}`
}

/**
 * Serializa JSON-LD para dentro de <script type="application/ld+json">. Escapa `<`: sem isso um
 * título de evento contendo `</script>` fecharia a tag e injetaria HTML — o dado vem da API.
 */
export function serializarJsonLd(dados: unknown): string {
  return JSON.stringify(dados).replace(/</g, '\\u003c')
}

const ENDERECO_CIDADE = {
  '@type': 'PostalAddress',
  addressLocality: ORGANIZACAO.cidade,
  addressRegion: ORGANIZACAO.uf,
  addressCountry: ORGANIZACAO.pais,
} as const

/** Organização (aparece em todas as páginas). `NGO` = organização não governamental. */
export function jsonLdOrganizacao() {
  return {
    '@context': 'https://schema.org',
    '@type': 'NGO',
    '@id': `${SITE_URL}/#organizacao`,
    name: ORGANIZACAO.nome,
    alternateName: ORGANIZACAO.sigla,
    url: `${SITE_URL}/`,
    slogan: ORGANIZACAO.lema,
    description: ORGANIZACAO.descricaoCurta,
    foundingDate: ORGANIZACAO.fundacao,
    address: ENDERECO_CIDADE,
    areaServed: { '@type': 'City', name: ORGANIZACAO.cidade },
  }
}

export interface EventoParaJsonLd {
  id_evento: number
  titulo: string
  descricao: string | null
  data_hora_inicio: string
  data_hora_fim: string | null
  endereco_avulso: string | null
  gratuito: boolean
}

/**
 * schema.org/Event de um evento público da ASAF — é isto que faz o evento aparecer com data,
 * local e "gratuito" direto no resultado do Google. As páginas de evento (v5.2) consomem esta
 * função; `urlPagina` é a URL estável e compartilhável da própria página do evento.
 *
 * Fica de fora de propósito: `offers` (a API pública ainda não expõe o valor da inscrição) e
 * `image` (o evento ainda não tem imagem). Melhor omitir do que declarar dado falso.
 */
export function jsonLdEvento(evento: EventoParaJsonLd, urlPagina: string) {
  const local = evento.endereco_avulso?.trim() || `Sede da ${ORGANIZACAO.sigla}`
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: evento.titulo,
    ...(evento.descricao ? { description: evento.descricao } : {}),
    startDate: comFusoDaAsaf(evento.data_hora_inicio),
    ...(evento.data_hora_fim
      ? { endDate: comFusoDaAsaf(evento.data_hora_fim) }
      : {}),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    isAccessibleForFree: evento.gratuito,
    url: urlPagina,
    location: { '@type': 'Place', name: local, address: ENDERECO_CIDADE },
    organizer: { '@id': `${SITE_URL}/#organizacao` },
  }
}
