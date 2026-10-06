// Espelho, no painel, da validação que o servidor faz ao reformar uma regra do estatuto (app/services/estatuto.py::validar_valor_da_regra):
// um valor que quebraria quem o lê (um quórum "abc" ou "2/0" derrubaria a apuração de quórum) é recusado ANTES de virar a regra vigente. O
// servidor continua sendo quem decide; aqui só se evita a ida e volta e se mostra a recusa no campo.
export function validarValorDaRegra(
  parametro: string,
  tipo: string,
  valor: string,
): string | null {
  const v = valor.trim()
  if (!v) return 'Informe o novo valor.'
  if (parametro === 'MESES_AGO_ESTATUTARIA') {
    const meses = v.split(',').map((m) => m.trim())
    const validos = meses.every(
      (m) => /^\d{1,2}$/.test(m) && +m >= 1 && +m <= 12,
    )
    if (!validos || new Set(meses).size !== meses.length) {
      return 'Informe os meses de 1 a 12, separados por vírgula e sem repetir (ex.: 2,8).'
    }
    return null
  }
  if (tipo === 'fracao') {
    const achado = /^(\d+)\/(\d+)(?:\+(\d+))?$/.exec(v.replace(/\s/g, ''))
    if (
      !achado ||
      +achado[2]! === 0 ||
      +achado[1]! < 1 ||
      +achado[1]! > +achado[2]!
    ) {
      return 'Informe uma fração como 2/3 (ou 1/2+1, para metade mais um): o numerador de 1 até o denominador, e o denominador maior que zero.'
    }
  } else if (tipo === 'numero') {
    if (!/^\d+$/.test(v) || +v < 1) {
      return 'Informe um número inteiro maior que zero (ex.: 30).'
    }
  } else if (tipo === 'booleano') {
    if (!['sim', 'nao'].includes(v.toLowerCase())) {
      return "Informe 'sim' ou 'nao'."
    }
  }
  return null
}
