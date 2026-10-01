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

function cartaoDoEvento(evento: EventoPublico): HTMLLIElement {
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

  item.append(criar('h3', 'mt-1 text-lg font-semibold', evento.titulo))

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
        'rounded-full bg-secondary px-2 py-1 font-medium text-secondary-foreground',
        'Gratuito',
      ),
    )
  }
  const vagas = rotuloDeVagas(evento)
  if (vagas) selos.append(criar('span', 'text-muted-foreground', vagas))
  if (selos.childElementCount > 0) item.append(selos)

  return item
}

export function renderizarEventos(
  container: HTMLElement,
  eventos: EventoPublico[],
): void {
  const lista = criar('ul', 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3')
  lista.setAttribute('data-estado', 'lista')
  for (const evento of eventos) lista.append(cartaoDoEvento(evento))
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
}

/** Carrega e desenha os eventos dentro de `container` (que traz `data-api-url`). */
export async function iniciarEventos(
  container: HTMLElement,
  opcoes: OpcoesIlha = {},
): Promise<void> {
  container.setAttribute('aria-busy', 'true')
  mostrarMensagem(container, 'Carregando eventos…', 'carregando')
  try {
    const todos = await buscarEventosPublicos({
      baseUrl: container.dataset.apiUrl ?? '',
      fetchImpl: opcoes.fetchImpl,
    })
    const proximos = eventosFuturos(todos, opcoes.agora)
    if (proximos.length === 0) {
      mostrarMensagem(
        container,
        'Nenhum evento aberto no momento. Volte em breve.',
        'vazio',
      )
    } else {
      renderizarEventos(container, proximos)
    }
  } catch {
    mostrarMensagem(
      container,
      'Não foi possível carregar os eventos agora.',
      'erro',
      () => void iniciarEventos(container, opcoes),
    )
  } finally {
    container.setAttribute('aria-busy', 'false')
  }
}
