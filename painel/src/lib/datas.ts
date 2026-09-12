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

export function formatarData(data: Date | string): string {
  const d = typeof data === 'string' ? new Date(`${data}T00:00:00`) : data
  return new Intl.DateTimeFormat('pt-BR').format(d)
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
