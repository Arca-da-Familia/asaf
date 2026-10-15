import type { StatusDoEvento } from '../../scripts/lib/conteudo-publico.mjs'
import { formatarDiaEHora } from './datas'

export type { StatusDoEvento }

/**
 * A SITUAÇÃO do evento (v5.5d): Programado, Adiado, Cancelado ou Realizado, com o motivo (cancelar e adiar exigem motivo no sistema) e, quando o evento foi
 * remarcado, o começo de ANTES da remarcação. É um fato do sistema (a diretoria muda no painel) — o site só o mostra, em palavras, nunca só em cor:
 *
 *  - REMARCADO não é um status: é um evento `Programado` que tem `data_hora_inicio_anterior`;
 *  - Cancelado, Adiado e Realizado não recebem inscrição (a API recusa); Programado e Remarcado seguem como sempre;
 *  - para o Google, `startDate` é sempre a data ATUAL (em Cancelado e Adiado, a original) — ver `jsonLdEvento` em seo.ts.
 *
 * Funções PURAS, testadas em tests/situacao-do-evento.test.ts. A resposta de uma API antiga (sem estes campos) vale como `Programado`.
 */

const STATUS_CONHECIDOS: readonly string[] = [
  'Programado',
  'Adiado',
  'Cancelado',
  'Realizado',
]

/** Os campos da situação como a API pública os manda (todos opcionais: a API antiga não os tem). */
export interface CamposDaSituacao {
  status?: string | null
  motivo_status?: string | null
  data_hora_inicio_anterior?: string | null
}

/** O status do evento; ausente (API antiga) ou desconhecido vale `Programado`. */
export function statusDoEvento(valor: unknown): StatusDoEvento {
  return typeof valor === 'string' && STATUS_CONHECIDOS.includes(valor)
    ? (valor as StatusDoEvento)
    : 'Programado'
}

/** Texto digitado por alguém (motivo, data): sem espaços nas pontas; vazio ou que não é texto = `null`. */
export function textoOuNulo(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const texto = valor.trim()
  return texto === '' ? null : texto
}

export interface SituacaoDoEvento {
  status: StatusDoEvento
  motivo: string | null
  /** O começo de antes da última remarcação (ISO sem fuso); `null` = nunca foi remarcado. */
  inicioAnterior: string | null
  /** `Programado` com data anterior: o evento mudou de data e continua de pé. */
  remarcado: boolean
}

export function situacaoDoEvento(e: CamposDaSituacao): SituacaoDoEvento {
  const status = statusDoEvento(e.status)
  const inicioAnterior = textoOuNulo(e.data_hora_inicio_anterior)
  return {
    status,
    motivo: textoOuNulo(e.motivo_status),
    inicioAnterior,
    remarcado: status === 'Programado' && inicioAnterior !== null,
  }
}

/** O evento está sem receber inscrição? (cancelado, adiado e realizado: a API recusa a inscrição nova). */
export const inscricoesParadas = (status: StatusDoEvento): boolean =>
  status !== 'Programado'

export type SeloDoEvento = 'Cancelado' | 'Adiado' | 'Remarcado' | 'Realizado'

/** O selo do cartão/lista: `null` quando o evento é só `Programado` (nada a avisar). */
export function seloDoEvento(e: CamposDaSituacao): SeloDoEvento | null {
  const { status, remarcado } = situacaoDoEvento(e)
  if (status !== 'Programado') return status
  return remarcado ? 'Remarcado' : null
}

/**
 * Visual do selo (sempre com o TEXTO escrito: a cor nunca é a única pista). Cada par de cores vem da paleta da marca, com o contraste medido nos tokens:
 * vermelho de erro e verde institucional sobre branco, e o verde-escuro sobre o ouro.
 */
export const CLASSES_DO_SELO: Record<SeloDoEvento, string> = {
  Cancelado:
    'inline-block rounded-full border-2 border-destructive bg-background px-3 py-1 text-xs font-semibold text-destructive',
  Adiado:
    'inline-block rounded-full border-2 border-brand-secondary bg-brand-secondary px-3 py-1 text-xs font-semibold text-brand-secondary-foreground',
  Remarcado:
    'inline-block rounded-full border-2 border-primary bg-background px-3 py-1 text-xs font-semibold text-primary',
  Realizado:
    'inline-block rounded-full border-2 bg-muted px-3 py-1 text-xs font-semibold text-foreground',
}

const BASE_DO_AVISO = 'rounded-lg border-2 bg-card p-4 text-card-foreground'

/** Visual do aviso do topo da página do evento, por situação (o texto é quem diz o que houve). */
export const CLASSES_DO_AVISO: Record<SeloDoEvento, string> = {
  Cancelado: `${BASE_DO_AVISO} border-destructive`,
  Adiado: `${BASE_DO_AVISO} border-brand-secondary`,
  Remarcado: `${BASE_DO_AVISO} border-primary`,
  Realizado: `${BASE_DO_AVISO} border-border`,
}

export interface AvisoDaSituacao {
  status: StatusDoEvento
  remarcado: boolean
  /** Qual visual (classes) o aviso usa: o mesmo nome do selo do cartão. */
  selo: SeloDoEvento
  /** A frase principal (em negrito na página). */
  frase: string
  /** "Motivo: ..." — só quando o sistema guardou um motivo. O texto é do sistema: a página o escreve SEMPRE como texto, nunca como HTML. */
  motivo: string | null
  /** O que acontece com a inscrição, quando isso muda (hoje: evento adiado). */
  complemento: string | null
}

/** O aviso do topo da página do evento. `null` = evento só `Programado` (a página fica como sempre foi). */
export function avisoDaSituacao(e: CamposDaSituacao): AvisoDaSituacao | null {
  const { status, motivo, inicioAnterior, remarcado } = situacaoDoEvento(e)
  const linhaDoMotivo = motivo ? `Motivo: ${motivo}` : null
  if (status === 'Cancelado')
    return {
      status,
      remarcado: false,
      selo: 'Cancelado',
      frase: 'Este evento foi cancelado.',
      motivo: linhaDoMotivo,
      complemento: null,
    }
  if (status === 'Adiado')
    return {
      status,
      remarcado: false,
      selo: 'Adiado',
      frase: 'Este evento foi adiado. A nova data ainda não foi definida.',
      motivo: linhaDoMotivo,
      complemento:
        'Enquanto estiver adiado, o evento não recebe novas inscrições; se voltar a ser programado, elas reabrem nesta página.',
    }
  if (status === 'Realizado')
    return {
      status,
      remarcado: false,
      selo: 'Realizado',
      frase: 'Este evento já foi realizado.',
      motivo: null,
      complemento: null,
    }
  if (remarcado && inicioAnterior)
    return {
      status,
      remarcado: true,
      selo: 'Remarcado',
      frase: `Este evento foi remarcado. A data anterior era ${formatarDiaEHora(inicioAnterior)}.`,
      motivo: linhaDoMotivo,
      complemento: null,
    }
  return null
}

/** A frase curta que ocupa o lugar do formulário de inscrição quando o evento não recebe inscrição (`null` = há formulário). */
export function fraseDeInscricaoParada(status: StatusDoEvento): string | null {
  if (status === 'Cancelado')
    return 'As inscrições estão encerradas porque o evento foi cancelado.'
  if (status === 'Adiado')
    return 'Enquanto o evento estiver adiado, não recebemos novas inscrições.'
  if (status === 'Realizado') return 'As inscrições estão encerradas.'
  return null
}

/**
 * Este evento ainda é um "próximo evento"? Vale para as listas "a seguir" (Home, edições futuras): o evento programado enquanto a data não passou, e o ADIADO
 * sempre (ele não aconteceu e não tem data nova: a data que o site tem é a original). Cancelado e realizado nunca são "próximos".
 */
export function aindaVaiAcontecer(
  status: StatusDoEvento,
  jaPassou: boolean,
): boolean {
  if (status === 'Adiado') return true
  return status === 'Programado' && !jaPassou
}
