/**
 * Datas de evento (v5.0). A API devolve horário LOCAL do evento, sem fuso ("2026-10-10T19:00:00").
 * Parauapebas fica em America/Belem (UTC-3, sem horário de verão desde 2019). Tratar a data crua
 * com `new Date(...)` usaria o fuso de QUEM ESTÁ VENDO — um visitante em Lisboa veria o evento
 * três horas errado. Por isso: fixar o fuso da ASAF ao ler e formatar sempre nele.
 *
 * Módulo separado de seo.ts de propósito: o navegador carrega este arquivo (ilha de eventos) e
 * não deve arrastar junto os dados institucionais.
 */
export const FUSO_ASAF = '-03:00'
export const TIMEZONE_ASAF = 'America/Belem'

const TEM_FUSO = /(Z|[+-]\d{2}:?\d{2})$/

/** Acrescenta o deslocamento da ASAF a uma data sem fuso; datas que já têm fuso passam intactas. */
export function comFusoDaAsaf(isoLocal: string): string {
  return TEM_FUSO.test(isoLocal) ? isoLocal : `${isoLocal}${FUSO_ASAF}`
}

/** O instante absoluto da data da API (nunca depende do fuso do navegador). */
export function paraInstante(isoDaApi: string): Date {
  return new Date(comFusoDaAsaf(isoDaApi))
}

const FORMATO_DIA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIMEZONE_ASAF,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const FORMATO_HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIMEZONE_ASAF,
  hour: '2-digit',
  minute: '2-digit',
})

/** "sábado, 10 de outubro de 2026" */
export function formatarDia(isoDaApi: string): string {
  return FORMATO_DIA.format(paraInstante(isoDaApi))
}

/** "19:00" */
export function formatarHora(isoDaApi: string): string {
  return FORMATO_HORA.format(paraInstante(isoDaApi))
}
