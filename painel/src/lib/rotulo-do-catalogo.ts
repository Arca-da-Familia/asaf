import { useQuery } from '@tanstack/react-query'

import { listarOpcoesCatalogo } from '@/lib/api'

/** v9.3g: o que fazer com um código que a lista não tem (opção desligada, ou ainda carregando): sem sublinhado e só a 1ª letra maiúscula. */
export function semCodigo(codigo: string): string {
  const texto = codigo.replace(/_/g, ' ').trim().toLowerCase()
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/**
 * v9.3g (pedido do Presidente, 06/11: nada de nome técnico na tela): várias telas guardam o CÓDIGO de uma opção das Configurações (PALESTRA,
 * EM_EXECUCAO, COZINHA) e o mostravam cru. Este gancho devolve a função que troca o código pelo nome da opção ("Palestra", "Em execução",
 * "Cozinha"); usa o mesmo cache das listas de escolha (`['opcoes-catalogo', chave]`), então não pede nada a mais ao servidor.
 */
export function useRotuloDoCatalogo(
  chave: string,
): (codigo: string | null | undefined) => string {
  const { data: opcoes } = useQuery({
    queryKey: ['opcoes-catalogo', chave],
    queryFn: () => listarOpcoesCatalogo(chave),
  })
  return (codigo) => {
    if (!codigo) return ''
    const opcao = opcoes?.find((o) => o.codigo === codigo)
    if (opcao) return opcao.rotulo
    // algumas telas já guardam o nome (não o código): fica como está
    return /^[A-Z0-9_]+$/.test(codigo) ? semCodigo(codigo) : codigo
  }
}
