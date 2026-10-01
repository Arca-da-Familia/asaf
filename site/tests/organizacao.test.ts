import { describe, expect, it } from 'vitest'

import { ENDERECO_LINHA, LOGO, ORGANIZACAO } from '../src/config/organizacao'

/** Dígitos verificadores do CNPJ (módulo 11) — o mesmo algoritmo da Receita Federal. */
function cnpjValido(cnpj: string): boolean {
  const d = cnpj.replace(/\D/g, '')
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  const digito = (base: string, pesos: number[]) => {
    const soma = base
      .split('')
      .reduce((acc, n, i) => acc + Number(n) * pesos[i]!, 0)
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const p2 = [6, ...p1]
  const d1 = digito(d.slice(0, 12), p1)
  const d2 = digito(d.slice(0, 12) + d1, p2)
  return d.endsWith(`${d1}${d2}`)
}

describe('dados institucionais', () => {
  it('o CNPJ publicado passa na checagem de dígitos verificadores', () => {
    // Erro de digitação num CNPJ público (emendas parlamentares!) não pode ir ao ar.
    expect(ORGANIZACAO.cnpj).toMatch(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/)
    expect(cnpjValido(ORGANIZACAO.cnpj)).toBe(true)
  })

  it('o validador de CNPJ do teste reprova número inválido (teste do teste)', () => {
    expect(cnpjValido('17.631.942/0001-71')).toBe(false)
    expect(cnpjValido('11.111.111/1111-11')).toBe(false)
  })

  it('as três formas do telefone são o MESMO número', () => {
    const digitos = (s: string) => s.replace(/\D/g, '')
    // texto "(94) 98412-0703" == link tel:+5594984120703 == "+55-94-98412-0703"
    expect(digitos(ORGANIZACAO.telefoneLink)).toBe(
      `55${digitos(ORGANIZACAO.telefone)}`,
    )
    expect(digitos(ORGANIZACAO.telefoneInternacional)).toBe(
      digitos(ORGANIZACAO.telefoneLink),
    )
    expect(ORGANIZACAO.telefoneLink.startsWith('tel:+55')).toBe(true)
  })

  it('e-mail e CEP têm formato válido; endereço é o do Estatuto', () => {
    expect(ORGANIZACAO.email).toMatch(/^[^\s@]+@asaf\.org\.br$/)
    expect(ORGANIZACAO.endereco.cep).toMatch(/^\d{5}-\d{3}$/)
    expect(ENDERECO_LINHA).toBe('Rua Paulo Afonso, 150 — Bairro da Paz')
    expect(ORGANIZACAO.cidade).toBe('Parauapebas')
    expect(ORGANIZACAO.uf).toBe('PA')
  })

  it('a proporção da logo é a do arquivo mestre (reserva espaço sem salto de layout)', () => {
    expect(LOGO.proporcao).toBeCloseTo(2607 / 2160, 5)
    // O PNG de 600 px de largura tem a mesma proporção (tolerância de 1 px de arredondamento).
    expect(
      Math.abs(LOGO.pngLargura / LOGO.pngAltura - LOGO.proporcao),
    ).toBeLessThan(0.01)
  })
})
