import { ApiError, buscarJson } from './api'
import {
  jaAconteceu,
  formatarDia,
  formatarHora,
  quandoEmPartes,
  type InstanteDoEvento,
} from './datas'
import {
  aplicarVagasAoVivo,
  esconderComoParticipar,
  mostrarComoParticipar,
} from './inscricao-evento'
import {
  avisoDaSituacao,
  CLASSES_DO_AVISO,
  fraseDeInscricaoParada,
  inscricoesParadas,
  situacaoDoEvento,
  statusDoEvento,
  textoOuNulo,
  type CamposDaSituacao,
  type StatusDoEvento,
} from './situacao-do-evento'

/**
 * Ilha da PÁGINA DE UM EVENTO (v5.2). A página é gerada no build (rápida, com a prévia certa no
 * WhatsApp), mas o que muda depois dela é resolvido aqui, no navegador, a cada visita:
 *
 *  1. VAGAS: `vagas_livres` muda a cada inscrição — o número do build seria velho.
 *  2. RETIRADO: a diretoria pode tirar o evento do ar (volta a "Interna"). A API passa a responder 404 e a
 *     página avisa na hora, sem esperar o próximo build.
 *  3. JÁ ACONTECEU: o build não sabe que dia é quando alguém abre a página meses depois.
 *  4. SITUAÇÃO (v5.5d): a diretoria pode cancelar, adiar, remarcar ou reativar o evento no painel. O site só é reconstruído
 *     de 15 em 15 minutos (ou mais): até lá, o aviso do topo, o "Quando" e a programação mostram a situação e a data de agora, e o bloco
 *     "Como participar" some (cancelado, adiado, realizado) ou volta (reativado, remarcado).
 *
 * Nos casos acima a INSCRIÇÃO acompanha (v5.5c): as vagas de agora (do evento e de cada sessão) chegam ao formulário e ao aviso de "vagas acabaram"; evento
 * retirado, que já aconteceu, cancelado, adiado ou realizado não oferece mais inscrição (some o bloco "Como participar" — a mensagem de cima é a que fica).
 *
 * SEGURANÇA: só `textContent` e atributos `hidden`/`class` — nada vindo da API entra como HTML (o motivo do cancelamento é texto digitado pela diretoria).
 */
export interface OpcoesEventoVivo {
  agora?: Date
  fetchImpl?: typeof fetch
  timeoutMs?: number
  esperaEntreTentativasMs?: number
}

/** O que a página usa de `GET /api/publico/eventos/{id}`. Tudo opcional: resposta parcial (ou de API antiga) nunca derruba a página. */
interface EventoAoVivo extends CamposDaSituacao {
  vagas_livres?: number | null
  data_hora_inicio?: string | null
  data_hora_fim?: string | null
  sessoes?: Array<{
    id_sessao?: number
    vagas_livres?: number | null
    data_hora_inicio?: string | null
  }>
}

function rotuloDeVagas(vagasLivres: number | null): string | null {
  if (vagasLivres === null) return null
  if (vagasLivres === 0) return 'Vagas esgotadas'
  return vagasLivres === 1
    ? '1 vaga disponível'
    : `${vagasLivres} vagas disponíveis`
}

function mostrar(raiz: HTMLElement, seletor: string, texto?: string): void {
  const alvo = raiz.querySelector<HTMLElement>(seletor)
  if (!alvo) return
  if (texto !== undefined) alvo.textContent = texto
  alvo.hidden = false
}

function esconder(raiz: HTMLElement, seletor: string): void {
  const alvo = raiz.querySelector<HTMLElement>(seletor)
  if (alvo) alvo.hidden = true
}

/**
 * Escreve o texto (como TEXTO) e mostra o elemento; sem texto (`null`), o elemento fica escondido e vazio. Só mexe no que mudou: reescrever o mesmo texto dentro
 * de um `role="status"` faria o leitor de tela anunciar o aviso uma segunda vez.
 */
function escrever(raiz: HTMLElement, seletor: string, texto: string | null) {
  const alvo = raiz.querySelector<HTMLElement>(seletor)
  if (!alvo) return
  if (alvo.textContent !== (texto ?? '')) alvo.textContent = texto ?? ''
  alvo.hidden = texto === null
}

/**
 * O que a inscrição pede da situação e da data: só o evento PROGRAMADO e que ainda não terminou tem "Como participar". O aviso "A data deste evento já
 * passou" é do programado; cancelado, adiado e realizado já têm o aviso da situação (e a frase curta que ocupa o lugar do formulário).
 */
function pintarInscricao(
  raiz: HTMLElement,
  status: StatusDoEvento,
  fim: string | null,
  agora?: Date,
): void {
  const parado = inscricoesParadas(status)
  const passou = fim ? jaAconteceu(fim, agora) : false
  const aviso = raiz.querySelector<HTMLElement>('[data-aviso-realizado]')
  if (aviso) aviso.hidden = !(!parado && passou)
  if (parado || passou) esconderComoParticipar(raiz)
  else mostrarComoParticipar(raiz)
  escrever(raiz, '[data-inscricoes-paradas]', fraseDeInscricaoParada(status))
}

/** O aviso da situação no topo da página (cancelado, adiado, remarcado, realizado) — escrito e apagado ao vivo. */
function pintarAviso(raiz: HTMLElement, evento: CamposDaSituacao): void {
  const bloco = raiz.querySelector<HTMLElement>('[data-aviso-situacao]')
  if (!bloco) return
  const situacao = situacaoDoEvento(evento)
  const aviso = avisoDaSituacao(evento)
  bloco.dataset.situacaoDoEvento = situacao.status
  bloco.toggleAttribute('data-evento-remarcado', situacao.remarcado)
  bloco.hidden = aviso === null
  if (aviso) bloco.className = CLASSES_DO_AVISO[aviso.selo]
  escrever(bloco, '[data-situacao-frase]', aviso?.frase ?? null)
  escrever(bloco, '[data-situacao-motivo]', aviso?.motivo ?? null)
  escrever(bloco, '[data-situacao-complemento]', aviso?.complemento ?? null)
}

function tempo(instante: InstanteDoEvento): HTMLTimeElement {
  const elemento = document.createElement('time')
  elemento.dateTime = instante.iso
  elemento.textContent = instante.texto
  return elemento
}

/** O "Quando" de agora (o evento pode ter sido remarcado depois do build): o mesmo texto que a página escreve no build. */
function atualizarQuando(
  raiz: HTMLElement,
  inicio: string | null,
  fimDaApi: string | null,
): void {
  const alvo = raiz.querySelector<HTMLElement>('[data-quando]')
  if (!alvo || !inicio) return
  const quando = quandoEmPartes(inicio, fimDaApi)
  alvo.replaceChildren(
    tempo(quando.inicio),
    ...(quando.fim ? [' até ', tempo(quando.fim)] : []),
  )
}

/** Cada sessão da programação segue a data de agora (remarcar leva a programação junto). */
function atualizarSessoes(
  raiz: HTMLElement,
  sessoes: EventoAoVivo['sessoes'],
): void {
  for (const sessao of sessoes ?? []) {
    const inicio = textoOuNulo(sessao.data_hora_inicio)
    if (!inicio || !Number.isInteger(sessao.id_sessao)) continue
    const alvo = raiz.querySelector<HTMLTimeElement>(
      `time[data-sessao-horario="${sessao.id_sessao}"]`,
    )
    if (!alvo) continue
    alvo.dateTime = quandoEmPartes(inicio, null).inicio.iso
    alvo.textContent = `${formatarDia(inicio)}, ${formatarHora(inicio)}`
  }
}

/** A linha "Vagas" da página (o título e o número) aparece ou some junto. */
function mostrarVagas(raiz: HTMLElement, rotulo: string | null): void {
  const numero = raiz.querySelector<HTMLElement>('[data-vagas]')
  const titulo = raiz.querySelector<HTMLElement>('[data-vagas-rotulo]')
  if (numero) {
    if (rotulo) numero.textContent = rotulo
    numero.hidden = rotulo === null
  }
  if (titulo) titulo.hidden = rotulo === null
}

export async function iniciarEventoVivo(
  raiz: HTMLElement,
  opcoes: OpcoesEventoVivo = {},
): Promise<void> {
  // O que o build já sabia. A data de hoje ele não sabia: "já aconteceu" é conferido agora.
  const fimDoBuild = textoOuNulo(raiz.dataset.fim)
  pintarInscricao(
    raiz,
    statusDoEvento(raiz.dataset.status),
    fimDoBuild,
    opcoes.agora,
  )

  try {
    const evento = await buscarJson<EventoAoVivo>(
      `/api/publico/eventos/${raiz.dataset.id ?? ''}`,
      {
        baseUrl: raiz.dataset.apiUrl ?? '',
        fetchImpl: opcoes.fetchImpl,
        timeoutMs: opcoes.timeoutMs ?? 35_000,
        tentativas: 2,
        esperaEntreTentativasMs: opcoes.esperaEntreTentativasMs,
      },
    )
    const situacao = situacaoDoEvento(evento)
    const inicio = textoOuNulo(evento.data_hora_inicio)
    const fimDaApi = textoOuNulo(evento.data_hora_fim)
    // sem data na resposta (parcial ou de API antiga), vale a do build
    const fim = inicio ? (fimDaApi ?? inicio) : fimDoBuild
    if (fim) raiz.dataset.fim = fim
    raiz.dataset.status = situacao.status

    atualizarQuando(raiz, inicio, fimDaApi)
    atualizarSessoes(raiz, evento.sessoes)
    pintarAviso(raiz, evento)
    pintarInscricao(raiz, situacao.status, fim, opcoes.agora)
    aplicarVagasAoVivo(raiz, evento)
    // evento parado não recebe inscrição: o número de vagas não ajuda ninguém
    mostrarVagas(
      raiz,
      inscricoesParadas(situacao.status)
        ? null
        : rotuloDeVagas(evento.vagas_livres ?? null),
    )
  } catch (erro) {
    // 404 = o evento saiu do ar depois do build. Outro erro (API acordando, sem rede): a página
    // continua útil com o que foi publicado — não alarma o visitante à toa.
    if (erro instanceof ApiError && erro.status === 404) {
      mostrar(raiz, '[data-aviso-retirado]')
      esconderComoParticipar(raiz)
      esconder(raiz, '[data-aviso-situacao]')
      esconder(raiz, '[data-inscricoes-paradas]')
      mostrarVagas(raiz, null)
    }
  }
}
