// Conteúdo público do site (v5.2) — busca na API e "impressão digital" do que as páginas mostram.
//
// (v5.3: junta também as notícias do Directus — ver ./directus.mjs.)
// (v5.4b: junta as parcerias/emendas e os documentos APROVADOS da Transparência, que moram no SISTEMA.)
// (v5.5: o detalhe de cada projeto (edições, relatórios, fotos), o contexto de cada evento e a ligação das notícias
//  com projeto/evento. TOLERANTE a API antiga: o que ainda não existe nela vira lista vazia / null.)
// COMPARTILHADO por dois usuários, de propósito, para nunca divergirem:
//   1. o BUILD das páginas (src/lib/dados-publicos.ts): gera Diretoria, Projetos, cada Evento etc.;
//   2. a SINCRONIZAÇÃO (scripts/verificar-conteudo.mjs, rodada pelo workflow sincronizar-site): compara
//      a impressão do que a API tem HOJE com a do site publicado (/conteudo.json) e, se mudou,
//      dispara um novo deploy. É assim que um evento/projeto/dirigente novo ganha página sem ninguém
//      lembrar de reconstruir o site.
//
// É JavaScript puro (não TypeScript) para rodar no Node do CI sem compilar. Tipos: conteudo-publico.d.mts.
import { createHash } from 'node:crypto'

import { buscarNoticias, configuracaoDoDirectus } from './directus.mjs'

/** Listas que alimentam as páginas. O detalhe de cada evento é buscado em seguida. */
export const ENDPOINTS_DE_LISTA = {
  eventos: '/api/publico/eventos',
  projetos: '/api/publico/projetos',
  diretoria: '/api/publico/diretoria',
  assembleias: '/api/publico/assembleias',
  // v5.4b - só o que a diretoria APROVOU no painel (rascunho, em revisão e retirado nem aparecem na API).
  parcerias: '/api/publico/transparencia/parcerias',
  documentos: '/api/publico/transparencia/documentos',
}

const ESPERA_ENTRE_TENTATIVAS_MS = 3000

/**
 * GET JSON com repetição só do que pode ser passageiro (rede, timeout, 5xx). 4xx nunca se repete.
 * `headers` (ex.: Authorization do Directus) e `rotulo` (quem respondeu, para a mensagem de erro).
 */
export async function buscarJson(
  base,
  caminho,
  {
    fetchImpl,
    tentativas,
    timeoutMs,
    esperaMs,
    headers = {},
    rotulo = 'a API',
    ler = (resposta) => resposta.json(),
  },
) {
  let ultimoErro
  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    const controlador = new AbortController()
    const timer = setTimeout(() => controlador.abort(), timeoutMs)
    try {
      const resposta = await fetchImpl(`${base}${caminho}`, {
        headers: { Accept: 'application/json', ...headers },
        signal: controlador.signal,
      })
      if (resposta.ok) return await ler(resposta)
      ultimoErro = new Error(
        `${caminho.split('?')[0]}: ${rotulo} respondeu ${resposta.status}`,
      )
      if (resposta.status < 500) throw ultimoErro
    } catch (erro) {
      ultimoErro = erro instanceof Error ? erro : new Error(String(erro))
      if (/respondeu 4\d\d/.test(ultimoErro.message)) throw ultimoErro
    } finally {
      clearTimeout(timer)
    }
    if (tentativa < tentativas)
      await new Promise((r) => setTimeout(r, esperaMs))
  }
  throw new Error(
    `Não consegui ler ${caminho.split('?')[0]} de ${rotulo} (${tentativas} tentativas): ${ultimoErro?.message}`,
  )
}

const lista = (valor) => (Array.isArray(valor) ? valor : [])

/**
 * Projeto da lista/detalhe -> forma que o site usa. TOLERANTE a API antiga (v5.5): o site e a API são publicados
 * ao mesmo tempo; se o build ler a API ANTES de ela ter o destaque, o projeto simplesmente não está em destaque.
 */
export function normalizarProjeto(projeto) {
  return { ...projeto, destaque: projeto.destaque === true }
}

/** Detalhe do projeto: edições, documentos e fotos ausentes (API antiga) viram lista vazia. */
export function normalizarProjetoDetalhado(detalhe) {
  return {
    ...normalizarProjeto(detalhe),
    eventos: lista(detalhe.eventos),
    documentos: lista(detalhe.documentos),
    fotos: lista(detalhe.fotos),
  }
}

/** Evento da lista: sem `id_projeto` (API antiga) = sem projeto. */
export function normalizarEvento(evento) {
  return { ...evento, id_projeto: evento.id_projeto ?? null }
}

/** Detalhe do evento: projeto ausente = null; edições, documentos e fotos ausentes = lista vazia. */
export function normalizarEventoDetalhado(detalhe) {
  return {
    ...normalizarEvento(detalhe),
    projeto: detalhe.projeto ?? null,
    edicoes: lista(detalhe.edicoes),
    documentos: lista(detalhe.documentos),
    fotos: lista(detalhe.fotos),
  }
}

/**
 * Notícia ligada a projeto/evento que NÃO existe (ou não é público) é publicada SEM a ligação — o número errado no
 * Directus nunca tira a notícia do ar, nem faz um link que daria 404. Cada ligação desfeita vira um aviso (mesmo
 * formato dos avisos de `validarNoticias`, com `publicada: true`) para o editor corrigir o número.
 */
export function ligarNoticias(noticias, { projetos, eventos }) {
  const idsDeProjetos = new Set(projetos.map((p) => p.id_projeto))
  const idsDeEventos = new Set(eventos.map((e) => e.id_evento))
  const avisos = []
  const ligadas = noticias.map((noticia) => {
    let { projetoId, eventoId } = noticia
    projetoId ??= null
    eventoId ??= null
    if (projetoId !== null && !idsDeProjetos.has(projetoId)) {
      avisos.push({
        id: noticia.id,
        titulo: noticia.titulo,
        motivo: `o projeto nº ${projetoId} não existe ou não é público. A notícia foi publicada sem a ligação com o projeto`,
        publicada: true,
      })
      projetoId = null
    }
    if (eventoId !== null && !idsDeEventos.has(eventoId)) {
      avisos.push({
        id: noticia.id,
        titulo: noticia.titulo,
        motivo: `o evento nº ${eventoId} não existe ou não é público. A notícia foi publicada sem a ligação com o evento`,
        publicada: true,
      })
      eventoId = null
    }
    return { ...noticia, projetoId, eventoId }
  })
  return { noticias: ligadas, avisos }
}

/**
 * v5.4h - os dados da Instituição que o painel marcou "vai para o site". TOLERANTE a uma API que ainda não tem a rota (404/405): sem dado, vale o texto fixo do
 * site. Só entram valores de texto (o resto não é desta rota).
 */
async function buscarInstituicao(base, config) {
  let dados
  try {
    dados = await buscarJson(base, '/api/publico/instituicao', config)
  } catch (erro) {
    if (/respondeu 40[45]/.test(String(erro?.message))) return {}
    throw erro
  }
  const instituicao = {}
  for (const [chave, valor] of Object.entries(dados ?? {})) {
    if (typeof valor === 'string') instituicao[chave] = valor
  }
  return instituicao
}

/**
 * Lê TODO o conteúdo público. A API escala a zero (partida a frio de ~20-35 s), então o tempo por
 * tentativa é generoso. Qualquer falha derruba o build: melhor não publicar do que publicar um
 * site sem a diretoria, sem projetos e sem eventos por causa de uma API acordando.
 */
export async function buscarConteudoPublico(apiUrl, opcoes = {}) {
  const config = {
    fetchImpl: opcoes.fetchImpl ?? fetch,
    tentativas: opcoes.tentativas ?? 3,
    timeoutMs: opcoes.timeoutMs ?? 60_000,
    esperaMs: opcoes.esperaMs ?? ESPERA_ENTRE_TENTATIVAS_MS,
  }
  const base = apiUrl.replace(/\/+$/, '')
  const chaves = Object.keys(ENDPOINTS_DE_LISTA)
  const respostas = await Promise.all(
    chaves.map((chave) => buscarJson(base, ENDPOINTS_DE_LISTA[chave], config)),
  )
  const { diretoria, assembleias, parcerias, documentos, ...listas } =
    Object.fromEntries(chaves.map((chave, i) => [chave, respostas[i]]))
  const instituicao = await buscarInstituicao(base, config)
  const eventos = listas.eventos.map(normalizarEvento)
  const projetos = listas.projetos.map(normalizarProjeto)
  const detalhesDeEventos = {}
  await Promise.all(
    eventos.map(async (evento) => {
      detalhesDeEventos[evento.id_evento] = normalizarEventoDetalhado(
        await buscarJson(
          base,
          `/api/publico/eventos/${evento.id_evento}`,
          config,
        ),
      )
    }),
  )
  // v5.5: cada projeto público tem a sua página, com as edições, os relatórios e as fotos dele.
  const detalhesDeProjetos = {}
  await Promise.all(
    projetos.map(async (projeto) => {
      detalhesDeProjetos[projeto.id_projeto] = normalizarProjetoDetalhado(
        await buscarJson(
          base,
          `/api/publico/projetos/${projeto.id_projeto}`,
          config,
        ),
      )
    }),
  )
  // Cada parceria aprovada tem a sua página (parcelas, recebimentos, pagamentos, etapas, relatórios, documentos).
  const detalhesDeParcerias = {}
  await Promise.all(
    parcerias.map(async (parceria) => {
      detalhesDeParcerias[parceria.id_parceria] = await buscarJson(
        base,
        `/api/publico/transparencia/parcerias/${parceria.id_parceria}`,
        config,
      )
    }),
  )
  // Documento aprovado em formato TEXTO (ex.: o estatuto transcrito) vira uma página: o texto vem do detalhe e o build só o
  // aceita se o SHA-256 bater com o que foi aprovado (mesma regra do PDF).
  const detalhesDeDocumentos = {}
  await Promise.all(
    documentos
      .filter((documento) => documento.formato === 'TEXTO')
      .map(async (documento) => {
        const detalhe = await buscarJson(
          base,
          `/api/publico/transparencia/documentos/${documento.id_documento}`,
          config,
        )
        verificarTextoDoDocumento(detalhe)
        detalhesDeDocumentos[documento.id_documento] = detalhe
      }),
  )
  // Notícias vêm do Directus (editor do site). Sem token em desenvolvimento = lista vazia; nos workflows de
  // publicação o token é obrigatório (DIRECTUS_OBRIGATORIO=1) e a falta dele derruba o build.
  const lidas = await buscarNoticias(
    opcoes.directus ?? configuracaoDoDirectus(),
    {
      fetchImpl: config.fetchImpl,
      tentativas: config.tentativas,
      timeoutMs: config.timeoutMs,
      esperaMs: config.esperaMs,
    },
  )
  // A notícia ligada a projeto/evento que não existe (ou não é público) vai ao ar sem a ligação.
  const { noticias, avisos } = ligarNoticias(lidas.noticias, {
    projetos,
    eventos,
  })
  return {
    instituicao,
    eventos,
    detalhesDeEventos,
    projetos,
    detalhesDeProjetos,
    diretoria,
    assembleias,
    parcerias,
    detalhesDeParcerias,
    documentos,
    detalhesDeDocumentos,
    noticias,
    avisosDeNoticias: [...lidas.avisos, ...avisos],
  }
}

/** Primeiros bytes de todo JPEG. */
const ASSINATURA_DE_JPEG = Buffer.from([0xff, 0xd8, 0xff])

/**
 * Baixa a foto de uma etapa (já regravada pela API: JPEG sem metadado, no máximo 2000 px) para o site guardá-la em endereço
 * permanente. Mesma regra do PDF: só entra o que é JPEG de verdade e cujo SHA-256 é o que a API declara.
 */
export async function baixarFotoDaTransparencia(apiUrl, foto, opcoes = {}) {
  const base = apiUrl.replace(/\/+$/, '')
  const bytes = await buscarJson(base, foto.arquivo, {
    fetchImpl: opcoes.fetchImpl ?? fetch,
    tentativas: opcoes.tentativas ?? 3,
    timeoutMs: opcoes.timeoutMs ?? 60_000,
    esperaMs: opcoes.esperaMs ?? ESPERA_ENTRE_TENTATIVAS_MS,
    headers: { Accept: 'image/jpeg' },
    ler: async (resposta) => Buffer.from(await resposta.arrayBuffer()),
  })
  // `opcoes.descricao`: de onde é a foto, para a mensagem de erro ("da transparência" é a etapa de parceria).
  const origem = opcoes.descricao ?? 'da transparência'
  if (
    !bytes.subarray(0, ASSINATURA_DE_JPEG.length).equals(ASSINATURA_DE_JPEG)
  ) {
    throw new Error(`A foto ${foto.id_foto} ${origem} não é um JPEG.`)
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== foto.sha256) {
    throw new Error(
      `A foto ${foto.id_foto} ${origem} não confere com a aprovada: SHA-256 ${sha256} em vez de ${foto.sha256}.`,
    )
  }
  return bytes
}

/**
 * O texto publicado tem que ser exatamente o aprovado: o SHA-256 dos seus bytes UTF-8 é o que a API declara. Texto vazio,
 * ou que não bate, derruba o build (melhor não publicar do que publicar outro texto).
 */
export function verificarTextoDoDocumento(detalhe) {
  const texto = detalhe.texto
  if (typeof texto !== 'string' || texto.trim() === '') {
    throw new Error(
      `O documento ${detalhe.id_documento} ("${detalhe.titulo}") é de formato texto, mas veio sem texto.`,
    )
  }
  const sha256 = createHash('sha256').update(texto, 'utf8').digest('hex')
  if (sha256 !== detalhe.sha256) {
    throw new Error(
      `O texto do documento ${detalhe.id_documento} ("${detalhe.titulo}") não confere com o que foi aprovado: ` +
        `SHA-256 ${sha256} em vez de ${detalhe.sha256}.`,
    )
  }
}

/** Primeiros bytes de todo PDF. */
const ASSINATURA_DE_PDF = Buffer.from('%PDF-')

/**
 * Baixa o PDF de um documento APROVADO da Transparência para o site guardá-lo em URL permanente (o site no ar não
 * depende de a API estar acordada: partida a frio de ~20-35 s). Só entra o arquivo que É o aprovado: o SHA-256 que a
 * API declara (o do arquivo que passou no verificador e foi aprovado) tem que bater com o dos bytes recebidos, e os
 * bytes têm que ser um PDF. Qualquer divergência derruba o build: melhor não publicar do que publicar outro arquivo.
 */
export async function baixarPdfDaTransparencia(apiUrl, documento, opcoes = {}) {
  const base = apiUrl.replace(/\/+$/, '')
  const bytes = await buscarJson(base, documento.arquivo, {
    fetchImpl: opcoes.fetchImpl ?? fetch,
    tentativas: opcoes.tentativas ?? 3,
    timeoutMs: opcoes.timeoutMs ?? 60_000,
    esperaMs: opcoes.esperaMs ?? ESPERA_ENTRE_TENTATIVAS_MS,
    headers: { Accept: 'application/pdf' },
    ler: async (resposta) => Buffer.from(await resposta.arrayBuffer()),
  })
  if (!bytes.subarray(0, ASSINATURA_DE_PDF.length).equals(ASSINATURA_DE_PDF)) {
    throw new Error(
      `O arquivo do documento ${documento.id_documento} ("${documento.titulo}") não é um PDF.`,
    )
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== documento.sha256) {
    throw new Error(
      `O PDF do documento ${documento.id_documento} ("${documento.titulo}") não confere com o que foi aprovado: ` +
        `SHA-256 ${sha256} em vez de ${documento.sha256}.`,
    )
  }
  return bytes
}

/** Remove, recursivamente, os campos que mudam a cada inscrição (não justificam reconstruir o site). */
function semVolateis(valor) {
  if (Array.isArray(valor)) return valor.map(semVolateis)
  if (valor && typeof valor === 'object') {
    const limpo = {}
    for (const chave of Object.keys(valor).sort()) {
      // `avisosDeNoticias` é diagnóstico (o que NÃO foi publicado): não justifica reconstruir o site.
      if (
        chave === 'vagas_livres' ||
        chave === 'vagas_ocupadas' ||
        chave === 'avisosDeNoticias'
      )
        continue
      limpo[chave] = semVolateis(valor[chave])
    }
    return limpo
  }
  return valor
}

/**
 * SHA-256 do conteúdo canônico (chaves em ordem, sem vagas). Duas buscas iguais dão a mesma
 * impressão; basta um título, uma data ou um nome mudar para ela mudar.
 */
export function impressaoDoConteudo(conteudo) {
  const canonico = JSON.stringify(semVolateis(conteudo))
  return createHash('sha256').update(canonico).digest('hex')
}
