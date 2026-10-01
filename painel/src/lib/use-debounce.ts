import { useEffect, useState } from 'react'

// v4.10 - primeira busca textual "ao digitar" do painel (inscritos, beneficiários): debounce
// simples, sem nova dependência - só adia o valor que alimenta a query/queryKey do React Query,
// pra não disparar uma requisição a cada tecla.
export function useDebounce<T>(valor: T, atrasoMs = 400): T {
  const [debounced, setDebounced] = useState(valor)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(valor), atrasoMs)
    return () => clearTimeout(id)
  }, [valor, atrasoMs])
  return debounced
}
