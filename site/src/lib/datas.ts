/**
 * Datas de evento. A API devolve o instante em UTC, SEM fuso ("2026-10-10T22:00:00"): é assim que o painel manda (a diretoria digita 19:00 em Belém, o navegador envia 22:00Z) e que o
 * servidor guarda e compara. Parauapebas fica em America/Belem (UTC-3, sem horário de verão desde 2019). Duas regras, juntas, dão sempre a hora certa:
 *  1. ler a data crua como UTC (nunca com `new Date(...)` puro, que usaria o fuso de QUEM ESTÁ VENDO — um visitante em Lisboa veria o evento três horas errado);
 *  2. formatar sempre no fuso da ASAF (`TIMEZONE_ASAF`): "22:00" em UTC aparece como "19:00".
 * (Até a v5.7 a leitura tratava a data crua como horário LOCAL de Belém, e todo evento criado pelo painel aparecia no site três horas depois do digitado.)
 *
 * Módulo separado de seo.ts de propósito: o navegador carrega este arquivo (ilha de eventos) e
 * não deve arrastar junto os dados institucionais.
 */
export const FUSO_ASAF = '-03:00'
export const TIMEZONE_ASAF = 'America/Belem'

const TEM_FUSO = /(Z|[+-]\d{2}:?\d{2})$/

const PARTES_DE_BELEM = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE_ASAF,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/** O instante absoluto da data da API (sem fuso = UTC; nunca depende do fuso do navegador). */
export function paraInstante(isoDaApi: string): Date {
  return new Date(TEM_FUSO.test(isoDaApi) ? isoDaApi : `${isoDaApi}Z`)
}

/**
 * A data da API como ISO com o fuso da ASAF ("2026-10-10T22:00:00" -> "2026-10-10T19:00:00-03:00"), para `<time datetime>` e para o dado estruturado que o Google lê. Data que já
 * traz fuso passa intacta.
 */
export function comFusoDaAsaf(isoDaApi: string): string {
  if (TEM_FUSO.test(isoDaApi)) return isoDaApi
  const p = Object.fromEntries(
    PARTES_DE_BELEM.formatToParts(paraInstante(isoDaApi)).map((x) => [
      x.type,
      x.value,
    ]),
  )
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${FUSO_ASAF}`
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

/** "sábado, 10 de outubro de 2026, às 19:00" — o dia e a hora do evento, no horário de Parauapebas. */
export function formatarDiaEHora(isoDaApi: string): string {
  return `${formatarDia(isoDaApi)}, às ${formatarHora(isoDaApi)}`
}

/** Um instante de evento em duas formas: o texto que a pessoa lê e o ISO COM fuso (para `<time datetime>`). */
export interface InstanteDoEvento {
  texto: string
  iso: string
}

/**
 * O "Quando" de um evento, em partes (a página do evento e a ilha que a atualiza ao vivo escrevem exatamente a mesma coisa):
 * o começo ("sábado, 10 de outubro de 2026, às 19:00") e, se houver, o fim — só a hora quando é no mesmo dia, o dia e a hora quando não é.
 */
export function quandoEmPartes(
  inicio: string,
  fim: string | null,
): { inicio: InstanteDoEvento; fim: InstanteDoEvento | null } {
  const mesmoDia = !fim || formatarDia(fim) === formatarDia(inicio)
  return {
    inicio: { texto: formatarDiaEHora(inicio), iso: comFusoDaAsaf(inicio) },
    fim: fim
      ? {
          texto: mesmoDia
            ? formatarHora(fim)
            : `${formatarDia(fim)}, ${formatarHora(fim)}`,
          iso: comFusoDaAsaf(fim),
        }
      : null,
  }
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
 * emitido) -> "03/10/2026 11:30" no horário de Parauapebas. Faz o mesmo que `paraInstante` (sem fuso = UTC) e devolve o texto já no horário de Parauapebas.
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

/**
 * Instante gravado pelo sistema em UTC SEM fuso ("2026-10-19T14:30:00.123456", ex.: o prazo de resposta de um pedido) -> "19 de outubro de 2026", o DIA
 * no horário de Parauapebas (um prazo que cai à 1h da manhã em UTC ainda é o dia anterior aqui).
 */
export function formatarDiaDeInstanteUtc(isoUtcSemFuso: string): string {
  const instante = new Date(
    TEM_FUSO.test(isoUtcSemFuso) ? isoUtcSemFuso : `${isoUtcSemFuso}Z`,
  )
  return FORMATO_DATA_LONGA.format(instante)
}
