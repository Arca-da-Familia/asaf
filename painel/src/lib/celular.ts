// v9.3z2 (pedido do Presidente, 05/11: celular primeiro): no celular cada linha de tabela vira um cartão de várias linhas, e 25 por página dá uma tela
// de 14 alturas. As listas paginadas pedem menos itens quando a tela é de celular (menos de 640 px, o mesmo corte do `sm` do Tailwind). Lido uma vez,
// ao abrir a tela (girar o aparelho não troca o tamanho da página no meio da leitura).
export function ehCelular(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 639.98px)').matches
  )
}

/** Quantos itens por página: `noComputador` a partir do tablet, `noCelular` (10) no celular. */
export function porPaginaNaTela(noComputador: number, noCelular = 10): number {
  return ehCelular() ? noCelular : noComputador
}
