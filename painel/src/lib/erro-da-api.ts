import { ApiError } from './api'

// Texto de erro para a tela. O servidor já devolve o motivo em português (`detail`, ex.: "Só um projeto Público pode
// ficar em destaque no site..."): mostra-o como veio. Qualquer outra falha (rede caiu, erro de programação) vira o
// texto padrão que a tela passar, nunca uma mensagem técnica em inglês.
export function mensagemDoErro(erro: unknown, padrao: string): string {
  return erro instanceof ApiError && erro.detail ? erro.detail : padrao
}
