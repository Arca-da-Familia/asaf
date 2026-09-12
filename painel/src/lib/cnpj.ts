// Validação e máscara de CNPJ (v0.2.4) — espelho do que cpf.ts faz para CPF.

export function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, '')
}

export function formatarCnpj(valor: string): string {
  const digitos = somenteDigitos(valor).slice(0, 14)
  return digitos
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}

function calcularDigito(cnpj: string, pesos: number[]): number {
  let soma = 0
  for (let i = 0; i < pesos.length; i += 1) {
    soma += Number(cnpj[i]) * pesos[i]!
  }
  const resto = soma % 11
  return resto < 2 ? 0 : 11 - resto
}

export function validarCnpj(cnpj: string): boolean {
  const digitos = somenteDigitos(cnpj)
  if (digitos.length !== 14) return false
  if (/^(\d)\1{13}$/.test(digitos)) return false

  const base = digitos.slice(0, 12)
  const dv1 = calcularDigito(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const dv2 = calcularDigito(
    base + String(dv1),
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  )

  return dv1 === Number(digitos[12]) && dv2 === Number(digitos[13])
}
