import {
  ENDERECO_LINHA,
  LOGO,
  ORGANIZACAO,
  SITE_URL,
} from '../config/organizacao'
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

/** Só cidade/UF — para local de evento que não é a sede (o endereço do local é texto livre). */
const ENDERECO_CIDADE = {
  '@type': 'PostalAddress',
  addressLocality: ORGANIZACAO.cidade,
  addressRegion: ORGANIZACAO.uf,
  addressCountry: ORGANIZACAO.pais,
} as const

/** Endereço completo da sede (Estatuto, confirmado pelo usuário em 2026-10-01). */
const ENDERECO_SEDE = {
  ...ENDERECO_CIDADE,
  streetAddress: `${ORGANIZACAO.endereco.logradouro}, ${ORGANIZACAO.endereco.numero}`,
  postalCode: ORGANIZACAO.endereco.cep,
} as const

/**
 * Organização (aparece em todas as páginas). `NGO` = organização não governamental. Carrega a
 * logo institucional: é o que o Google usa para mostrar a marca nos resultados de busca.
 */
export function jsonLdOrganizacao() {
  return {
    '@context': 'https://schema.org',
    '@type': 'NGO',
    '@id': `${SITE_URL}/#organizacao`,
    name: ORGANIZACAO.nome,
    alternateName: ORGANIZACAO.sigla,
    url: `${SITE_URL}/`,
    logo: {
      '@type': 'ImageObject',
      url: `${SITE_URL}${LOGO.png}`,
      width: LOGO.pngLargura,
      height: LOGO.pngAltura,
    },
    slogan: ORGANIZACAO.lema,
    description: ORGANIZACAO.descricaoCurta,
    foundingDate: ORGANIZACAO.fundacao,
    taxID: ORGANIZACAO.cnpj,
    telephone: ORGANIZACAO.telefoneInternacional,
    email: ORGANIZACAO.email,
    address: ENDERECO_SEDE,
    areaServed: { '@type': 'City', name: ORGANIZACAO.cidade },
  }
}

export interface MigalhaParaJsonLd {
  rotulo: string
  /** Caminho (ex.: "/quem-somos/"); a última migalha (página atual) também leva o seu. */
  caminho: string
}

/**
 * schema.org/BreadcrumbList — o Google mostra "ASAF › Quem somos" no resultado de busca. A home é
 * sempre o primeiro item; `trilha` traz os demais, do mais alto ao da própria página.
 */
export function jsonLdMigalhas(trilha: MigalhaParaJsonLd[]) {
  const itens = [{ rotulo: 'Início', caminho: '/' }, ...trilha]
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: itens.map((item, indice) => ({
      '@type': 'ListItem',
      position: indice + 1,
      name: item.rotulo,
      item: urlCanonica(item.caminho),
    })),
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
  // Sem local próprio, o evento é na sede: aí o endereço completo é verdadeiro e ajuda o Google.
  const localProprio = evento.endereco_avulso?.trim()
  const local =
    localProprio || `Sede da ${ORGANIZACAO.sigla} — ${ENDERECO_LINHA}`
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
    location: {
      '@type': 'Place',
      name: local,
      address: localProprio ? ENDERECO_CIDADE : ENDERECO_SEDE,
    },
    organizer: { '@id': `${SITE_URL}/#organizacao` },
  }
}
