// Validação de CPF no cliente (v0.2.1) — evita chamar a API com CPF inválido.
// Algoritmo oficial de dígitos verificadores (módulo 11).

export function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, '')
}

export function formatarCpf(valor: string): string {
  const digitos = somenteDigitos(valor).slice(0, 11)
  return digitos
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
}

function calcularDigito(base: string, pesoInicial: number): number {
  let soma = 0
  for (let i = 0; i < base.length; i += 1) {
    soma += Number(base[i]) * pesoInicial
    pesoInicial -= 1
  }
  const resto = (soma * 10) % 11
  return resto === 10 ? 0 : resto
}

export function validarCpf(cpf: string): boolean {
  const digitos = somenteDigitos(cpf)
  if (digitos.length !== 11) return false
  // Rejeita sequências de dígitos iguais (ex.: 111.111.111-11), que passam no
  // cálculo mas não são CPFs reais.
  if (/^(\d)\1{10}$/.test(digitos)) return false

  const base = digitos.slice(0, 9)
  const dv1 = calcularDigito(base, 10)
  const dv2 = calcularDigito(base + String(dv1), 11)

  return dv1 === Number(digitos[9]) && dv2 === Number(digitos[10])
}
