// Conteúdo público do site (v5.2) — busca na API e "impressão digital" do que as páginas mostram.
//
// (v5.3: junta também as notícias do Directus — ver ./directus.mjs.)
// (v5.4b: junta as parcerias/emendas e os documentos APROVADOS da Transparência, que moram no SISTEMA.)
// (v5.5: o detalhe de cada projeto (edições, relatórios, fotos), o contexto de cada evento e a ligação das notícias
//  com projeto/evento. TOLERANTE a API antiga: o que ainda não existe nela vira lista vazia / null.)
// (v5.7c: a foto de quem está na Diretoria e no Conselho Fiscal, só de quem autorizou a imagem. O JPEG é baixado NO BUILD
//  (`baixarFotosDaDiretoria`) e uma foto que falha deixa só aquela pessoa sem foto; nunca derruba o build.)
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
    eventos: lista(detalhe.eventos).map(normalizarResumoDeEvento),
    documentos: lista(detalhe.documentos),
    fotos: lista(detalhe.fotos),
  }
}

/** Situações que o sistema conhece (v5.5d). O que não for uma delas (ou vier ausente, de uma API antiga) vale `Programado`. */
const STATUS_DO_EVENTO = ['Programado', 'Adiado', 'Cancelado', 'Realizado']

const statusDoEvento = (valor) =>
  STATUS_DO_EVENTO.includes(valor) ? valor : 'Programado'

const textoOuNulo = (valor) =>
  typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null

/**
 * Evento da lista: sem `id_projeto` (API antiga) = sem projeto. v5.5d: a situação do evento (`status`, o `motivo_status` e o começo de antes da remarcação,
 * `data_hora_inicio_anterior`) — API antiga, sem esses campos = evento `Programado`, sem motivo e nunca remarcado.
 */
export function normalizarEvento(evento) {
  return {
    ...evento,
    id_projeto: evento.id_projeto ?? null,
    status: statusDoEvento(evento.status),
    motivo_status: textoOuNulo(evento.motivo_status),
    data_hora_inicio_anterior: textoOuNulo(evento.data_hora_inicio_anterior),
  }
}

/** Caminho, na API, da foto de quem está na Diretoria: o contrato é exatamente este prefixo mais o número da foto. */
const PREFIXO_DA_FOTO_DA_DIRETORIA = '/api/publico/diretoria/fotos/'

const inteiroPositivo = (valor) => Number.isInteger(valor) && valor > 0

/**
 * Foto de um membro da Diretoria (v5.7c) -> forma que o site usa, ou `null`. TOLERANTE: API antiga (sem o campo), pessoa sem foto autorizada
 * (`null`) e qualquer formato que não seja o do contrato (campo faltando, impressão digital que não é SHA-256, endereço fora de
 * `/api/publico/diretoria/fotos/<id_foto>`) valem "sem foto" — nunca derrubam o build, e uma resposta estranha da API não vira endereço a baixar.
 */
export function normalizarFotoDaDiretoria(foto) {
  if (!foto || typeof foto !== 'object' || Array.isArray(foto)) return null
  const { id_foto, sha256, largura, altura, arquivo } = foto
  const alt = textoOuNulo(foto.alt)
  if (
    !inteiroPositivo(id_foto) ||
    alt === null ||
    typeof sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(sha256) ||
    !inteiroPositivo(largura) ||
    !inteiroPositivo(altura) ||
    arquivo !== `${PREFIXO_DA_FOTO_DA_DIRETORIA}${id_foto}`
  ) {
    return null
  }
  return {
    id_foto,
    alt,
    sha256: sha256.toLowerCase(),
    largura,
    altura,
    arquivo,
  }
}

/** Membro da Diretoria/Conselho: `foto` ausente (API antiga) ou inválida = `null`. */
export function normalizarMembroDaDiretoria(membro) {
  return { ...membro, foto: normalizarFotoDaDiretoria(membro.foto) }
}

/**
 * Nome da cópia da foto da Diretoria no site (`/midia/diretoria/<nome>.jpg`): o número da foto e o começo da impressão digital. O número
 * não muda quando a pessoa troca de foto (a nova substitui a antiga), a impressão muda: com ela no nome, o endereço de uma foto nova
 * nunca é o de uma foto velha que algum navegador ou rede de distribuição ainda guarde.
 */
export const nomeDaFotoDaDiretoria = (foto) =>
  `${foto.id_foto}-${foto.sha256.slice(0, 12)}`

/** Evento nas listas de contexto (edições do projeto, cadeia de edições): só traz o `status` (API antiga = `Programado`). */
const normalizarResumoDeEvento = (resumo) => ({
  ...resumo,
  status: statusDoEvento(resumo.status),
})

/** Detalhe do evento: projeto ausente = null; sessões, perguntas, edições, documentos e fotos ausentes = lista vazia. */
export function normalizarEventoDetalhado(detalhe) {
  return {
    ...normalizarEvento(detalhe),
    sessoes: lista(detalhe.sessoes),
    perguntas: lista(detalhe.perguntas),
    projeto: detalhe.projeto ?? null,
    edicoes: lista(detalhe.edicoes).map(normalizarResumoDeEvento),
    documentos: lista(detalhe.documentos),
    fotos: lista(detalhe.fotos),
  }
}

/**
 * Notícia ligada a projeto/evento que NÃO existe (ou não é público) é publicada SEM a ligação — o número errado no
 * Directus nunca tira a notícia do ar, nem faz um link que daria 404. Cada ligação desfeita vira um aviso (mesmo
 * formato dos avisos de `validarNoticias`, com `publicada: true`) para o editor corrigir o número.
 */
export function ligarNoticias(noticias, { projetos, eventos, parcerias = [] }) {
  const idsDeProjetos = new Set(projetos.map((p) => p.id_projeto))
  const idsDeEventos = new Set(eventos.map((e) => e.id_evento))
  // v5.7h: a emenda é uma parceria do tipo EMENDA, e só tem página quando está aprovada (a lista pública só traz as aprovadas)
  const idsDeEmendas = new Set(
    parcerias
      .filter((p) => p.tipo_codigo === 'EMENDA')
      .map((p) => p.id_parceria),
  )
  const avisos = []
  const ligadas = noticias.map((noticia) => {
    let { projetoId, eventoId, emendaId } = noticia
    projetoId ??= null
    eventoId ??= null
    emendaId ??= null
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
    if (emendaId !== null && !idsDeEmendas.has(emendaId)) {
      avisos.push({
        id: noticia.id,
        titulo: noticia.titulo,
        motivo: `a emenda nº ${emendaId} não existe ou não é pública. A notícia foi publicada sem a ligação com a emenda`,
        publicada: true,
      })
      emendaId = null
    }
    return { ...noticia, projetoId, eventoId, emendaId }
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
 * v6.3b - as contas de cada exercício aprovadas pela Assembleia e publicadas (números gerados dos lançamentos). TOLERANTE a uma API que ainda não
 * tem a rota (404/405): sem a rota, nenhuma conta publicada.
 */
async function buscarContas(base, config) {
  return buscarListaOpcional(base, '/api/publico/transparencia/contas', config)
}

/** v6.3b/c - uma lista que a API pode ainda não ter (404/405): sem a rota, lista vazia; outro erro derruba o build. */
async function buscarListaOpcional(base, caminho, config) {
  try {
    const dados = await buscarJson(base, caminho, config)
    return Array.isArray(dados) ? dados : []
  } catch (erro) {
    if (/respondeu 40[45]/.test(String(erro?.message))) return []
    throw erro
  }
}

/**
 * Lê TODO o conteúdo público. A API escala a zero (partida a frio de ~20-35 s), então o tempo por
 * tentativa é generoso. Qualquer falha derruba o build: melhor não publicar do que publicar um
 * site sem a diretoria, sem projetos e sem eventos por causa de uma API acordando.
 * (As FOTOS da Diretoria são a exceção, e só no build: aqui só se lê a lista, com a foto normalizada; quem baixa e confere o JPEG é `baixarFotosDaDiretoria`.)
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
  const contas = await buscarContas(base, config)
  // v6.3c - o relatório anual de atividades de cada ano publicado (mesma tolerância das contas)
  const relatoriosAnuais = await buscarListaOpcional(
    base,
    '/api/publico/transparencia/relatorios-anuais',
    config,
  )
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
    parcerias,
  })
  return {
    instituicao,
    eventos,
    detalhesDeEventos,
    projetos,
    detalhesDeProjetos,
    diretoria: diretoria.map(normalizarMembroDaDiretoria),
    assembleias,
    parcerias,
    detalhesDeParcerias,
    documentos,
    detalhesDeDocumentos,
    contas,
    relatoriosAnuais,
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
 * Baixa, NO BUILD, a foto de cada pessoa da Diretoria e do Conselho que tem foto (v5.7c), conferindo que é JPEG e que o SHA-256 é o declarado
 * (`baixarFotoDaTransparencia`). Diferente das fotos de evento e de etapa, uma foto que falha (API fora do ar, 404 porque a pessoa deixou
 * o cargo ou retirou a autorização no meio do caminho, arquivo adulterado) NÃO derruba o build: só aquela pessoa sai sem foto, e o motivo
 * volta em `avisos` para o build registrar. A página da Diretoria tem de sair do ar com ou sem rosto; a foto é a parte opcional.
 *
 * Devolve `diretoria` (os membros cuja foto não veio ficam com `foto: null`), `fotos` (nome da cópia -> bytes; ver `nomeDaFotoDaDiretoria`) e
 * `avisos`. A mesma foto em dois mandatos da mesma pessoa é baixada uma vez.
 *
 * O conteúdo devolvido é o que o site publica: se uma foto falhou, a impressão dele difere da da API (que ainda declara a foto), e a próxima
 * sincronização reconstrói o site para tentar de novo, em vez de deixar a pessoa sem foto até a próxima mudança qualquer.
 */
export async function baixarFotosDaDiretoria(apiUrl, diretoria, opcoes = {}) {
  const fotos = new Map()
  const avisos = []
  const porNome = new Map()
  for (const membro of diretoria) {
    if (membro.foto) porNome.set(nomeDaFotoDaDiretoria(membro.foto), membro)
  }
  await Promise.all(
    [...porNome].map(async ([nome, membro]) => {
      try {
        fotos.set(
          nome,
          await baixarFotoDaTransparencia(apiUrl, membro.foto, {
            ...opcoes,
            descricao: 'da Diretoria',
          }),
        )
      } catch (erro) {
        avisos.push({
          id_foto: membro.foto.id_foto,
          cargo: membro.cargo,
          motivo: erro instanceof Error ? erro.message : String(erro),
        })
      }
    }),
  )
  avisos.sort((a, b) => a.id_foto - b.id_foto)
  return {
    diretoria: diretoria.map((membro) =>
      membro.foto && !fotos.has(nomeDaFotoDaDiretoria(membro.foto))
        ? { ...membro, foto: null }
        : membro,
    ),
    fotos,
    avisos,
  }
}

/** Escreve no log do build uma linha por foto da Diretoria que ficou de fora (no GitHub Actions, como aviso destacado). */
export function anunciarAvisosDeFotosDaDiretoria(
  avisos,
  escrever = console.warn,
  noGitHub = process.env.GITHUB_ACTIONS === 'true',
) {
  for (const aviso of avisos ?? []) {
    const texto = `Foto da Diretoria NÃO publicada (foto nº ${aviso.id_foto}, ${aviso.cargo}): ${aviso.motivo}. A pessoa aparece só com nome e cargo; a próxima sincronização tenta de novo.`
    escrever(
      noGitHub
        ? `::warning title=Foto da Diretoria não publicada::${texto.replace(/[\r\n]+/g, ' ')}`
        : texto,
    )
  }
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
