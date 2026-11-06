/** v9.3c: para procurar em listas sem ligar para acento nem maiúscula ("familia" acha "Família"). */
export function simplificar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}
