import { useState } from 'react'

// v9.3b (pedido do Presidente, 05/11: telas compridas "tiram o foco dos dados"): divide em páginas uma lista que já chegou inteira à tela. Com o
// Paginador (components/data/Paginador.tsx). Quando a lista muda (filtro, item novo) e a página atual deixa de existir, volta para a última que existe;
// quando `reiniciarCom` muda (o filtro), volta para a primeira.
export function usePaginaLocal<T>(
  itens: readonly T[] | undefined,
  porPagina: number,
  reiniciarCom?: unknown,
): {
  pagina: number
  setPagina: (pagina: number) => void
  daPagina: T[]
  total: number
  porPagina: number
} {
  const [pagina, setPagina] = useState(1)
  const [filtroAnterior, setFiltroAnterior] = useState(reiniciarCom)
  // o filtro mudou: volta à 1ª página (ajuste durante a renderização, o jeito que o React recomenda no lugar de um efeito)
  if (filtroAnterior !== reiniciarCom) {
    setFiltroAnterior(reiniciarCom)
    setPagina(1)
  }
  const total = itens?.length ?? 0
  const paginas = Math.max(1, Math.ceil(total / porPagina))

  const atual = Math.min(pagina, paginas)
  const inicio = (atual - 1) * porPagina
  return {
    pagina: atual,
    setPagina,
    daPagina: (itens ?? []).slice(inicio, inicio + porPagina),
    total,
    porPagina,
  }
}
