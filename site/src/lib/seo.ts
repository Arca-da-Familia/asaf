import { LOGO, ORGANIZACAO, SITE_URL } from '../config/organizacao'
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
export function jsonLdOrganizacao(
  organizacao: {
    cnpj: string
    telefoneInternacional: string
    email: string
    redes?: { instagram: string | null; facebook: string | null }
  } = ORGANIZACAO,
) {
  const redes = [
    organizacao.redes?.instagram,
    organizacao.redes?.facebook,
  ].filter((endereco): endereco is string => Boolean(endereco))
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
    taxID: organizacao.cnpj,
    telephone: organizacao.telefoneInternacional,
    email: organizacao.email,
    address: ENDERECO_SEDE,
    areaServed: { '@type': 'City', name: ORGANIZACAO.cidade },
    ...(redes.length > 0 ? { sameAs: redes } : {}),
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
 * local e "gratuito" direto no resultado do Google (o local só entra quando o evento tem endereço próprio). As páginas de evento (v5.2) consomem esta
 * função; `urlPagina` é a URL estável e compartilhável da própria página do evento.
 *
 * Fica de fora de propósito: `offers` (a API pública ainda não expõe o valor da inscrição) e
 * `image` (o evento ainda não tem imagem). Melhor omitir do que declarar dado falso.
 */
export function jsonLdEvento(evento: EventoParaJsonLd, urlPagina: string) {
  // O sistema só guarda o local quando o evento tem endereço próprio. Sem ele NÃO se presume a sede nem
  // o modo presencial (o evento pode ser online ou em outro lugar): `location` e
  // `eventAttendanceMode` ficam de fora — melhor omitir do que declarar dado falso (revisão de
  // fatos da v5.2).
  const localProprio = evento.endereco_avulso?.trim()
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
    isAccessibleForFree: evento.gratuito,
    url: urlPagina,
    ...(localProprio
      ? {
          eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
          location: {
            '@type': 'Place',
            name: localProprio,
            address: ENDERECO_CIDADE,
          },
        }
      : {}),
    organizer: { '@id': `${SITE_URL}/#organizacao` },
  }
}

export interface NoticiaParaJsonLd {
  titulo: string
  resumo: string
  /** ISO em UTC. */
  publicadaEm: string
  atualizadaEm: string | null
  /** Caminho da foto (ex.: "/midia/noticias/<id>.webp"); sem foto = sem `image`. */
  caminhoDaImagem: string | null
}

/**
 * schema.org/NewsArticle de uma notícia da ASAF. Só entra o que existe: sem foto não há `image` (melhor
 * omitir do que apontar para a logo como se fosse a foto da notícia) e sem edição não há `dateModified`.
 */
export function jsonLdNoticia(noticia: NoticiaParaJsonLd, urlPagina: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: noticia.titulo,
    description: noticia.resumo,
    datePublished: noticia.publicadaEm,
    ...(noticia.atualizadaEm ? { dateModified: noticia.atualizadaEm } : {}),
    ...(noticia.caminhoDaImagem
      ? { image: [`${SITE_URL}${noticia.caminhoDaImagem}`] }
      : {}),
    mainEntityOfPage: { '@type': 'WebPage', '@id': urlPagina },
    url: urlPagina,
    inLanguage: 'pt-BR',
    author: { '@id': `${SITE_URL}/#organizacao` },
    publisher: { '@id': `${SITE_URL}/#organizacao` },
  }
}
