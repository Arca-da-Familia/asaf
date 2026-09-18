// Formatação de data/moeda/número SEMPRE por Intl (decisão v0.2.6 antecipada no que é
// estrutural) — nunca concatenação manual. Também aqui vivem os conversores ISO<->dd/mm/aaaa.

export function isoParaDataBr(iso: string): string {
  if (!iso) return ''
  const partes = iso.split('-')
  if (partes.length !== 3) return iso
  const [ano, mes, dia] = partes
  return `${dia}/${mes}/${ano}`
}

export function dataBrParaIso(br: string): string {
  const match = br.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return ''
  return `${match[3]}-${match[2]}-${match[1]}`
}

// Máscara progressiva de data enquanto o usuário digita (dd/mm/aaaa).
export function mascaraData(valor: string): string {
  const digitos = valor.replace(/\D/g, '').slice(0, 8)
  if (digitos.length <= 2) return digitos
  if (digitos.length <= 4) return `${digitos.slice(0, 2)}/${digitos.slice(2)}`
  return `${digitos.slice(0, 2)}/${digitos.slice(2, 4)}/${digitos.slice(4)}`
}

// Convenção do projeto (documentada desde a v4.3): todo datetime "ingênuo" (sem timezone na
// string) que circula entre painel e API é sempre UTC — nunca hora local crua. O back-end só
// grava isso porque SEMPRE recebe UTC de quem escreve (ver `paraUtcIso` abaixo, usado em todo
// formulário com `datetime-local`); o painel só exibe certo se SEMPRE tratar esse ingênuo como
// UTC antes de converter pra hora local de quem está vendo.
// Achado real (2026-09-18, relatado pelo usuário): sem isso, o JavaScript interpreta uma string
// "YYYY-MM-DDTHH:mm:ss" sem `Z` como hora LOCAL do navegador — uma auditoria feita agora em
// horário de Brasília aparecia ~3h adiantada (e depois das 21h, no dia seguinte), porque o valor
// gravado (UTC de verdade) era mostrado sem converter.
function comoUtc(dataHoraIso: string): string {
  return /Z$|[+-]\d{2}:?\d{2}$/.test(dataHoraIso)
    ? dataHoraIso
    : `${dataHoraIso}Z`
}

export function formatarData(
  data: Date | string,
  opcoes?: { comHora?: boolean },
): string {
  let d: Date
  if (typeof data === 'string') {
    // Data-only (yyyy-mm-dd) → força meia-noite local; datetime com hora → é UTC (ver `comoUtc`).
    d = data.includes('T')
      ? new Date(comoUtc(data))
      : new Date(`${data}T00:00:00`)
  } else {
    d = data
  }
  if (opcoes?.comHora) {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(d)
  }
  return new Intl.DateTimeFormat('pt-BR').format(d)
}

// Converte o valor CRU de um <input type="datetime-local"> (hora LOCAL de quem está digitando,
// sem timezone na string, por definição do próprio tipo de input HTML) pro UTC que a API espera
// receber — a outra ponta da mesma convenção que `formatarData`/`comoUtc` já assume na exibição.
// Usar em todo `.transform()` de schema cujo campo alimenta um input `datetime-local`.
export function paraUtcIso(dataHoraLocal: string): string {
  if (!dataHoraLocal) return dataHoraLocal
  return new Date(dataHoraLocal).toISOString()
}

export function formatarMoeda(centavos: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(centavos / 100)
}

export function formatarNumero(valor: number): string {
  return new Intl.NumberFormat('pt-BR').format(valor)
}
