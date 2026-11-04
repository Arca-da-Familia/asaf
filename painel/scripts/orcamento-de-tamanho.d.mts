export const LIMITE_DA_ENTRADA_KB: number
export const LIMITE_DE_UM_PEDACO_KB: number
export type Arquivo = { arquivo: string; bytes: number }
export type Medida = {
  entrada: Arquivo[]
  totalDaEntrada: number
  pedacos: Arquivo[]
}
export function arquivosDaEntrada(html: string): string[]
export function medir(pasta?: string): Medida
export function conferir(medida: Medida): string[]
