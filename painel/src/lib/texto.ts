/** v9.3c: para procurar em listas sem ligar para acento nem maiúscula ("familia" acha "Família"). */
export function simplificar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/** v9.3g: o código interno da opção nova sai do nome ("Viúvo(a)" → "VIUVO_A"); quem cria nunca o vê nem o digita. */
export function codigoDoRotulo(rotulo: string): string {
  const codigo = simplificar(rotulo)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return codigo || 'OPCAO'
}
