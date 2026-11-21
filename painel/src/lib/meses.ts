// v9.6b - as contas com o mês (AAAA-MM) das telas do Financeiro: o nome em português, o mês anterior e o próximo, o primeiro e o último dia.
const MESES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]

/** "2026-11" do dia no aparelho de quem usa (Belém). */
export function mesDeHoje(agora = new Date()): string {
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`
}

/** Aceita só AAAA-MM com mês de 1 a 12; o resto vira o mês de hoje. */
export function mesValido(valor: string | null | undefined): string | null {
  if (!valor || !/^\d{4}-\d{2}$/.test(valor)) return null
  const mes = Number(valor.slice(5, 7))
  return mes >= 1 && mes <= 12 ? valor : null
}

export function somarMeses(mes: string, quantos: number): string {
  const ano = Number(mes.slice(0, 4))
  const indice = Number(mes.slice(5, 7)) - 1 + quantos
  const novoAno = ano + Math.floor(indice / 12)
  const novoMes = ((indice % 12) + 12) % 12
  return `${novoAno}-${String(novoMes + 1).padStart(2, '0')}`
}

/** "Novembro de 2026" */
export function nomeDoMes(mes: string): string {
  return `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`
}

/** "Novembro" */
export function nomeCurtoDoMes(mes: string): string {
  return MESES[Number(mes.slice(5, 7)) - 1] ?? ''
}

/** O primeiro e o último dia do mês (AAAA-MM-DD). */
export function limitesDoMes(mes: string): { inicio: string; fim: string } {
  const ano = Number(mes.slice(0, 4))
  const numero = Number(mes.slice(5, 7))
  const ultimo = new Date(ano, numero, 0).getDate()
  return { inicio: `${mes}-01`, fim: `${mes}-${String(ultimo).padStart(2, '0')}` }
}
