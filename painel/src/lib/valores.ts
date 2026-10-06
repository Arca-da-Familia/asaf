// Aceita como a pessoa escreve no Brasil: "50.000,00", "50000,5", "R$ 1.200", "50000.00".
// Devolve texto com ponto decimal ("50000.00") para a API, ou null se não der para entender.
export function lerValorEmReais(texto: string): string | null {
  const limpo = texto.replace(/R\$/gi, '').replace(/\s/g, '').trim()
  if (!limpo || !/^[\d.,]+$/.test(limpo)) return null
  const temVirgula = limpo.includes(',')
  let normalizado: string
  if (temVirgula) {
    // vírgula = decimal; pontos antes dela são milhar
    const [parteInteira, centavos, sobra] = limpo.split(',')
    if (
      parteInteira === undefined ||
      centavos === undefined ||
      sobra !== undefined
    )
      return null
    if (centavos.length > 2 || !/^\d*$/.test(centavos)) return null
    const inteiro = parteInteira.replace(/\./g, '')
    if (!/^\d+$/.test(inteiro)) return null
    normalizado = `${inteiro}.${centavos.padEnd(2, '0')}`
  } else if (/^\d{1,3}(\.\d{3})+$/.test(limpo)) {
    normalizado = limpo.replace(/\./g, '') // 1.200 / 50.000 = milhar
  } else if (/^\d+(\.\d{1,2})?$/.test(limpo)) {
    normalizado = limpo.includes('.')
      ? limpo.padEnd(limpo.indexOf('.') + 3, '0')
      : `${limpo}.00`
  } else {
    return null
  }
  return Number(normalizado) > 0 ? normalizado : null
}
