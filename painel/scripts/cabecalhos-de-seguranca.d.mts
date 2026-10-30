export const API_PADRAO: string
export function origemDe(url: string): string
export function resumosDosScriptsInline(html: string): string[]
export function politicaDeConteudo(
  urlDaApi?: string,
  resumos?: string[],
): string
export function cabecalhosDeSeguranca(
  urlDaApi?: string,
  resumos?: string[],
): Record<string, string>
export function configComCabecalhos<T extends object>(
  base: T,
  urlDaApi?: string,
  resumos?: string[],
): T & { globalHeaders: Record<string, string> }
