import { ApiError, buscarJson } from './api'
import { jaAconteceu } from './datas'
import {
  aplicarVagasAoVivo,
  esconderComoParticipar,
  type VagasAoVivo,
} from './inscricao-evento'

/**
 * Ilha da PÁGINA DE UM EVENTO (v5.2). A página é gerada no build (rápida, com a prévia certa no
 * WhatsApp), mas três coisas mudam depois dela e são resolvidas aqui, no navegador, a cada visita:
 *
 *  1. VAGAS: `vagas_livres` muda a cada inscrição — o número do build seria velho.
 *  2. RETIRADO: a diretoria pode tirar o evento do ar (o sistema não tem "cancelado": volta a
 *     "Interna"). A API passa a responder 404 e a página avisa na hora, sem esperar o próximo build.
 *  3. JÁ ACONTECEU: o build não sabe que dia é quando alguém abre a página meses depois.
 *
 * Nos três casos a INSCRIÇÃO acompanha (v5.5c): as vagas de agora (do evento e de cada sessão) chegam ao formulário e ao aviso de "vagas acabaram"; evento
 * retirado ou que já aconteceu não oferece mais inscrição (some o bloco "Como participar" — a mensagem de cima é a que fica).
 *
 * SEGURANÇA: só `textContent` e atributos `hidden` — nada vindo da API entra como HTML.
 */
export interface OpcoesEventoVivo {
  agora?: Date
  fetchImpl?: typeof fetch
  timeoutMs?: number
  esperaEntreTentativasMs?: number
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

export async function iniciarEventoVivo(
  raiz: HTMLElement,
  opcoes: OpcoesEventoVivo = {},
): Promise<void> {
  const fim = raiz.dataset.fim
  if (fim && jaAconteceu(fim, opcoes.agora)) {
    mostrar(raiz, '[data-aviso-realizado]')
    esconderComoParticipar(raiz)
  }

  try {
    const evento = await buscarJson<
      VagasAoVivo & { vagas_livres: number | null }
    >(`/api/publico/eventos/${raiz.dataset.id ?? ''}`, {
      baseUrl: raiz.dataset.apiUrl ?? '',
      fetchImpl: opcoes.fetchImpl,
      timeoutMs: opcoes.timeoutMs ?? 35_000,
      tentativas: 2,
      esperaEntreTentativasMs: opcoes.esperaEntreTentativasMs,
    })
    aplicarVagasAoVivo(raiz, evento)
    const rotulo = rotuloDeVagas(evento.vagas_livres)
    const vagas = raiz.querySelector<HTMLElement>('[data-vagas]')
    if (vagas) {
      if (rotulo) {
        vagas.textContent = rotulo
        vagas.hidden = false
      } else {
        vagas.hidden = true
      }
    }
  } catch (erro) {
    // 404 = o evento saiu do ar depois do build. Outro erro (API acordando, sem rede): a página
    // continua útil com o que foi publicado — não alarma o visitante à toa.
    if (erro instanceof ApiError && erro.status === 404) {
      mostrar(raiz, '[data-aviso-retirado]')
      esconderComoParticipar(raiz)
      raiz
        .querySelector<HTMLElement>('[data-vagas]')
        ?.setAttribute('hidden', '')
    }
  }
}
