import { decodeQR } from 'qr/decode.js'

/**
 * Ajuda dos testes do QR Code do Pix (v5.6a): transforma a matriz de módulos (`true` = escuro) em pixels e a LÊ de volta com o leitor da própria biblioteca `qr` (só em
 * desenvolvimento: o site publicado só inclui o gerador). É a prova de que o desenho carrega EXATAMENTE o texto do código "copia e cola".
 */
export function lerMatriz(matriz: boolean[][], escala = 4): string {
  const lado = matriz.length * escala
  const dados = new Uint8ClampedArray(lado * lado * 4).fill(255)
  matriz.forEach((linha, y) =>
    linha.forEach((escuro, x) => {
      if (!escuro) return
      for (let dy = 0; dy < escala; dy++)
        for (let dx = 0; dx < escala; dx++) {
          const i = ((y * escala + dy) * lado + x * escala + dx) * 4
          dados[i] = dados[i + 1] = dados[i + 2] = 0
        }
    }),
  )
  return decodeQR({ width: lado, height: lado, data: dados })
}
