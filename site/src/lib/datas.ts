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

const FORMATO_DATA_CURTA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

/**
 * "AAAA-MM-DD" (data sem hora, como mandato e projeto) -> "10/02/2026". Fixa UTC de propósito:
 * `new Date('2026-02-10')` já é meia-noite UTC, e formatar no fuso do navegador (UTC-3) mostraria
 * "09/02" — um dia a menos numa data de mandato.
 */
export function formatarDataCurta(dataIso: string): string {
  return FORMATO_DATA_CURTA.format(
    new Date(`${dataIso.slice(0, 10)}T00:00:00Z`),
  )
}

const FORMATO_DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIMEZONE_ASAF,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/**
 * Instante gravado pelo sistema em UTC SEM fuso ("2026-10-03T14:30:00", ex.: quando o edital foi
 * emitido) -> "03/10/2026 11:30" no horário de Parauapebas. É o oposto de `paraInstante`: aquele
 * trata a data da API como horário LOCAL do evento; este trata como UTC.
 */
export function formatarInstanteUtc(isoUtcSemFuso: string): string {
  const instante = new Date(
    TEM_FUSO.test(isoUtcSemFuso) ? isoUtcSemFuso : `${isoUtcSemFuso}Z`,
  )
  return FORMATO_DATA_HORA.format(instante).replace(',', '')
}

/** O evento já terminou? (compara instantes absolutos: não depende do fuso do navegador). */
export function jaAconteceu(
  fimOuInicioIso: string,
  agora: Date = new Date(),
): boolean {
  return paraInstante(fimOuInicioIso).getTime() < agora.getTime()
}

const FORMATO_DATA_LONGA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIMEZONE_ASAF,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

/** "10 de outubro de 2026" — data de uma notícia (instante UTC mostrado no horário de Parauapebas). */
export function formatarDataLonga(instanteIso: string): string {
  return FORMATO_DATA_LONGA.format(new Date(instanteIso))
}
