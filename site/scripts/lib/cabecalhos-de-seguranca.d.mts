export const API_PADRAO: string
export const VALIDADE_DO_SECURITY_TXT_EM_DIAS: number
export function origemDe(url: string): string
export function politicaDeConteudo(urlDaApi?: string): string
export function cabecalhosDeSeguranca(urlDaApi?: string): Record<string, string>
export function configComCabecalhos(
  base: Record<string, unknown>,
  urlDaApi?: string,
): Record<string, unknown> & { globalHeaders: Record<string, string> }
export function securityTxt(opcoes: {
  email: string
  urlDoSite: string
  agora?: Date
}): string
