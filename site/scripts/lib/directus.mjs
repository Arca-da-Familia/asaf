// Notícias do Directus (v5.3) — o Directus é SÓ o editor do site (notícias, textos, fotos). Documento
// oficial, emenda e dinheiro são do SISTEMA (ver PLANO_PROJETO.md, "Decisão de arquitetura").
//
// COMPARTILHADO pelo build das páginas e pela sincronização (como conteudo-publico.mjs), para os dois
// verem exatamente a mesma coisa. JavaScript puro (roda no Node do CI sem compilar); tipos em directus.d.mts.
//
// O que este módulo garante, em linguagem simples:
//   - só entra no site notícia PUBLICADA e com a data de publicação já vencida (a conta do site no Directus
//     já só enxerga isso; aqui se confere de novo, por garantia);
//   - nenhuma notícia incompleta vai ao ar: título, endereço (slug), resumo e texto são obrigatórios;
//   - FOTO só vai ao ar com TEXTO ALTERNATIVO e com a AUTORIZAÇÃO DE IMAGEM confirmada (ECA/LGPD). Notícia que
//     descumpre isso NÃO é publicada (a notícia inteira, não só a foto) e aparece em `avisos`;
//   - o texto do editor (HTML) é limpo: sem script, sem estilo solto, sem imagem solta, sem link perigoso;
//   - o token da conta do site só existe aqui, no servidor do build: nunca vai para o HTML.
import sanitizeHtml from 'sanitize-html'

import { buscarJson } from './conteudo-publico.mjs'

export const DIRECTUS_URL_PADRAO = 'https://cms.asaf.org.br'

/** Campos pedidos ao Directus (a conta do site só consegue ler campos permitidos de arquivo). */
export const CAMPOS_DA_NOTICIA = [
  'id',
  'status',
  'titulo',
  'slug',
  'resumo',
  'corpo',
  'publicada_em',
  'date_updated',
  'imagem.id',
  'imagem.width',
  'imagem.height',
  'imagem_alt',
  'autorizacao_imagem',
]

/** Endereço da notícia: minúsculas, números e hífen (o que o editor vê como "slug"). */
const PADRAO_DE_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Configuração do Directus a partir do ambiente. `obrigatorio` (DIRECTUS_OBRIGATORIO=1, ligado nos workflows
 * de publicação) faz a falta do token DERRUBAR o build: melhor não publicar do que publicar o site sem notícias
 * por causa de um segredo que sumiu.
 */
export function configuracaoDoDirectus(env = process.env) {
  return {
    url: (env.DIRECTUS_URL ?? DIRECTUS_URL_PADRAO).replace(/\/+$/, ''),
    token: env.DIRECTUS_SITE_TOKEN || '',
    obrigatorio: env.DIRECTUS_OBRIGATORIO === '1',
  }
}

const TAGS_PERMITIDAS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'ul',
  'ol',
  'li',
  'a',
  'h2',
  'h3',
  'h4',
  'blockquote',
  'hr',
]

/**
 * Limpa o HTML do editor. O título da notícia é o <h1> da página, então `h1` do texto vira `h2` (e h5/h6 viram
 * h4): a hierarquia de títulos continua certa para quem usa leitor de tela. Imagem solta no texto é removida
 * (a foto da notícia é o campo próprio, com texto alternativo e autorização).
 */
export function sanitizarCorpo(html) {
  return (
    sanitizeHtml(String(html ?? ''), {
      allowedTags: TAGS_PERMITIDAS,
      allowedAttributes: { a: ['href', 'title', 'rel'] },
      allowedSchemes: ['http', 'https', 'mailto', 'tel'],
      allowProtocolRelative: false,
      disallowedTagsMode: 'discard',
      transformTags: {
        h1: 'h2',
        h5: 'h4',
        h6: 'h4',
        a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
      },
    })
      // Link cujo destino foi barrado (ex.: javascript:) sobra como <a> SEM href: não é link (nem rastreável nem
      // acessível). Fica só o texto.
      .replace(/<a(?![^>]*\shref=)[^>]*>([\s\S]*?)<\/a>/g, '$1')
      .replace(/<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/g, '')
      .trim()
  )
}

const textoSimples = (valor) =>
  String(valor ?? '')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Valida as notícias lidas do Directus. Devolve `{ noticias, avisos }`: `noticias` já limpas e ordenadas da mais
 * recente para a mais antiga; `avisos` lista cada notícia NÃO publicada e o motivo (aparece no resumo do deploy).
 */
export function validarNoticias(brutas, agora = new Date()) {
  const avisos = []
  const vistas = new Set()
  const noticias = []
  for (const bruta of brutas ?? []) {
    const nome =
      textoSimples(bruta?.titulo) || String(bruta?.id ?? 'sem título')
    const recusar = (motivo) =>
      avisos.push({ id: String(bruta?.id ?? ''), titulo: nome, motivo })

    if (bruta?.status !== 'publicado') {
      recusar(
        `veio do Directus com situação "${bruta?.status}" (só "publicado" vai ao site)`,
      )
      continue
    }
    const publicadaEm = new Date(bruta.publicada_em)
    if (Number.isNaN(publicadaEm.getTime())) {
      recusar('sem data de publicação válida')
      continue
    }
    if (publicadaEm > agora) continue // agendada: ainda não é hora (não é erro)

    const titulo = textoSimples(bruta.titulo)
    const slug = textoSimples(bruta.slug)
    const resumo = textoSimples(bruta.resumo)
    const corpoHtml = sanitizarCorpo(bruta.corpo)
    if (!titulo) {
      recusar('sem título')
      continue
    }
    if (!PADRAO_DE_SLUG.test(slug)) {
      recusar(
        `endereço (slug) inválido: "${slug}" — use só minúsculas, números e hífen`,
      )
      continue
    }
    if (vistas.has(slug)) {
      recusar(`o endereço "${slug}" já é de outra notícia`)
      continue
    }
    if (!resumo) {
      recusar('sem resumo')
      continue
    }
    if (!corpoHtml) {
      recusar('sem texto')
      continue
    }

    let imagem = null
    if (bruta.imagem) {
      const alt = textoSimples(bruta.imagem_alt)
      if (alt.length < 3) {
        recusar(
          'tem foto, mas falta o texto alternativo (descrição da foto para quem não enxerga)',
        )
        continue
      }
      if (bruta.autorizacao_imagem !== true) {
        recusar(
          'tem foto, mas a autorização de uso de imagem não foi confirmada',
        )
        continue
      }
      const id =
        typeof bruta.imagem === 'object' ? bruta.imagem.id : bruta.imagem
      const arquivo = typeof bruta.imagem === 'object' ? bruta.imagem : {}
      imagem = {
        id: String(id),
        alt,
        largura: Number(arquivo.width) > 0 ? Number(arquivo.width) : 1200,
        altura: Number(arquivo.height) > 0 ? Number(arquivo.height) : 630,
      }
    }

    vistas.add(slug)
    noticias.push({
      id: String(bruta.id),
      titulo,
      slug,
      resumo,
      corpoHtml,
      publicadaEm: publicadaEm.toISOString(),
      atualizadaEm: bruta.date_updated
        ? new Date(bruta.date_updated).toISOString()
        : null,
      imagem,
    })
  }
  noticias.sort(
    (a, b) =>
      b.publicadaEm.localeCompare(a.publicadaEm) ||
      a.slug.localeCompare(b.slug),
  )
  return { noticias, avisos }
}

/**
 * Lê as notícias publicadas do Directus. Sem token: devolve vazio (desenvolvimento local) — ou ERRO, se for
 * obrigatório (publicação). Token recusado (401/403) e demais erros 4xx derrubam o build na hora; erro passageiro
 * (rede, 5xx, o Directus acordando) é repetido, como na API.
 */
export async function buscarNoticias(
  config = configuracaoDoDirectus(),
  opcoes = {},
) {
  if (!config.token) {
    if (config.obrigatorio) {
      throw new Error(
        'DIRECTUS_SITE_TOKEN não está definido (DIRECTUS_OBRIGATORIO=1): o site não é publicado sem ler as notícias do Directus.',
      )
    }
    return { noticias: [], avisos: [], semDirectus: true }
  }
  const consulta = new URLSearchParams({
    fields: CAMPOS_DA_NOTICIA.join(','),
    'filter[status][_eq]': 'publicado',
    'filter[publicada_em][_lte]': '$NOW',
    sort: '-publicada_em',
    limit: '-1',
  })
  const resposta = await buscarJson(config.url, `/items/noticias?${consulta}`, {
    fetchImpl: opcoes.fetchImpl ?? fetch,
    tentativas: opcoes.tentativas ?? 3,
    timeoutMs: opcoes.timeoutMs ?? 60_000,
    esperaMs: opcoes.esperaMs ?? 3000,
    headers: { Authorization: `Bearer ${config.token}` },
    rotulo: 'o Directus',
  })
  const { noticias, avisos } = validarNoticias(
    resposta?.data ?? [],
    opcoes.agora,
  )
  return { noticias, avisos, semDirectus: false }
}

/**
 * Anuncia as notícias NÃO publicadas e o motivo. No GitHub Actions vira aviso amarelo (anotação) no resumo do
 * job — é como o editor descobre que a notícia dele ficou de fora (foto sem autorização, sem texto alternativo...).
 */
export function anunciarAvisosDeNoticias(
  avisos,
  escrever = console.warn,
  noGitHub = process.env.GITHUB_ACTIONS === 'true',
) {
  for (const aviso of avisos ?? []) {
    const texto = `Notícia NÃO publicada: "${aviso.titulo}" — ${aviso.motivo}`
    escrever(
      noGitHub
        ? `::warning title=Notícia não publicada::${texto.replace(/[\r\n]+/g, ' ')}`
        : texto,
    )
  }
}

/** Baixa a foto de uma notícia já redimensionada pelo Directus (WebP, no máximo 1280 px de largura). */
export async function baixarImagem(config, idDoArquivo, opcoes = {}) {
  if (!config.token)
    throw new Error(
      'DIRECTUS_SITE_TOKEN não está definido: não dá para baixar a foto.',
    )
  const consulta = new URLSearchParams({
    width: '1280',
    fit: 'inside',
    format: 'webp',
    quality: '80',
  })
  const fetchImpl = opcoes.fetchImpl ?? fetch
  const tentativas = opcoes.tentativas ?? 3
  let ultimoErro
  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    const controlador = new AbortController()
    const timer = setTimeout(
      () => controlador.abort(),
      opcoes.timeoutMs ?? 60_000,
    )
    try {
      const resposta = await fetchImpl(
        `${config.url}/assets/${encodeURIComponent(idDoArquivo)}?${consulta}`,
        {
          headers: { Authorization: `Bearer ${config.token}` },
          signal: controlador.signal,
        },
      )
      if (resposta.ok) return Buffer.from(await resposta.arrayBuffer())
      ultimoErro = new Error(
        `o Directus respondeu ${resposta.status} ao baixar a foto ${idDoArquivo}`,
      )
      if (resposta.status < 500) throw ultimoErro
    } catch (erro) {
      ultimoErro = erro instanceof Error ? erro : new Error(String(erro))
      if (/respondeu 4\d\d/.test(ultimoErro.message)) throw ultimoErro
    } finally {
      clearTimeout(timer)
    }
    if (tentativa < tentativas)
      await new Promise((r) => setTimeout(r, opcoes.esperaMs ?? 3000))
  }
  throw new Error(
    `Não consegui baixar a foto ${idDoArquivo} (${tentativas} tentativas): ${ultimoErro?.message}`,
  )
}
