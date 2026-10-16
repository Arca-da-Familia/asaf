import type { SituacaoDaIntencaoDeDoacao } from './api'
import { formatarCpf, somenteDigitos } from './cpf'

// v5.6a - o que a seção "Doações do site (Pix)" da tela de Doações mostra e pede, longe do desenho da tela.

export const INTENCOES_POR_PAGINA = 25

// O que a tesouraria vê primeiro: o que ainda espera uma decisão (aguardando conferência + prazo vencido).
export const SITUACAO_PADRAO = 'a_conferir'

export const OPCOES_DE_SITUACAO: { valor: string; rotulo: string }[] = [
  { valor: 'a_conferir', rotulo: 'A conferir' },
  { valor: 'PENDENTE', rotulo: 'Aguardando conferência' },
  { valor: 'EXPIRADA', rotulo: 'Prazo vencido' },
  { valor: 'NAO_LOCALIZADA', rotulo: 'Pix não localizado' },
  { valor: 'CONFIRMADA', rotulo: 'Confirmadas' },
  { valor: '', rotulo: 'Todas' },
]

// Cor + ícone + texto: a situação nunca depende só da cor.
export const CLASSE_DA_SITUACAO_DA_INTENCAO: Record<
  SituacaoDaIntencaoDeDoacao,
  string
> = {
  PENDENTE:
    'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300',
  EXPIRADA: 'bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300',
  NAO_LOCALIZADA: 'bg-muted text-foreground',
  CONFIRMADA:
    'bg-green-100 text-green-900 dark:bg-green-500/15 dark:text-green-300',
}

export function reais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

// O CPF inteiro, no formato 000.000.000-00: a tesouraria confere com o extrato do banco. Qualquer outro documento aparece como veio.
export function cpfParaATela(documento: string | null): string | null {
  if (!documento) return null
  return somenteDigitos(documento).length === 11
    ? formatarCpf(documento)
    : documento
}

// O valor no campo, como a pessoa escreve no Brasil ("1200,50"); vazio quando o doador não informou valor.
export function valorParaOCampo(valor: number | null): string {
  if (valor === null || valor === undefined) return ''
  return Number(valor).toFixed(2).replace('.', ',')
}
