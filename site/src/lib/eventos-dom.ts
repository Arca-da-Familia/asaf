import { buscarEventosPublicos, type EventoPublico } from './api'
import { comFusoDaAsaf, formatarDia, formatarHora, paraInstante } from './datas'

/**
 * Ilha "Próximos eventos" (v5.0): busca `GET /api/publico/eventos` NO NAVEGADOR, a cada visita.
 * É o padrão que o plano pede para todo dado dinâmico do site — evento novo ou vaga que acabou
 * aparecem na hora, sem rebuild do site.
 *
 * SEGURANÇA: título, descrição e local são texto digitado pela diretoria e vêm da API. Tudo é
 * inserido com `textContent`/`createElement`, NUNCA `innerHTML` — um título como
 * `<img onerror=...>` aparece como texto, não executa. Coberto em tests/eventos-dom.test.ts.
 */

const LIMITE_PADRAO = 6
const LIMITE_ARQUIVO = 12

/**
 * A API pública lista TODO evento marcado como público, inclusive os que já passaram, e não tem
 * campo de cancelamento (achado da v5.0, registrado para a v5.2). Aqui ficam só os que ainda
 * não terminaram, do mais próximo para o mais distante.
 */
export function eventosFuturos(
  eventos: EventoPublico[],
  agora: Date = new Date(),
  limite: number = LIMITE_PADRAO,
): EventoPublico[] {
  return eventos
    .filter(
      (e) =>
        paraInstante(e.data_hora_fim ?? e.data_hora_inicio).getTime() >=
        agora.getTime(),
    )
    .sort(
      (a, b) =>
        paraInstante(a.data_hora_inicio).getTime() -
        paraInstante(b.data_hora_inicio).getTime(),
    )
    .slice(0, limite)
}

/** Eventos que já terminaram, do mais recente para o mais antigo (arquivo da agenda). */
export function eventosPassados(
  eventos: EventoPublico[],
  agora: Date = new Date(),
  limite: number = LIMITE_ARQUIVO,
): EventoPublico[] {
  return eventos
    .filter(
      (e) =>
        paraInstante(e.data_hora_fim ?? e.data_hora_inicio).getTime() <
        agora.getTime(),
    )
    .sort(
      (a, b) =>
        paraInstante(b.data_hora_inicio).getTime() -
        paraInstante(a.data_hora_inicio).getTime(),
    )
    .slice(0, limite)
}

export type ModoDaLista = 'futuros' | 'passados'

/** Ids que têm página própria (/eventos/<id>/) no site publicado — só esses viram link. */
export function lerIdsComPagina(container: HTMLElement): Set<number> {
  const bruto = container.dataset.idsComPagina ?? ''
  return new Set(
    bruto
      .split(',')
      .map((p) => Number(p.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
  )
}

function criar<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  classe?: string,
  texto?: string,
): HTMLElementTagNameMap[K] {
  const elemento = document.createElement(tag)
  if (classe) elemento.className = classe
  if (texto !== undefined) elemento.textContent = texto
  return elemento
}

function rotuloDeVagas(evento: EventoPublico): string | null {
  if (evento.vagas_livres === null) return null
  if (evento.vagas_livres === 0) return 'Vagas esgotadas'
  return evento.vagas_livres === 1
    ? '1 vaga disponível'
    : `${evento.vagas_livres} vagas disponíveis`
}

function cartaoDoEvento(
  evento: EventoPublico,
  idsComPagina: Set<number>,
  modo: ModoDaLista,
): HTMLLIElement {
  const item = criar(
    'li',
    'flex flex-col rounded-lg border bg-card p-5 shadow-card',
  )

  const quando = criar('p', 'text-sm font-medium text-primary')
  const tempo = criar(
    'time',
    undefined,
    `${formatarDia(evento.data_hora_inicio)} · ${formatarHora(evento.data_hora_inicio)}`,
  )
  tempo.dateTime = comFusoDaAsaf(evento.data_hora_inicio)
  quando.append(tempo)
  item.append(quando)

  const titulo = criar('h3', 'mt-1 text-lg font-semibold')
  if (idsComPagina.has(evento.id_evento)) {
    // O link existe só quando a página do evento já foi publicada (senão seria um 404).
    const link = criar('a', 'underline-offset-4 hover:underline', evento.titulo)
    link.href = `/eventos/${evento.id_evento}/`
    titulo.append(link)
  } else {
    titulo.textContent = evento.titulo
  }
  item.append(titulo)

  if (evento.endereco_avulso) {
    item.append(
      criar('p', 'mt-1 text-sm text-muted-foreground', evento.endereco_avulso),
    )
  }
  if (evento.descricao) {
    item.append(criar('p', 'mt-2 line-clamp-3 text-sm', evento.descricao))
  }

  const selos = criar('p', 'mt-4 flex flex-wrap items-center gap-2 text-xs')
  if (evento.gratuito) {
    selos.append(
      criar(
        'span',
        'rounded-full bg-brand-secondary px-2 py-1 font-semibold text-brand-secondary-foreground',
        'Gratuito',
      ),
    )
  }
  // Vaga de evento que já passou não interessa a ninguém.
  const vagas = modo === 'futuros' ? rotuloDeVagas(evento) : null
  if (vagas) selos.append(criar('span', 'text-muted-foreground', vagas))
  if (selos.childElementCount > 0) item.append(selos)

  return item
}

export function renderizarEventos(
  container: HTMLElement,
  eventos: EventoPublico[],
  idsComPagina: Set<number> = new Set(),
  modo: ModoDaLista = 'futuros',
): void {
  const lista = criar('ul', 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3')
  lista.setAttribute('data-estado', 'lista')
  for (const evento of eventos) {
    lista.append(cartaoDoEvento(evento, idsComPagina, modo))
  }
  container.replaceChildren(lista)
}

export function mostrarMensagem(
  container: HTMLElement,
  texto: string,
  estado: 'vazio' | 'erro' | 'carregando' = 'vazio',
  aoTentarDeNovo?: () => void,
): void {
  const paragrafo = criar('p', 'text-muted-foreground', texto)
  paragrafo.setAttribute('data-estado', estado)
  container.replaceChildren(paragrafo)
  if (aoTentarDeNovo) {
    const botao = criar(
      'button',
      'mt-3 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent',
      'Tentar novamente',
    )
    botao.type = 'button'
    botao.addEventListener('click', aoTentarDeNovo)
    container.append(botao)
  }
}

export interface OpcoesIlha {
  agora?: Date
  fetchImpl?: typeof fetch
  /** Depois deste tempo carregando, a mensagem avisa que pode demorar. */
  dicaAposMs?: number
  timeoutMs?: number
  esperaEntreTentativasMs?: number
}

/** Quanto esperar antes de avisar que está demorando (API acordando da partida a frio). */
const DICA_APOS_MS = 4000
/**
 * Por tentativa. Partida a frio da API MEDIDA em produção: 21 a 23 s na primeira chamada depois de
 * um tempo parada (e 33 s no Directus). Com 20 s a 1ª tentativa abortava um instante antes de a API
 * responder; 35 s deixa a 1ª terminar, e a 2ª tentativa fica para falha de verdade.
 */
const TIMEOUT_POR_TENTATIVA_MS = 35_000
const TENTATIVAS = 2

/** Carrega e desenha os eventos dentro de `container` (que traz `data-api-url`). */
export async function iniciarEventos(
  container: HTMLElement,
  opcoes: OpcoesIlha = {},
): Promise<void> {
  container.setAttribute('aria-busy', 'true')
  mostrarMensagem(container, 'Carregando eventos…', 'carregando')
  // A API escala a zero: a 1ª visita depois de um tempo parado espera o contêiner acordar.
  // Em vez de um "Carregando…" mudo, avisa que é normal demorar um pouco.
  const avisoDeDemora = setTimeout(
    () =>
      mostrarMensagem(
        container,
        'Ainda carregando os eventos… isso pode levar alguns segundos.',
        'carregando',
      ),
    opcoes.dicaAposMs ?? DICA_APOS_MS,
  )
  try {
    const todos = await buscarEventosPublicos({
      baseUrl: container.dataset.apiUrl ?? '',
      fetchImpl: opcoes.fetchImpl,
      timeoutMs: opcoes.timeoutMs ?? TIMEOUT_POR_TENTATIVA_MS,
      tentativas: TENTATIVAS,
      esperaEntreTentativasMs: opcoes.esperaEntreTentativasMs,
    })
    const modo: ModoDaLista =
      container.dataset.modo === 'passados' ? 'passados' : 'futuros'
    const escolhidos =
      modo === 'passados'
        ? eventosPassados(todos, opcoes.agora)
        : eventosFuturos(todos, opcoes.agora)
    if (escolhidos.length === 0) {
      mostrarMensagem(
        container,
        modo === 'passados'
          ? 'Ainda não há eventos realizados.'
          : 'Nenhum evento aberto no momento. Volte em breve.',
        'vazio',
      )
    } else {
      renderizarEventos(container, escolhidos, lerIdsComPagina(container), modo)
    }
  } catch {
    mostrarMensagem(
      container,
      'Não foi possível carregar os eventos agora.',
      'erro',
      () => void iniciarEventos(container, opcoes),
    )
  } finally {
    clearTimeout(avisoDeDemora)
    container.setAttribute('aria-busy', 'false')
  }
}
