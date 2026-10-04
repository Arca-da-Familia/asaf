export interface MedidaDaPasta {
  bytes: number
  arquivos: number
  maior: { caminho: string | null; bytes: number }
}
export const LIMITE_FREE: { megabytes: number; arquivos: number }
export const PERCENTUAL_DE_AVISO: number
export const PERCENTUAL_DE_ERRO: number
export const LIMITE_DE_UM_ARQUIVO_MB: number
export function medirPasta(pasta: string): MedidaDaPasta
export function avaliar(
  medida: MedidaDaPasta,
  limite?: { megabytes: number; arquivos: number },
  limites?: { aviso?: number; erro?: number },
): {
  nivel: 'ok' | 'aviso' | 'erro'
  mensagens: string[]
  percentuais: { tamanho: number; arquivos: number }
}
